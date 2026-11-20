export const MAX_ARTICLE_TEXT = 64 * 1024;
export const MAX_QUOTE_TEXT = 20 * 1024;
export const MAX_SURROUNDING_TEXT = 512;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const PENDING_CAPTURE_TTL_MS = 2 * 60 * 1000;

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
const MAX_PAGE_URL = 4096;

function isSensitiveQueryKey(key) {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    SENSITIVE_QUERY_KEYS.has(normalized) ||
    SENSITIVE_QUERY_SUFFIX.test(normalized)
  );
}

/**
 * Remove credentials and well-known secret-bearing query parameters before a
 * page URL enters a capture payload. This is deliberately lossy; a source
 * URL containing a secret is unsafe to persist as-is.
 */
export function safePageUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.username = "";
  parsed.password = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (isSensitiveQueryKey(key)) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  const safe = parsed.toString();
  return safe.length <= MAX_PAGE_URL ? safe : null;
}

export function textField(value, maxLength = 512) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  if (!cleaned) return undefined;
  return cleaned.slice(0, maxLength);
}

export function boundedArticleText(value) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\u0000/g, "");
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_ARTICLE_TEXT);
}

export function boundedQuoteText(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_QUOTE_TEXT
  ) {
    return null;
  }
  return value.replace(/\u0000/g, "");
}

export function boundedSurrounding(value, fromEnd = false) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const cleaned = value.replace(/\u0000/g, "");
  return fromEnd
    ? cleaned.slice(-MAX_SURROUNDING_TEXT)
    : cleaned.slice(0, MAX_SURROUNDING_TEXT);
}

function firstMeta(document, selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element?.getAttribute("content");
    if (value) return value;
  }
  return undefined;
}

/** Collect only citation metadata; no JSON-LD, scripts, forms, or storage. */
export function collectMetadata(document, rawUrl) {
  const url = safePageUrl(rawUrl);
  const metadata = {
    title: textField(
      firstMeta(document, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ]) ?? document.title,
      512,
    ),
    authors: textField(
      firstMeta(document, [
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="byline"]',
      ]),
      512,
    ),
    publication: textField(
      firstMeta(document, [
        'meta[property="og:site_name"]',
        'meta[name="application-name"]',
        'meta[name="publisher"]',
      ]),
      512,
    ),
    date: textField(
      firstMeta(document, [
        'meta[property="article:published_time"]',
        'meta[name="date"]',
        'meta[name="pubdate"]',
      ]),
      128,
    ),
    ...(url ? { url } : {}),
  };
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

export function normalizeYouTubeUrl(rawUrl) {
  const safe = safePageUrl(rawUrl);
  if (!safe) return null;
  let parsed;
  try {
    parsed = new URL(safe);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  let videoId = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    videoId = parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  ) {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") videoId = parsed.searchParams.get("v");
    else if (
      parts[0] === "shorts" ||
      parts[0] === "live" ||
      parts[0] === "embed"
    )
      videoId = parts[1] ?? null;
  }
  if (!videoId || !/^[A-Za-z0-9_-]{6,64}$/.test(videoId)) return null;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function isHttpUrl(value) {
  const safe = safePageUrl(value);
  return safe ?? null;
}

export function base64Payload(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match || match[2].length > 4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3))
    return null;
  return { mimeType: match[1].toLowerCase(), data: match[2] };
}

export function pendingKey(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
