import {
  createContext,
  useEffect,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  formatLanguageLabel,
  type ProjectSummary,
  type User,
} from "@research-video/contracts";

export type ProjectDestination =
  "videos" | "workbench" | "clips" | "project_settings";

const splitStorageKey = "vera:layout:transcript-width";
const defaultTranscriptWidth = 46;
const minTranscriptWidth = 30;
const maxTranscriptWidth = 70;

const ResearchLayoutContext = createContext<
  | {
      transcriptWidth: number;
      onTranscriptWidthChange(value: number): void;
    }
  | undefined
>(undefined);

function storedNumber(key: string, fallback: number, min: number, max: number) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return fallback;
    const value = Number(stored);
    return Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;
  } catch {
    return fallback;
  }
}

type WorkspaceShellProps = Readonly<{
  setup: ReactNode;
  ingest: ReactNode;
  accountSettings: ReactNode;
  workspace: ReactNode;
  projectContent: ReactNode;
  projects: readonly ProjectSummary[];
  projectId: string;
  destination: ProjectDestination;
  user?: User;
  unreadCount: number;
  navigationTitle?: string;
  navigationHistory: readonly { id: string; label: string }[];
  onProjectChange(projectId: string): void;
  onDestinationChange(destination: ProjectDestination): void;
  onBack(): void;
  onNavigationHistorySelect(id: string): void;
  onSignOut(): void;
}>;

