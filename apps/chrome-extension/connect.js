export function veraOrigin(value) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Enter the HTTPS address of VERA, or its local address.");
  return url.origin;
}
export async function connection() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  return (await chrome.storage.local.get("connection")).connection;
}
export async function gateway(origin, path, body, key) {
  const response = await fetch(veraOrigin(origin) + "/extension/v1/" + path, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(key && { "x-vera-capture-key": key }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const messages = {
      401: "Connect the extension to VERA in Settings.",
      403: "You do not have permission for this action.",
      409: "This capture conflicts with an earlier save.",
      413: "This capture exceeds the upload size limit.",
      422: "The video details are unavailable. Try again later.",
      429: "VERA is busy. Try again shortly.",
    };
    throw new Error(
      messages[response.status] ??
        "VERA could not save this request. Check the server and try again.",
    );
  }
  return response.json();
}
