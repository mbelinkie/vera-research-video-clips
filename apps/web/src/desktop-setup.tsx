import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiErrorSchema,
  ModelDownloadProgressSchema,
  ProjectSchema,
  ProjectSummarySchema,
  ReadinessReportSchema,
  SetupSnapshotSchema,
  type DesktopAuthStatus,
  type ModelDownloadProgress,
  type ProjectSummary,
  type ReadinessOperation,
  type SetupAction,
  type SetupSelectionTarget,
  type SetupSnapshot,
} from "@research-video/contracts";

import { apiFetch, desktopBridge } from "./api-client.ts";

type DesktopSetupProps = {
  authorization: string;
  authStatus?: DesktopAuthStatus;
  projects: readonly ProjectSummary[];
  projectId: string;
  onProjectsChange(projects: ProjectSummary[]): void;
  onProjectChange(projectId: string): void;
  onSignIn(): Promise<void>;
  onSignOut(): Promise<void>;
};

const targetLabels: Record<SetupSelectionTarget, string> = {
  output_root: "Export folder",
  cache_root: "Transcript cache folder",
  ffmpeg: "FFmpeg",
  ffprobe: "FFprobe",
  yt_dlp: "yt-dlp",
  whisper_cli: "whisper-cli",
  whisper_model: "Whisper model",
};

const operationLabels: Record<ReadinessOperation["operation"], string> = {
  project_browsing: "Browse projects",
  verified_cached_review: "Review verified cached transcripts",
  project_logging: "Log research clips",
  transcript_processing: "Process transcripts",
  export_processing: "Render exports",
};

const setupTargets = Object.keys(targetLabels) as SetupSelectionTarget[];

