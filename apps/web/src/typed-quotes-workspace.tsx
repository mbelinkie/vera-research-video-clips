import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  ApiErrorSchema,
  LibraryItemSchema,
  LibrarySourceSchema,
  type LibrarySource,
  type Project,
} from "@research-video/contracts";

import { cloudFetch } from "./browser-api.ts";
import {
  createOfflineSourceRequest,
  createTypedQuoteRequest,
  emptyTypedQuoteDraft,
  type OfflineSourceDraft,
  type QuoteItem,
  type TypedQuoteDraft,
} from "./typed-quote-model.ts";

type Props = {
  authorization: string;
  browserSession?: boolean;
  csrfToken?: string | undefined;
  onAuthUnavailable?: (() => void) | undefined;
  projectId: string;
  projects: readonly Project[];
};

const pageSize = 20;
const offlineKinds: { value: OfflineSourceDraft["subtype"]; label: string }[] =
  [
    { value: "book", label: "Book" },
    { value: "print_article", label: "Print article" },
    { value: "interview", label: "Interview" },
    { value: "letter", label: "Letter" },
    { value: "document", label: "Document" },
    { value: "other", label: "Other" },
  ];

function newOfflineDraft(): OfflineSourceDraft {
  return {
    subtype: "book",
    title: "",
    authors: "",
    publication: "",
    publisher: "",
    date: "",
    url: "",
    notes: "",
  };
}

function sourceTitle(source: LibrarySource): string {
  return (
    source.bibliography.title?.value ??
    source.bibliography.url?.value ??
    `${source.kind.replace(/_/gu, " ")} source`
  );
}

function topicsFromText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/u)
        .map((topic) => topic.trim())
        .filter(Boolean),
    ),
  ];
}

function listPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && "items" in payload)
    return payload.items;
  return payload;
}

async function apiFailure(
  response: Response,
  fallback: string,
): Promise<Error> {
  const payload: unknown = await response.json().catch(() => undefined);
  const parsed = ApiErrorSchema.safeParse(payload);
  const message = parsed.success ? parsed.data.error.message : fallback;
  return new Error(
    `${response.status === 403 ? "Access denied: " : response.status === 409 ? "Conflict: " : ""}${message}`,
  );
}

