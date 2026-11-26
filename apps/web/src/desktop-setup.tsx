import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ApiErrorSchema,
  ModelDownloadProgressSchema,
  ProjectSchema,
  ProjectSummarySchema,
  RecommendedSetupPlanSchema,
  ReadinessReportSchema,
  SetupSnapshotSchema,
  type DesktopAuthStatus,
  type ModelDownloadProgress,
  type ProjectSummary,
  type RecommendedSetupPlan,
  type ReadinessOperation,
  type SetupAction,
  type SetupSelectionTarget,
  type SetupSnapshot,
} from "@research-video/contracts";

import { apiFetch, desktopBridge } from "./api-client.ts";
import {
  desktopAuthenticationIssue,
  desktopAuthenticationSummary,
  desktopSignInUnavailable,
} from "./desktop-auth-status.ts";

type DesktopSetupProps = {
  authorization: string;
  authStatus?: DesktopAuthStatus;
  profileState: DesktopProfileState;
  projects: readonly ProjectSummary[];
  projectId: string;
  onProjectsChange(projects: ProjectSummary[]): void;
  onProjectChange(projectId: string): void;
  onRegisterProfile(displayName: string): Promise<void>;
  onSignIn(): Promise<void>;
  onSignOut(): Promise<void>;
};

export type DesktopProfileState =
  "idle" | "loading" | "registration_required" | "ready" | "error";

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
  project_browsing: "Browse and log research",
  verified_cached_review: "Review transcripts",
  project_logging: "Browse and log research",
  transcript_processing: "Create transcripts",
  export_processing: "Export clips",
};

const setupTargets = Object.keys(targetLabels) as SetupSelectionTarget[];
const recommendedLocalTargets: readonly SetupSelectionTarget[] = [
  "output_root",
  "cache_root",
  "ffmpeg",
  "ffprobe",
  "yt_dlp",
  "whisper_cli",
];

