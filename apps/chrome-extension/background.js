import {
  PENDING_CAPTURE_TTL_MS,
  base64Payload,
  isHttpUrl,
  normalizeYouTubeUrl,
  pendingKey,
  safePageUrl,
} from "./src/capture-utils.mjs";
import {
  highlightFromVisibleRects,
  pngDimensions,
} from "./src/highlight-geometry.mjs";
import { stitchTallTop } from "./src/tall-top.mjs";

const pending = new Map();
const statuses = new Map();
const activationEpoch = new Map();
const screenshotTail = new Map();
const lastScreenshotAt = new Map();
const MEDIA_PATH =
  /\.(?:aac|aiff?|flac|m4a|m4v|mp3|mp4|mpeg|oga|ogg|opus|wav|webm)(?:$|[?#])/i;
const SCREENSHOT_INTERVAL_MS = 550;
const YOUTUBE_SESSION_PREFIX = "veraYoutubeCapture:";

class CaptureSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptureSafetyError";
  }
}

function chromeApi() {
  return globalThis.chrome;
}

function requestId() {
  return crypto.randomUUID();
}

function rememberStatus(status) {
  const value = {
    scope: status.scope ?? "global",
    ok: status.ok === true,
    message:
      typeof status.message === "string" && status.message.length <= 512
        ? status.message
        : status.ok === true
          ? "Capture is ready for confirmation"
          : "Capture failed. Check the current tab and try again.",
    at: Date.now(),
  };
  statuses.set(value.scope, value);
  const write = chromeApi().storage?.local?.set?.({ veraCaptureStatus: value });
  if (write && typeof write.catch === "function") write.catch(() => {});
}

function statusError(error) {
  const message = error instanceof Error ? error.message : "";
  if (
    /^(Select|This page|Keep the full|The linked resource|Choose a direct|The image|This is not|The capture tab|The capture page|The capture viewport|The selected passage|Chrome returned|Invalid PNG|PNG dimensions)/.test(
      message,
    )
  ) {
    return message;
  }
  return "Capture failed. Check the current tab and try again.";
}

function isCaptureSafetyError(error) {
  return error instanceof CaptureSafetyError;
}

function supportedPage(tab) {
  return (
    tab && (tab.url?.startsWith("https://") || tab.url?.startsWith("http://"))
  );
}

async function sourceTab(tabId) {
  const tab = await chromeApi().tabs.get(tabId);
  if (!tab || tab.id === undefined) {
    throw new CaptureSafetyError("The capture tab is no longer available");
  }
  if (!supportedPage(tab)) throw new Error("This page cannot be captured");
  return tab;
}

async function activeTab(expectedTabId) {
  const tabs = await chromeApi().tabs.query({
    active: true,
    currentWindow: true,
  });
  const tab = tabs[0];
  if (
    tab?.id === undefined ||
    (expectedTabId !== undefined && tab.id !== expectedTabId)
  ) {
    throw new CaptureSafetyError("The capture tab is no longer active");
  }
  if (!supportedPage(tab)) throw new Error("This page cannot be captured");
  return tab;
}

function sameViewport(left, right) {
  return (
    left && right && left.width === right.width && left.height === right.height
  );
}

function sameSourceUrl(contextUrl, currentUrl, youtube) {
  if (youtube) {
    const expected = normalizeYouTubeUrl(contextUrl);
    const current = normalizeYouTubeUrl(currentUrl);
    return Boolean(expected && current && expected === current);
  }
  return safePageUrl(currentUrl) === contextUrl;
}

async function captureContext(tabId, requireActive) {
  const tab = requireActive ? await activeTab(tabId) : await sourceTab(tabId);
  const url = safePageUrl(tab.url ?? "");
  if (!url || tab.windowId === undefined)
    throw new Error("The capture page has no safe URL");
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    url,
    navigationKey: null,
    viewport: null,
    documentId: null,
    youtubeIdentity: null,
    activationEpoch: activationEpoch.get(tab.windowId) ?? 0,
  };
}

