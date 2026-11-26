import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CreateSourceRequestSchema,
  ImportWebPageRequestSchema,
  LibrarySourceSchema,
  type LibrarySource,
  type LibraryItem,
  type Project,
} from "@research-video/contracts";
import {
  getResearchSource,
  jsonWrite,
  projectPath,
  readResearch,
  researchRequest,
  verifySource,
  type ResearchAuth,
  type ResearchRequest,
} from "./research-library-data.ts";
import {
  ResearchCatalog,
  researchError,
  sourceKinds,
  sourceTitle,
  useResearchMutation,
  useResearchRead,
} from "./research-catalog.tsx";
import { getDiscussionCounts, SourceDiscussion } from "./source-discussion.tsx";
import { CitationEditor, WebPageWorkspace } from "./web-page-workspace.tsx";
import { TypedQuotesWorkspace } from "./typed-quotes-workspace.tsx";
import { AudioIntake, AudioWorkspace } from "./audio-workspace.tsx";
import { StillsWorkspace } from "./stills-workspace.tsx";
import { YouTubeSourceView } from "./youtube-source-view.tsx";

type Quote = Extract<LibraryItem, { kind: "quote" }>;

export type ResearchTab = "sources" | "library";

export function ResearchProject({
  project,
  auth,
  browserSession,
  localImport,
  canWrite,
  tab,
  sourceId,
  onOpenSource,
  onCloseSource,
  onAddYouTube,
  onReviewVideo,
  legacyLibrary,
}: {
  project: Project;
  auth: ResearchAuth;
  browserSession: boolean;
  localImport: boolean;
  canWrite: boolean;
  tab: ResearchTab;
  sourceId: string | undefined;
  onOpenSource(id: string): void;
  onCloseSource(): void;
  onAddYouTube(): void;
  onReviewVideo?(source: LibrarySource): void;
  legacyLibrary?: ReactNode;
}) {
  const { authorization, csrfToken, onUnavailable } = auth;
  const request = useMemo(
    () => researchRequest({ authorization, csrfToken, onUnavailable }),
    [authorization, csrfToken, onUnavailable],
  );
  const [refresh, setRefresh] = useState(0);
  const [textSize, setTextSize] = useState("standard");
  const [intake, setIntake] = useState<
    | "web"
    | "image"
    | "file"
    | "image-file"
    | "quote"
    | "audio-url"
    | "audio-file"
  >();
  const [localAudio, setLocalAudio] = useState<{
    sourceId: string;
    file: File;
  }>();
  function audioOpened(id: string, file?: File) {
    if (file) setLocalAudio({ sourceId: id, file });
    closeIntake();
    onOpenSource(id);
  }
  const [manualQuote, setManualQuote] = useState<{
    sourceId: string;
    quote?: Quote;
  }>();
  const [recentQuote, setRecentQuote] = useState<Quote>();
  const [updatedSource, setUpdatedSource] = useState<LibrarySource>();
  const [sourceRetry, setSourceRetry] = useState(0);
  const focusSource = useRef("");
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLElement>(null);
  const bump = useCallback(() => setRefresh((value) => value + 1), []);
  const projectId = project.id;
  const loadSource = useCallback(
    (signal: AbortSignal) =>
      sourceId
        ? getResearchSource(request, projectId, sourceId, signal)
        : Promise.resolve(undefined),
    [projectId, request, sourceId],
  );
  const sourceState = useResearchRead(
    loadSource,
    tab === "sources" && Boolean(sourceId),
    sourceRetry,
  );
  const loadedSource = sourceState.data;
  const source =
    loadedSource &&
    updatedSource?.id === loadedSource.id &&
    updatedSource.version >= loadedSource.version
      ? updatedSource
      : loadedSource;
  const countComments = useCallback(
    (ids: string[], signal: AbortSignal) =>
      getDiscussionCounts(request, projectId, ids, signal),
    [projectId, request],
  );

  useEffect(() => {
    if (tab !== "sources") return;
    if (sourceId) {
      focusSource.current = sourceId;
      sourceHeading.current?.focus();
    } else if (focusSource.current) {
      const title = document.querySelector<HTMLButtonElement>(
        `[data-research-source="${focusSource.current}"]`,
      );
      (title ?? addButton.current)?.focus();
      focusSource.current = "";
    }
  }, [sourceId, tab]);

  function closeIntake() {
    setIntake(undefined);
    addButton.current?.focus();
    bump();
  }

  function sourceChanged(updated: LibrarySource) {
    setUpdatedSource(updated);
    bump();
  }

  const sharedIntake = {
    authorization,
    browserSession,
    csrfToken,
    onAuthUnavailable: onUnavailable,
    projectId,
    projects: [project],
  };

  const tools = (
    <details className="research-add">
      <summary ref={addButton}>+ Add</summary>
      <div>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            onAddYouTube();
          }}
        >
          YouTube URL
        </button>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setIntake("web");
          }}
        >
          Web page URL
        </button>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setIntake("image");
          }}
        >
          Image URL
        </button>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setIntake("audio-url");
          }}
        >
          Audio URL
        </button>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setIntake("file");
          }}
        >
          File from this Mac
        </button>
        <button type="button" disabled>
          PDF (unavailable)
        </button>
        <button
          type="button"
          disabled={!canWrite}
          onClick={(event) => {
            event.currentTarget.closest("details")?.removeAttribute("open");
            setIntake("quote");
          }}
        >
          Typed quote
        </button>
      </div>
    </details>
  );

  return (
    <section
      className="research-project"
      style={
        {
          "--research-text-size": textSize === "large" ? "1.15rem" : "1rem",
        } as CSSProperties
      }
    >
      <div className="research-toolbar research-options">
        <label>
          Text size
          <select
            value={textSize}
            onChange={(event) => setTextSize(event.target.value)}
          >
            <option value="standard">Standard</option>
            <option value="large">Large</option>
          </select>
        </label>
      </div>
      <ResearchCatalog
        request={request}
        projectId={projectId}
        tab="sources"
        refresh={refresh}
        active={tab === "sources" && !sourceId}
        visible={tab === "sources" && !sourceId}
        onOpenSource={(id) => {
          setIntake(undefined);
          onOpenSource(id);
        }}
        toolbar={tools}
        commentCounts={countComments}
      />
      {tab === "sources" && !sourceId && intake === "web" && (
        <WebPageIntake
          request={request}
          projectId={projectId}
          localImport={localImport}
          onCancel={closeIntake}
          onCreated={(id) => {
            closeIntake();
            onOpenSource(id);
          }}
        />
      )}
      {tab === "sources" && !sourceId && intake === "quote" && (
        <TypedQuotesWorkspace
          {...sharedIntake}
          initialOpen
          onAuthUnavailable={onUnavailable}
          onSaved={bump}
          onClose={closeIntake}
        />
      )}
      {tab === "sources" && !sourceId && intake === "file" && (
        <div
          className="research-detail research-intake research-toolbar"
          aria-label="File type"
        >
          <button type="button" onClick={() => setIntake("image-file")}>
            Image file
          </button>
          <button type="button" onClick={() => setIntake("audio-file")}>
            Audio file
          </button>
          <button type="button" onClick={closeIntake}>
            Cancel
          </button>
        </div>
      )}
      {tab === "sources" &&
        !sourceId &&
        (intake === "audio-url" || intake === "audio-file") && (
          <AudioIntake
            request={request}
            projectId={projectId}
            mode={intake === "audio-url" ? "url" : "file"}
            onCreated={audioOpened}
            onCancel={closeIntake}
          />
        )}
      {tab === "sources" &&
        !sourceId &&
        (intake === "image" || intake === "image-file") && (
          <StillsWorkspace
            {...sharedIntake}
            initialMode={intake === "image" ? "url" : "file"}
            onClose={closeIntake}
          />
        )}
      {tab === "library" && (
        <>
          <ResearchCatalog
            request={request}
            projectId={projectId}
            tab="library"
            active
            refresh={refresh}
            onOpenSource={onOpenSource}
            localAudio={localAudio}
          />
          {legacyLibrary}
        </>
      )}
      {tab === "sources" && sourceId && (
        <section
          className="research-source-workspace"
          aria-label="Source workspace"
        >
          <div className="section-heading research-source-heading">
            <button type="button" onClick={onCloseSource}>
              Back to Sources
            </button>
            <h2 ref={sourceHeading} tabIndex={-1}>
              {source ? sourceTitle(source) : "Source workspace"}
            </h2>
            {source && (
              <span className="research-kind">{sourceKinds[source.kind]}</span>
            )}
          </div>
          {sourceState.error && (
            <p role="alert">
              {sourceState.error}{" "}
              <button
                type="button"
                onClick={() => setSourceRetry((value) => value + 1)}
              >
                Try again
              </button>
            </p>
          )}
          {!source && !sourceState.error && (
            <p role="status">Opening source…</p>
          )}
          {source?.kind === "web_page" && (
            <WebPageWorkspace
              key={source.id}
              request={request}
              source={source}
              canWrite={canWrite}
              refresh={refresh}
              onSourceChange={sourceChanged}
              onLogged={bump}
              onManualQuote={(quote) =>
                setManualQuote({
                  sourceId: source.id,
                  ...(quote ? { quote } : {}),
                })
              }
              recentQuote={
                recentQuote?.sourceId === source.id ? recentQuote : undefined
              }
              comments={
                <SourceDiscussion
                  request={request}
                  projectId={projectId}
                  sourceId={source.id}
                  refresh={refresh}
                  onChanged={bump}
                />
              }
            />
          )}
          {source?.kind === "youtube" && (
            <>
              <div className="research-toolbar">
                <SourceDiscussion
                  key={source.id}
                  request={request}
                  projectId={projectId}
                  sourceId={source.id}
                  refresh={refresh}
                  onChanged={bump}
                />
                {onReviewVideo && (
                  <button type="button" onClick={() => onReviewVideo(source)}>
                    Open transcript and log clips
                  </button>
                )}
              </div>
              <YouTubeSourceView
                key={source.id}
                nested
                receipt={{ projectId, sourceId: source.id }}
                authorization={authorization}
                {...(csrfToken ? { csrfToken } : {})}
                {...(onUnavailable ? { onAuthUnavailable: onUnavailable } : {})}
                projectName={project.name}
                onClose={onCloseSource}
              />
            </>
          )}
          {source?.kind === "audio" && (
            <AudioWorkspace
              key={source.id}
              request={request}
              source={source}
              canWrite={canWrite}
              localSpeech={localImport}
              file={
                localAudio?.sourceId === source.id ? localAudio.file : undefined
              }
              onRelinked={(file) =>
                setLocalAudio({ sourceId: source.id, file })
              }
              onSourceChange={sourceChanged}
              onLogged={bump}
            />
          )}
          {source &&
            source.kind !== "web_page" &&
            source.kind !== "youtube" && (
              <div className="research-detail">
                <CitationEditor
                  key={source.id}
                  request={request}
                  source={source}
                  canWrite={canWrite}
                  onSourceChange={sourceChanged}
                />
                {canWrite && source.kind === "offline" && (
                  <button
                    type="button"
                    onClick={() => setManualQuote({ sourceId: source.id })}
                  >
                    New quote
                  </button>
                )}
                {source.kind !== "offline" && source.kind !== "audio" && (
                  <p>Open Library to see logged items from this source.</p>
                )}
              </div>
            )}
          {source && manualQuote?.sourceId === source.id && (
            <TypedQuotesWorkspace
              key={manualQuote.quote?.id ?? source.id}
              {...sharedIntake}
              initialOpen
              initialSource={source}
              initialQuote={manualQuote.quote}
              onSaved={(item, continueAdding) => {
                bump();
                if (!continueAdding) {
                  setRecentQuote(item);
                  setManualQuote(undefined);
                }
              }}
              onClose={() => setManualQuote(undefined)}
            />
          )}
        </section>
      )}
    </section>
  );
}