/** Standalone entrypoint: #81 can later mount this within a source workspace. */
export function TypedQuotesWorkspace({
  authorization,
  browserSession = false,
  csrfToken,
  onAuthUnavailable,
  projectId,
  projects,
}: Props) {
  const [open, setOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<"existing" | "new">("existing");
  const [selectedSource, setSelectedSource] = useState<LibrarySource>();
  const [sourceDraft, setSourceDraft] = useState(newOfflineDraft);
  const [quoteDraft, setQuoteDraft] = useState(emptyTypedQuoteDraft);
  const [topicsText, setTopicsText] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string>();
  const [sourceRetry, setSourceRetry] = useState(0);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [quotesError, setQuotesError] = useState<string>();
  const [quotesRetry, setQuotesRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [focusSavedId, setFocusSavedId] = useState<string>();
  const quoteTextRef = useRef<HTMLTextAreaElement>(null);
  const savedQuoteRefs = useRef(new Map<string, HTMLLIElement>());
  const listRequest = useRef<AbortController | null>(null);
  const quoteRequest = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  // Keys belong to user intentions, not HTTP attempts. A failed write is retried
  // with the same key; edits/new quotes begin a new intention.
  const sourceIntentKey = useRef(crypto.randomUUID());
  const quoteIntentKey = useRef(crypto.randomUUID());
  const context = useRef({ projectId, authorization, csrfToken });
  context.current = { projectId, authorization, csrfToken };
  const previousContext = useRef({ projectId, authorization, csrfToken });
  const canWrite = Boolean(projectId && authorization);
  const projectName = projects.find(
    (project) => project.id === projectId,
  )?.name;

  // The outer app remounts for project/identity changes. Also invalidate a
  // live component when the same user receives a different browser session.
  useEffect(() => {
    const previous = previousContext.current;
    if (
      previous.projectId === projectId &&
      previous.authorization === authorization &&
      previous.csrfToken === csrfToken
    )
      return;
    previousContext.current = { projectId, authorization, csrfToken };
    listRequest.current?.abort();
    quoteRequest.current?.abort();
    saveRequest.current?.abort();
    saveRequest.current = null;
    setSaving(false);
    setOpen(false);
    setAddMenuOpen(false);
    setSelectedSource(undefined);
    setSources([]);
    setQuotes([]);
    setQuery("");
    setQueryInput("");
    setOffset(0);
    setSourceDraft(newOfflineDraft());
    setQuoteDraft(emptyTypedQuoteDraft());
    setTopicsText("");
    setError(undefined);
    setMessage(undefined);
    setFocusSavedId(undefined);
    sourceIntentKey.current = crypto.randomUUID();
    quoteIntentKey.current = crypto.randomUUID();
  }, [projectId, authorization, csrfToken]);

  useEffect(
    () => () => {
      listRequest.current?.abort();
      quoteRequest.current?.abort();
      saveRequest.current?.abort();
    },
    [],
  );

  const auth = {
    authorization,
    csrfToken,
    onUnavailable: browserSession ? onAuthUnavailable : undefined,
  };

  useEffect(() => {
    listRequest.current?.abort();
    if (!open || !canWrite || selectedSource || sourceMode !== "existing")
      return;
    const controller = new AbortController();
    listRequest.current = controller;
    setSourceLoading(true);
    setSourceError(undefined);
    void (async () => {
      try {
        const params = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset),
        });
        if (query) params.set("q", query);
        const response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/sources?${params}`,
          { signal: controller.signal },
          auth,
        );
        if (!response.ok)
          throw await apiFailure(response, "Unable to load sources.");
        const next = LibrarySourceSchema.array().parse(
          listPayload(await response.json()),
        );
        if (next.some((source) => source.projectId !== projectId))
          throw new Error("Source list did not match the selected project.");
        if (controller.signal.aborted) return;
        setSources((current) =>
          offset === 0
            ? next
            : [
                ...current,
                ...next.filter(
                  (source) => !current.some((seen) => seen.id === source.id),
                ),
              ],
        );
        setHasMore(next.length === pageSize);
      } catch (cause) {
        if (!controller.signal.aborted)
          setSourceError(
            cause instanceof Error ? cause.message : "Unable to load sources.",
          );
      } finally {
        if (!controller.signal.aborted) setSourceLoading(false);
      }
    })();
    return () => controller.abort();
  }, [
    open,
    canWrite,
    projectId,
    authorization,
    csrfToken,
    browserSession,
    onAuthUnavailable,
    selectedSource,
    sourceMode,
    query,
    offset,
    sourceRetry,
  ]);

  useEffect(() => {
    quoteRequest.current?.abort();
    setQuotes([]);
    setQuotesError(undefined);
    if (!open || !canWrite || !selectedSource) return;
    const controller = new AbortController();
    quoteRequest.current = controller;
    void (async () => {
      try {
        const params = new URLSearchParams({
          kind: "quote",
          sourceId: selectedSource.id,
          limit: "100",
          offset: "0",
        });
        const response = await cloudFetch(
          `/cloud-api/api/projects/${projectId}/items?${params}`,
          { signal: controller.signal },
          auth,
        );
        if (!response.ok)
          throw await apiFailure(response, "Unable to load source quotes.");
        const next = LibraryItemSchema.array()
          .parse(listPayload(await response.json()))
          .filter(
            (item): item is QuoteItem =>
              item.kind === "quote" && item.sourceId === selectedSource.id,
          );
        if (next.some((item) => item.projectId !== projectId))
          throw new Error("Quote list did not match the selected project.");
        if (!controller.signal.aborted)
          setQuotes((current) => [
            ...current.filter(
              (item) => !next.some((loaded) => loaded.id === item.id),
            ),
            ...next,
          ]);
      } catch (cause) {
        if (!controller.signal.aborted)
          setQuotesError(
            cause instanceof Error
              ? cause.message
              : "Unable to load source quotes.",
          );
      }
    })();
    return () => controller.abort();
  }, [
    open,
    canWrite,
    projectId,
    authorization,
    csrfToken,
    browserSession,
    onAuthUnavailable,
    selectedSource,
    quotesRetry,
  ]);

  useEffect(() => {
    if (focusSavedId) savedQuoteRefs.current.get(focusSavedId)?.focus();
  }, [focusSavedId, quotes]);

  function changeSourceDraft<K extends keyof OfflineSourceDraft>(
    field: K,
    value: OfflineSourceDraft[K],
  ) {
    setSourceDraft((current) => ({ ...current, [field]: value }));
    sourceIntentKey.current = crypto.randomUUID();
    setError(undefined);
    setMessage(undefined);
  }

  function changeQuoteDraft<K extends keyof TypedQuoteDraft>(
    field: K,
    value: TypedQuoteDraft[K],
  ) {
    setQuoteDraft((current) => ({ ...current, [field]: value }));
    quoteIntentKey.current = crypto.randomUUID();
    setError(undefined);
    setMessage(undefined);
    setFocusSavedId(undefined);
  }

  function chooseSource(source: LibrarySource) {
    setSelectedSource(source);
    setSourceMode("existing");
    setError(undefined);
    setMessage(undefined);
    quoteIntentKey.current = crypto.randomUUID();
    setFocusSavedId(undefined);
    queueMicrotask(() => quoteTextRef.current?.focus());
  }

  async function saveQuote(addAnother: boolean) {
    if (saveRequest.current || !canWrite) return;
    const controller = new AbortController();
    let nextSource = selectedSource;
    let quoteRequestBody:
      ReturnType<typeof createTypedQuoteRequest> | undefined;
    let sourceRequestBody:
      ReturnType<typeof createOfflineSourceRequest> | undefined;
    try {
      // Validate both documents before making either write. A failed quote
      // validation must not leave an accidental empty source in the Library.
      if (!nextSource && sourceMode === "new") {
        sourceRequestBody = createOfflineSourceRequest(
          sourceDraft,
          sourceIntentKey.current,
        );
        quoteRequestBody = createTypedQuoteRequest(
          // Validate before the source exists; the server-generated source ID
          // replaces this placeholder before the quote POST.
          crypto.randomUUID(),
          { ...quoteDraft, topics: topicsFromText(topicsText) },
          quoteIntentKey.current,
        );
      } else if (nextSource) {
        quoteRequestBody = createTypedQuoteRequest(
          nextSource.id,
          { ...quoteDraft, topics: topicsFromText(topicsText) },
          quoteIntentKey.current,
        );
      } else
        throw new Error("Choose a source or create an offline source first.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Check the source and quote fields.",
      );
      return;
    }
    saveRequest.current = controller;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    const expected = { ...context.current };
    const isCurrent = () =>
      !controller.signal.aborted &&
      context.current.projectId === expected.projectId &&
      context.current.authorization === expected.authorization &&
      context.current.csrfToken === expected.csrfToken;
    const post = async (path: string, body: unknown) => {
      const response = await cloudFetch(
        path,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        auth,
      );
      if (!response.ok)
        throw await apiFailure(
          response,
          "Unable to save; retry the same quote.",
        );
      return response.json() as Promise<unknown>;
    };
    try {
      const base = `/cloud-api/api/projects/${projectId}`;
      if (!nextSource) {
        nextSource = LibrarySourceSchema.parse(
          await post(`${base}/sources`, sourceRequestBody),
        );
        if (nextSource.projectId !== projectId)
          throw new Error("Created source did not match the selected project.");
        if (!isCurrent()) return;
        // Keep a successfully created source even if the subsequent quote fails.
        setSelectedSource(nextSource);
        setSourceMode("existing");
      }
      const body = { ...quoteRequestBody!, sourceId: nextSource.id };
      const item = LibraryItemSchema.parse(await post(`${base}/items`, body));
      if (
        item.kind !== "quote" ||
        item.sourceId !== nextSource.id ||
        item.projectId !== projectId
      )
        throw new Error(
          "Saved quote response did not match the selected source.",
        );
      if (!isCurrent()) return;
      setQuotes((current) => [
        item,
        ...current.filter((existing) => existing.id !== item.id),
      ]);
      setQuotesRetry((retry) => retry + 1);
      quoteIntentKey.current = crypto.randomUUID();
      setMessage(
        addAnother
          ? "Quote saved. Add another to the same source."
          : "Quote saved to this source.",
      );
      if (addAnother) {
        setQuoteDraft(emptyTypedQuoteDraft());
        setTopicsText("");
        setFocusSavedId(undefined);
        // The textarea stays mounted; focus is restored after the successful save.
        queueMicrotask(() => {
          if (isCurrent()) quoteTextRef.current?.focus();
        });
      } else {
        setFocusSavedId(item.id);
      }
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to save; retry this quote.",
        );
    } finally {
      if (saveRequest.current === controller) saveRequest.current = null;
      if (isCurrent()) setSaving(false);
    }
  }

  return (
    <section
      className="typed-quotes-workspace"
      aria-labelledby="typed-quotes-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Project library</p>
          <h2 id="typed-quotes-heading">Typed quotes</h2>
        </div>
        <div className="typed-quotes-add">
          <span className="status">{projectName ?? "No project selected"}</span>
          <button
            type="button"
            aria-expanded={addMenuOpen}
            aria-controls="typed-quotes-add-menu"
            disabled={!canWrite || saving}
            onClick={() => setAddMenuOpen((value) => !value)}
          >
            + Add
          </button>
          {addMenuOpen && (
            <div id="typed-quotes-add-menu" className="typed-quotes-add-menu">
              <button
                type="button"
                onClick={() => {
                  setOpen(true);
                  setAddMenuOpen(false);
                }}
              >
                Typed quote
              </button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="typed-quotes-body">
          <div className="typed-quotes-topline">
            <strong>Log a quote</strong>
            <button
              type="button"
              className="quiet-button"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                setError(undefined);
                setMessage(undefined);
              }}
            >
              Close
            </button>
          </div>
          <p className="muted">
            Saving to {projectName ?? "the selected project"}. Your quote text
            is retained exactly as entered.
          </p>
          <div className="typed-quotes-source" aria-label="Quote source">
            <h3>1. Source</h3>
            {selectedSource ? (
              <div className="typed-quotes-selected">
                <p>
                  <strong>Selected source:</strong>{" "}
                  {sourceTitle(selectedSource)}{" "}
                  <span className="muted">
                    ({selectedSource.kind.replace(/_/gu, " ")})
                  </span>
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setSelectedSource(undefined);
                    setSources([]);
                    setOffset(0);
                    setSourceRetry((retry) => retry + 1);
                    setFocusSavedId(undefined);
                  }}
                >
                  Change source
                </button>
              </div>
            ) : (
              <>
                <div className="typed-quotes-tabs">
                  <button
                    type="button"
                    aria-pressed={sourceMode === "existing"}
                    disabled={saving}
                    onClick={() => setSourceMode("existing")}
                  >
                    Choose existing source
                  </button>
                  <button
                    type="button"
                    aria-pressed={sourceMode === "new"}
                    disabled={saving}
                    onClick={() => setSourceMode("new")}
                  >
                    New offline source
                  </button>
                </div>
                {sourceMode === "existing" ? (
                  <div className="typed-quotes-chooser">
                    <form
                      className="typed-quotes-search"
                      onSubmit={(event) => {
                        event.preventDefault();
                        setSources([]);
                        setOffset(0);
                        setQuery(queryInput.trim());
                        setSourceRetry((retry) => retry + 1);
                      }}
                    >
                      <label htmlFor="typed-source-search">
                        Search existing sources (including web pages)
                      </label>
                      <div>
                        <input
                          id="typed-source-search"
                          value={queryInput}
                          onChange={(event) =>
                            setQueryInput(event.target.value)
                          }
                          placeholder="Title, author or URL"
                          maxLength={500}
                        />
                        <button type="submit" disabled={sourceLoading}>
                          Search
                        </button>
                      </div>
                    </form>
                    {sourceError && (
                      <p role="alert">
                        {sourceError}{" "}
                        <button
                          type="button"
                          onClick={() => setSourceRetry((retry) => retry + 1)}
                        >
                          Retry sources
                        </button>
                      </p>
                    )}
                    <ul className="typed-quotes-source-list">
                      {sources.map((source) => (
                        <li key={source.id}>
                          <button
                            type="button"
                            onClick={() => chooseSource(source)}
                          >
                            <strong>{sourceTitle(source)}</strong>
                            <span>{source.kind.replace(/_/gu, " ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {sourceLoading && <p role="status">Loading sources…</p>}
                    {!sourceLoading && !sourceError && sources.length === 0 && (
                      <p className="muted">
                        No sources found. You can create an offline source.
                      </p>
                    )}
                    {hasMore && (
                      <button
                        type="button"
                        disabled={sourceLoading}
                        onClick={() => setOffset((value) => value + pageSize)}
                      >
                        Load more sources
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="typed-quotes-source-form">
                    <label>
                      Source type
                      <select
                        value={sourceDraft.subtype}
                        onChange={(event) =>
                          changeSourceDraft(
                            "subtype",
                            event.target.value as OfflineSourceDraft["subtype"],
                          )
                        }
                      >
                        {offlineKinds.map((kind) => (
                          <option key={kind.value} value={kind.value}>
                            {kind.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Source title *
                      <input
                        required
                        maxLength={500}
                        value={sourceDraft.title}
                        onChange={(event) =>
                          changeSourceDraft("title", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Authors (one per line)
                      <textarea
                        rows={2}
                        value={sourceDraft.authors}
                        onChange={(event) =>
                          changeSourceDraft("authors", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Publication
                      <input
                        maxLength={500}
                        value={sourceDraft.publication}
                        onChange={(event) =>
                          changeSourceDraft("publication", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Publisher
                      <input
                        maxLength={500}
                        value={sourceDraft.publisher}
                        onChange={(event) =>
                          changeSourceDraft("publisher", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Publication date
                      <input
                        maxLength={100}
                        value={sourceDraft.date}
                        onChange={(event) =>
                          changeSourceDraft("date", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      URL (optional)
                      <input
                        type="url"
                        value={sourceDraft.url}
                        onChange={(event) =>
                          changeSourceDraft("url", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Source notes
                      <textarea
                        rows={2}
                        value={sourceDraft.notes}
                        onChange={(event) =>
                          changeSourceDraft("notes", event.target.value)
                        }
                      />
                    </label>
                    <p className="muted">
                      Only the first save creates this source; later quotes
                      reuse it.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <form
            className="typed-quotes-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void saveQuote(false);
            }}
          >
            <h3>2. Quote</h3>
            <label>
              Quote text *
              <textarea
                ref={quoteTextRef}
                required
                rows={5}
                maxLength={100000}
                value={quoteDraft.text}
                onChange={(event) =>
                  changeQuoteDraft("text", event.target.value)
                }
                placeholder="Enter the exact words, including punctuation and line breaks"
              />
            </label>
            <div className="typed-quotes-grid">
              <label>
                Speaker name
                <input
                  maxLength={300}
                  value={quoteDraft.speaker}
                  onChange={(event) =>
                    changeQuoteDraft("speaker", event.target.value)
                  }
                />
              </label>
              <label>
                Speaker title / role
                <input
                  maxLength={500}
                  value={quoteDraft.speakerTitle}
                  onChange={(event) =>
                    changeQuoteDraft("speakerTitle", event.target.value)
                  }
                />
              </label>
              <label>
                Page / location
                <input
                  maxLength={500}
                  value={quoteDraft.page}
                  onChange={(event) =>
                    changeQuoteDraft("page", event.target.value)
                  }
                />
              </label>
              <label>
                Topics (comma-separated)
                <input
                  value={topicsText}
                  onChange={(event) => {
                    setTopicsText(event.target.value);
                    quoteIntentKey.current = crypto.randomUUID();
                    setError(undefined);
                    setMessage(undefined);
                  }}
                />
              </label>
            </div>
            <label>
              Quote note
              <textarea
                rows={2}
                maxLength={20000}
                value={quoteDraft.note}
                onChange={(event) =>
                  changeQuoteDraft("note", event.target.value)
                }
              />
            </label>
            <label>
              Citation override (optional)
              <textarea
                rows={2}
                maxLength={20000}
                value={quoteDraft.citationOverride}
                onChange={(event) =>
                  changeQuoteDraft("citationOverride", event.target.value)
                }
              />
            </label>
            {error && (
              <p className="typed-quotes-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="typed-quotes-success" role="status">
                {message}
              </p>
            )}
            <div className="typed-quotes-actions">
              <button type="submit" disabled={!canWrite || saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={!canWrite || saving}
                onClick={() => void saveQuote(true)}
              >
                Save and add another
              </button>
            </div>
          </form>
          {selectedSource && (
            <section
              className="typed-quotes-saved"
              aria-label="Quotes from selected source"
            >
              <h3>Saved quotes</h3>
              {quotesError && (
                <p role="alert">
                  {quotesError}{" "}
                  <button
                    type="button"
                    onClick={() => setQuotesRetry((value) => value + 1)}
                  >
                    Retry quotes
                  </button>
                </p>
              )}
              <ul>
                {quotes.map((item) => (
                  <li
                    key={item.id}
                    ref={(node) => {
                      if (node) savedQuoteRefs.current.set(item.id, node);
                      else savedQuoteRefs.current.delete(item.id);
                    }}
                    tabIndex={-1}
                    aria-label={`Saved quote: ${item.content.text.slice(0, 100)}`}
                  >
                    <blockquote>{item.content.text}</blockquote>
                    <small>{item.content.location ?? "No page"}</small>
                  </li>
                ))}
              </ul>
              {!quotes.length && !quotesError && (
                <p className="muted">No quotes from this source yet.</p>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}