async function assertContext(
  context,
  checkContent = true,
  requireActive = true,
) {
  const tab = await chromeApi().tabs.get(context.tabId);
  const current = requireActive
    ? await activeTab(context.tabId)
    : await sourceTab(context.tabId);
  if (
    tab.windowId !== context.windowId ||
    current.windowId !== context.windowId ||
    !sameSourceUrl(context.url, tab.url ?? "", context.youtubeIdentity) ||
    !sameSourceUrl(context.url, current.url ?? "", context.youtubeIdentity)
  ) {
    throw new CaptureSafetyError(
      "The capture tab changed; no screenshot was attached",
    );
  }
  if (
    !context.youtubeIdentity &&
    (activationEpoch.get(context.windowId) ?? 0) !== context.activationEpoch
  ) {
    throw new CaptureSafetyError("The capture tab was switched during capture");
  }
  let identity;
  if (checkContent && (context.navigationKey || context.youtubeIdentity)) {
    identity = await sendContent(
      context.tabId,
      {
        type: "vera.capture.identity",
      },
      context.documentId,
    );
    if (
      !identity?.ok ||
      (!context.youtubeIdentity &&
        identity.value.navigationKey !== context.navigationKey)
    ) {
      throw new CaptureSafetyError(
        "The capture page navigated; no screenshot was attached",
      );
    }
    if (
      context.viewport &&
      !sameViewport(identity.value.viewport, context.viewport)
    ) {
      throw new CaptureSafetyError(
        "The capture viewport changed; no screenshot was attached",
      );
    }
    if (
      context.youtubeIdentity &&
      !sameYouTubeIdentity(
        context.youtubeIdentity,
        identity.value.youtube ?? null,
      )
    ) {
      throw new CaptureSafetyError(
        "The YouTube video changed; no capture was attached",
      );
    }
  }
  return { tab, identity: identity?.value };
}

async function injectContent(tabId, requireDocument = false) {
  const result = await chromeApi().scripting.executeScript({
    target: requireDocument ? { tabId, frameIds: [0] } : { tabId },
    files: ["content.js"],
  });
  const top = Array.isArray(result)
    ? (result.find((entry) => entry?.frameId === 0) ?? result[0])
    : undefined;
  const documentId = top?.documentId;
  if (requireDocument && typeof documentId !== "string")
    throw new CaptureSafetyError(
      "The source page could not be verified. Reopen the capture and try again.",
    );
  return typeof documentId === "string" ? documentId : null;
}

async function sendContent(tabId, message, documentId) {
  const response = await chromeApi().tabs.sendMessage(
    tabId,
    message,
    ...(typeof documentId === "string" ? [{ documentId }] : []),
  );
  if (!response?.ok)
    throw new Error(response?.error || "The page did not respond");
  return response;
}

async function capturePng(context) {
  await assertContext(context);
  let release;
  const previous = screenshotTail.get(context.windowId) ?? Promise.resolve();
  const current = new Promise((resolve) => {
    release = resolve;
  });
  screenshotTail.set(context.windowId, current);
  let dataUrl;
  await previous;
  try {
    const waitMs = Math.max(
      0,
      SCREENSHOT_INTERVAL_MS -
        (Date.now() - (lastScreenshotAt.get(context.windowId) ?? -Infinity)),
    );
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    await assertContext(context);
    lastScreenshotAt.set(context.windowId, Date.now());
    try {
      dataUrl = await chromeApi().tabs.captureVisibleTab(context.windowId, {
        format: "png",
      });
    } catch {
      // A restricted or unavailable screenshot still permits an explicitly
      // confirmed text capture. Any changed document or tab must abort it.
      await assertContext(context);
      return undefined;
    }
  } finally {
    release();
    if (screenshotTail.get(context.windowId) === current) {
      screenshotTail.delete(context.windowId);
    }
  }
  await assertContext(context);
  const encoded = base64Payload(dataUrl);
  if (!encoded || encoded.mimeType !== "image/png")
    throw new Error("Chrome returned an invalid screenshot");
  const dimensions = pngDimensions(encoded.data, encoded.mimeType);
  return { ...encoded, ...dimensions };
}

