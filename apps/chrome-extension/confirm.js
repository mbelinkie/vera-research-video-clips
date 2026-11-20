import { connection, gateway } from "./connect.js";

const byId = (id) => document.getElementById(id);
const names = {
  quote: "Save quote",
  page: "Save page",
  still: "Save as still",
  audio: "Save audio",
  youtube: "Save video",
};
const status = byId("status");
const projects = byId("project");
const reason = byId("reason");
const note = byId("note");
const time = byId("time");
const timeText = byId("time-text");
const requestId = location.hash.slice(1);
let draft;
let paired;
let busy = false;
let complete = false;
let writeRequestId = requestId;
let attemptedIntent;
let sampledPlayheadMs;
let timeProbeAttempted = false;
let timeProbePromise;
let timeModeGeneration = 0;
let activeProjectId = "";
let reasonRevision = 0;
const reasonDrafts = new Map();
const reasonDirty = new Map();
const reasonHydration = new Map();
const intentRequestIds = new Map();
const noteDrafts = new Map();
let prefillGeneration = 0;

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

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

function freshRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? requestId;
}

function syncYouTubeSubmit() {
  if (draft?.kind !== "youtube") return;
  reason.disabled = note.disabled = !projects.value;
  byId("submit").disabled =
    !projects.value ||
    (time.checked
      ? !Number.isSafeInteger(sampledPlayheadMs)
      : reasonHydration.get(projects.value) === "pending");
}

function youtubeMode(isMoment) {
  if (!draft || draft.kind !== "youtube") return;
  byId("video-reason").hidden = isMoment;
  byId("moment-note-field").hidden = !isMoment;
  byId("submit").textContent = isMoment
    ? "Save moment at " + formatTime(sampledPlayheadMs)
    : "Save video";
  syncYouTubeSubmit();
}

function rememberProjectDraft() {
  if (!activeProjectId || !draft || draft.kind !== "youtube") return;
  reasonDrafts.set(activeProjectId, reason.value);
  noteDrafts.set(activeProjectId, note.value);
}

function setProjectDraft(projectId) {
  activeProjectId = projectId;
  reason.value = reasonDrafts.get(projectId) ?? "";
  note.value = noteDrafts.get(projectId) ?? "";
  reasonRevision++;
}

async function prefillYouTubeReason(projectId) {
  if (!projectId || !draft || draft.kind !== "youtube") return;
  const generation = ++prefillGeneration;
  const revision = reasonRevision;
  if (reasonDirty.get(projectId)) {
    reasonHydration.set(projectId, "dirty");
    return;
  }
  reasonHydration.set(projectId, "pending");
  syncYouTubeSubmit();
  try {
    const result = await gateway(
      paired.origin,
      "projects/" + encodeURIComponent(projectId) + "/youtube-source",
      { url: draft.url },
      paired.key,
    );
    if (
      generation !== prefillGeneration ||
      projects.value !== projectId ||
      reasonRevision !== revision ||
      reasonDirty.get(projectId)
    )
      return;
    const text =
      typeof result?.reason?.text === "string" ? result.reason.text : "";
    reasonDrafts.set(projectId, text);
    reason.value = text;
    reasonRevision++;
    reasonHydration.set(projectId, "ready");
  } catch (error) {
    if (
      generation === prefillGeneration &&
      projects.value === projectId &&
      reasonRevision === revision &&
      !reasonDirty.get(projectId)
    ) {
      reasonHydration.set(projectId, "failed");
      status.textContent =
        (error instanceof Error ? error.message : "") +
        " Refresh projects to try again, or edit the reason explicitly.";
      byId("retry").hidden = false;
    }
  } finally {
    syncYouTubeSubmit();
  }
}

async function probeYouTubeTime() {
  if (timeProbeAttempted) {
    if (Number.isSafeInteger(sampledPlayheadMs)) youtubeMode(true);
    return;
  }
  if (timeProbePromise) return timeProbePromise;
  const generation = ++timeModeGeneration;
  time.disabled = true;
  timeText.textContent = "Reading current time…";
  syncYouTubeSubmit();
  timeProbePromise = (async () => {
    let result;
    try {
      result = await chrome.runtime.sendMessage({
        type: "vera.capture.youtube-playhead",
        requestId,
      });
    } catch {
      result = {
        ok: false,
        error:
          "Time unavailable. Reopen the capture once the source video can be verified.",
      };
    }
    timeProbeAttempted = true;
    timeProbePromise = undefined;
    const playheadMs = result?.ok ? result.playheadMs : undefined;
    if (Number.isSafeInteger(playheadMs) && playheadMs >= 0) {
      sampledPlayheadMs = playheadMs;
      time.disabled = false;
      timeText.textContent = "Include " + formatTime(playheadMs);
      if (time.checked && generation === timeModeGeneration) youtubeMode(true);
      return;
    }
    sampledPlayheadMs = undefined;
    time.checked = false;
    time.disabled = true;
    timeText.textContent =
      result?.error ||
      "Time unavailable. Reopen the capture once the source video can be verified.";
    youtubeMode(false);
  })();
  return timeProbePromise;
}

