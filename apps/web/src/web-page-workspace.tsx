import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import {
  CreateItemRequestSchema,
  LibraryItemSchema,
  LibrarySourceSchema,
  UpdateSourceRequestSchema,
  webPageExtractionMessages,
  type LibraryItem,
  type LibrarySource,
} from "@research-video/contracts";
import {
  CaptureReceiptSchema,
  jsonWrite,
  listItems,
  readResearch,
  researchPageSize,
  projectPath,
  ResearchRequestError,
  verifyItem,
  verifySource,
  type ResearchRequest,
} from "./research-library-data.ts";
import {
  ResearchImage,
  researchError,
  useResearchMutation,
  useResearchRead,
} from "./research-catalog.tsx";
import { findExactQuoteSpan, readArticleSelection } from "./quote-spans.ts";

type Quote = Extract<LibraryItem, { kind: "quote" }>;
type Capture = z.infer<typeof CaptureReceiptSchema>;

export function WebPageWorkspace({
  source,
  request,
  canWrite,
  refresh,
  onSourceChange,
  onLogged,
  onManualQuote,
  recentQuote,
  comments,
}: {
  source: LibrarySource;
  request: ResearchRequest;
  canWrite: boolean;
  refresh: number;
  onSourceChange(source: LibrarySource): void;
  onLogged(): void;
  onManualQuote(quote?: Quote): void;
  recentQuote?: Quote | undefined;
  comments?: ReactNode;
}) {
  const { projectId, id: sourceId } = source;
  const base = projectPath(projectId);
  const [view, setView] = useState<"text" | "picture" | "details">("text");
  const [quotePage, setQuotePage] = useState(0);
  const [selectedQuote, setSelectedQuote] = useState<Quote>();
  const [focusQuoteId, setFocusQuoteId] = useState<string>();
  const [pending, setPending] = useState<{
    selection: NonNullable<ReturnType<typeof readArticleSelection>>;
    key: string;
  }>();
  const [topics, setTopics] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const article = useRef<HTMLDivElement>(null);
  const marked = useRef<HTMLElement>(null);
  const savedFocus = useRef<HTMLButtonElement>(null);
  const write = useResearchMutation();
  const extraction =
    "extraction" in source.details ? source.details.extraction : undefined;
  const text = extraction?.status === "ready" ? extraction.text : "";
  const span = selectedQuote && findExactQuoteSpan(text, selectedQuote.content);

  const loadQuotes = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({
        kind: "quote",
        sourceId,
        limit: String(researchPageSize),
        offset: String(quotePage * researchPageSize),
      });
      const items = await listItems(request, projectId, query, signal);
      return items.filter((item): item is Quote => item.kind === "quote");
    },
    [projectId, quotePage, request, sourceId],
  );
  const quotes = useResearchRead(loadQuotes, true, refresh + retry, true);
  const pictureItemId = selectedQuote?.id;
  const loadPicture = useCallback(
    async (signal: AbortSignal) => {
      let passage: Capture | undefined;
      if (pictureItemId) {
        try {
          passage = await readResearch(
            request,
            `${base}/items/${pictureItemId}/extension-capture`,
            CaptureReceiptSchema,
            { signal },
          );
          if (passage.itemId !== pictureItemId || passage.sourceId !== sourceId)
            throw new Error("Picture does not belong to this quote.");
          if (passage.assets.some((asset) => asset.role === "passage"))
            return passage;
        } catch (caught) {
          if (
            !(caught instanceof ResearchRequestError) ||
            caught.status !== 404
          )
            throw caught;
        }
      }
      for (let offset = 0; !signal.aborted; offset += 50) {
        const captures = await readResearch(
          request,
          `${base}/sources/${sourceId}/extension-captures?offset=${offset}`,
          CaptureReceiptSchema.array(),
          { signal },
        );
        if (captures.some((capture) => capture.sourceId !== sourceId))
          throw new Error("Picture does not belong to this source.");
        const top = captures.find((capture) =>
          capture.assets.some((asset) => asset.role === "top"),
        );
        if (top || captures.length < 50) return top;
      }
      return undefined;
    },
    [base, pictureItemId, request, sourceId],
  );
  const picture = useResearchRead(
    loadPicture,
    view === "picture",
    refresh + retry,
  );
  const capture = picture.data;
  const asset =
    capture?.assets.find(
      ({ role }) => role === "passage" && capture.itemId === pictureItemId,
    ) ?? capture?.assets.find(({ role }) => role === "top");

  useEffect(() => {
    if (span && view === "text")
      marked.current?.scrollIntoView({ block: "nearest" });
  }, [span?.start, span?.end, selectedQuote?.id, view]);

  useEffect(() => {
    if (recentQuote) {
      setSelectedQuote(recentQuote);
      setQuotePage(0);
      setFocusQuoteId(recentQuote.id);
    }
  }, [recentQuote]);

  useEffect(() => {
    if (savedFocus.current && focusQuoteId) {
      savedFocus.current.focus();
      setFocusQuoteId(undefined);
    }
  }, [focusQuoteId, quotes.data]);

  useEffect(() => {
    function onSelectionChange() {
      if (!article.current || !text || !canWrite || write.current) return;
      const selected = readArticleSelection(article.current, text);
      if (!selected) return;
      setPending((current) =>
        current?.selection.text === selected.text &&
        current.selection.surroundingWords.before ===
          selected.surroundingWords.before &&
        current.selection.surroundingWords.after ===
          selected.surroundingWords.after
          ? current
          : { selection: selected, key: crypto.randomUUID() },
      );
    }
    if (view === "text")
      document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, [canWrite, text, view, write]);

  async function logQuote(event: FormEvent) {
    event.preventDefault();
    if (!pending || !canWrite || write.current) return;
    const body = CreateItemRequestSchema.safeParse({
      kind: "quote",
      sourceId,
      content: pending.selection,
      notes,
      topics: topics
        .split(",")
        .map((topic) => topic.trim())
        .filter(Boolean),
      idempotencyKey: pending.key,
    });
    if (!body.success) {
      setError(body.error.issues[0]?.message ?? "Check the quote fields.");
      return;
    }
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const item = verifyItem(
        await readResearch(request, `${base}/items`, LibraryItemSchema, {
          ...jsonWrite("POST", body.data),
          signal: controller.signal,
        }),
        projectId,
        sourceId,
      );
      if (controller.signal.aborted || item.kind !== "quote") return;
      setSelectedQuote(item);
      setFocusQuoteId(item.id);
      setQuotePage(0);
      setPending(undefined);
      setTopics("");
      setNotes("");
      window.getSelection()?.removeAllRanges();
      onLogged();
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(researchError(caught, "The quote could not be saved."));
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="research-article">
      <div className="research-toolbar">
        <nav aria-label="Article views">
          <button
            type="button"
            aria-pressed={view === "text"}
            onClick={() => setView("text")}
          >
            Text
          </button>
          <button
            type="button"
            aria-pressed={view === "picture"}
            onClick={() => setView("picture")}
          >
            Page picture
          </button>
          <button
            type="button"
            aria-pressed={view === "details"}
            onClick={() => setView("details")}
          >
            Details &amp; citation
          </button>
        </nav>
        {view !== "details" && comments}
      </div>
      <div className="research-article-split">
        <div className="research-detail">
          {view === "text" &&
            (text ? (
              <>
                <div
                  ref={article}
                  className="research-article-text"
                  aria-label="Clean article text"
                  tabIndex={0}
                >
                  {span ? (
                    <>
                      {text.slice(0, span.start)}
                      <mark ref={marked}>
                        {text.slice(span.start, span.end)}
                      </mark>
                      {text.slice(span.end)}
                    </>
                  ) : (
                    text
                  )}
                </div>
                {selectedQuote && !span && (
                  <p className="muted">
                    This quote has no unique match in the clean article text.
                  </p>
                )}
                {canWrite && pending && (
                  <form
                    className="research-quote-form"
                    onSubmit={(event) => void logQuote(event)}
                  >
                    <blockquote>{pending.selection.text}</blockquote>
                    <label>
                      Topics{" "}
                      <input
                        value={topics}
                        placeholder="Comma-separated Topics"
                        disabled={busy}
                        onChange={(event) => setTopics(event.target.value)}
                      />
                    </label>
                    <label>
                      Note{" "}
                      <textarea
                        value={notes}
                        disabled={busy}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={busy}>
                      {busy ? "Saving…" : "Log quote"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        window.getSelection()?.removeAllRanges();
                        setPending(undefined);
                        setError(undefined);
                      }}
                    >
                      Cancel
                    </button>
                    {error && <p role="alert">{error}</p>}
                  </form>
                )}
              </>
            ) : (
              <p>
                {extraction?.status === "failed"
                  ? webPageExtractionMessages[extraction.reason]
                  : "Clean article text is unavailable for this source."}
              </p>
            ))}
          {view === "picture" && (
            <>
              {picture.error && (
                <p role="alert">
                  {picture.error}{" "}
                  <button type="button" onClick={() => setRetry((n) => n + 1)}>
                    Try again
                  </button>
                </p>
              )}
              {!picture.loaded && !picture.error && (
                <p role="status">Loading picture…</p>
              )}
              {picture.loaded && !asset && (
                <p>No saved picture for this view.</p>
              )}
              {asset && capture && (
                <>
                  <p>
                    {asset.role === "passage"
                      ? "Passage picture"
                      : "Top of article"}
                  </p>
                  <div
                    className="research-page-picture"
                    style={{ aspectRatio: `${asset.width} / ${asset.height}` }}
                  >
                    <ResearchImage
                      request={request}
                      path={`${base}/extension-captures/${capture.captureId}/assets/${asset.role}?revisionId=${asset.revisionId}`}
                      alt={
                        asset.role === "passage"
                          ? "Saved picture of the quoted passage"
                          : "Saved picture of the top of the article"
                      }
                    />
                    {asset.role === "passage" &&
                      asset.normalizedRectangles.map((rectangle, index) => (
                        <span
                          key={index}
                          aria-hidden="true"
                          style={{
                            left: `${rectangle.x * 100}%`,
                            top: `${rectangle.y * 100}%`,
                            width: `${rectangle.width * 100}%`,
                            height: `${rectangle.height * 100}%`,
                          }}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
          {view === "details" && (
            <CitationEditor
              request={request}
              source={source}
              canWrite={canWrite}
              onSourceChange={onSourceChange}
            />
          )}
        </div>
        <aside
          className="research-detail research-quotes"
          aria-label="Saved quotes"
        >
          <div className="section-heading">
            <h3>Saved quotes</h3>
            {canWrite && (
              <button type="button" onClick={() => onManualQuote()}>
                New quote
              </button>
            )}
          </div>
          {quotes.error && (
            <p role="alert">
              {quotes.error}{" "}
              <button type="button" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </button>
            </p>
          )}
          {!quotes.data && !quotes.error && (
            <p role="status">Loading quotes…</p>
          )}
          {quotes.data?.length === 0 && <p>No saved quotes.</p>}
          <ul className="research-rows">
            {quotes.data?.map((quote) => (
              <li key={quote.id}>
                <button
                  type="button"
                  ref={quote.id === focusQuoteId ? savedFocus : undefined}
                  aria-pressed={selectedQuote?.id === quote.id}
                  onClick={() => {
                    setSelectedQuote(quote);
                    if (view === "details") setView("text");
                  }}
                >
                  {quote.content.text}
                  {(quote.content.speaker || quote.content.speakerTitle) && (
                    <small>
                      {[quote.content.speaker, quote.content.speakerTitle]
                        .filter(Boolean)
                        .join(", ")}
                    </small>
                  )}
                </button>
                {canWrite && selectedQuote?.id === quote.id && (
                  <button type="button" onClick={() => onManualQuote(quote)}>
                    Edit selected quote
                  </button>
                )}
              </li>
            ))}
          </ul>
          {!!(quotePage || quotes.data?.length === researchPageSize) && (
            <div className="research-pagination">
              <button
                type="button"
                disabled={!quotePage}
                onClick={() => setQuotePage((n) => n - 1)}
              >
                Previous quotes
              </button>
              <button
                type="button"
                disabled={
                  quotes.data?.length !== researchPageSize || quotePage >= 3333
                }
                onClick={() => setQuotePage((n) => n + 1)}
              >
                More quotes
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

const fields = {
  title: "Title",
  authors: "Authors",
  publication: "Publication",
  publisher: "Publisher",
  date: "Publication date",
  url: "URL",
  credit: "Credit",
} as const;
const fieldNames = Object.keys(fields) as (keyof typeof fields)[];

function fieldText(source: LibrarySource, field: keyof typeof fields) {
  const value = source.bibliography[field]?.value;
  return Array.isArray(value) ? value.join("\n") : (value ?? "");
}

export function CitationEditor({
  request,
  source,
  canWrite,
  onSourceChange,
}: {
  request: ResearchRequest;
  source: LibrarySource;
  canWrite: boolean;
  onSourceChange(source: LibrarySource): void;
}) {
  const [draft, setDraft] = useState<
    Partial<Record<keyof typeof fields, string>>
  >({});
  const [version, setVersion] = useState(source.version);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const write = useResearchMutation();
  const path = `${projectPath(source.projectId)}/sources/${source.id}`;
  function change(field: keyof typeof fields, value: string) {
    if (!Object.keys(draft).length) setVersion(source.version);
    setDraft((current) => ({ ...current, [field]: value }));
    setMessage(undefined);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || write.current || !Object.keys(draft).length) return;
    const bibliography = Object.fromEntries(
      Object.entries(draft).map(([field, input]) => {
        const value = input.trim();
        return [
          field,
          value
            ? {
                value:
                  field === "authors"
                    ? value
                        .split("\n")
                        .map((author) => author.trim())
                        .filter(Boolean)
                    : value,
                state: "confirmed",
              }
            : null,
        ];
      }),
    );
    const body = UpdateSourceRequestSchema.safeParse({
      expectedVersion: version,
      bibliography,
    });
    if (!body.success) {
      setError(body.error.issues[0]?.message ?? "Check citation fields.");
      return;
    }
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const updated = verifySource(
        await readResearch(request, path, LibrarySourceSchema, {
          ...jsonWrite("PATCH", body.data),
          signal: controller.signal,
        }),
        source.projectId,
        source.id,
      );
      if (controller.signal.aborted) return;
      onSourceChange(updated);
      setDraft({});
      setMessage("Citation saved.");
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (caught instanceof ResearchRequestError && caught.status === 409) {
        try {
          const latest = verifySource(
            await readResearch(request, path, LibrarySourceSchema, {
              signal: controller.signal,
            }),
            source.projectId,
            source.id,
          );
          if (controller.signal.aborted) return;
          onSourceChange(latest);
          setVersion(latest.version);
        } catch {
          if (controller.signal.aborted) return;
        }
        setError(
          "The source changed while you were editing. Review the current fields before saving again.",
        );
      } else
        setError(researchError(caught, "The citation could not be saved."));
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form className="research-citation" onSubmit={(event) => void save(event)}>
      {fieldNames.map((field) => {
        const value = draft[field] ?? fieldText(source, field);
        const state = source.bibliography[field]?.state;
        return (
          <div key={field}>
            <label>
              {fields[field]}
              {field === "authors" ? (
                <textarea
                  placeholder="One author per line"
                  value={value}
                  readOnly={!canWrite}
                  disabled={busy}
                  onChange={(event) => change(field, event.target.value)}
                />
              ) : (
                <input
                  value={value}
                  type={field === "url" ? "url" : "text"}
                  readOnly={!canWrite}
                  disabled={busy}
                  onChange={(event) => change(field, event.target.value)}
                />
              )}
            </label>
            {draft[field] === undefined && state && (
              <small>
                {state === "automatic" ? "Found automatically" : "Confirmed"}
              </small>
            )}
            {canWrite &&
              state === "automatic" &&
              draft[field] === undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => change(field, value)}
                >
                  Confirm {fields[field].toLowerCase()}
                </button>
              )}
          </div>
        );
      })}
      {canWrite && (
        <button type="submit" disabled={busy || !Object.keys(draft).length}>
          Save citation
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