export function DesktopSetup({
  authorization,
  authStatus,
  profileState,
  projects,
  projectId,
  onProjectsChange,
  onProjectChange,
  onRegisterProfile,
  onSignIn,
  onSignOut,
}: DesktopSetupProps) {
  const bridge = desktopBridge();
  const [snapshot, setSnapshot] = useState<SetupSnapshot>();
  const [readiness, setReadiness] =
    useState<ReturnType<typeof ReadinessReportSchema.parse>>();
  const [download, setDownload] = useState<ModelDownloadProgress>();
  const [recommendedPlan, setRecommendedPlan] =
    useState<RecommendedSetupPlan>();
  const [message, setMessage] = useState("Checking this workstation’s setup…");
  const [busy, setBusy] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectKind, setNewProjectKind] = useState<"personal" | "shared">(
    "shared",
  );
  const [displayName, setDisplayName] = useState("");

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
  const localSetupConfigured = recommendedLocalTargets.every((target) =>
    activeByTarget.has(target),
  );
  const modelActive =
    activeByTarget.has("whisper_model") ||
    recommendedPlan?.model.state === "active";

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
    setBusy(true);
    setMessage("");
    try {
      const previous = activeByTarget.get(target)?.id;
      const next = SetupSnapshotSchema.parse(
        await bridge!.chooseSetupTarget(target),
      );
      setSnapshot(next);
      await refresh();
      const selected = next.activeComponents.find(
        (component) => component.target === target,
      );
      setMessage(
        selected?.id && selected.id !== previous
          ? `${targetLabels[target]} validated and activated.`
          : "No setup change was made.",
      );
    } catch (error) {
      setMessage(errorMessage(error, "Setup change failed."));
    } finally {
      setBusy(false);
    }
  }

  async function checkRecommendedSetup() {
    setBusy(true);
    setMessage("Checking this Mac…");
    try {
      const plan = RecommendedSetupPlanSchema.parse(
        await bridge!.checkRecommendedSetup(),
      );
      setRecommendedPlan(plan);
      setMessage(
        plan.state === "needs_action"
          ? "Some local tools need attention. See the detected setup below."
          : plan.state === "completed"
            ? "This Mac’s local tools and folders are set up."
            : "Ready to set up. Review the changes, then confirm.",
      );
    } catch (error) {
      setMessage(errorMessage(error, "Unable to check this Mac."));
    } finally {
      setBusy(false);
    }
  }

  async function applyRecommendedSetup() {
    setBusy(true);
    setMessage("Creating folders and validating local tools…");
    try {
      const plan = RecommendedSetupPlanSchema.parse(
        await bridge!.applyRecommendedSetup(),
      );
      setRecommendedPlan(plan);
      await refresh();
      setMessage(
        "Local folders and tools are active. Download the approved speech model to finish transcript setup.",
      );
    } catch (error) {
      setMessage(
        errorMessage(
          error,
          "Local setup needs action. No prior valid tool or model was replaced.",
        ),
      );
    } finally {
      setBusy(false);
    }
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

  async function registerProfile() {
    const name = displayName.trim();
    if (!authorization || !name) return;
    setBusy(true);
    setMessage("");
    try {
      await onRegisterProfile(name);
      setDisplayName("");
      setMessage("Account profile created. You can now create a project.");
    } catch (error) {
      setMessage(errorMessage(error, "Unable to create the account profile."));
    } finally {
      setBusy(false);
    }
  }

  const setup = snapshot?.setup;
  const canCancelDownload =
    download &&
    ["preparing", "downloading", "verifying"].includes(download.state);
  const capabilityReadiness = readiness
    ? summarizeCapabilities(readiness.operations)
    : [];

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
          <p
            className="muted"
            role={desktopAuthenticationIssue(authStatus) ? "status" : undefined}
          >
            {desktopAuthenticationSummary(authStatus)}
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
                disabled={busy || desktopSignInUnavailable(authStatus)}
                onClick={() => void onSignIn()}
              >
                {authStatus?.state === "signing_in"
                  ? "Waiting for browser…"
                  : authStatus?.state === "refreshing"
                    ? "Refreshing…"
                    : "Sign in"}
              </button>
            )}
            <button
              type="button"
              disabled={busy || !authorization || profileState !== "ready"}
              onClick={() => void refreshProjects()}
            >
              Refresh projects
            </button>
          </div>
          {authorization && profileState === "registration_required" ? (
            <div className="setup-inline-form">
              <input
                aria-label="Account display name"
                value={displayName}
                maxLength={160}
                placeholder="Your display name"
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || !displayName.trim()}
                onClick={() => void registerProfile()}
              >
                Create account profile
              </button>
            </div>
          ) : null}
          {authorization && profileState === "loading" ? (
            <p className="muted" role="status">
              Loading your account profile…
            </p>
          ) : null}
          {authorization && profileState === "error" ? (
            <p className="muted" role="status">
              Account setup could not be loaded. Recheck or sign in again.
            </p>
          ) : null}
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
              disabled={
                busy ||
                !authorization ||
                profileState !== "ready" ||
                !newProjectName.trim()
              }
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
          <legend>3. Processing preferences</legend>
          <p className="muted">
            Recommended setup enables local transcript creation and clip export.
            Translation remains off unless you explicitly enable and consent to
            it.
          </p>
          <details className="advanced-setup">
            <summary>Advanced provider choices</summary>
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
              Start the supervised local processing worker when ready.
            </label>
          </details>
        </fieldset>

        <fieldset className="recommended-setup">
          <legend>4. Local transcript and export setup</legend>
          <p className="muted">
            Research Video Clips can create private working folders and safely
            detect compatible tools already installed on this Mac.
          </p>
          {!recommendedPlan ? (
            <button
              className="primary-setup-action"
              type="button"
              disabled={busy || modelPinMissing}
              onClick={() => void checkRecommendedSetup()}
            >
              {localSetupConfigured
                ? "Re-detect local setup"
                : "Set up this Mac"}
            </button>
          ) : (
            <div
              className="recommended-setup-plan"
              aria-label="Recommended setup plan"
            >
              <h3>
                {recommendedPlan.state === "completed"
                  ? "Local setup active"
                  : recommendedPlan.state === "needs_action"
                    ? "Setup needs attention"
                    : "Ready to set up"}
              </h3>
              <p className="muted">Folders</p>
              <ul>
                {recommendedPlan.roots.map((root) => (
                  <li key={root.target}>
                    <strong>{root.displayName}</strong> —{" "}
                    {setupStateLabel(root.state)}
                  </li>
                ))}
              </ul>
              <p className="muted">Compatible tools found</p>
              <ul>
                {recommendedPlan.tools.map((tool) => (
                  <li key={tool.target}>
                    <strong>{tool.displayName}</strong> —{" "}
                    {setupStateLabel(tool.state)}
                    {tool.version ? ` (${tool.version})` : ""}
                  </li>
                ))}
              </ul>
              <p>
                <strong>{recommendedPlan.model.displayName}</strong> is the
                approved speech model (
                {formatBytes(recommendedPlan.model.byteSize)}).{" "}
                {modelActive
                  ? "It is downloaded, verified, and active."
                  : "Its download is a separate, explicit step."}
              </p>
              <p className="muted">
                This prepares Create transcripts and Export clips. Source-rights
                and privacy confirmations are still required before acquisition.
              </p>
              <div className="setup-actions">
                {recommendedPlan.state !== "completed" ? (
                  <button
                    className="primary-setup-action"
                    type="button"
                    disabled={busy || recommendedPlan.state === "needs_action"}
                    onClick={() => void applyRecommendedSetup()}
                  >
                    Confirm local setup
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void checkRecommendedSetup()}
                >
                  Re-detect
                </button>
              </div>
            </div>
          )}
          <div className="setup-actions">
            <button
              type="button"
              disabled={
                busy ||
                modelActive ||
                Boolean(canCancelDownload) ||
                Boolean(modelPinMissing)
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
              {modelActive
                ? "Approved model active"
                : modelPinMissing
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
          <details className="advanced-setup">
            <summary>Advanced setup</summary>
            <p className="muted">
              Choose a different folder, tool, or approved model file for
              recovery. Each replacement is validated before it becomes active.
            </p>
            <div className="setup-target-list">
              {setupTargets.map((target) => {
                const active = activeByTarget.get(target);
                return (
                  <div className="setup-target" key={target}>
                    <div>
                      <strong>{targetLabels[target]}</strong>
                      <span>
                        {active ? active.displayName : "Not selected"}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={
                        busy || (target === "whisper_model" && modelPinMissing)
                      }
                      onClick={() => void chooseTarget(target)}
                    >
                      {active ? "Choose a different file" : "Choose"}
                    </button>
                  </div>
                );
              })}
            </div>
          </details>
        </fieldset>
      </div>

      <section className="readiness-summary" aria-label="Operation readiness">
        <h3>What can I do now?</h3>
        <div className="readiness-list">
          {capabilityReadiness.map((operation) => (
            <div
              className={`readiness-item ${operation.state}`}
              key={operation.label}
            >
              <strong>{operation.label}</strong>
              <span>{operation.state.replace("_", " ")}</span>
              {operation.blockingComponents.length ? (
                <small>
                  Needs: {operation.blockingComponents.map(humanize).join(", ")}
                </small>
              ) : null}
            </div>
          ))}
          {!capabilityReadiness.length ? (
            <p className="muted">Readiness has not loaded yet.</p>
          ) : null}
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

function summarizeCapabilities(
  operations: readonly ReadinessOperation[],
): Array<{
  label: string;
  state: ReadinessOperation["state"];
  blockingComponents: ReadinessOperation["blockingComponents"];
}> {
  const byOperation = new Map(
    operations.map((operation) => [operation.operation, operation]),
  );
  const combine = (
    label: string,
    kinds: readonly ReadinessOperation["operation"][],
  ) => {
    const selected = kinds
      .map((kind) => byOperation.get(kind))
      .filter((operation): operation is ReadinessOperation =>
        Boolean(operation),
      );
    const state = selected.some((operation) => operation.state === "blocked")
      ? ("blocked" as const)
      : selected.some((operation) => operation.state === "degraded")
        ? ("degraded" as const)
        : ("ready" as const);
    return {
      label,
      state,
      blockingComponents: [
        ...new Set(
          selected.flatMap((operation) => operation.blockingComponents),
        ),
      ],
    };
  };
  return [
    combine(operationLabels.project_browsing, [
      "project_browsing",
      "project_logging",
    ]),
    combine(operationLabels.verified_cached_review, ["verified_cached_review"]),
    combine(operationLabels.transcript_processing, ["transcript_processing"]),
    combine(operationLabels.export_processing, ["export_processing"]),
  ];
}

function setupStateLabel(state: string): string {
  const labels: Record<string, string> = {
    active: "active",
    will_create: "will be created",
    will_use_existing: "existing folder will be preserved",
    unavailable: "needs a different location",
    detected: "detected and ready to validate",
    missing: "not found",
    download_required: "download required",
  };
  return labels[state] ?? humanize(state);
}

function formatBytes(bytes: number): string {
  const gibibytes = bytes / (1024 * 1024 * 1024);
  return `${gibibytes.toFixed(1)} GiB`;
}

function apiError(payload: unknown, fallback: string) {
  const parsed = ApiErrorSchema.safeParse(payload);
  return new Error(parsed.success ? parsed.data.error.message : fallback);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
