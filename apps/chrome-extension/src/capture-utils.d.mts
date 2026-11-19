export const MAX_ARTICLE_TEXT: number;
export const MAX_QUOTE_TEXT: number;
export const MAX_SURROUNDING_TEXT: number;
export const MAX_SCREENSHOT_BYTES: number;
export const MAX_IMAGE_BYTES: number;
export const PENDING_CAPTURE_TTL_MS: number;
export function safePageUrl(value: string): string | null;
export function textField(
  value: string,
  maxLength?: number,
): string | undefined;
export function boundedArticleText(value: string): string | undefined;
export function boundedQuoteText(value: string): string | null;
export function boundedSurrounding(
  value: string,
  fromEnd?: boolean,
): string | undefined;
export function normalizeYouTubeUrl(rawUrl: string): string | null;
export function isHttpUrl(value: string): string | null;
export function base64Payload(
  dataUrl: string,
): { mimeType: string; data: string } | null;
export function pendingKey(value: string): boolean;