export function DesktopSetup({
  authorization,
  authStatus,
  projects,
  projectId,
  onProjectsChange,
  onProjectChange,
  onSignIn,
  onSignOut,
}: DesktopSetupProps) {
  const bridge = desktopBridge();
  const [snapshot, setSnapshot] = useState<SetupSnapshot>();
  const [readiness, setReadiness] =
    useState<ReturnType<typeof ReadinessReportSchema.parse>>();
  const [download, setDownload] = useState<ModelDownloadProgress>();
  const [message, setMessage] = useState("Checking this workstation’s setup…");
  const [busy, setBusy] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectKind, setNewProjectKind] = useState<"personal" | "shared">(
    "shared",
  );

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const [nextSnapshot, nextReadiness] = await Promise.all([
      bridge.getSetup(),
      bridge.getReadiness(),
    ]);
    setSnapshot(SetupSnapshotSchema.parse(nextSnapshot));
    setReadiness(ReadinessReportSchema.parse(nextReadiness));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void refresh().catch((error: unknown) =>
      setMessage(errorMessage(error, "Setup is temporarily unavailable.")),
    );
    const timer = window.setInterval(() => {
      void bridge
        .getReadiness()
        .then((report) => setReadiness(ReadinessReportSchema.parse(report)))
        .catch(() => undefined);
    }, 5_000);
    const removeProgressListener = bridge.onModelDownloadProgress(
      (progress) => {
        const parsed = ModelDownloadProgressSchema.parse(progress);
        setDownload(parsed);
        if (parsed.state === "completed") {
          setMessage("Pinned model downloaded, verified, and activated.");
          void refresh();
        } else if (parsed.state === "failed") {
          setMessage(
            "The pinned model download failed. The previous model remains active.",
          );
        } else if (parsed.state === "canceled") {
          setMessage(
            "Model download canceled. The previous model remains active.",
          );
        }
      },
    );
    return () => {
      window.clearInterval(timer);
      removeProgressListener();
    };
  }, [bridge, refresh]);

  const activeByTarget = useMemo(
    () =>
      new Map(snapshot?.activeComponents.map((item) => [item.target, item])),
    [snapshot],
  );
  const modelPinMissing = readiness?.components.some(
    (component) =>
      component.component === "whisper_model" &&
      component.reason === "model_pin_required",
  );

  if (!bridge) return null;

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (error) {
      setMessage(errorMessage(error, "Setup change failed."));
    } finally {
      setBusy(false);
    }
  }

  async function updateSetup(action: SetupAction, success: string) {
    await run(async () => {
      setSnapshot(SetupSnapshotSchema.parse(await bridge!.updateSetup(action)));
    }, success);
  }

  async function chooseTarget(target: SetupSelectionTarget) {
    await run(async () => {
      setSnapshot(
        SetupSnapshotSchema.parse(await bridge!.chooseSetupTarget(target)),
      );
    }, `${targetLabels[target]} validated and activated.`);
  }

  async function refreshProjects() {
    if (!authorization) return;
    await run(async () => {
      const response = await apiFetch(
        "cloud",
        "/api/projects",
        {},
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) throw apiError(payload, "Unable to load projects.");
      const loaded = ProjectSummarySchema.array().parse(payload);
      onProjectsChange(loaded);
      if (!loaded.some((project) => project.id === projectId)) {
        onProjectChange("");
      }
    }, "Project access refreshed.");
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!authorization || !name) return;
    await run(async () => {
      const response = await apiFetch(
        "cloud",
        "/api/projects",
        {
          method: "POST",
          body: JSON.stringify({ name, description: "", kind: newProjectKind }),
        },
        authorization,
      );
      const payload = await response.json().catch(() => undefined);
      if (!response.ok) throw apiError(payload, "Unable to create project.");
      const project = ProjectSchema.parse(payload);
      const projectSummary = ProjectSummarySchema.parse({
        ...project,
        currentUserRole: "owner",
        memberCount: 1,
      });
      onProjectsChange([
        ...projects.filter((candidate) => candidate.id !== project.id),
        projectSummary,
      ]);
      onProjectChange(project.id);
      setNewProjectName("");
      setNewProjectKind("shared");
    }, "Project created and selected.");
  }

  const setup = snapshot?.setup;
  const canCancelDownload =
    download &&
    ["preparing", "downloading", "verifying"].includes(download.state);

  return (
    <section className="desktop-setup" aria-labelledby="desktop-setup-title">
      <div className="desktop-setup-heading">
        <div>
          <p className="eyebrow">Desktop first run</p>
          <h2 id="desktop-setup-title">Prepare this workstation</h2>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          Recheck
        </button>
      </div>

      <div className="desktop-setup-grid">
        <fieldset>
          <legend>1. Account and project</legend>
          <p className="muted">
            {authStatus?.state === "signed_in"
              ? "Signed in to your account."
              : "Sign in through the browser to use project-authorized cloud data."}
          </p>
          <div className="setup-actions">
            {authStatus?.state === "signed_in" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSignOut()}
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSignIn()}
              >
                Sign in
              </button>
            )}
            <button
              type="button"
              disabled={busy || !authorization}
              onClick={() => void refreshProjects()}
            >
              Refresh projects
            </button>
          </div>
          <label>
            Active project
            <select
              value={projectId}
              disabled={!projects.length}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">Choose a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <div className="setup-inline-form">
            <select
              aria-label="Desktop new project kind"
              value={newProjectKind}
              onChange={(event) =>
                setNewProjectKind(event.target.value as "personal" | "shared")
              }
            >
              <option value="personal">Personal</option>
              <option value="shared">Shared</option>
            </select>
            <input
              aria-label="New project name"
              value={newProjectName}
              maxLength={160}
              placeholder="New project name"
              onChange={(event) => setNewProjectName(event.target.value)}
            />
            <button
              type="button"
              disabled={busy || !authorization || !newProjectName.trim()}
              onClick={() => void createProject()}
            >
              Create
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>2. Rights and privacy</legend>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={setup?.rightsAcknowledged ?? false}
              disabled={busy}
              onChange={(event) =>
                void updateSetup(
                  {
                    action: "set_rights_acknowledgement",
                    acknowledged: event.target.checked,
                  },
                  "Source-rights acknowledgement updated.",
                )
              }
            />
            I will process only sources I am authorized to use.
          </label>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={setup?.privacyAcknowledged ?? false}
              disabled={busy}
              onChange={(event) =>
                void updateSetup(
                  {
                    action: "set_privacy_acknowledgement",
                    acknowledged: event.target.checked,
                  },
                  "Private-media handling acknowledgement updated.",
                )
              }
            />
            Full source media is private job scratch and must be deleted after
            terminal cleanup.
          </label>
          <label className="setup-check">
            <input
              type="checkbox"
              checked={setup?.translationConsent ?? false}
              disabled={busy}
              onChange={(event) =>
                void updateSetup(
                  {
                    action: "set_translation_consent",
                    consented: event.target.checked,
                  },
                  "Cloud-translation consent updated.",
                )
              }
            />
            Allow authorized transcript text to be sent to Amazon Translate.
          </label>
        </fieldset>

        <fieldset>
          <legend>3. Providers and worker</legend>
          <ProviderSelect
            label="Captions"
            value={setup?.captionProvider ?? "disabled"}
            disabled={busy}
            options={[
              ["disabled", "Disabled"],
              ["yt_dlp", "yt-dlp caption discovery"],
            ]}
            onChange={(provider) =>
              void updateSetup(
                {
                  action: "set_caption_provider",
                  provider: provider as "disabled" | "yt_dlp",
                },
                "Caption provider updated.",
              )
            }
          />
          <ProviderSelect
            label="Audio acquisition"
            value={setup?.mediaProvider ?? "disabled"}
            disabled={busy}
            options={[
              ["disabled", "Disabled"],
              ["yt_dlp_audio", "yt-dlp authorized audio"],
            ]}
            onChange={(provider) =>
              void updateSetup(
                {
                  action: "set_media_provider",
                  provider: provider as "disabled" | "yt_dlp_audio",
                },
                "Media provider updated.",
              )
            }
          />
          <ProviderSelect
            label="Export source"
            value={setup?.exportSourceProvider ?? "disabled"}
            disabled={busy}
            options={[
              ["disabled", "Disabled"],
              ["yt_dlp", "yt-dlp authorized source"],
            ]}
            onChange={(provider) =>
              void updateSetup(
                {
                  action: "set_export_source_provider",
                  provider: provider as "disabled" | "yt_dlp",
                },
                "Export source provider updated.",
              )
            }
          />
          <ProviderSelect
            label="Speech to text"
            value={setup?.speechToTextProvider ?? "disabled"}
            disabled={busy}
            options={[
              ["disabled", "Disabled"],
              ["whisper_cpp", "whisper.cpp"],
            ]}
            onChange={(provider) =>
              void updateSetup(
                {
                  action: "set_speech_to_text_provider",
                  provider: provider as "disabled" | "whisper_cpp",
                },
                "Speech-to-text provider updated.",
              )
            }
          />
          <ProviderSelect
            label="Translation"
            value={setup?.translationProvider ?? "disabled"}
            disabled={busy}
            options={[
              ["disabled", "Disabled"],
              ["aws_translate", "Amazon Translate"],
            ]}
            onChange={(provider) =>
              void updateSetup(
                {
                  action: "set_translation_provider",
                  provider: provider as "disabled" | "aws_translate",
                },
                "Translation provider updated.",
              )
            }
          />
          <label className="setup-check">
            <input
              type="checkbox"
              checked={setup?.workerEnabled ?? false}
              disabled={busy}
              onChange={(event) =>
                void updateSetup(
                  {
                    action: "set_worker_enabled",
                    enabled: event.target.checked,
                  },
                  "Local worker preference updated.",
                )
              }
            />
            Start the supervised local transcription worker when ready.
          </label>
        </fieldset>

        <fieldset>
          <legend>4. Folders, tools, and model</legend>
          <div className="setup-target-list">
            {setupTargets.map((target) => {
              const active = activeByTarget.get(target);
              return (
                <div className="setup-target" key={target}>
                  <div>
                    <strong>{targetLabels[target]}</strong>
                    <span>{active ? active.displayName : "Not selected"}</span>
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy || (target === "whisper_model" && modelPinMissing)
                    }
                    onClick={() => void chooseTarget(target)}
                  >
                    {active ? "Replace" : "Choose"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="setup-actions">
            <button
              type="button"
              disabled={
                busy || Boolean(canCancelDownload) || Boolean(modelPinMissing)
              }
              onClick={() => {
                setBusy(true);
                setMessage("");
                void bridge
                  .startModelDownload()
                  .then((progress) => {
                    setDownload(ModelDownloadProgressSchema.parse(progress));
                    setMessage("Pinned model download started.");
                  })
                  .catch((error: unknown) =>
                    setMessage(
                      errorMessage(
                        error,
                        "Pinned model download is not configured.",
                      ),
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {modelPinMissing
                ? "Pinned model not configured"
                : "Download pinned model"}
            </button>
            <button
              type="button"
              disabled={busy || !canCancelDownload}
              onClick={() =>
                void bridge
                  .cancelModelDownload()
                  .then((progress) =>
                    setDownload(ModelDownloadProgressSchema.parse(progress)),
                  )
              }
            >
              Cancel download
            </button>
          </div>
          {download ? (
            <progress
              aria-label="Whisper model download"
              value={download.bytesDownloaded}
              max={download.expectedBytes}
            />
          ) : null}
          {download ? (
            <p className="muted">
              Model {download.state}:{" "}
              {download.bytesDownloaded.toLocaleString()} of{" "}
              {download.expectedBytes.toLocaleString()} bytes.
            </p>
          ) : null}
        </fieldset>
      </div>

      <section className="readiness-summary" aria-label="Operation readiness">
        <h3>What can I do now?</h3>
        <div className="readiness-list">
          {readiness?.operations.map((operation) => (
            <div
              className={`readiness-item ${operation.state}`}
              key={operation.operation}
            >
              <strong>{operationLabels[operation.operation]}</strong>
              <span>{operation.state.replace("_", " ")}</span>
              {operation.blockingComponents.length ? (
                <small>
                  Needs: {operation.blockingComponents.map(humanize).join(", ")}
                </small>
              ) : null}
            </div>
          )) ?? <p className="muted">Readiness has not loaded yet.</p>}
        </div>
      </section>
      <p
        className={
          /failed|unable|unavailable/i.test(message)
            ? "form-message error"
            : "form-message"
        }
        role="status"
      >
        {message}
      </p>
    </section>
  );
}

function ProviderSelect({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  options: ReadonlyArray<readonly [string, string]>;
  onChange(value: string): void;
}) {
  return (
    <label>
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}

function apiError(payload: unknown, fallback: string) {
  const parsed = ApiErrorSchema.safeParse(payload);
  return new Error(parsed.success ? parsed.data.error.message : fallback);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
