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
  const youtubeVideoKeys = new WeakMap();
  let nextYoutubeVideoKey = 1;

  function navigationKey() {
    const navigation = performance.getEntriesByType("navigation")[0];
    return `${location.href}|${performance.timeOrigin}|${navigation?.type ?? "unknown"}`;
  }

  function youtubeNavigationKey() {
    const navigation = performance.getEntriesByType("navigation")[0];
    const value = `${safePageUrl(location.href) ?? ""}|${performance.timeOrigin}|${navigation?.type ?? "unknown"}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
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
    const youtube = youtubeIdentity();
    return {
      url: safePageUrl(location.href),
      navigationKey: navigationKey(),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      ...(youtube ? { youtube } : {}),
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
      if (value?.trim()) return value.trim();
    }
    return undefined;
  }

  function metadata() {
    const url = safePageUrl(location.href);
    const author = cleanText(
      firstMeta([
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="byline"]',
      ])?.trim(),
      300,
    );
    const result = {
      title: cleanText(
        firstMeta([
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
        ]) ?? document.title.trim(),
        500,
      ),
      authors: author ? [author] : undefined,
      publication: cleanText(
        firstMeta([
          'meta[property="og:site_name"]',
          'meta[name="application-name"]',
          'meta[name="publisher"]',
        ]),
        500,
      ),
      date: cleanText(
        firstMeta([
          'meta[property="article:published_time"]',
          'meta[name="date"]',
          'meta[name="pubdate"]',
        ]),
        100,
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
    const anchor =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const scrollContainers = [];
    const scrollable = /^(auto|scroll|hidden|overlay)$/;
    for (
      let element = anchor;
      element && element !== document.scrollingElement;
      element = element.parentElement
    ) {
      const { overflowX, overflowY } = getComputedStyle(element);
      if (
        (element.scrollHeight > element.clientHeight &&
          scrollable.test(overflowY)) ||
        (element.scrollWidth > element.clientWidth &&
          scrollable.test(overflowX))
      ) {
        scrollContainers.push({
          element,
          left: element.scrollLeft,
          top: element.scrollTop,
        });
      }
    }
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
      anchor,
      scrollContainers,
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
    const { scrollContainers } = quoteState;
    // The cloned range still gives us the passage bounds after clearing its paint.
    window.getSelection()?.removeAllRanges();
    for (const { element } of scrollContainers)
      element.scrollTo({ left: 0, top: 0, behavior: "instant" });
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    await stablePaint();
    return {
      atTop:
        Math.abs(window.scrollY) < 1 &&
        scrollContainers.every(
          ({ element }) => Math.abs(element.scrollTop) < 1,
        ),
    };
  }

  async function scrollSelection() {
    if (!quoteState) throw new Error("Quote capture is not prepared");
    quoteState.anchor?.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    });
    await stablePaint();
    return quoteData();
  }

  function restore(expectedNavigationKey) {
    if (!quoteState || expectedNavigationKey !== navigationKey())
      return pageIdentity();
    const { range, original, scrollContainers } = quoteState;
    quoteState = null;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (
      original.active?.isConnected &&
      typeof original.active.focus === "function"
    ) {
      original.active.focus({ preventScroll: true });
    }
    for (const { element, left, top } of scrollContainers)
      element.scrollTo({ left, top, behavior: "instant" });
    window.scrollTo({
      left: original.x,
      top: original.y,
      behavior: "instant",
    });
    return pageIdentity();
  }

  function pageData() {
    return {
      ...pageIdentity(),
      metadata: metadata(),
      articleText: visibleArticleText(),
    };
  }

  function isShowingYouTubeAd(video) {
    if (video.closest(".ad-showing")) return true;
    const player = video.closest(".html5-video-player");
    // YouTube can leave a hidden ad overlay in the player during normal playback.
    return [...(player?.querySelectorAll(".ytp-ad-player-overlay") ?? [])].some(
      (overlay) =>
        overlay.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }),
    );
  }

  function youtubeVideoId() {
    const host = location.hostname.toLowerCase();
    if (host === "youtu.be") return location.pathname.split("/")[1] || null;
    if (
      host !== "youtube.com" &&
      host !== "www.youtube.com" &&
      host !== "m.youtube.com"
    )
      return null;
    if (location.pathname.startsWith("/shorts/"))
      return location.pathname.split("/")[2] || null;
    return new URL(location.href).searchParams.get("v") || null;
  }

  function youtubeVideoCandidates() {
    if (!youtubeVideoId() || location.pathname.startsWith("/shorts/"))
      return [];
    return [...document.querySelectorAll("video")]
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
          !isShowingYouTubeAd(video),
      )
      .sort(
        (left, right) =>
          right.rect.width * right.rect.height -
          left.rect.width * left.rect.height,
      );
  }

  function selectedYouTubeVideo() {
    const candidates = youtubeVideoCandidates();
    if (!candidates.length) return null;
    if (candidates.length > 1) {
      const largest = candidates[0].rect.width * candidates[0].rect.height;
      const second = candidates[1].rect.width * candidates[1].rect.height;
      if (largest < second * 1.5) return null;
    }
    return candidates[0];
  }

  function youtubeIdentity(video = selectedYouTubeVideo()?.video) {
    const videoId = youtubeVideoId();
    if (!videoId) return null;
    const identity = {
      videoId,
      navigationKey: youtubeNavigationKey(),
      videoKey: null,
    };
    if (!video) return identity;
    let videoKey = youtubeVideoKeys.get(video);
    if (!videoKey) {
      videoKey = nextYoutubeVideoKey++;
      youtubeVideoKeys.set(video, videoKey);
    }
    identity.videoKey = videoKey;
    const source = video.currentSrc || video.src;
    if (typeof source === "string" && source.length <= 2_048)
      identity.source = source;
    return identity;
  }

  function sameYouTubeIdentity(expected, actual) {
    return Boolean(
      expected &&
      actual &&
      expected.videoId === actual.videoId &&
      expected.navigationKey === actual.navigationKey &&
      (expected.videoKey == null || expected.videoKey === actual.videoKey) &&
      (expected.source == null ||
        actual.source == null ||
        expected.source === actual.source),
    );
  }

  async function youtubePlayhead(expectedIdentity) {
    if (location.pathname.startsWith("/shorts/")) return null;
    await stablePaint();
    const selected = selectedYouTubeVideo();
    if (!selected) return null;
    const { video } = selected;
    const beforeIdentity = youtubeIdentity(video);
    if (!sameYouTubeIdentity(expectedIdentity, beforeIdentity)) return null;
    const first = video.currentTime;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const second = video.currentTime;
    if (
      !Number.isFinite(second) ||
      Math.abs(second - first) > 0.5 ||
      isShowingYouTubeAd(video)
    )
      return null;
    const afterIdentity = youtubeIdentity(video);
    if (!sameYouTubeIdentity(beforeIdentity, afterIdentity)) return null;
    const playheadMs = Math.floor(second * 1000);
    return Number.isSafeInteger(playheadMs) && playheadMs >= 0
      ? { playheadMs, identity: afterIdentity }
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
      title: cleanText(document.title.trim(), 500) || "Untitled image",
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
          return { ok: true, value: restore(message.navigationKey) };
        case "vera.capture.page":
          return { ok: true, value: pageData() };
        case "vera.capture.youtube-playhead":
          return {
            ok: true,
            value: await youtubePlayhead(message.youtubeIdentity),
          };
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
