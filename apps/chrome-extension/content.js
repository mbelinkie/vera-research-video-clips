(() => {
  if (globalThis.__veraResearchCaptureInstalled) return;
  globalThis.__veraResearchCaptureInstalled = true;

  const MAX_ARTICLE_TEXT = 64 * 1024;
  const MAX_QUOTE_TEXT = 20 * 1024;
  const MAX_SURROUNDING_TEXT = 512;
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  const SENSITIVE_QUERY_KEYS = new Set([
    "access",
    "accesstoken",
    "apikey",
    "auth",
    "authtoken",
    "authorization",
    "code",
    "csrf",
    "csrftoken",
    "key",
    "password",
    "secret",
    "session",
    "sessionid",
    "sessiontoken",
    "sig",
    "signature",
    "token",
  ]);
  const SENSITIVE_QUERY_SUFFIX =
    /(?:access|auth|csrf|password|secret|session|signature|sig|token)$/;
  let quoteState = null;
  let pageScrollState = null;

  function navigationKey() {
    const navigation = performance.getEntriesByType("navigation")[0];
    return `${location.href}|${performance.timeOrigin}|${navigation?.type ?? "unknown"}`;
  }

  function safePageUrl(value) {
    if (typeof value !== "string" || value.length === 0) return null;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      const normalized = key.replace(/[-_]/g, "").toLowerCase();
      if (
        SENSITIVE_QUERY_KEYS.has(normalized) ||
        SENSITIVE_QUERY_SUFFIX.test(normalized)
      ) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = "";
    const safe = parsed.toString();
    return safe.length <= 4096 ? safe : null;
  }

  function pageIdentity() {
    return {
      url: safePageUrl(location.href),
      navigationKey: navigationKey(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
    };
  }

  function cleanText(value, maxLength) {
    if (typeof value !== "string") return undefined;
    const cleaned = value.replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
      "",
    );
    return cleaned ? cleaned.slice(0, maxLength) : undefined;
  }

  function removePrivateNodes(root) {
    const selector =
      "script,style,noscript,template,iframe,object,embed,canvas,form,input,textarea,select,button,nav,aside,[role='navigation'],[role='complementary'],[role='dialog'],[hidden],[aria-hidden='true']";
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
      root.remove();
      return;
    }
    root.querySelectorAll?.(selector).forEach((node) => node.remove());
  }

  function readableRoot(range) {
    const preferred = document.querySelector(
      "article,[itemprop='articleBody'],main,[role='main']",
    );
    if (!range) return preferred ?? document.body;
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const end =
      range.endContainer instanceof Element
        ? range.endContainer
        : range.endContainer.parentElement;
    const nearest = start?.closest(
      "article,[itemprop='articleBody'],main,[role='main']",
    );
    if (nearest && end && nearest.contains(end)) return nearest;
    return document.body;
  }

  function visibleClone(range) {
    const clone = readableRoot(range)?.cloneNode(true);
    if (!clone) return null;
    removePrivateNodes(clone);
    return clone;
  }

  function visibleArticleText(range) {
    const clone = visibleClone(range);
    if (!clone) return undefined;
    return cleanText(
      clone.innerText || clone.textContent || "",
      MAX_ARTICLE_TEXT,
    );
  }

  function firstMeta(selectors) {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.getAttribute("content");
      if (value) return value;
    }
    return undefined;
  }

  function metadata() {
    const url = safePageUrl(location.href);
    const result = {
      title: cleanText(
        firstMeta([
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
        ]) ?? document.title,
        512,
      ),
      authors: cleanText(
        firstMeta([
          'meta[name="author"]',
          'meta[property="article:author"]',
          'meta[name="byline"]',
        ]),
        512,
      ),
      publication: cleanText(
        firstMeta([
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
          'meta[name="publisher"]',
        ]),
        512,
      ),
      date: cleanText(
        firstMeta([
          'meta[property="article:published_time"]',
          'meta[name="date"]',
          'meta[name="pubdate"]',
        ]),
        128,
      ),
      ...(url ? { url } : {}),
    };
    return Object.fromEntries(
      Object.entries(result).filter(([, value]) => value !== undefined),
    );
  }

  function visibleRectangles(range) {
    return [...range.getClientRects()]
      .map(({ left, top, width, height }) => ({ left, top, width, height }))
      .filter(({ width, height }) => width > 0 && height > 0);
  }

  function clipped(rectangles) {
    return rectangles.some(
      ({ left, top, width, height }) =>
        left < 0 ||
        top < 0 ||
        left + width > window.innerWidth ||
        top + height > window.innerHeight,
    );
  }

  function stablePaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(resolve, 35)),
      );
    });
  }

  function textAroundRange(range, before) {
    const probe = range.cloneRange();
    try {
      probe.selectNodeContents(readableRoot(range));
      if (before) probe.setEnd(range.startContainer, range.startOffset);
      else probe.setStart(range.endContainer, range.endOffset);
      const fragment = probe.cloneContents();
      removePrivateNodes(fragment);
      const text = fragment.textContent || "";
      return cleanText(
        before
          ? text.slice(-MAX_SURROUNDING_TEXT)
          : text.slice(0, MAX_SURROUNDING_TEXT),
        MAX_SURROUNDING_TEXT,
      );
    } catch {
      return undefined;
    }
  }

  function selectionRange() {
    const selection = window.getSelection();
    if (
      !selection ||
      selection.rangeCount !== 1 ||
      selection.isCollapsed ||
      selection.type !== "Range"
    ) {
      throw new Error("Select a passage before capturing a quote");
    }
    const range = selection.getRangeAt(0).cloneRange();
    const rawText = selection.toString();
    if (!rawText || rawText.length > MAX_QUOTE_TEXT)
      throw new Error("Select a shorter passage");
    if (rawText.includes("\u0000"))
      throw new Error("The selected passage contains unsupported text");
    const text = cleanText(rawText, MAX_QUOTE_TEXT);
    if (!text) throw new Error("Select a non-empty passage");
    return { range, text };
  }

  async function prepareQuote() {
    const { range, text } = selectionRange();
    const original = {
      x: window.scrollX,
      y: window.scrollY,
      active:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    };
    let rectangles = visibleRectangles(range);
    if (!rectangles.length)
      throw new Error("The selected passage is not visible");
    if (clipped(rectangles)) {
      const anchor =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement;
      anchor?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
      await stablePaint();
      rectangles = visibleRectangles(range);
    }
    if (!rectangles.length || clipped(rectangles)) {
      throw new Error("Keep the full selected passage visible and try again");
    }
    quoteState = {
      range,
      text,
      original,
      identity: pageIdentity(),
      rectangles,
      before: textAroundRange(range, true),
      after: textAroundRange(range, false),
    };
    return quoteData();
  }

  function quoteData() {
    if (!quoteState) throw new Error("Quote capture is not prepared");
    const rectangles = visibleRectangles(quoteState.range);
    if (!rectangles.length || clipped(rectangles))
      throw new Error("The selected passage moved out of view");
    quoteState.rectangles = rectangles;
    return {
      ...pageIdentity(),
      metadata: metadata(),
      articleText: visibleArticleText(quoteState.range),
      text: quoteState.text,
      surroundingWords: {
        ...(quoteState.before ? { before: quoteState.before } : {}),
        ...(quoteState.after ? { after: quoteState.after } : {}),
      },
      rectangles,
    };
  }

  async function scrollTop() {
    if (!quoteState) throw new Error("Quote capture is not prepared");
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    await stablePaint();
    return pageIdentity();
  }

  async function scrollSelection() {
    if (!quoteState) throw new Error("Quote capture is not prepared");
    const anchor =
      quoteState.range.startContainer instanceof Element
        ? quoteState.range.startContainer
        : quoteState.range.startContainer.parentElement;
    anchor?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    await stablePaint();
    return quoteData();
  }

  async function restore() {
    if (!quoteState) return pageIdentity();
    const restoreState = quoteState;
    quoteState = null;
    window.scrollTo({
      left: restoreState.original.x,
      top: restoreState.original.y,
      behavior: "instant",
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(restoreState.range);
    if (
      restoreState.original.active?.isConnected &&
      typeof restoreState.original.active.focus === "function"
    ) {
      restoreState.original.active.focus({ preventScroll: true });
    }
    await stablePaint();
    return pageIdentity();
  }

  function pageData() {
    return {
      ...pageIdentity(),
      metadata: metadata(),
      articleText: visibleArticleText(),
    };
  }

  async function youtubePlayhead() {
    if (location.pathname.startsWith("/shorts/")) return null;
    if (document.querySelector(".ad-showing, .ytp-ad-player-overlay"))
      return null;
    await stablePaint();
    const candidates = [...document.querySelectorAll("video")]
      .map((video) => ({
        video,
        rect: video.getBoundingClientRect(),
      }))
      .filter(
        ({ video, rect }) =>
          video.isConnected &&
          video.readyState >= 2 &&
          Number.isFinite(video.currentTime) &&
          video.currentTime >= 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          !video.closest(".ad-showing, .ytp-ad-player-overlay"),
      )
      .sort(
        (left, right) =>
          right.rect.width * right.rect.height -
          left.rect.width * left.rect.height,
      );
    if (!candidates.length) return null;
    if (candidates.length > 1) {
      const largest = candidates[0].rect.width * candidates[0].rect.height;
      const second = candidates[1].rect.width * candidates[1].rect.height;
      if (largest < second * 1.5) return null;
    }
    const first = candidates[0].video.currentTime;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const second = candidates[0].video.currentTime;
    if (!Number.isFinite(second) || Math.abs(second - first) > 0.5) return null;
    const playheadMs = Math.floor(second * 1000);
    return Number.isSafeInteger(playheadMs) && playheadMs >= 0
      ? playheadMs
      : null;
  }

  async function pageTop() {
    pageScrollState = { x: window.scrollX, y: window.scrollY };
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
    await stablePaint();
    return pageIdentity();
  }

  async function pageRestore() {
    if (pageScrollState) {
      window.scrollTo({
        left: pageScrollState.x,
        top: pageScrollState.y,
        behavior: "auto",
      });
      pageScrollState = null;
      await stablePaint();
    }
    return pageIdentity();
  }

  function imageDetails(sourceUrl) {
    const safeSource = safePageUrl(sourceUrl);
    if (!safeSource)
      throw new Error("The image URL is not a public HTTP(S) address");
    const image = [...document.images].find(
      (candidate) =>
        safePageUrl(candidate.currentSrc || candidate.src) === safeSource,
    );
    if (!image)
      throw new Error("The image is no longer available on this page");
    const figure = image?.closest("figure");
    const credit = figure?.querySelector(
      "figcaption,[data-credit],[class*='credit' i]",
    )?.textContent;
    return {
      url: safeSource,
      pageUrl: safePageUrl(location.href),
      title: cleanText(document.title, 512) || "Untitled image",
      ...(image?.alt ? { altText: cleanText(image.alt, 1_024) } : {}),
      ...(credit ? { credit: cleanText(credit, 1_024) } : {}),
      ...(image
        ? { viewportRect: image.getBoundingClientRect().toJSON() }
        : {}),
    };
  }

  function encodeBase64(bytes) {
    let result = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      result += String.fromCharCode(
        ...bytes.subarray(index, index + chunkSize),
      );
    }
    return btoa(result);
  }

  async function fetchImage(sourceUrl) {
    const details = imageDetails(sourceUrl);
    let response;
    try {
      response = await fetch(details.url, {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      return {
        ...details,
        error:
          "The image could not be copied from this page because CORS or network access was blocked",
      };
    }
    if (!response.ok)
      return {
        ...details,
        error:
          "The image could not be copied from this page because CORS or network access was blocked",
      };
    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType))
      return {
        ...details,
        error: "The linked resource is not a supported image",
      };
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return {
        ...details,
        error: "The image is larger than the 16 MiB capture limit",
      };
    }
    let bytes;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return {
        ...details,
        error:
          "The image could not be copied from this page because CORS or network access was blocked",
      };
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      return {
        ...details,
        error: "The image is larger than the 16 MiB capture limit",
      };
    }
    return { ...details, data: encodeBase64(bytes), mimeType: contentType };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return undefined;
    const operation = (async () => {
      switch (message.type) {
        case "vera.capture.prepare-quote":
          return { ok: true, value: await prepareQuote() };
        case "vera.capture.quote-data":
          return { ok: true, value: quoteData() };
        case "vera.capture.scroll-top":
          return { ok: true, value: await scrollTop() };
        case "vera.capture.scroll-selection":
          return { ok: true, value: await scrollSelection() };
        case "vera.capture.restore":
          return { ok: true, value: await restore() };
        case "vera.capture.page":
          return { ok: true, value: pageData() };
        case "vera.capture.youtube-playhead":
          return { ok: true, value: await youtubePlayhead() };
        case "vera.capture.page-top":
          return { ok: true, value: await pageTop() };
        case "vera.capture.page-restore":
          return { ok: true, value: await pageRestore() };
        case "vera.capture.still":
          return { ok: true, value: await fetchImage(message.url) };
        case "vera.capture.identity":
          return { ok: true, value: pageIdentity() };
        default:
          return undefined;
      }
    })().catch((error) => ({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The page could not be captured",
    }));
    operation.then(sendResponse);
    return true;
  });
})();