function WebPageIntake({
  request,
  projectId,
  localImport,
  onCancel,
  onCreated,
}: {
  request: ResearchRequest;
  projectId: string;
  localImport: boolean;
  onCancel(): void;
  onCreated(id: string): void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const key = useRef(crypto.randomUUID());
  const write = useResearchMutation();
  useEffect(() => input.current?.focus(), []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (write.current) return;
    const body = ImportWebPageRequestSchema.safeParse({
      mode: "public_url",
      url: url.trim(),
    });
    if (
      !body.success ||
      body.data.mode !== "public_url" ||
      new URL(body.data.url).username ||
      new URL(body.data.url).password
    ) {
      setError(
        "Enter a public HTTP or HTTPS page address without credentials.",
      );
      return;
    }
    const controller = new AbortController();
    write.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const path = projectPath(projectId);
      const source = localImport
        ? await readResearch(
            request,
            `${path}/web-page-sources`,
            LibrarySourceSchema,
            { ...jsonWrite("POST", body.data), signal: controller.signal },
            "local",
          )
        : await readResearch(request, `${path}/sources`, LibrarySourceSchema, {
            ...jsonWrite(
              "POST",
              CreateSourceRequestSchema.parse({
                kind: "web_page",
                idempotencyKey: key.current,
                bibliography: {
                  url: { value: body.data.url, state: "confirmed" },
                },
                details: {
                  submittedUrl: body.data.url,
                  extraction: { status: "failed", reason: "unavailable" },
                },
              }),
            ),
            signal: controller.signal,
          });
      verifySource(source, projectId);
      if (!controller.signal.aborted) onCreated(source.id);
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(researchError(caught, "The page could not be added."));
    } finally {
      write.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <form
      className="research-detail research-intake"
      onSubmit={(event) => void save(event)}
    >
      <label>
        Web page URL{" "}
        <input
          required
          type="url"
          ref={input}
          value={url}
          disabled={busy}
          onChange={(event) => {
            setUrl(event.target.value);
            key.current = crypto.randomUUID();
          }}
        />
      </label>
      {!localImport && (
        <p>
          To include clean text and page pictures, send the page from the Chrome
          extension.
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add web page"}
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
