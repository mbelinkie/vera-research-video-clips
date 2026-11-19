import { connection, gateway } from "./connect.js";
const byId = (id) => document.getElementById(id);
const names = {
  quote: "Save quote",
  page: "Save page",
  still: "Save as still",
  audio: "Save audio",
  youtube: "Queue video",
};
const status = byId("status");
const projects = byId("project");
const requestId = location.hash.slice(1);
let draft,
  paired,
  busy = false,
  complete = false;
byId("cancel").onclick = () => window.close();
byId("settings").onclick = () => chrome.runtime.openOptionsPage();
function picture(title, src) {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = title;
  const img = document.createElement("img");
  img.alt = title;
  img.src = src;
  figure.append(img, caption);
  byId("images").append(figure);
}
async function load() {
  byId("fields").disabled = true;
  try {
    if (!draft) {
      draft = await chrome.runtime.sendMessage({
        type: "vera.capture.read",
        requestId,
      });
      if (
        !draft ||
        draft.requestId !== requestId ||
        !Object.hasOwn(names, draft.kind)
      )
        throw new Error(
          "This capture expired. Return to the source and capture it again.",
        );
      // Missing picture messages are local UI state. Only capture fields go to VERA.
      delete draft.captureWarnings;
      byId("heading").textContent = byId("submit").textContent =
        names[draft.kind];
      byId("source").textContent =
        (draft.metadata?.title || draft.title || "") + " " + draft.url;
      byId("video-reason").hidden = draft.kind !== "youtube";
      if (
        draft.kind === "youtube" &&
        Number.isSafeInteger(draft.playheadMs) &&
        draft.playheadMs >= 0
      ) {
        const seconds = Math.floor(draft.playheadMs / 1000);
        byId("time-label").hidden = false;
        byId("time-text").textContent =
          "Include " +
          Math.floor(seconds / 60) +
          ":" +
          String(seconds % 60).padStart(2, "0");
      }
      if (draft.kind === "quote") {
        byId("quote-fields").hidden = false;
        byId("excerpt").hidden = false;
        byId("excerpt").textContent = draft.quote.text;
      }
      if (draft.kind === "quote" || draft.kind === "page") {
        const missing = [];
        for (const [key, label] of [
          ["top", "Top of article"],
          ["passage", "Passage view"],
        ]) {
          if (draft[key])
            picture(label, "data:image/png;base64," + draft[key].data);
          else missing.push(label);
        }
        if (draft.kind === "quote" && !draft.quote.highlight)
          missing.push("Highlight position");
        if (missing.length)
          byId("capture-warning").textContent =
            "Unavailable in this capture: " +
            missing.join(", ") +
            ". You can still save the text.";
      }
      if (draft.kind === "still")
        picture(
          "Kept image",
          "data:" + draft.mimeType + ";base64," + draft.data,
        );
    }
    paired = await connection();
    if (!paired)
      throw new Error("Connect to VERA in Settings, then refresh projects.");
    const list = await gateway(paired.origin, "projects", {}, paired.key);
    projects.replaceChildren(new Option("Choose a project", ""));
    for (const project of list)
      projects.add(new Option(project.name, project.id));
    if (!list.length) throw new Error("Your account has no writable projects.");
    if (list.length === 1) projects.selectedIndex = 1;
    byId("fields").disabled = false;
    byId("retry").hidden = true;
    status.textContent = "Connected to " + paired.origin;
    projects.focus();
  } catch (error) {
    status.textContent = error.message;
    byId("retry").hidden = false;
  }
}
byId("retry").onclick = () => void load();
byId("save").onsubmit = async (event) => {
  event.preventDefault();
  if (busy || complete || !draft || !projects.value) return;
  busy = true;
  byId("fields").disabled = true;
  const projectId = projects.value;
  const projectName = projects.selectedOptions[0].text;
  byId("retry").hidden = true;
  byId("cancel").disabled = true;
  status.textContent = "Saving to " + projectName + "…";
  try {
    const current = await connection();
    if (
      !current ||
      current.origin !== paired.origin ||
      current.key !== paired.key
    )
      throw new Error(
        "The connection changed. Refresh projects before saving.",
      );
    let body = draft;
    if (draft.kind === "youtube") {
      const { playheadMs, ...video } = draft;
      const comment = byId("comment").value.trim();
      body = {
        ...video,
        ...(comment && { comment }),
        ...(byId("time").checked &&
          Number.isSafeInteger(playheadMs) && { timecodeMs: playheadMs }),
      };
    }
    if (draft.kind === "quote") {
      const speaker = byId("speaker").value.trim(),
        speakerTitle = byId("speaker-title").value.trim();
      body = {
        ...draft,
        quote: {
          ...draft.quote,
          ...(speaker && { speaker }),
          ...(speakerTitle && { speakerTitle }),
        },
        topics: byId("topics")
          .value.split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        notes: byId("notes").value,
      };
    }
    const receipt = await gateway(
      paired.origin,
      "projects/" + encodeURIComponent(projectId) + "/captures",
      body,
      paired.key,
    );
    if (draft.kind === "youtube") {
      const stateMessage =
        receipt.status === "ready_for_review"
          ? "The transcript is ready for review."
          : receipt.status === "queued"
            ? "The video is in the transcription queue."
            : ["blocked", "canceled"].includes(receipt.status)
              ? "Open the batch in Research to check its status."
              : "Transcription is in progress.";
      const hasComment = Boolean(body.comment || body.timecodeMs !== undefined);
      status.textContent =
        (hasComment ? "Comment saved with the video in " : "Video saved in ") +
        projectName +
        ". " +
        stateMessage;
    } else status.textContent = "Saved to " + projectName + ".";
    complete = true;
    draft = undefined;
    byId("cancel").textContent = "Close";
    byId("settings").hidden = true;
    byId("cancel").focus();
  } catch (error) {
    status.textContent = error.message;
    byId("retry").hidden = false;
  } finally {
    busy = false;
    byId("cancel").disabled = false;
    byId("fields").disabled = complete;
  }
};
void load();