function imagePayload(capture) {
  return { data: capture.data, width: capture.width, height: capture.height };
}

async function captureTallTop(context) {
  const first = await capturePng(context);
  if (!first) return undefined;
  try {
    const step = (
      await sendContent(context.tabId, { type: "vera.capture.top-next" })
    ).value;
    if (!step?.delta) return first;
    await assertContext(context);
    const second = await capturePng(context);
    if (!second) return first;
    return (
      (await stitchTallTop(first, second, step, context.viewport)) ?? first
    );
  } catch (error) {
    // A tab switch, navigation or viewport change is never a valid fallback.
    if (isCaptureSafetyError(error)) throw error;
    await assertContext(context);
    // Page shifts, screenshot failures and unavailable canvas processing keep
    // the original valid one-viewport top image.
    return first;
  }
}

function quotePayload(request, core, top, passage) {
  const result = {
    kind: "quote",
    requestId: request,
    url: core.url,
    metadata: core.metadata,
    ...(core.articleText ? { articleText: core.articleText } : {}),
    quote: {
      text: core.text,
      ...(core.surroundingWords
        ? { surroundingWords: core.surroundingWords }
        : {}),
      ...(passage?.geometry
        ? { highlight: { rectangles: passage.geometry.normalized } }
        : {}),
    },
    ...(top ? { top: imagePayload(top) } : {}),
    ...(passage?.capture ? { passage: imagePayload(passage.capture) } : {}),
  };
  return result;
}

async function openConfirmation(payload, sampleContext) {
  const id = payload.requestId;
  const url = chromeApi().runtime.getURL(`confirm.html#${id}`);
  const expiresAt = Date.now() + PENDING_CAPTURE_TTL_MS;
  const record = {
    payload,
    sampleContext,
    expiresAt,
    expectedUrl: url,
    confirmTabId: null,
    documentId: null,
  };
  pending.set(id, record);
  const timer = setTimeout(() => {
    const current = pending.get(id);
    if (current === record && current.expiresAt <= Date.now()) {
      pending.delete(id);
      void forgetYouTubeRecord(id);
    }
  }, PENDING_CAPTURE_TTL_MS + 100);
  record.timer = timer;
  try {
    if (chromeApi().windows?.create) {
      const popup = await chromeApi().windows.create({
        url,
        type: "popup",
        focused: true,
        width: 460,
        height: 760,
      });
      record.confirmTabId = popup?.tabs?.[0]?.id ?? null;
      if (record.confirmTabId === null && popup?.id !== undefined) {
        const tabs = await chromeApi().tabs.query({ windowId: popup.id });
        record.confirmTabId = tabs.find((tab) => tab.url === url)?.id ?? null;
      }
    } else {
      const tab = await chromeApi().tabs.create({ url, active: true });
      record.confirmTabId = tab?.id ?? null;
    }
    if (sampleContext) await persistYouTubeRecord(record);
  } catch (error) {
    clearTimeout(timer);
    pending.delete(id);
    throw error;
  }
  rememberStatus({
    scope: "global",
    ok: true,
    message: "Ready for confirmation",
  });
  return id;
}

function youtubeSessionStorage() {
  return chromeApi().storage?.session;
}

function youtubeSessionKey(requestIdValue) {
  return YOUTUBE_SESSION_PREFIX + requestIdValue;
}

function youtubeSessionValue(record) {
  const context = record.sampleContext;
  return {
    requestId: record.payload.requestId,
    url: record.payload.url,
    expiresAt: record.expiresAt,
    expectedUrl: record.expectedUrl,
    confirmTabId: record.confirmTabId,
    documentId: record.documentId,
    sampleContext: {
      tabId: context.tabId,
      windowId: context.windowId,
      url: context.url,
      documentId: context.documentId,
      youtubeIdentity: context.youtubeIdentity
        ? {
            videoId: context.youtubeIdentity.videoId,
            navigationKey: context.youtubeIdentity.navigationKey,
            videoKey: context.youtubeIdentity.videoKey,
          }
        : null,
    },
  };
}