time.onchange = () => {
  timeModeGeneration++;
  if (time.checked) return probeYouTubeTime();
  if (Number.isSafeInteger(sampledPlayheadMs)) youtubeMode(false);
  return undefined;
};
reason.oninput = () => {
  reasonRevision++;
  if (activeProjectId) {
    reasonDrafts.set(activeProjectId, reason.value);
    reasonDirty.set(activeProjectId, true);
    reasonHydration.set(activeProjectId, "dirty");
    syncYouTubeSubmit();
  }
};
note.oninput = () => {
  if (activeProjectId) noteDrafts.set(activeProjectId, note.value);
};
projects.onchange = () => {
  rememberProjectDraft();
  setProjectDraft(projects.value);
  syncYouTubeSubmit();
  void prefillYouTubeReason(projects.value);
};

async function load() {
  byId("fields").disabled = true;
  const previousProject = projects.value || activeProjectId;
  const previousReason = reason.value;
  const previousNote = note.value;
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
      delete draft.captureWarnings;
      writeRequestId = draft.requestId;
      byId("heading").textContent = byId("submit").textContent =
        names[draft.kind];
      byId("source").textContent =
        (draft.metadata?.title || draft.title || "") + " " + draft.url;
      if (draft.kind === "youtube") {
        byId("video-reason").hidden = false;
        byId("time-label").hidden = false;
        time.checked = false;
        time.disabled = false;
        timeText.textContent = "Capture current time";
        youtubeMode(false);
      }
      if (draft.kind === "quote") {
        byId("quote-fields").hidden = false;
        byId("excerpt").hidden = false;
        byId("excerpt").textContent = draft.quote.text;
      }
      if (draft.kind === "quote" || draft.kind === "page") {
        byId("repair").hidden = false;
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
    const preferred = list.some((project) => project.id === previousProject)
      ? previousProject
      : list.length === 1
        ? list[0].id
        : "";
    projects.value = preferred;
    if (draft.kind === "youtube") {
      setProjectDraft(preferred);
      if (previousProject === preferred && previousReason)
        reason.value = previousReason;
      if (previousProject === preferred && previousNote)
        note.value = previousNote;
    }
    byId("fields").disabled = false;
    byId("retry").hidden = true;
    status.textContent = "Connected to " + paired.origin;
    projects.focus();
    syncYouTubeSubmit();
    void prefillYouTubeReason(preferred);
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
      const details = time.checked
        ? {
            kind: "moment",
            timecodeMs: sampledPlayheadMs,
            note: note.value.trim(),
          }
        : { kind: "general", reason: reason.value.trim() };
      if (
        details.kind === "moment" &&
        (!Number.isSafeInteger(details.timecodeMs) || details.timecodeMs < 0)
      ) {
        time.checked = false;
        youtubeMode(false);
        throw new Error(
          "Time unavailable. Save the video without a timecode, or try again from the source tab.",
        );
      }
      if (
        details.kind === "general" &&
        !reasonDirty.get(projectId) &&
        reasonHydration.get(projectId) !== "ready"
      )
        throw new Error(
          "The saved reason is not loaded yet. Retry the lookup or edit the reason explicitly.",
        );
      const intent = JSON.stringify({ projectId, url: draft.url, details });
      if (!intentRequestIds.has(intent))
        intentRequestIds.set(
          intent,
          attemptedIntent === undefined ? writeRequestId : freshRequestId(),
        );
      writeRequestId = intentRequestIds.get(intent);
      attemptedIntent = intent;
      body = {
        kind: "youtube",
        requestId: writeRequestId,
        url: draft.url,
        youtubeDetails: details,
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
    if (draft.kind === "page" || draft.kind === "quote") {
      const code = byId("repair-code").value.trim();
      if (code) {
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(code))
          throw new Error(
            "Check the picture repair code from your earlier save.",
          );
        body = { ...body, repairCaptureId: code };
      }
    }
    const receipt = await gateway(
      paired.origin,
      "projects/" + encodeURIComponent(projectId) + "/captures",
      body,
      paired.key,
    );
    if (draft.kind === "youtube") {
      const action =
        body.youtubeDetails.kind === "moment" ? "Moment saved" : "Video saved";
      const stateMessage =
        receipt.status === "ready_for_review"
          ? "The transcript is ready for review."
          : receipt.status === "queued"
            ? "The video is in the transcription queue."
            : ["blocked", "canceled"].includes(receipt.status)
              ? "Open the batch in Research to check its status."
              : "Transcription is in progress.";
      status.textContent = action + " in " + projectName + ". " + stateMessage;
      if (body.youtubeDetails.kind === "general") {
        reasonDrafts.set(projectId, reason.value);
        reasonDirty.set(projectId, false);
        reasonHydration.set(projectId, "ready");
      }
      const link = byId("open-source");
      if (link && receipt.sourcePath) {
        link.href = new URL(receipt.sourcePath, paired.origin).href;
        link.hidden = false;
      }
    } else if (receipt.missingPictures?.length) {
      status.textContent =
        "Saved to " +
        projectName +
        ". Still missing: " +
        receipt.missingPictures.join(", ") +
        ". Capture the same page or passage again and enter this picture repair code: " +
        receipt.captureId;
    } else if (body.repairCaptureId) {
      status.textContent =
        "Both pictures are available on your earlier save in " +
        projectName +
        ".";
    } else status.textContent = "Saved to " + projectName + ".";
    complete = true;
    draft = undefined;
    byId("cancel").textContent = "Close";
    byId("settings").hidden = true;
    byId("cancel").focus();
    if (body.kind === "quote" && !receipt.missingPictures?.length)
      setTimeout(() => window.close(), 900);
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
