import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type {
  CreateSourceRequest,
  ImportWebPageRequest,
  WebPageExtraction,
} from "@research-video/contracts";
import { inspectPublicUrl } from "@research-video/providers/public-egress";

type Metadata = Extract<
  ImportWebPageRequest,
  { mode: "extension" }
>["metadata"];
type Bibliography = CreateSourceRequest["bibliography"];

export function safePageUrl(raw: string): string | undefined {
  try {
    return inspectPublicUrl(raw).canonicalUrl;
  } catch {
    return undefined;
  }
}

function canonical(value: string | undefined, base: string | undefined) {
  if (!value || !base) return undefined;
  try {
    const candidate = safePageUrl(new URL(value, base).href);
    if (!candidate) return undefined;
    // The citation URL also identifies a source. A page cannot claim another site's source.
    const host = (url: string) => new URL(url).hostname.replace(/^www\./u, "");
    return host(candidate) === host(base) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return;
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number) {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/\s+/gu, " ");
  return clean.length && clean.length <= max && !clean.includes("\0")
    ? clean
    : undefined;
}

function articleSchema(document: Document) {
  for (const script of [
    ...document.querySelectorAll('script[type="application/ld+json"]'),
  ].slice(0, 20)) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? "");
      const graph = record(data)?.["@graph"];
      const candidates: unknown[] = Array.isArray(data)
        ? data
        : Array.isArray(graph)
          ? [data, ...graph.slice(0, 100)]
          : [data];
      for (const entry of candidates.slice(0, 100)) {
        const item = record(entry);
        const types = item?.["@type"];
        if (
          (Array.isArray(types) ? types : [types]).some(
            (type) =>
              typeof type === "string" &&
              /^(?:(?:https?:\/\/schema\.org\/))?(?:Article|NewsArticle|BlogPosting|Report|ScholarlyArticle)$/u.test(
                type,
              ),
          )
        )
          return item;
      }
    } catch {
      // A malformed metadata block does not invalidate the article.
    }
  }
}

export function extractArticle(
  html: string,
  base: string | undefined,
  supplied: Metadata = {},
  publicFetch = false,
): { bibliography: Bibliography; extraction: WebPageExtraction } {
  const { document } = parseHTML(html);
  const article = articleSchema(document);
  const meta = (key: string) =>
    document
      .querySelector(`meta[property="${key}"], meta[name="${key}"]`)
      ?.getAttribute("content");
  const authors = (values: unknown[]) => [
    ...new Set(
      values.slice(0, 50).flatMap((value) => {
        const author = text(record(value)?.name ?? value, 300);
        return author ? [author] : [];
      }),
    ),
  ];
  const pageAuthors = authors(
    Array.isArray(article?.author) ? article.author : [article?.author],
  );
  const byline =
    supplied.authors ??
    (pageAuthors.length
      ? pageAuthors
      : authors(
          [...document.querySelectorAll('meta[name="author"]')].map((node) =>
            node.getAttribute("content"),
          ),
        ));
  const title =
    supplied.title ??
    text(meta("og:title"), 500) ??
    text(article?.headline, 500) ??
    text(document.querySelector("title")?.textContent, 500);
  const publication =
    supplied.publication ??
    text(meta("og:site_name"), 500) ??
    text(record(article?.publisher)?.name, 500);
  const date =
    supplied.date ??
    text(meta("article:published_time"), 100) ??
    text(article?.datePublished, 100);
  const url =
    canonical(supplied.url, base) ??
    canonical(
      document
        .querySelector('link[rel~="canonical" i]')
        ?.getAttribute("href") ?? undefined,
      base,
    ) ??
    canonical(meta("og:url") ?? undefined, base);
  const automatic = <T>(value: T) => ({ value, state: "automatic" as const });
  const bibliography: Bibliography = {
    ...(title && { title: automatic(title) }),
    ...(byline.length && { authors: automatic(byline) }),
    ...(publication && { publication: automatic(publication) }),
    ...(date && { date: automatic(date) }),
    ...(url && { url: automatic(url) }),
  };
  if (
    publicFetch &&
    (article?.isAccessibleForFree === false ||
      article?.isAccessibleForFree === "false")
  ) {
    return {
      bibliography,
      extraction: { status: "failed", reason: "blocked" },
    };
  }
  document
    .querySelectorAll(
      "script, style, nav, footer, aside, form, template, noscript, iframe, [hidden], [aria-hidden=true]",
    )
    .forEach((node) => node.remove());
  let extracted: string | undefined;
  try {
    extracted = new Readability(document, {
      maxElemsToParse: 15_000,
      serializer: (node) => (node as HTMLElement).innerText,
    })
      .parse()
      ?.content?.replace(/\0/gu, "")
      .trim();
  } catch {
    // Keep bibliographic details even when the reader cannot process the DOM.
  }
  return {
    bibliography,
    extraction: !extracted
      ? { status: "failed", reason: "no_article" }
      : extracted.length > 100_000
        ? { status: "failed", reason: "too_large" }
        : { status: "ready", text: extracted },
  };
}