async function persistYouTubeRecord(record) {
  if (!record.sampleContext) return;
  const storage = youtubeSessionStorage();
  if (!storage?.set) return;
  try {
    await storage.set({
      [youtubeSessionKey(record.payload.requestId)]:
        youtubeSessionValue(record),
    });
  } catch {
    // A missing session area should only make timecode unavailable after a
    // worker restart. The general save remains usable in the confirmation UI.
  }
}

async function forgetYouTubeRecord(requestIdValue) {
  const storage = youtubeSessionStorage();
  if (!storage?.remove) return;
  try {
    await storage.remove(youtubeSessionKey(requestIdValue));
  } catch {
    // Best effort: the short-lived entry is still bounded by its expiry.
  }
}

async function restoreYouTubeRecord(requestIdValue) {
  if (!pendingKey(requestIdValue)) return undefined;
  const current = pending.get(requestIdValue);
  if (current) return current;
  const storage = youtubeSessionStorage();
  if (!storage?.get) return undefined;
  let stored;
  try {
    stored = (await storage.get(youtubeSessionKey(requestIdValue)))?.[
      youtubeSessionKey(requestIdValue)
    ];
  } catch {
    return undefined;
  }
  if (
    !stored ||
    stored.requestId !== requestIdValue ||
    typeof stored.expiresAt !== "number" ||
    stored.expiresAt < Date.now() ||
    !stored.sampleContext
  ) {
    if (stored) void forgetYouTubeRecord(requestIdValue);
    return undefined;
  }
  const record = {
    payload: {
      kind: "youtube",
      requestId: requestIdValue,
      url: stored.url,
    },
    sampleContext: stored.sampleContext,
    expiresAt: stored.expiresAt,
    expectedUrl: stored.expectedUrl,
    confirmTabId: stored.confirmTabId ?? null,
    documentId: stored.documentId ?? null,
  };
  record.timer = setTimeout(
    () => {
      if (pending.get(requestIdValue) === record)
        pending.delete(requestIdValue);
      void forgetYouTubeRecord(requestIdValue);
    },
    Math.max(0, stored.expiresAt - Date.now()) + 100,
  );
  pending.set(requestIdValue, record);
  return record;
}

async function captureQuote(context) {
  await injectContent(context.tabId);
  const prepared = await sendContent(context.tabId, {
    type: "vera.capture.prepare-quote",
  });
  const core = prepared.value;
  context.navigationKey = core.navigationKey;
  context.viewport = core.viewport;
  let top;
  let passage;
  let geometry;
  try {
    await assertContext(context);
    const scrolled = await sendContent(context.tabId, {
      type: "vera.capture.scroll-top",
    });
    if (scrolled.value.atTop) top = await captureTallTop(context);
    await sendContent(context.tabId, { type: "vera.capture.scroll-selection" });
    const beforeCapture = await sendContent(context.tabId, {
      type: "vera.capture.quote-data",
    });
    passage = await capturePng(context);
    const selected = await sendContent(context.tabId, {
      type: "vera.capture.quote-data",
    });
    const sameGeometry =
      JSON.stringify(beforeCapture.value.rectangles) ===
      JSON.stringify(selected.value.rectangles);
    if (!sameGeometry)
      throw new CaptureSafetyError(
        "The selected passage moved during screenshot capture",
      );
    if (passage) {
      geometry = highlightFromVisibleRects(
        selected.value.rectangles,
        selected.value.viewport,
        passage,
      );
    }
    if (selected.value.navigationKey !== context.navigationKey) {
      throw new CaptureSafetyError(
        "The selected passage changed during screenshot capture",
      );
    }
    if (!sameViewport(selected.value.viewport, context.viewport)) {
      throw new CaptureSafetyError(
        "The capture viewport changed; no screenshot was attached",
      );
    }
  } finally {
    try {
      await assertContext(context);
    } catch (error) {
      if (isCaptureSafetyError(error)) throw error;
    } finally {
      // Restore the original document even when switching tabs aborted capture.
      await sendContent(context.tabId, {
        type: "vera.capture.restore",
        navigationKey: context.navigationKey,
      }).catch(() => undefined);
    }
  }
  return quotePayload(context.requestId, core, top, {
    capture: passage,
    geometry,
  });
}

