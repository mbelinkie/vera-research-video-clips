import { connection, gateway, veraOrigin } from "./connect.js";
const byId = (id) => document.getElementById(id);
let saved = await connection();
let approvalUrl;
const origin = byId("origin");
const status = byId("status");
function refresh() {
  origin.value = saved?.origin ?? "http://127.0.0.1:43112";
  byId("check").hidden = !saved;
  byId("disconnect").hidden = !saved;
}
refresh();
byId("connect").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const address = veraOrigin(origin.value);
    if (saved && saved.origin !== address)
      throw new Error(
        "Disconnect the current server before changing the address.",
      );
    const host = new URL(address);
    if (
      !(await chrome.permissions.request({
        origins: [host.protocol + "//" + host.hostname + "/*"],
      }))
    )
      throw new Error("Permission to contact this VERA server is required.");
    if (saved) {
      try {
        await gateway(saved.origin, "projects", {}, saved.key);
        status.textContent = "Already connected. You can close Settings.";
        return;
      } catch (error) {
        if (!error.message.startsWith("Connect the extension")) throw error;
      }
    }
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const hex = (value) =>
      Array.from(value, (x) => x.toString(16).padStart(2, "0")).join("");
    const digest = hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    );
    const { requestId, code } = await gateway(address, "pair", { digest });
    if (!/^[0-9a-f-]{36}$/.test(requestId) || !/^\d{8}$/.test(code))
      throw new Error("This server did not return a VERA connection code.");
    saved = { origin: address, key: hex(bytes) };
    await chrome.storage.local.set({ connection: saved });
    refresh();
    approvalUrl = address + "/?chrome-pair#" + requestId;
    byId("code").textContent = code;
    byId("pair").hidden = false;
    status.textContent = "Waiting for approval.";
    await chrome.tabs.create({ url: approvalUrl });
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
byId("approve").onclick = () => chrome.tabs.create({ url: approvalUrl });
byId("check").onclick = async () => {
  try {
    await gateway(saved.origin, "projects", {}, saved.key);
    status.textContent = "Connected. You can close Settings.";
    byId("pair").hidden = true;
  } catch (error) {
    status.textContent = error.message;
  }
};
byId("disconnect").onclick = async () => {
  if (!saved) return;
  try {
    try {
      await gateway(saved.origin, "disconnect", {}, saved.key);
    } catch (error) {
      if (!error.message.startsWith("Connect the extension")) throw error;
    }
    await chrome.storage.local.remove("connection");
    const host = new URL(saved.origin);
    await chrome.permissions.remove({
      origins: [host.protocol + "//" + host.hostname + "/*"],
    });
    saved = undefined;
    byId("pair").hidden = true;
    refresh();
    status.textContent = "Disconnected.";
  } catch {
    status.textContent =
      "Unable to revoke the connection. Reconnect to the server and retry.";
  }
};