export function WorkspaceShell({
  setup,
  ingest,
  accountSettings,
  workspace,
  projectContent,
  projects,
  projectId,
  destination,
  user,
  unreadCount,
  navigationTitle,
  navigationHistory,
  onProjectChange,
  onDestinationChange,
  onBack,
  onNavigationHistorySelect,
  onSignOut,
}: WorkspaceShellProps) {
  const [transcriptWidth, setTranscriptWidth] = useState(() =>
    storedNumber(
      splitStorageKey,
      defaultTranscriptWidth,
      minTranscriptWidth,
      maxTranscriptWidth,
    ),
  );
  const activeProject = projects.find((project) => project.id === projectId);
  const canManageProject =
    activeProject?.currentUserRole === "owner" ||
    activeProject?.currentUserRole === "administrator";
  const personalProjects = projects.filter(
    (project) => project.kind === "personal",
  );
  const sharedProjects = projects.filter(
    (project) => project.kind === "shared",
  );

  useEffect(() => {
    try {
      localStorage.setItem(splitStorageKey, String(transcriptWidth));
    } catch {
      // Layout persistence is optional private install state.
    }
  }, [transcriptWidth]);

  useEffect(() => {
    if (destination === "project_settings" && !canManageProject)
      onDestinationChange("videos");
  }, [canManageProject, destination, onDestinationChange]);

  const style = {
    "--transcript-column-width": `${transcriptWidth}%`,
  } as CSSProperties;

  return (
    <main
      className={`shell vera-shell destination-${destination}`}
      style={style}
      aria-label="VERA application shell"
    >
      <header className="vera-header">
        <div className="vera-project-control">
          <div className="vera-brand">
            <strong>VERA</strong>
            <span>Video Essay Research and Authoring</span>
          </div>
          <label>
            <span>Active project</span>
            <select
              aria-label="Active project"
              value={projectId}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">Choose a project</option>
              {personalProjects.length ? (
                <optgroup label="Personal projects">
                  {personalProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {sharedProjects.length ? (
                <optgroup label="Shared projects">
                  {sharedProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} · {project.memberCount} member
                      {project.memberCount === 1 ? "" : "s"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
        </div>

        <div className="vera-product-heading">
          <p className="eyebrow">Research Video Clips</p>
          <h1>{destinationLabel(destination)}</h1>
          {activeProject ? (
            <span>
              {activeProject.name} · {roleLabel(activeProject.currentUserRole)}
            </span>
          ) : (
            <span>Choose an authorized project to begin.</span>
          )}
        </div>

        <details className="account-menu">
          <summary>
            <span>{user?.displayName ?? "Account"}</span>
            {unreadCount ? (
              <span
                className="count-badge"
                aria-label={`${unreadCount} unread`}
              >
                {unreadCount}
              </span>
            ) : null}
          </summary>
          <div className="account-menu-panel">
            {user ? (
              <p>
                <strong>{user.displayName}</strong>
                <br />@{user.handle} ·{" "}
                {formatLanguageLabel(user.preferredLanguage)}
              </p>
            ) : (
              <p>Connect or sign in to load account settings.</p>
            )}
            {accountSettings}
            <details className="local-setup-menu">
              <summary>Personal and local setup</summary>
              {setup}
            </details>
            <button type="button" disabled={!user} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </details>
      </header>

      <nav className="vera-destinations" aria-label="Project destinations">
        <button
          type="button"
          aria-current={destination === "videos" ? "page" : undefined}
          onClick={() => onDestinationChange("videos")}
        >
          Add
        </button>
        <button
          type="button"
          aria-current={destination === "workbench" ? "page" : undefined}
          onClick={() => onDestinationChange("workbench")}
        >
          Review
        </button>
        <button
          type="button"
          aria-current={destination === "clips" ? "page" : undefined}
          disabled={!activeProject}
          onClick={() => onDestinationChange("clips")}
        >
          Logged
        </button>
        {canManageProject ? (
          <button
            type="button"
            aria-current={
              destination === "project_settings" ? "page" : undefined
            }
            onClick={() => onDestinationChange("project_settings")}
          >
            Project Settings
          </button>
        ) : null}
        <div
          className="vera-source-navigation"
          aria-label="Source navigation"
          hidden={destination !== "workbench"}
        >
          <button
            type="button"
            disabled={!navigationHistory.length}
            onClick={onBack}
          >
            Back
          </button>
          <span aria-label="Current source">
            {activeProject?.name ?? "No project"} /{" "}
            {navigationTitle ?? "No source"}
          </span>
          <label>
            Recent sources
            <select
              aria-label="Recent sources"
              value=""
              disabled={!navigationHistory.length}
              onChange={(event) => {
                if (event.target.value)
                  onNavigationHistorySelect(event.target.value);
              }}
            >
              <option value="">Choose history</option>
              {navigationHistory.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </nav>

      {destination === "videos" ? (
        <div className="add-layout">
          <div className="workbench-ingest">{ingest}</div>
          <div className="workbench-project-session">{projectContent}</div>
        </div>
      ) : destination === "workbench" ? (
        <div className="workbench-layout review-layout">
          <div className="workbench-project-session">{projectContent}</div>
          <LayoutControls
            transcriptWidth={transcriptWidth}
            onTranscriptWidthChange={setTranscriptWidth}
            onReset={() => {
              setTranscriptWidth(defaultTranscriptWidth);
            }}
          />
          <ResearchLayoutContext.Provider
            value={{
              transcriptWidth,
              onTranscriptWidthChange: setTranscriptWidth,
            }}
          >
            <div className="workbench-research">{workspace}</div>
          </ResearchLayoutContext.Provider>
        </div>
      ) : (
        <section className="project-destination-content">
          {projectContent}
        </section>
      )}
    </main>
  );
}

function LayoutControls({
  transcriptWidth,
  onTranscriptWidthChange,
  onReset,
}: {
  transcriptWidth: number;
  onTranscriptWidthChange(value: number): void;
  onReset(): void;
}) {
  return (
    <details className="layout-controls">
      <summary>Layout</summary>
      <label>
        Transcript width
        <input
          type="range"
          aria-label="Transcript width"
          min={minTranscriptWidth}
          max={maxTranscriptWidth}
          step="2"
          value={transcriptWidth}
          onChange={(event) =>
            onTranscriptWidthChange(Number(event.target.value))
          }
        />
        <output>{transcriptWidth}%</output>
      </label>
      <button type="button" onClick={onReset}>
        Reset layout
      </button>
    </details>
  );
}

function destinationLabel(destination: ProjectDestination) {
  if (destination === "videos") return "Add";
  if (destination === "clips") return "Logged";
  if (destination === "project_settings") return "Project Settings";
  return "Review";
}

function roleLabel(role: ProjectSummary["currentUserRole"]) {
  if (role === "owner") return "Owner";
  if (role === "administrator") return "Administrator";
  if (role === "researcher") return "Researcher";
  if (role === "editor") return "Legacy Editor";
  return "Legacy Viewer";
}

type VideoIngestPanelProps = Readonly<{
  url: string;
  error?: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
  onBulkAdd: () => void;
}>;

export function VideoIngestPanel({
  url,
  error,
  onUrlChange,
  onSubmit,
  onBulkAdd,
}: VideoIngestPanelProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="loader compact-ingest" onSubmit={submit}>
      <label htmlFor="video-url">YouTube URL or video ID</label>
      <div className="loader-row">
        <input
          id="video-url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          aria-invalid={Boolean(error)}
        />
        <button type="submit">Load video</button>
        <button type="button" onClick={onBulkAdd}>
          Bulk add
        </button>
      </div>
      <p className={error ? "form-message error" : "form-message"}>
        {error ??
          "Paste a YouTube URL, search for a source, or add several videos as a batch."}
      </p>
    </form>
  );
}

type AccountLanguagePanelProps = Readonly<{
  preferredLanguage: string;
  disabled: boolean;
  message: string;
  onPreferredLanguageChange: (language: string) => void;
  onSave: () => void;
}>;

export function AccountLanguagePanel({
  preferredLanguage,
  disabled,
  message,
  onPreferredLanguageChange,
  onSave,
}: AccountLanguagePanelProps) {
  let readableLanguage = preferredLanguage;
  try {
    readableLanguage = formatLanguageLabel(preferredLanguage);
  } catch {
    // Keep the draft visible while the user corrects an invalid value.
  }
  return (
    <section className="account-settings" aria-label="Account settings">
      <label htmlFor="preferred-language">Preferred transcript language</label>
      <div className="loader-row">
        <input
          id="preferred-language"
          value={preferredLanguage}
          maxLength={35}
          disabled={disabled}
          onChange={(event) => onPreferredLanguageChange(event.target.value)}
          placeholder="en, fr-CA, zh-Hant…"
        />
        <button
          type="button"
          disabled={disabled || !preferredLanguage.trim()}
          onClick={onSave}
        >
          Save preference
        </button>
      </div>
      <p className="language-preview">{readableLanguage}</p>
      <p className="form-message" role="status">
        {message}
      </p>
    </section>
  );
}

type ResearchWorkspaceLayoutProps = Readonly<{
  transcript: ReactNode;
  player: ReactNode;
}>;

export function ResearchWorkspaceLayout({
  transcript,
  player,
}: ResearchWorkspaceLayoutProps) {
  const layout = useContext(ResearchLayoutContext);
  const workspaceRef = useRef<HTMLElement>(null);

  function resizeAt(clientX: number) {
    if (!layout || !workspaceRef.current) return;
    const bounds = workspaceRef.current.getBoundingClientRect();
    const percentage = ((clientX - bounds.left) / bounds.width) * 100;
    layout.onTranscriptWidthChange(
      Math.min(
        maxTranscriptWidth,
        Math.max(minTranscriptWidth, Math.round(percentage)),
      ),
    );
  }

  return (
    <section
      ref={workspaceRef}
      className="workspace"
      aria-label="Research workspace"
    >
      {transcript}
      {layout ? (
        <div
          className="workspace-resizer"
          role="separator"
          aria-label="Resize transcript panel"
          aria-orientation="vertical"
          aria-valuemin={minTranscriptWidth}
          aria-valuemax={maxTranscriptWidth}
          aria-valuenow={layout.transcriptWidth}
          tabIndex={0}
          onDoubleClick={() =>
            layout.onTranscriptWidthChange(defaultTranscriptWidth)
          }
          onKeyDown={(event) => {
            if (event.key === "Home") {
              event.preventDefault();
              layout.onTranscriptWidthChange(minTranscriptWidth);
            } else if (event.key === "End") {
              event.preventDefault();
              layout.onTranscriptWidthChange(maxTranscriptWidth);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              layout.onTranscriptWidthChange(
                Math.max(minTranscriptWidth, layout.transcriptWidth - 2),
              );
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              layout.onTranscriptWidthChange(
                Math.min(maxTranscriptWidth, layout.transcriptWidth + 2),
              );
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeAt(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              resizeAt(event.clientX);
          }}
          onPointerUp={(event) =>
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        />
      ) : null}
      {player}
    </section>
  );
}