async function capturePage(context) {
  await injectContent(context.tabId);
  const page = await sendContent(context.tabId, { type: "vera.capture.page" });
  const core = page.value;
  context.navigationKey = core.navigationKey;
  context.viewport = core.viewport;
  let passage;
  let top;
  try {
    await assertContext(context);
    passage = await capturePng(context);
    await assertContext(context);
    await sendContent(context.tabId, { type: "vera.capture.page-top" });
    top = await captureTallTop(context);
  } finally {
    try {
      await assertContext(context);
      await sendContent(context.tabId, { type: "vera.capture.page-restore" });
    } catch (error) {
      if (isCaptureSafetyError(error)) throw error;
      // The safety check above aborts on tab/navigation changes; restoration is
      // best-effort when Chrome has already discarded the source document.
    }
  }
  return {
    kind: "page",
    requestId: context.requestId,
    url: core.url,
    metadata: core.metadata,
    ...(core.articleText ? { articleText: core.articleText } : {}),
    ...(passage ? { passage: imagePayload(passage) } : {}),
    ...(top ? { top: imagePayload(top) } : {}),
  };
}

async function captureStill(context, sourceUrl) {
  await injectContent(context.tabId);
  const identity = await sendContent(context.tabId, {
    type: "vera.capture.identity",
  });
  context.navigationKey = identity.value.navigationKey;
  context.viewport = identity.value.viewport;
  await assertContext(context, false, false);
  const result = (
    await sendContent(context.tabId, {
      type: "vera.capture.still",
      url: sourceUrl,
    })
  ).value;
  await assertContext(context, true, false);
  if (safePageUrl(result.pageUrl ?? "") !== context.url) {
    throw new CaptureSafetyError(
      "The capture page changed; no still was attached",
    );
  }
  if (result.error || !result.data || !result.mimeType) {
    throw new Error(
      result.error || "The image could not be copied from this page",
    );
  }
  return {
    kind: "still",
    requestId: context.requestId,
    url: result.url,
    pageUrl: result.pageUrl,
    title: result.title,
    ...(result.altText ? { altText: result.altText } : {}),
    ...(result.credit ? { credit: result.credit } : {}),
    data: result.data,
    mimeType: result.mimeType,
  };
}

function captureAudio(context, sourceUrl, title) {
  const url = isHttpUrl(sourceUrl);
  if (!url || !MEDIA_PATH.test(url))
    throw new Error("Choose a direct HTTP(S) audio or video file link");
  return {
    kind: "audio",
    requestId: context.requestId,
    url,
    pageUrl: context.url,
    ...(title?.trim() ? { title: title.trim().slice(0, 500) } : {}),
  };
}

async function captureYouTube(context) {
  const url = normalizeYouTubeUrl(context.url);
  if (!url) throw new Error("This is not a supported YouTube video URL");
  try {
    context.documentId = await injectContent(context.tabId);
    if (context.documentId) {
      const { value } = await sendContent(
        context.tabId,
        { type: "vera.capture.identity" },
        context.documentId,
      );
      // Use the sanitized YouTube identity when this capture outlives the worker.
      context.youtubeIdentity = value.youtube ?? null;
      if (context.youtubeIdentity) {
        context.url = url;
        await assertContext(context, true, false);
      }
    }
  } catch {
    // The original normalized URL is still available for a general save.
    context.youtubeIdentity = null;
  }
  return {
    kind: "youtube",
    requestId: context.requestId,
    url,
  };
}

async function startCapture({ kind, tabId, sourceUrl, title }) {
  const context = await captureContext(
    tabId,
    kind === "quote" || kind === "page",
  );
  context.requestId = requestId();
  let payload;
  if (kind === "quote") payload = await captureQuote(context);
  else if (kind === "page") payload = await capturePage(context);
  else if (kind === "still") payload = await captureStill(context, sourceUrl);
  else if (kind === "audio") payload = captureAudio(context, sourceUrl, title);
  else if (kind === "youtube") payload = await captureYouTube(context);
  else throw new Error("Unknown capture action");
  await openConfirmation(
    payload,
    kind === "youtube" && context.youtubeIdentity ? context : undefined,
  );
  rememberStatus({
    scope: "global",
    ok: true,
    message: "Capture is waiting for confirmation",
  });
  return payload.requestId;
}

