import {
  CreateSourceRequestSchema,
  LibrarySourceSchema,
  MaxWebPageHtmlBytes,
  type CreateSourceRequest,
  type ImportWebPageRequest,
  type WebPageExtraction,
} from "@research-video/contracts";
import { extractArticle, safePageUrl } from "./extract.ts";
import {
  CaptureDenied,
  NodePinnedTransport,
  PublicEgressGuard,
  SystemDnsResolver,
} from "./timeline-egress.ts";

type FindPage = Pick<PublicEgressGuard, "fetch">;
type FailureReason = Extract<WebPageExtraction, { status: "failed" }>["reason"];

export class WebPageImportError extends Error {
  readonly code = "web_page_import_failed";
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function createPublicPageReader(
  guard: FindPage = new PublicEgressGuard(
    new SystemDnsResolver(),
    new NodePinnedTransport(),
    { maxRedirects: 5, maxResponseBytes: MaxWebPageHtmlBytes },
  ),
) {
  let active = 0;
  return async (url: string) => {
    if (active >= 2)
      throw new WebPageImportError(
        429,
        "The Mac is reading other pages. Try again shortly.",
      );
    active++;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(
          new CaptureDenied(
            "connection_timeout",
            "Page download timed out.",
            "connect",
          ),
        );
      }, 12_000);
    });
    // Keep the slot occupied until any pending system DNS lookup actually finishes.
    const response = guard
      .fetch(url, "GET", abort.signal)
      .finally(() => active--);
    try {
      return await Promise.race([response, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}

function failure(error: unknown): FailureReason {
  if (!(error instanceof CaptureDenied)) return "unavailable";
  if (error.code === "response_too_large") return "too_large";
  if (error.code === "connection_timeout") return "timed_out";
  if (
    ["dns_unavailable", "dns_no_answers", "connection_failed"].includes(
      error.code,
    )
  )
    return "unavailable";
  return "blocked";
}

function sourceDetails(
  submittedUrl: string | undefined,
  extraction: WebPageExtraction,
) {
  return { ...(submittedUrl && { submittedUrl }), extraction };
}

export async function buildWebPageSource(
  input: ImportWebPageRequest,
  readPublicPage: ReturnType<typeof createPublicPageReader>,
): Promise<CreateSourceRequest> {
  const submittedUrl = safePageUrl(input.url);
  const failed = (reason: FailureReason) => ({
    kind: "web_page" as const,
    bibliography: {},
    details: sourceDetails(submittedUrl, { status: "failed", reason }),
  });
  if (!submittedUrl) return failed("blocked");
  let html: string;
  let base = submittedUrl;
  if (input.mode === "extension") {
    if (Buffer.byteLength(input.html, "utf8") > MaxWebPageHtmlBytes)
      throw new WebPageImportError(
        413,
        "The supplied HTML exceeds the import size limit.",
      );
    html = input.html;
  } else {
    let response;
    try {
      response = await readPublicPage(submittedUrl);
    } catch (error) {
      if (error instanceof WebPageImportError) throw error;
      return failed(failure(error));
    }
    if ([401, 402, 403, 407, 429, 451].includes(response.status))
      return failed("blocked");
    if (response.status < 200 || response.status >= 300)
      return failed("unavailable");
    const type = response.headers["content-type"] ?? "";
    const encoding =
      response.headers["content-encoding"]?.toLowerCase() ?? "identity";
    if (
      !/^\s*(?:text\/html|application\/xhtml\+xml)\s*(?:;|$)/iu.test(type) ||
      encoding !== "identity"
    )
      return failed("not_html");
    const charset =
      /;\s*charset\s*=\s*["']?([^;"'\s]+)/iu.exec(type)?.[1] ?? "utf-8";
    try {
      html = new TextDecoder(charset).decode(response.body);
    } catch {
      return failed("not_html");
    }
    base = response.finalUrl;
  }
  let extracted;
  try {
    extracted = extractArticle(
      html,
      base,
      input.mode === "extension" ? input.metadata : {},
      input.mode === "public_url",
    );
  } catch {
    // Parser failures can contain page data. Keep only a stable failure reason.
    return failed("no_article");
  }
  return CreateSourceRequestSchema.parse({
    kind: "web_page",
    bibliography: extracted.bibliography,
    details: sourceDetails(submittedUrl, extracted.extraction),
    ...(input.mode === "extension" && { idempotencyKey: input.idempotencyKey }),
  });
}

export function createWebPageImporter(
  catalogUrl: string,
  readPublicPage = createPublicPageReader(),
  catalogRequest = globalThis.fetch,
) {
  return async (
    projectId: string,
    authorization: string,
    input: ImportWebPageRequest,
  ) => {
    const sources = new URL(`/api/projects/${projectId}/sources`, catalogUrl);
    const request = async (
      method: "HEAD" | "POST",
      source?: CreateSourceRequest,
    ) => {
      const url =
        method === "HEAD" ? new URL("source-write-access", sources) : sources;
      const response = await catalogRequest(url, {
        method,
        headers: {
          authorization,
          ...(source && { "content-type": "application/json" }),
        },
        ...(source && { body: JSON.stringify(source) }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if ([401, 403].includes(response.status))
        throw new WebPageImportError(
          response.status,
          "Project write access is required to import a page.",
        );
      if (response.status === 409)
        throw new WebPageImportError(
          409,
          "This request key is already in use. Use a new key for a different import.",
        );
      if (!response.ok)
        throw new WebPageImportError(
          502,
          "The Research catalog could not save the page. Try again.",
        );
      return response;
    };
    await request("HEAD");
    const source = await buildWebPageSource(input, readPublicPage);
    const response = await request("POST", source);
    return LibrarySourceSchema.parse(await response.json());
  };
}