function actionKindForTab(tab) {
  if (normalizeYouTubeUrl(tab?.url ?? "")) return "youtube";
  return "quote";
}

async function invokeCapture(kind, tabId, sourceUrl, title) {
  try {
    return await startCapture({ kind, tabId, sourceUrl, title });
  } catch (error) {
    const message = statusError(error);
    rememberStatus({ scope: "global", ok: false, error: message, message });
    try {
      await chromeApi().action.setBadgeText({ text: "!" });
      await chromeApi().action.setBadgeBackgroundColor({ color: "#b42318" });
    } catch {
      // Badge APIs are not available in a few test and restricted-page contexts.
    }
    throw error;
  }
}

function createContextMenus() {
  const menus = [
    {
      id: "vera-log-quote",
      title: "Log quote in VERA",
      contexts: ["selection"],
    },
    { id: "vera-save-page", title: "Save page in VERA", contexts: ["page"] },
    {
      id: "vera-save-still",
      title: "Save image as still in VERA",
      contexts: ["image"],
    },
    { id: "vera-save-audio", title: "Save audio in VERA", contexts: ["link"] },
    {
      id: "vera-send-youtube",
      title: "Send YouTube video to VERA",
      contexts: ["page"],
      targetUrlPatterns: [
        "*://youtube.com/*",
        "*://*.youtube.com/*",
        "*://youtu.be/*",
      ],
    },
  ];
  chromeApi().contextMenus.removeAll(() => {
    for (const menu of menus) chromeApi().contextMenus.create(menu);
  });
}

chromeApi().runtime.onInstalled.addListener(createContextMenus);
chromeApi().runtime.onStartup?.addListener(createContextMenus);
chromeApi().tabs.onActivated?.addListener(({ windowId }) => {
  activationEpoch.set(windowId, (activationEpoch.get(windowId) ?? 0) + 1);
});
createContextMenus();

chromeApi().contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id ?? info.tabId;
  if (tabId === undefined) return;
  const sourceUrl = info.srcUrl ?? info.linkUrl;
  const kind = {
    "vera-log-quote": "quote",
    "vera-save-page": "page",
    "vera-save-still": "still",
    "vera-save-audio": "audio",
    "vera-send-youtube": "youtube",
  }[info.menuItemId];
  if (!kind) return;
  void invokeCapture(kind, tabId, sourceUrl, tab?.title);
});

chromeApi().commands.onCommand.addListener((command) => {
  void (async () => {
    const tab = await activeTab();
    if (command === "save-page") await invokeCapture("page", tab.id);
    else if (command === "log-quote") await invokeCapture("quote", tab.id);
  })().catch((error) =>
    rememberStatus({ scope: "global", ok: false, error: statusError(error) }),
  );
});

function confirmationRecord(id, sender) {
  const record = pendingKey(id) ? pending.get(id) : undefined;
  const tabId = sender?.tab?.id;
  if (
    !record ||
    Date.now() > record.expiresAt ||
    sender?.frameId !== 0 ||
    tabId === undefined ||
    (record.confirmTabId !== null && tabId !== record.confirmTabId) ||
    sender.url !== record.expectedUrl
  )
    return undefined;
  if (record.documentId && sender.documentId !== record.documentId)
    return undefined;
  if (record.confirmTabId === null) record.confirmTabId = tabId;
  if (record.documentId === null && typeof sender.documentId === "string")
    record.documentId = sender.documentId;
  if (record.sampleContext) void persistYouTubeRecord(record);
  return record;
}

const YOUTUBE_TIME_UNAVAILABLE =
  "Time unavailable. Reopen the capture once the source video can be verified.";

function sameYouTubeIdentity(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.videoId === actual.videoId &&
    expected.navigationKey === actual.navigationKey &&
    (expected.videoKey == null || expected.videoKey === actual.videoKey),
  );
}

async function sampleYouTube(requestIdValue, sender) {
  await restoreYouTubeRecord(requestIdValue);
  const record = confirmationRecord(requestIdValue, sender);
  if (!record || record.payload.kind !== "youtube" || !record.sampleContext)
    return { ok: false, error: YOUTUBE_TIME_UNAVAILABLE };
  if (record.sampleResult) return record.sampleResult;
  if (!record.documentId || !record.sampleContext.documentId)
    return { ok: false, error: YOUTUBE_TIME_UNAVAILABLE };
  if (record.samplePromise) return record.samplePromise;
  record.samplePromise = (async () => {
    const context = record.sampleContext;
    try {
      await assertContext(context, true, false);
      const response = await sendContent(
        context.tabId,
        {
          type: "vera.capture.youtube-playhead",
          youtubeIdentity: context.youtubeIdentity,
        },
        context.documentId,
      );
      const sample = response?.value;
      await assertContext(context, true, false);
      const playheadMs =
        typeof sample === "number" ? sample : sample?.playheadMs;
      if (!Number.isSafeInteger(playheadMs) || playheadMs < 0)
        throw new CaptureSafetyError(YOUTUBE_TIME_UNAVAILABLE);
      if (
        context.youtubeIdentity &&
        sample?.identity &&
        !sameYouTubeIdentity(context.youtubeIdentity, sample.identity)
      )
        throw new CaptureSafetyError(
          "The YouTube video changed; timecode is unavailable.",
        );
      return { ok: true, playheadMs };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof CaptureSafetyError
            ? error.message
            : YOUTUBE_TIME_UNAVAILABLE,
      };
    }
  })();
  record.sampleResult = await record.samplePromise;
  return record.sampleResult;
}

chromeApi().runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return undefined;
  if (message.type === "vera.capture.start") {
    const popupUrl = chromeApi().runtime.getURL("popup.html");
    if (sender.url !== popupUrl) {
      sendResponse({
        ok: false,
        error: "Capture actions must start from the extension toolbar",
      });
      return false;
    }
    const kind = message.kind === "auto" ? null : message.kind;
    if (
      kind !== null &&
      !["quote", "page", "still", "audio", "youtube"].includes(kind)
    ) {
      sendResponse({ ok: false, error: "Unknown capture action" });
      return false;
    }
    void (async () => {
      const tab = await activeTab();
      const selectedKind = kind ?? actionKindForTab(tab);
      return invokeCapture(selectedKind, tab.id, undefined, tab.title);
    })().then(
      (value) => sendResponse({ ok: true, requestId: value }),
      (error) => sendResponse({ ok: false, error: statusError(error) }),
    );
    return true;
  }
  if (message.type === "vera.capture.status") {
    const read = chromeApi().storage?.local?.get?.("veraCaptureStatus");
    if (read && typeof read.then === "function") {
      void read.then((stored) => {
        sendResponse({
          ok: true,
          status: stored?.veraCaptureStatus ?? statuses.get("global") ?? null,
        });
      });
    } else {
      sendResponse({ ok: true, status: statuses.get("global") ?? null });
    }
    return true;
  }
  if (message.type === "vera.capture.youtube-playhead") {
    void sampleYouTube(message.requestId, sender).then(sendResponse);
    return true;
  }
  if (message.type !== "vera.capture.read") return undefined;

  const id = message.requestId;
  void (async () => {
    await restoreYouTubeRecord(id);
    const record = confirmationRecord(id, sender);
    if (!record) {
      sendResponse(null);
      return;
    }
    if (record.payload.kind !== "youtube") {
      pending.delete(id);
      clearTimeout(record.timer);
    }
    sendResponse(record.payload);
  })();
  return true;
});

chromeApi().tabs.onRemoved?.addListener((tabId) => {
  for (const [id, record] of pending) {
    if (record.confirmTabId === tabId) {
      clearTimeout(record.timer);
      pending.delete(id);
      void forgetYouTubeRecord(id);
    }
  }
});

chromeApi().action?.setBadgeText?.({ text: "" });
