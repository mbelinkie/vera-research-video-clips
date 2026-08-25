import { createHash } from "node:crypto";

import { expect, test, type Dialog, type Page } from "@playwright/test";
import {
  CURRENT_EXPORT_WORKER_CAPABILITY,
  sha256Fingerprint,
} from "@research-video/export-settings";
import englishWordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };
import multilingualFixture from "../fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

const directVideo = {
  id: "019fbb95-cd76-7920-93fa-e23ba755ee33",
  youtubeVideoId: "M7lc1UVf-VE",
  canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
  title: "Fixture review video",
  channel: "Fixture channel",
};

const romanianVideo = {
  id: "019fbb95-cd76-7920-93fa-e23ba755ee53",
  youtubeVideoId: "Romanian001",
  canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
  title: "Romanian review video",
  channel: "Fixture channel",
};

const immediateVideo = {
  id: "019fbb95-cd76-7920-93fa-e23ba755ee93",
  youtubeVideoId: "48CKtpjFvjs",
  canonicalUrl: "https://www.youtube.com/watch?v=48CKtpjFvjs",
  title: "New immediate-review video",
  channel: "Fixture channel",
};

function projectVideoFixture(
  video: typeof directVideo | typeof romanianVideo,
  now: string,
) {
  return { ...video, version: 1, createdAt: now, updatedAt: now };
}

function defaultLocalProcessingStatus(path: string) {
  const projectId = path.match(
    /(?:\/cloud-api)?\/api\/projects\/([^/]+)\/local-processing$/,
  )?.[1];
  if (!projectId) return undefined;
  return {
    projectId,
    policy: { state: "automatic", version: 1 },
    workload: {
      queuedJobs: 0,
      activeJobs: 0,
      queuedKnownDurationMs: 0,
      activeKnownDurationMs: 0,
      queuedUnknownDurationCount: 0,
      activeUnknownDurationCount: 0,
      unprocessedActiveVideoCount: 0,
    },
  };
}

function defaultProjectKeywordCatalog(path: string) {
  const projectId = path.match(
    /(?:\/cloud-api)?\/api\/projects\/([^/]+)\/keywords$/,
  )?.[1];
  if (!projectId) return undefined;
  return {
    projectId,
    keywordSetVersion: 1,
    keywords: [],
    suggestions: [],
  };
}

function transcriptWithSegmentTrackIds(transcript: {
  track: { id: string };
  segments: readonly Record<string, unknown>[];
  tokens: readonly Record<string, unknown>[];
}) {
  return {
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      trackId: transcript.track.id,
    })),
  };
}

function workspaceFixture(input: {
  projectId: string;
  video: typeof directVideo | typeof romanianVideo;
  preferredLanguage: string;
}) {
  if (input.video.youtubeVideoId === directVideo.youtubeVideoId) {
    const english = transcriptWithSegmentTrackIds(englishWordFixture);
    return {
      schemaVersion: 1,
      projectId: input.projectId,
      catalogVideoId: input.video.id,
      youtubeVideoId: input.video.youtubeVideoId,
      transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee34",
      source: "shared-store",
      catalogState: "active_verified",
      original: english,
      english,
      preferred: {
        state: "ready",
        source: "english",
        transcript: english,
      },
    };
  }
  const original = transcriptWithSegmentTrackIds(multilingualFixture.original);
  const english = transcriptWithSegmentTrackIds(multilingualFixture.english);
  const spanish = transcriptWithSegmentTrackIds(multilingualFixture.spanish);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    catalogVideoId: input.video.id,
    youtubeVideoId: input.video.youtubeVideoId,
    transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
    source: "verified-local-cache",
    catalogState: "active_verified",
    original,
    english,
    preferred: input.preferredLanguage.toLowerCase().startsWith("es")
      ? {
          state: "ready",
          source: "shared",
          transcript: spanish,
        }
      : {
          state: "ready",
          source: "english",
          transcript: english,
        },
  };
}

async function selectDirectFixturePassage(page: Page) {
  await page.evaluate(() => {
    const anchor = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    ).find((token) => token.textContent === "fixture");
    const focus = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    ).find((token) => token.textContent === "any word");
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent) {
      throw new Error("Expected typed direct-English workspace tokens.");
    }
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

async function selectFirstTwoTranscriptRows(page: Page) {
  await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-testid=transcript-window-row]",
      ),
    );
    const anchor = rows[0]?.querySelector<HTMLElement>(".transcript-text span");
    const focus = rows[1]?.querySelector<HTMLElement>(".transcript-text span");
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent) {
      throw new Error("Expected two typed transcript cue rows.");
    }
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

async function openMoreClipActions(page: Page) {
  const menu = page.locator("details.split-action-menu");
  await menu.evaluate((element: HTMLDetailsElement) => {
    element.open = true;
  });
  await expect(menu.getByRole("menu")).toBeVisible();
}

async function closeMoreClipActions(page: Page) {
  await page
    .locator("details.split-action-menu")
    .evaluate((element: HTMLDetailsElement) => {
      element.open = false;
    });
}

async function postFixturePlayerInfo(
  page: Page,
  info: { currentTime?: number; duration?: number },
) {
  await expect
    .poll(() =>
      page
        .frames()
        .some((frame) =>
          frame.url().startsWith("https://www.youtube-nocookie.com/embed/"),
        ),
    )
    .toBe(true);
  const playerFrame = page
    .frames()
    .find((frame) =>
      frame.url().startsWith("https://www.youtube-nocookie.com/embed/"),
    );
  if (!playerFrame) throw new Error("Expected the isolated YouTube player.");
  await playerFrame.evaluate((message) => {
    parent.postMessage(JSON.stringify({ info: message }), "*");
  }, info);
}

test.beforeEach(async ({ page }) => {
  await page.route(
    "**/local-agent/api/projects/*/bookmark-outbox/replay",
    async (route) =>
      route.fulfill({ json: { applied: 0, queued: 0, conflicts: 0 } }),
  );
  await page.route(
    "**/local-agent/api/projects/*/bookmarks?*",
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const projectId = path.split("/")[4]!;
      await route.fulfill({
        json: {
          projectId,
          items: [],
          freshness: "fresh",
          cachedAt: "2026-08-24T12:00:00.000Z",
          outbox: [],
        },
      });
    },
  );
  await page.route("**/cloud-api/api/projects/*/worklist?*", async (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route(
    "**/cloud-api/api/projects/*/local-processing",
    async (route) => {
      const status = defaultLocalProcessingStatus(
        new URL(route.request().url()).pathname,
      );
      await route.fulfill({ json: status });
    },
  );
  await page.route("**/cloud-api/api/projects/*/keywords", async (route) => {
    const catalog = defaultProjectKeywordCatalog(
      new URL(route.request().url()).pathname,
    );
    await route.fulfill({ json: catalog });
  });
  await page.route(
    "https://www.youtube-nocookie.com/embed/**",
    async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>
          window.__receivedPlayerCommands = [];
          window.__fixtureCurrentTime = 0;
          window.__fixtureDuration = 120;
          window.addEventListener("message", (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            window.__receivedPlayerCommands.push(message);
            if (message.event !== "command") return;
            if (message.func === "seekTo") {
              window.__fixtureCurrentTime = Number(message.args?.[0] ?? 0);
              event.source.postMessage(JSON.stringify({ info: { currentTime: window.__fixtureCurrentTime } }), event.origin);
            }
            if (message.func === "getCurrentTime") {
              event.source.postMessage(JSON.stringify({ info: { currentTime: window.__fixtureCurrentTime } }), event.origin);
            }
            if (message.func === "getDuration") {
              event.source.postMessage(JSON.stringify({ info: { duration: window.__fixtureDuration } }), event.origin);
            }
            const state = message.func === "playVideo" ? 1 : message.func === "pauseVideo" ? 2 : undefined;
            if (state !== undefined) {
              event.source.postMessage(JSON.stringify({ info: { playerState: state } }), event.origin);
            }
          });
        </script>`,
      });
    },
  );
});

test("does not hydrate fixture text for an arbitrary projectless URL", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Add" })).toBeVisible();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(
    page.getByText(
      "Choose a project before loading a project-authorized video.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(0);
});

test("rejects a non-YouTube URL without replacing the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("YouTube URL or video ID")
    .fill("https://example.com/video");
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(page.getByText(/Enter a YouTube watch/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add" })).toBeVisible();
});

async function mockAuthenticatedWorkspace(
  page: Page,
  input: {
    projectId: string;
    preferredLanguage: string;
    workspace: Record<string, unknown>;
  },
) {
  const now = "2026-08-01T12:00:00.000Z";
  const workspaceVideo =
    input.workspace.youtubeVideoId === directVideo.youtubeVideoId
      ? directVideo
      : romanianVideo;
  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/session/profile") {
      return route.fulfill({
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          externalSubject: "fixture:e2e-user",
          handle: "e2e_user",
          displayName: "E2E User",
          preferredLanguage: input.preferredLanguage,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: input.projectId,
            name: "Workspace fixture project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${input.projectId}/videos`) {
      return route.fulfill({
        json: [projectVideoFixture(workspaceVideo, now)],
      });
    }
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => route.fulfill({ json: input.workspace }),
  );
}

const shellUserId = "019fbb95-cd76-7920-93fa-e23ba755ee70";
const shellPersonalProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee71";
const shellAdminProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee72";
const shellResearcherProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
const removedShellProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee74";

function shellProject(
  id: string,
  name: string,
  kind: "personal" | "shared",
  currentUserRole: "owner" | "administrator" | "researcher",
  memberCount: number,
) {
  const now = "2026-08-01T12:00:00.000Z";
  return {
    id,
    name,
    description: "",
    kind,
    visibility: kind === "personal" ? "private" : "invitation_only",
    currentUserRole,
    memberCount,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function mockShellWorkspace(page: Page, unreadCount = 3) {
  const now = "2026-08-01T12:00:00.000Z";
  const projects = [
    shellProject(
      shellPersonalProjectId,
      "Personal notebook",
      "personal",
      "owner",
      1,
    ),
    shellProject(
      shellAdminProjectId,
      "Shared administration",
      "shared",
      "administrator",
      4,
    ),
    shellProject(
      shellResearcherProjectId,
      "Shared research",
      "shared",
      "researcher",
      7,
    ),
  ];
  const requestedProjectIds: string[] = [];
  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/session/profile") {
      return route.fulfill({
        json: {
          id: shellUserId,
          externalSubject: "fixture:shell-user",
          handle: "shell_user",
          displayName: "Shell User",
          preferredLanguage: "zh-Hant-TW",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (path === "/api/projects") return route.fulfill({ json: projects });
    const projectMatch = path.match(/^\/api\/projects\/([^/]+)/u);
    if (projectMatch?.[1]) requestedProjectIds.push(projectMatch[1]);
    if (path.endsWith("/videos"))
      return route.fulfill({ json: [projectVideoFixture(directVideo, now)] });
    if (path.endsWith("/transcription-batches"))
      return route.fulfill({ json: { batches: [] } });
    if (path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (path.includes("/worklist"))
      return route.fulfill({ json: { items: [], total: 0 } });
    if (path.endsWith("/local-processing"))
      return route.fulfill({ json: defaultLocalProcessingStatus(path) });
    if (path.endsWith("/keywords"))
      return route.fulfill({ json: defaultProjectKeywordCatalog(path) });
    if (path.endsWith("/activity"))
      return route.fulfill({ json: { items: [], unreadCount } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => {
      const projectId = new URL(route.request().url()).pathname.split("/")[4]!;
      return route.fulfill({
        json: workspaceFixture({
          projectId,
          video: directVideo,
          preferredLanguage: "zh-Hant-TW",
        }),
      });
    },
  );
  return { requestedProjectIds };
}

async function connectShellWorkspace(page: Page) {
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${shellUserId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
}

test("onboards a first Cognito desktop user, creates a project, and persists setup", async ({
  page,
}) => {
  const now = "2026-08-24T23:10:00.000Z";
  const userId = "019fbb95-cd76-7920-93fa-e23ba755ee90";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee91";
  await page.addInitScript(
    ({ now, userId, projectId }) => {
      const profile = {
        id: userId,
        externalSubject: "cognito:fixture:first-user",
        handle: "first_researcher",
        displayName: "First Researcher",
        preferredLanguage: "en",
        createdAt: now,
        updatedAt: now,
      };
      const readProjects = () =>
        JSON.parse(localStorage.getItem("desktop-first-run-projects") ?? "[]");
      const response = (status: number, value: unknown) => ({
        status,
        body: JSON.stringify(value),
        contentType: "application/json",
      });
      const readSetup = () => ({
        setup: {
          schemaVersion: 1,
          rightsAcknowledged:
            localStorage.getItem("desktop-first-run-rights") === "true",
          privacyAcknowledged: false,
          workerEnabled: false,
          translationConsent: false,
          captionProvider: "disabled",
          mediaProvider: "disabled",
          exportSourceProvider: "disabled",
          speechToTextProvider: "disabled",
          translationProvider: "disabled",
          updatedAt: now,
        },
        activeComponents: [],
      });
      Object.defineProperty(window, "researchVideoDesktop", {
        configurable: true,
        value: {
          async getStatus() {
            return {
              auth: { state: "signed_in", expiresAt: now },
              services: [
                { service: "local_agent", state: "healthy", restartCount: 0 },
                {
                  service: "transcription_worker",
                  state: "stopped",
                  restartCount: 0,
                },
              ],
            };
          },
          async signIn() {
            return { state: "signed_in", expiresAt: now };
          },
          async signOut() {
            return { state: "signed_out" };
          },
          async getSetup() {
            return readSetup();
          },
          async getReadiness() {
            return {
              schemaVersion: 1,
              generatedAt: now,
              components: [
                {
                  component: "cloud_api",
                  state: "ready",
                  reason: "ready",
                  remediation: "none",
                  checkedAt: now,
                },
              ],
              operations: [
                "project_browsing",
                "verified_cached_review",
                "project_logging",
                "transcript_processing",
                "export_processing",
              ].map((operation) => ({
                operation,
                state: "ready",
                blockingComponents: [],
              })),
            };
          },
          async updateSetup(action: {
            action: string;
            acknowledged?: boolean;
          }) {
            if (action.action === "set_rights_acknowledgement") {
              localStorage.setItem(
                "desktop-first-run-rights",
                String(action.acknowledged === true),
              );
            }
            return readSetup();
          },
          async checkRecommendedSetup() {
            return {
              state: "ready_to_setup",
              roots: [
                {
                  target: "output_root",
                  displayName: "Movies exports folder",
                  state: "will_create",
                },
                {
                  target: "cache_root",
                  displayName: "Private transcript cache",
                  state: "will_create",
                },
              ],
              tools: [
                {
                  target: "ffmpeg",
                  displayName: "FFmpeg",
                  state: "detected",
                  version: "8.1.2",
                },
                {
                  target: "ffprobe",
                  displayName: "FFprobe media inspector",
                  state: "detected",
                  version: "8.1.2",
                },
                {
                  target: "yt_dlp",
                  displayName: "Authorized source helper",
                  state: "detected",
                  version: "2026.08.19",
                },
                {
                  target: "whisper_cli",
                  displayName: "whisper.cpp speech engine",
                  state: "detected",
                },
              ],
              model: {
                displayName: "Whisper large-v3-turbo",
                byteSize: 1624555275,
                state: "download_required",
              },
              enables: ["create_transcripts", "export_clips"],
            };
          },
          async applyRecommendedSetup() {
            const plan = await this.checkRecommendedSetup();
            localStorage.setItem("desktop-first-run-local-setup", "true");
            return {
              ...plan,
              state: "completed",
              roots: plan.roots.map(
                (root: {
                  target: string;
                  displayName: string;
                  state: string;
                }) => ({
                  ...root,
                  state: "active",
                }),
              ),
              tools: plan.tools.map(
                (tool: {
                  target: string;
                  displayName: string;
                  state: string;
                  version?: string;
                }) => ({ ...tool, state: "active" }),
              ),
            };
          },
          async chooseSetupTarget() {
            return readSetup();
          },
          async startModelDownload() {
            throw new Error("not configured");
          },
          async cancelModelDownload() {
            throw new Error("not active");
          },
          onModelDownloadProgress() {
            return () => undefined;
          },
          async request(request: {
            method: string;
            path: string;
            body?: string;
          }) {
            if (request.path === "/api/session/profile") {
              return localStorage.getItem("desktop-first-run-registered")
                ? response(200, profile)
                : response(404, {
                    error: {
                      code: "not_found",
                      message: "User is not registered.",
                      retryable: false,
                    },
                  });
            }
            if (
              request.path === "/api/session/register" &&
              request.method === "POST"
            ) {
              localStorage.setItem("desktop-first-run-registered", "true");
              return response(200, profile);
            }
            if (request.path === "/api/projects" && request.method === "GET") {
              return response(200, readProjects());
            }
            if (request.path === "/api/projects" && request.method === "POST") {
              const input = JSON.parse(request.body ?? "{}") as {
                name?: string;
                description?: string;
                kind?: "personal" | "shared";
              };
              const project = {
                id: projectId,
                name: input.name ?? "First project",
                description: input.description ?? "",
                kind: input.kind ?? "shared",
                visibility:
                  input.kind === "personal" ? "private" : "invitation_only",
                version: 1,
                createdAt: now,
                updatedAt: now,
              };
              localStorage.setItem(
                "desktop-first-run-projects",
                JSON.stringify([
                  { ...project, currentUserRole: "owner", memberCount: 1 },
                ]),
              );
              return response(200, project);
            }
            return response(503, {
              error: {
                code: "unavailable",
                message: "Fixture unavailable.",
                retryable: true,
              },
            });
          },
          async uploadTimedTranscript() {
            throw new Error("not configured");
          },
          async getNotificationPreferences() {
            throw new Error("not configured");
          },
          async updateNotificationPreferences() {
            throw new Error("not configured");
          },
          async getNotificationSupport() {
            throw new Error("not configured");
          },
          onNotificationNavigation() {
            return () => undefined;
          },
        },
      });
    },
    { now, userId, projectId },
  );

  await page.goto("/");
  await page.locator("details.account-menu > summary").click();
  await page.locator("details.local-setup-menu > summary").click();
  await expect(page.getByLabel("Account display name")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();

  await page.getByLabel("Account display name").fill("First Researcher");
  await page.getByRole("button", { name: "Create account profile" }).click();
  await expect(page.getByLabel("Account display name")).toHaveCount(0);
  await page.getByLabel("New project name").fill("First research project");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const activeProject = page
    .locator(".vera-project-control")
    .getByLabel("Active project");
  await expect(activeProject).toHaveValue(projectId);
  await expect(activeProject).toContainText("First research project");

  const rights = page.getByLabel(
    "I will process only sources I am authorized to use.",
  );
  await rights.check();
  await expect(rights).toBeChecked();

  await page.getByRole("button", { name: "Set up this Mac" }).click();
  await expect(
    page.getByText("Ready to set up", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Whisper large-v3-turbo")).toBeVisible();
  await expect(page.getByText("1.5 GiB", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Confirm local setup" }).click();
  await expect(page.getByText("Local setup active")).toBeVisible();
  await expect(page.getByText("Advanced setup")).toBeVisible();

  await page.reload();
  await page.locator("details.account-menu > summary").click();
  await page.locator("details.local-setup-menu > summary").click();
  await expect(page.getByLabel("Account display name")).toHaveCount(0);
  await expect(
    page.getByLabel("I will process only sources I am authorized to use."),
  ).toBeChecked();
  await expect(
    page.locator(".vera-project-control").getByLabel("Active project"),
  ).toHaveValue(projectId);
});

test("searches YouTube with capability-gated providers and hands selection to preflight", async ({
  page,
}) => {
  await mockShellWorkspace(page, 0);
  let preflightCount = 0;
  let createAttempts = 0;
  let createdBatch: Record<string, any> | undefined;
  const createdBatchId = "019fbb95-cd76-7920-93fa-e23ba755eef1";
  const createdItemIds = [
    "019fbb95-cd76-7920-93fa-e23ba755eef2",
    "019fbb95-cd76-7920-93fa-e23ba755eef3",
  ];
  await page.route(
    "**/cloud-api/api/projects/*/source-capabilities",
    async (route) =>
      route.fulfill({
        json: {
          providers: [
            {
              provider: "youtube",
              operations: [
                { operation: "search", state: "available", configured: true },
                {
                  operation: "embed-preview",
                  state: "available",
                  configured: true,
                },
              ],
            },
            {
              provider: "tiktok",
              operations: [
                {
                  operation: "search",
                  state: "unsupported",
                  configured: false,
                  explanation:
                    "TikTok search requires qualifying official API access.",
                },
              ],
            },
            {
              provider: "instagram",
              operations: [
                {
                  operation: "search",
                  state: "unsupported",
                  configured: false,
                  explanation:
                    "Instagram search requires qualifying official API access.",
                },
              ],
            },
            {
              provider: "facebook",
              operations: [
                {
                  operation: "search",
                  state: "unsupported",
                  configured: false,
                  explanation:
                    "Facebook search is limited to authorized assets and is not enabled.",
                },
              ],
            },
          ],
        },
      }),
  );
  await page.route("**/cloud-api/api/projects/*/source-search", async (route) =>
    route.fulfill({
      json: {
        outcomes: [
          {
            provider: "youtube",
            state: "success",
            candidates: ["M7lc1UVf-VE", "Romanian001"].map(
              (providerMediaId, resultPosition) => ({
                sourceIdentity: {
                  schemaVersion: 1,
                  provider: "youtube",
                  providerMediaId,
                  canonicalUrl: `https://www.youtube.com/watch?v=${providerMediaId}`,
                },
                title: `Search result ${resultPosition + 1}`,
                creator: "Fixture channel",
                thumbnailUrl: `https://i.ytimg.com/vi/${providerMediaId}/hqdefault.jpg`,
                availability: "available",
                provenance: { provider: "youtube", resultPosition },
              }),
            ),
          },
        ],
      },
    }),
  );
  await page.route(
    "**/cloud-api/api/projects/*/videos/preflight",
    async (route) => {
      preflightCount += 1;
      const body = route.request().postDataJSON() as Record<string, any> & {
        inputs: string[];
      };
      return route.fulfill({
        json: {
          projectId: shellPersonalProjectId,
          options: {
            targetLanguage: "en",
            transcriptionProfile: "default",
            sourcePolicy: body.sourcePolicy,
            executionLocation: body.executionLocation,
            priority: body.priority,
            ...(body.translationConsent
              ? { translationConsent: body.translationConsent }
              : {}),
          },
          items: body.inputs.map((input, inputIndex) => ({
            inputIndex,
            input,
            status: "ready",
            processingNeed: "transcription",
            youtubeVideoId: new URL(input).searchParams.get("v"),
            canonicalUrl: input,
            title: `Search result ${inputIndex + 1}`,
          })),
          summary: {
            total: body.inputs.length,
            ready: body.inputs.length,
            existingTranscripts: 0,
            duplicates: 0,
            unsupported: 0,
            metadataFailed: 0,
          },
        },
      });
    },
  );
  await page.route(
    "**/cloud-api/api/projects/*/transcription-batches",
    async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          json: {
            batches: createdBatch
              ? [
                  {
                    batch: createdBatch.batch,
                    progress: createdBatch.progress,
                  },
                ]
              : [],
          },
        });
      }
      createAttempts += 1;
      if (createAttempts === 1) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "creation_conflict",
              message: "Correct the draft and retry.",
              retryable: true,
            },
          },
        });
      }
      const body = route.request().postDataJSON() as Record<string, any>;
      expect(body).toMatchObject({
        name: "Research batch",
        executionLocation: "hosted",
        priority: "high",
        translationConsent: {
          provider: "amazon-translate",
          transcriptTextTransferAccepted: true,
        },
      });
      const now = "2026-08-25T12:00:00.000Z";
      const items = body.inputs.map((input: string, inputIndex: number) => ({
        id: createdItemIds[inputIndex],
        batchId: createdBatchId,
        inputIndex,
        input,
        status: "ready",
        processingNeed: "transcription",
        youtubeVideoId: new URL(input).searchParams.get("v"),
        canonicalUrl: input,
        title: `Search result ${inputIndex + 1}`,
        state: "queued",
        reviewStatus: "unreviewed",
        attempt: 0,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }));
      createdBatch = {
        batch: {
          id: createdBatchId,
          projectId: shellPersonalProjectId,
          name: body.name,
          targetLanguage: "en",
          transcriptionProfile: "default",
          sourcePolicy: body.sourcePolicy,
          executionLocation: body.executionLocation,
          priority: body.priority,
          translationConsent: body.translationConsent,
          hostedApproval: { state: "pending", version: 1 },
          dispatchStatus: "active",
          createdBy: shellUserId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        items,
        summary: {
          total: 2,
          ready: 2,
          existingTranscripts: 0,
          duplicates: 0,
          unsupported: 0,
          metadataFailed: 0,
        },
        progress: {
          total: 2,
          queued: 2,
          active: 0,
          readyForReview: 0,
          blocked: 0,
          failed: 0,
          retryableFailed: 0,
          canceled: 0,
          unreviewed: 0,
          reviewing: 0,
          reviewed: 0,
          skipped: 0,
        },
      };
      return route.fulfill({ status: 201, json: createdBatch });
    },
  );
  await page.route(
    `**/cloud-api/api/projects/*/transcription-batches/${createdBatchId}`,
    async (route) =>
      createdBatch
        ? route.fulfill({ json: createdBatch })
        : route.fulfill({ status: 404, json: { error: "not found" } }),
  );

  await page.goto("/");
  await connectShellWorkspace(page);
  await page.getByLabel("Worker").selectOption("hosted");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByLabel(/Allow Amazon Translate/u).check();
  const csvInput = page.getByLabel("Import CSV");
  await csvInput.setInputFiles({
    name: "draft.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Title,URL\nDraft,https://youtu.be/DraftVideo1\n"),
  });
  await page.getByLabel("YouTube URL column").selectOption("1");
  await page.getByRole("button", { name: "Use CSV values" }).click();
  await page.getByRole("tab", { name: "Search" }).click();

  const providerOptions = page.locator(".source-provider-options");
  await expect(providerOptions.getByLabel("YouTube")).toBeChecked();
  await expect(providerOptions.getByLabel(/TikTok/)).toBeDisabled();
  await expect(providerOptions.getByLabel(/Instagram/)).toBeDisabled();
  await expect(providerOptions.getByLabel(/Facebook/)).toBeDisabled();

  await page.getByLabel("Search videos").fill("fixture research");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.locator(".source-result-card")).toHaveCount(2);
  expect(preflightCount).toBe(0);

  await page
    .locator(".source-result-card")
    .nth(0)
    .getByRole("button", { name: "Preview" })
    .click();
  await expect(page.locator(".source-search-results iframe")).toHaveCount(1);
  await page
    .locator(".source-result-card")
    .nth(1)
    .getByRole("button", { name: "Preview" })
    .click();
  await expect(page.locator(".source-search-results iframe")).toHaveCount(1);

  for (const checkbox of await page
    .locator(".source-result-card input[type=checkbox]")
    .all()) {
    await checkbox.check();
  }
  await page.getByRole("button", { name: "Add selected to batch (2)" }).click();
  await expect(
    page.getByLabel("YouTube URLs or video IDs, one per line"),
  ).toHaveValue(
    "https://www.youtube.com/watch?v=M7lc1UVf-VE\nhttps://www.youtube.com/watch?v=Romanian001",
  );
  expect(preflightCount).toBe(0);
  await page.getByRole("button", { name: "Preflight 2" }).click();
  await expect(page.getByText("Preflight complete.")).toBeVisible();
  expect(preflightCount).toBe(1);
  await page
    .getByRole("button", { name: "Create batch" })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page.getByText("Correct the draft and retry.")).toBeVisible();
  expect(createAttempts).toBe(1);
  await expect(page.getByLabel("Batch name")).toHaveValue("Research batch");
  await expect(
    page.getByLabel("YouTube URLs or video IDs, one per line"),
  ).not.toHaveValue("");
  await expect(page.getByLabel("YouTube URL column")).toHaveValue("1");
  await expect(page.locator(".batch-create-card .summary-line")).toHaveCount(1);
  await page.getByRole("button", { name: "Create batch" }).click();
  await expect(page.getByLabel("Batch name")).toHaveValue("");
  await expect(page.getByLabel("Batch name")).toBeFocused();
  await expect(
    page.getByLabel("YouTube URLs or video IDs, one per line"),
  ).toHaveValue("");
  await expect(csvInput).toHaveValue("");
  await expect(page.getByLabel("YouTube URL column")).toHaveCount(0);
  await expect(page.locator(".batch-create-card .summary-line")).toHaveCount(0);
  await expect(page.getByLabel("Worker")).toHaveValue("hosted");
  await expect(page.getByLabel("Priority")).toHaveValue("high");
  await expect(page.getByLabel(/Allow Amazon Translate/u)).toBeChecked();
  await expect(page.getByText("Research batch", { exact: true })).toBeVisible();
  expect(createAttempts).toBe(2);
});

test("adds an unknown pasted URL for immediate review and exposes keyboard tabs", async ({
  page,
}) => {
  const now = "2026-08-25T12:00:00.000Z";
  await mockShellWorkspace(page, 0);
  let resolveCount = 0;
  let resolvedProjectId: string | undefined;
  const retryBatchId = "019fbb95-cd76-7920-93fa-e23ba755eef0";
  const retryItemId = "019fbb95-cd76-7920-93fa-e23ba755eef1";
  let retryItemState: "failed" | "queued" = "failed";
  let retryItemVersion = 4;
  let retryCommand: Record<string, unknown> | undefined;
  const retryBatch = () => ({
    id: retryBatchId,
    projectId: shellPersonalProjectId,
    name: "Immediate transcript retry",
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 2,
    createdAt: now,
    updatedAt: now,
  });
  const retryItem = () => ({
    id: retryItemId,
    batchId: retryBatchId,
    inputIndex: 0,
    input: immediateVideo.canonicalUrl,
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: immediateVideo.youtubeVideoId,
    canonicalUrl: immediateVideo.canonicalUrl,
    catalogVideoId: immediateVideo.id,
    title: immediateVideo.title,
    state: retryItemState,
    reviewStatus: "unreviewed",
    attempt: 1,
    version: retryItemVersion,
    createdAt: now,
    updatedAt: now,
    ...(retryItemState === "failed"
      ? {
          error: {
            code: "worker_execution_failed",
            message: "Earlier worker failed after caption acquisition.",
            retryable: true,
          },
        }
      : {}),
  });
  const retryProgress = () => ({
    total: 1,
    queued: retryItemState === "queued" ? 1 : 0,
    active: 0,
    readyForReview: 0,
    blocked: 0,
    failed: retryItemState === "failed" ? 1 : 0,
    retryableFailed: retryItemState === "failed" ? 1 : 0,
    canceled: 0,
    unreviewed: 0,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  });
  const retryDetail = () => ({
    batch: retryBatch(),
    items: [retryItem()],
    summary: {
      total: 1,
      ready: 1,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: retryProgress(),
  });

  await page.route("**/cloud-api/api/projects/*/videos", async (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    "**/cloud-api/api/projects/*/videos/resolve",
    async (route) => {
      resolveCount += 1;
      const path = new URL(route.request().url()).pathname;
      resolvedProjectId = path.split("/")[4];
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        url: immediateVideo.canonicalUrl,
      });
      await route.fulfill({
        status: 201,
        json: {
          ...immediateVideo,
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
    },
  );
  await page.route(
    "**/cloud-api/api/projects/*/transcription-batches**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace("/cloud-api", "");
      if (
        path ===
          `/api/projects/${shellPersonalProjectId}/transcription-batches` &&
        request.method() === "GET"
      ) {
        return route.fulfill({
          json: {
            batches: [{ batch: retryBatch(), progress: retryProgress() }],
          },
        });
      }
      if (
        path ===
          `/api/projects/${shellPersonalProjectId}/transcription-batches/${retryBatchId}` &&
        request.method() === "GET"
      ) {
        return route.fulfill({ json: retryDetail() });
      }
      if (
        path ===
          `/api/projects/${shellPersonalProjectId}/transcription-batches/${retryBatchId}/items/${retryItemId}/retry` &&
        request.method() === "POST"
      ) {
        retryCommand = request.postDataJSON();
        expect(retryCommand).toEqual({
          idempotencyKey: `workspace-transcript-retry:${shellPersonalProjectId}:${retryItemId}:v4`,
          expectedVersion: 4,
        });
        retryItemState = "queued";
        retryItemVersion += 1;
        return route.fulfill({
          json: {
            projectId: shellPersonalProjectId,
            batchId: retryBatchId,
            item: retryItem(),
            outcome: "queued",
          },
        });
      }
      return route.fallback();
    },
  );
  await page.route(
    `**/local-agent/api/projects/*/videos/${immediateVideo.id}/transcript?*`,
    async (route) =>
      route.fulfill({
        status: 404,
        json: {
          error: {
            code: "not_found",
            message:
              "No active transcript exists yet. Retry this video or open Project Videos to inspect progress.",
            retryable: true,
          },
        },
      }),
  );

  await page.goto("/");
  await connectShellWorkspace(page);

  const pasteTab = page.getByRole("tab", { name: "Paste URL" });
  const searchTab = page.getByRole("tab", { name: "Search" });
  await expect(pasteTab).toHaveAttribute("aria-selected", "true");
  await pasteTab.focus();
  await pasteTab.press("ArrowRight");
  await expect(searchTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Search" })).toBeVisible();
  await searchTab.press("Home");
  await expect(pasteTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Paste URL" })).toBeVisible();

  await page
    .getByLabel("YouTube URL or video ID")
    .fill(immediateVideo.youtubeVideoId);
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(
    page.locator(
      `iframe[src*="youtube-nocookie.com/embed/${immediateVideo.youtubeVideoId}"]`,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No active transcript exists yet. Retry this video or open Project Videos to inspect progress.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry transcript" }).click();
  await expect(
    page.getByText(/Checking the YouTube transcript before Whisper/u),
  ).toBeVisible();
  expect(retryCommand).toBeDefined();
  expect(resolveCount).toBe(1);
  expect(resolvedProjectId).toBe(shellPersonalProjectId);
  await expect(
    page.getByText(/not in this project yet|batch workflow/u),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Load video" }).click();
  await expect.poll(() => resolveCount).toBe(1);
});

test("keeps immediate URL resolve failures actionable without opening a video", async ({
  page,
}) => {
  await mockShellWorkspace(page, 0);
  await page.route("**/cloud-api/api/projects/*/videos", async (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    "**/cloud-api/api/projects/*/videos/resolve",
    async (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: "unavailable",
            message: "YouTube metadata is temporarily unavailable. Try again.",
            retryable: true,
          },
        },
      }),
  );

  await page.goto("/");
  await connectShellWorkspace(page);
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(immediateVideo.youtubeVideoId);
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(
    page.getByText("YouTube metadata is temporarily unavailable. Try again."),
  ).toBeVisible();
  await expect(
    page.locator(
      `iframe[src*="youtube-nocookie.com/embed/${immediateVideo.youtubeVideoId}"]`,
    ),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load video" })).toBeEnabled();
});

const navigationUserId = "019fbb95-cd76-7920-93fa-e23ba755ee80";
const navigationProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee81";
const navigationOtherProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee82";
const navigationDirectClipId = "019fbb95-cd76-7920-93fa-e23ba755ee83";
const navigationRomanianClipId = "019fbb95-cd76-7920-93fa-e23ba755ee84";
const navigationDirectArtifactId = "019fbb95-cd76-7920-93fa-e23ba755ee85";
const navigationRomanianArtifactId = "019fbb95-cd76-7920-93fa-e23ba755ee86";
const navigationDirectLocatorId = "019fbb95-cd76-7920-93fa-e23ba755ee87";
const navigationRomanianLocatorId = "019fbb95-cd76-7920-93fa-e23ba755ee88";
const navigationRootId = "019fbb95-cd76-7920-93fa-e23ba755ee89";

const navigationDirectSelection = {
  trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
  transcriptVersion: 1,
  firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
  lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
  firstTokenId: "019fbb95-cd76-7920-93fa-e23ba755e322",
  lastTokenId: "019fbb95-cd76-7920-93fa-e23ba755e326",
  transcriptStartMs: 300,
  transcriptEndMs: 2_900,
  exportStartMs: 200,
  exportEndMs: 3_200,
  text: "fixture has accurate word timing. Click any word",
  timingPrecision: "word",
} as const;

const navigationRomanianSelection = {
  trackId: "019fbb95-cd76-7920-93fa-e23ba755e502",
  transcriptVersion: 1,
  firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e521",
  lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e522",
  transcriptStartMs: 0,
  transcriptEndMs: 4_000,
  exportStartMs: 0,
  exportEndMs: 4_000,
  text: "This is a Romanian example. The selection stays linked by time.",
  timingPrecision: "cue",
} as const;

function navigationClip(
  video: typeof directVideo | typeof romanianVideo,
  id: string,
  selection:
    typeof navigationDirectSelection | typeof navigationRomanianSelection,
) {
  const now = "2026-08-01T12:00:00.000Z";
  const native =
    video.youtubeVideoId === directVideo.youtubeVideoId
      ? {
          role: "native",
          language: "en",
          text: selection.text,
          trackId: englishWordFixture.track.id,
          trackVersion: 1,
          timingPrecision: "word",
        }
      : {
          role: "native",
          language: "ro",
          text: "Acesta este un exemplu românesc. Selecția rămâne legată de timp.",
          trackId: multilingualFixture.original.track.id,
          trackVersion: 1,
          timingPrecision: "cue",
        };
  const english =
    video.youtubeVideoId === directVideo.youtubeVideoId
      ? {
          role: "english",
          language: "en",
          text: selection.text,
          trackId: englishWordFixture.track.id,
          trackVersion: 1,
          timingPrecision: "word",
        }
      : {
          role: "english",
          language: "en",
          text: selection.text,
          trackId: multilingualFixture.english.track.id,
          trackVersion: 1,
          sourceTrackId: multilingualFixture.original.track.id,
          timingPrecision: "cue",
        };
  return {
    id,
    projectId: navigationProjectId,
    catalogVideoId: video.id,
    video: {
      youtubeVideoId: video.youtubeVideoId,
      canonicalUrl: video.canonicalUrl,
      title: video.title,
      channel: video.channel,
    },
    selection,
    languageEvidence: { schemaVersion: 2, native, english },
    englishText: selection.text,
    ...(video.youtubeVideoId === romanianVideo.youtubeVideoId
      ? { originalText: native.text }
      : {}),
    notes: "Navigation fixture",
    tags: ["Navigation"],
    researchStatus: "candidate",
    exportStatus: "not_requested",
    createdBy: navigationUserId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function mockNavigationWorkspace(
  page: Page,
  input: {
    authorizedVideos?: Array<typeof directVideo | typeof romanianVideo>;
  } = {},
) {
  const now = "2026-08-01T12:00:00.000Z";
  let authorizedVideos = input.authorizedVideos ?? [directVideo, romanianVideo];
  const transcriptVersions = new Map<string, string>();
  const transcriptRequests: string[] = [];
  const artifactResolutionRequests: string[] = [];
  const artifactOpenRequests: string[] = [];
  const directClip = navigationClip(
    directVideo,
    navigationDirectClipId,
    navigationDirectSelection,
  );
  const romanianClip = navigationClip(
    romanianVideo,
    navigationRomanianClipId,
    navigationRomanianSelection,
  );
  const versions = new Map([
    [
      navigationDirectClipId,
      artifactVersionFixture(directClip, navigationDirectArtifactId, now),
    ],
    [
      navigationRomanianClipId,
      artifactVersionFixture(romanianClip, navigationRomanianArtifactId, now),
    ],
  ]);
  const locators = new Map([
    [
      navigationDirectClipId,
      artifactLocatorFixture(
        navigationDirectLocatorId,
        navigationDirectArtifactId,
        navigationRootId,
        now,
      ),
    ],
    [
      navigationRomanianClipId,
      artifactLocatorFixture(
        navigationRomanianLocatorId,
        navigationRomanianArtifactId,
        navigationRootId,
        now,
      ),
    ],
  ]);

  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/session/profile") {
      return route.fulfill({
        json: {
          id: navigationUserId,
          externalSubject: "fixture:navigation-user",
          handle: "navigation_user",
          displayName: "Navigation User",
          preferredLanguage: "en",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          shellProject(
            navigationProjectId,
            "Navigation project",
            "shared",
            "owner",
            2,
          ),
          shellProject(
            navigationOtherProjectId,
            "Other project",
            "shared",
            "owner",
            1,
          ),
        ],
      });
    }
    if (path === `/api/projects/${navigationProjectId}/videos`) {
      return route.fulfill({
        json: authorizedVideos.map((video) => projectVideoFixture(video, now)),
      });
    }
    if (path === `/api/projects/${navigationOtherProjectId}/videos`) {
      return route.fulfill({ json: [projectVideoFixture(directVideo, now)] });
    }
    if (path.endsWith("/transcription-batches"))
      return route.fulfill({ json: { batches: [] } });
    if (path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (path.includes("/worklist"))
      return route.fulfill({ json: { items: [], total: 0 } });
    if (path.endsWith("/local-processing"))
      return route.fulfill({ json: defaultLocalProcessingStatus(path) });
    if (path.endsWith("/keywords"))
      return route.fulfill({ json: defaultProjectKeywordCatalog(path) });
    if (path.endsWith("/activity"))
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => {
      const parts = new URL(route.request().url()).pathname.split("/");
      const projectId = parts[4]!;
      const catalogVideoId = parts[6]!;
      transcriptRequests.push(catalogVideoId);
      const video =
        catalogVideoId === romanianVideo.id ? romanianVideo : directVideo;
      const fixture = workspaceFixture({
        projectId,
        video,
        preferredLanguage: "en",
      });
      return route.fulfill({
        json: {
          ...fixture,
          transcriptVersionId:
            transcriptVersions.get(catalogVideoId) ??
            fixture.transcriptVersionId,
        },
      });
    },
  );
  await page.route("**/local-agent/api/artifact-roots", async (route) =>
    route.fulfill({
      json: {
        roots: [
          {
            id: navigationRootId,
            label: "Navigation exports",
            platform: "posix",
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    }),
  );
  await page.route(
    "**/local-agent/api/projects/*/clips/*/artifact-resolution",
    async (route) => {
      const clipId = new URL(route.request().url()).pathname.split("/")[6]!;
      artifactResolutionRequests.push(clipId);
      const version = versions.get(clipId)!;
      return route.fulfill({
        json: {
          state: "reusable_local",
          artifactVersionId: version.artifactVersionId,
          locator: locators.get(clipId),
          freshness: "fresh",
        },
      });
    },
  );
  await page.route("**/local-agent/api/artifact-locators/**", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const locatorId = parts.at(-2)!;
    const action = parts.at(-1)!;
    if (action === "open") artifactOpenRequests.push(locatorId);
    if (locatorId === navigationRomanianLocatorId && action === "open") {
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "artifact_invalid",
            message: "Fresh bytes no longer match the verified package.",
            retryable: false,
          },
        },
      });
    }
    const clipId =
      locatorId === navigationDirectLocatorId
        ? navigationDirectClipId
        : navigationRomanianClipId;
    return route.fulfill({
      json: { locator: locators.get(clipId), freshness: "fresh" },
    });
  });
  await page.route(
    "**/local-agent/api/projects/*/clip-library**",
    async (route) => {
      const projectId = new URL(route.request().url()).pathname.split("/")[4]!;
      const clips =
        projectId === navigationProjectId ? [directClip, romanianClip] : [];
      return route.fulfill({
        json: {
          projectId,
          entries: clips.map((clip) => ({
            clip,
            currentLeaves: [],
            hasMoreLeaves: false,
            completedVersionCount: 1,
            recentArtifactVersions: [versions.get(clip.id)],
          })),
          syncCursor: "1",
          fetchedAt: now,
          query: { limit: 25, completed: "any" },
          freshness: "fresh",
          cachedAt: now,
          cacheCoverage: "cached_subset",
          selectedClipIds: [],
          localAvailability: clips.map((clip) => ({
            artifactVersionId: versions.get(clip.id)!.artifactVersionId,
            locators: [locators.get(clip.id)],
          })),
        },
      });
    },
  );

  return {
    transcriptRequests,
    artifactResolutionRequests,
    artifactOpenRequests,
    setAuthorizedVideos(
      videos: Array<typeof directVideo | typeof romanianVideo>,
    ) {
      authorizedVideos = videos;
    },
    setTranscriptVersion(catalogVideoId: string, transcriptVersionId: string) {
      transcriptVersions.set(catalogVideoId, transcriptVersionId);
    },
  };
}

test("creates, searches, seeks, and moderates project bookmarks with visible sync state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockNavigationWorkspace(page);
  const now = "2026-08-24T12:00:00.000Z";
  const actor = {
    userId: navigationUserId,
    handle: "navigation_user",
    displayName: "Navigation User",
  };
  const directBookmarkId = "019fbb95-cd76-7920-93fa-e23ba755ef61";
  const romanianBookmarkId = "019fbb95-cd76-7920-93fa-e23ba755ef62";
  let directVersion = 1;
  let directState: "active" | "archived" = "active";
  let directBookmark: Record<string, unknown> | undefined;
  const romanianBookmark = {
    id: romanianBookmarkId,
    projectId: navigationProjectId,
    videoId: romanianVideo.id,
    sourceTimeMs: 3_000,
    title: "Romanian evidence",
    note: "Cross-video searchable note",
    state: "active" as const,
    version: 1,
    createdBy: actor,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
    source: {
      youtubeVideoId: romanianVideo.youtubeVideoId,
      canonicalUrl: romanianVideo.canonicalUrl,
      title: romanianVideo.title,
    },
  };
  const retainedOutbox = [
    {
      outboxId: "019fbb95-cd76-7920-93fa-e23ba755ef63",
      commandType: "bookmark.create.v1",
      videoId: directVideo.id,
      sourceTimeMs: 6_000,
      title: "Queued offline marker",
      state: "queued",
      createdAt: now,
    },
    {
      outboxId: "019fbb95-cd76-7920-93fa-e23ba755ef64",
      commandType: "bookmark.update.v1",
      bookmarkId: romanianBookmarkId,
      title: "Retained conflict title",
      note: "Retained conflict note",
      expectedVersion: 1,
      state: "conflict",
      code: "version_conflict",
      createdAt: now,
    },
  ];
  await page.route(
    "**/local-agent/api/projects/*/bookmarks**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (request.method() === "GET") {
        const wholeProject = url.searchParams.get("scope") === "project";
        const search = (url.searchParams.get("search") ?? "").toLowerCase();
        const state = url.searchParams.get("state") ?? "active";
        const items = [directBookmark, romanianBookmark]
          .filter((bookmark): bookmark is Record<string, unknown> =>
            Boolean(bookmark),
          )
          .filter(
            (bookmark) => wholeProject || bookmark.videoId === directVideo.id,
          )
          .filter((bookmark) => state === "all" || bookmark.state === state)
          .filter((bookmark) =>
            search
              ? `${bookmark.title ?? ""} ${bookmark.note ?? ""}`
                  .toLowerCase()
                  .includes(search)
              : true,
          );
        return route.fulfill({
          json: {
            projectId: navigationProjectId,
            items,
            freshness: "fresh",
            cachedAt: now,
            outbox: retainedOutbox,
          },
        });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      if (request.method() === "POST" && path.endsWith("/bookmarks")) {
        directBookmark = {
          id: directBookmarkId,
          projectId: navigationProjectId,
          videoId: directVideo.id,
          sourceTimeMs: body.sourceTimeMs,
          title: body.title,
          note: body.note,
          state: directState,
          version: directVersion,
          createdBy: actor,
          updatedBy: actor,
          createdAt: now,
          updatedAt: now,
          source: {
            youtubeVideoId: directVideo.youtubeVideoId,
            canonicalUrl: directVideo.canonicalUrl,
            title: directVideo.title,
          },
        };
      } else if (request.method() === "PATCH") {
        directVersion += 1;
        directBookmark = {
          ...directBookmark,
          title: body.title ?? undefined,
          note: body.note ?? undefined,
          version: directVersion,
        };
      } else if (path.endsWith("/archive")) {
        directState = "archived";
        directVersion += 1;
        directBookmark = {
          ...directBookmark,
          state: directState,
          version: directVersion,
        };
      } else if (path.endsWith("/restore")) {
        directState = "active";
        directVersion += 1;
        directBookmark = {
          ...directBookmark,
          state: directState,
          version: directVersion,
        };
      }
      return route.fulfill({
        status: path.endsWith("/bookmarks") ? 201 : 200,
        json: {
          state: "applied",
          outboxId: "019fbb95-cd76-7920-93fa-e23ba755ef65",
          bookmark: directBookmark,
        },
      });
    },
  );

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${navigationUserId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await postFixturePlayerInfo(page, { currentTime: 7.5, duration: 120 });
  const panel = page.getByRole("region", { name: "Bookmarks", exact: true });
  await panel.getByLabel("Bookmark title").fill("Opening claim");
  await panel
    .getByLabel("Bookmark note")
    .fill("Use this point in the opening sequence");
  await panel.getByRole("button", { name: "Bookmark current time" }).click();
  await expect(panel).toContainText("0:07 · Opening claim");
  await expect(panel).toContainText("Queued offline marker");
  await expect(panel).toContainText("Retained conflict note");
  await panel.getByRole("button", { name: /Opening claim/u }).click();
  await expect(page.locator(".video-details strong")).toHaveText("0:07");

  const dialogResponses = ["Edited opening claim", "Edited searchable note"];
  const answerBookmarkDialog = (dialog: Dialog) =>
    dialog.accept(dialogResponses.shift() ?? "");
  page.on("dialog", answerBookmarkDialog);
  await panel.getByRole("button", { name: "Edit" }).click();
  page.off("dialog", answerBookmarkDialog);
  await expect(panel).toContainText("Edited opening claim");
  await panel.getByRole("button", { name: "Archive" }).click();
  await expect(panel).not.toContainText("Edited opening claim");
  await panel.getByLabel("Archived").check();
  await expect(panel).toContainText("Edited opening claim");
  await panel.getByRole("button", { name: "Restore" }).click();

  await panel.getByLabel("Whole project").check();
  await panel.getByLabel("Search bookmarks").fill("cross-video");
  await expect(panel).toContainText("Romanian evidence");
  await panel.getByRole("button", { name: /Romanian evidence/u }).click();
  await expect
    .poll(() =>
      page.frames().some((frame) => frame.url().includes("Romanian001")),
    )
    .toBe(true);

  const geometry = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
    panelScrollHeight: document.querySelector(".bookmarks-panel")!.scrollHeight,
    panelClientHeight: document.querySelector(".bookmarks-panel")!.clientHeight,
  }));
  expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.panelScrollHeight).toBeGreaterThanOrEqual(
    geometry.panelClientHeight,
  );
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(panel).toBeVisible();
});

test("separates Add, Review, and Logged workflow destinations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    ({ userId, projectId, otherUserId, otherProjectId }) => {
      localStorage.setItem(`vera:recent-project:${userId}`, projectId);
      localStorage.setItem(
        `vera:recent-project:${otherUserId}`,
        otherProjectId,
      );
    },
    {
      userId: shellUserId,
      projectId: shellAdminProjectId,
      otherUserId: "019fbb95-cd76-7920-93fa-e23ba755ee79",
      otherProjectId: shellResearcherProjectId,
    },
  );
  await mockShellWorkspace(page);
  await page.goto("/");
  await connectShellWorkspace(page);

  await expect(page.getByLabel("Active project")).toHaveValue(
    shellAdminProjectId,
  );
  await expect(
    page
      .getByLabel("Active project")
      .locator('optgroup[label="Personal projects"] option'),
  ).toHaveCount(1);
  await expect(
    page
      .getByLabel("Active project")
      .locator('optgroup[label="Shared projects"] option'),
  ).toHaveCount(2);
  await expect(page.getByLabel("3 unread")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Project Settings" }),
  ).toBeVisible();

  await page.locator("details.account-menu > summary").click();
  await expect(page.getByLabel("Account settings")).toContainText(
    "Chinese (Traditional) (Taiwan) (zh-Hant-TW)",
  );
  await expect(page.getByLabel("Desktop notifications")).toContainText(
    "Native notifications are unavailable in browser development.",
  );
  await expect(page.locator(".account-menu-panel")).not.toContainText(
    "Project keywords",
  );
  await page.locator("details.account-menu > summary").click();

  await page.getByRole("button", { name: "Bulk add" }).click();
  await expect(page.getByRole("heading", { name: "Add" })).toBeVisible();
  await expect(
    page.getByLabel("YouTube URLs or video IDs, one per line"),
  ).toBeFocused();
  await page.getByRole("button", { name: "Review", exact: true }).click();

  const shellGeometry = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
    hasWorklistShelf: Boolean(
      document.querySelector(".workbench-worklist-slot"),
    ),
    researchHeight: Math.round(
      document.querySelector(".workbench-research")!.getBoundingClientRect()
        .height,
    ),
  }));
  expect(shellGeometry.documentHeight).toBeLessThanOrEqual(
    shellGeometry.viewportHeight,
  );
  expect(shellGeometry.hasWorklistShelf).toBe(false);
  expect(shellGeometry.researchHeight).toBeGreaterThan(100);

  await page.getByText("Layout", { exact: true }).click();
  await expect(page.getByLabel("Worklist shelf height")).toHaveCount(0);
  await page.getByLabel("Transcript width").fill("54");
  await page.reload();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByText("Layout", { exact: true }).click();
  await expect(page.getByLabel("Transcript width")).toHaveValue("54");
  await page.getByRole("button", { name: "Reset layout" }).click();
  await expect(page.getByLabel("Transcript width")).toHaveValue("46");
  const transcriptWidthBeforeResize = await page
    .locator(".transcript-panel")
    .evaluate((element) => element.getBoundingClientRect().width);
  await page
    .getByRole("separator", { name: "Resize transcript panel" })
    .press("End");
  await expect(page.getByLabel("Transcript width")).toHaveValue("70");
  await expect
    .poll(() =>
      page
        .locator(".transcript-panel")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(transcriptWidthBeforeResize);
  await page.getByRole("button", { name: "Reset layout" }).click();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await connectShellWorkspace(page);
  await expect(page.getByRole("heading", { name: "Add" })).toBeVisible();
  await expect(page.getByLabel("Project video worklist")).toBeVisible();
  const projectVideosGeometry = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
    shellOverflow: getComputedStyle(
      document.querySelector(".destination-videos")!,
    ).overflow,
    contentOverflow: getComputedStyle(document.querySelector(".add-layout")!)
      .overflow,
    ingestTop: document
      .querySelector(".source-ingest-panel")!
      .getBoundingClientRect().top,
    batchesTop: document.querySelector(".batch-grid")!.getBoundingClientRect()
      .top,
    worklistTop: document
      .querySelector(".canonical-worklist-card")!
      .getBoundingClientRect().top,
  }));
  expect(projectVideosGeometry.documentHeight).toBeGreaterThan(
    projectVideosGeometry.viewportHeight,
  );
  expect(projectVideosGeometry.shellOverflow).toBe("visible");
  expect(projectVideosGeometry.contentOverflow).toBe("visible");
  expect(projectVideosGeometry.ingestTop).toBeLessThan(
    projectVideosGeometry.batchesTop,
  );
  expect(projectVideosGeometry.batchesTop).toBeLessThan(
    projectVideosGeometry.worklistTop,
  );

  await page.getByRole("button", { name: "Logged", exact: true }).click();
  await expect(page.locator(".batch-grid")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Create a transcription batch" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Batches" })).toHaveCount(0);
});

test("fails closed for removed recency and gates settings for researchers", async ({
  page,
}) => {
  await page.addInitScript(
    ({ userId, projectId }) =>
      localStorage.setItem(`vera:recent-project:${userId}`, projectId),
    { userId: shellUserId, projectId: removedShellProjectId },
  );
  const fixture = await mockShellWorkspace(page, 0);
  await page.goto("/");
  await connectShellWorkspace(page);

  await expect(page.getByLabel("Active project")).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(
        (userId) => localStorage.getItem(`vera:recent-project:${userId}`),
        shellUserId,
      ),
    )
    .toBeNull();
  expect(fixture.requestedProjectIds).not.toContain(removedShellProjectId);

  await page
    .getByLabel("Active project")
    .selectOption(shellResearcherProjectId);
  await expect(
    page.getByRole("button", { name: "Project Settings" }),
  ).toHaveCount(0);
  await expect(page.getByText("Shared research · Researcher")).toBeVisible();

  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.setViewportSize({ width: 700, height: 900 });
  const panelOrder = await page.evaluate(() => {
    const player = document
      .querySelector(".video-panel")!
      .getBoundingClientRect();
    const transcript = document
      .querySelector(".transcript-panel")!
      .getBoundingClientRect();
    return { playerTop: player.top, transcriptTop: transcript.top };
  });
  expect(panelOrder.playerTop).toBeLessThan(panelOrder.transcriptTop);
});

test("administers project access, roles, invitations, and ownership in Project Settings", async ({
  page,
}) => {
  await mockShellWorkspace(page, 0);
  const now = "2026-08-24T12:00:00.000Z";
  const researcherId = "019fbb95-cd76-7920-93fa-e23ba755ef01";
  const successorId = "019fbb95-cd76-7920-93fa-e23ba755ef02";
  const invitationId = "019fbb95-cd76-7920-93fa-e23ba755ef03";
  const openProjectId = "019fbb95-cd76-7920-93fa-e23ba755ef04";
  let project = shellProject(
    shellPersonalProjectId,
    "Personal notebook",
    "personal",
    "owner",
    3,
  );
  let members = [
    {
      projectId: project.id,
      userId: shellUserId,
      role: "owner",
      version: 1,
      createdAt: now,
      updatedAt: now,
      user: {
        id: shellUserId,
        handle: "shell_user",
        displayName: "Shell User",
      },
    },
    {
      projectId: project.id,
      userId: researcherId,
      role: "researcher",
      version: 1,
      createdAt: now,
      updatedAt: now,
      user: {
        id: researcherId,
        handle: "role_researcher",
        displayName: "Role Researcher",
      },
    },
    {
      projectId: project.id,
      userId: successorId,
      role: "administrator",
      version: 1,
      createdAt: now,
      updatedAt: now,
      user: {
        id: successorId,
        handle: "owner_successor",
        displayName: "Owner Successor",
      },
    },
  ];
  let pendingInvitations: Record<string, unknown>[] = [];
  let ownInvitations: Record<string, unknown>[] = [
    {
      id: invitationId,
      projectId: shellAdminProjectId,
      projectName: "Shared administration",
      invitee: { id: shellUserId, handle: "shell_user" },
      inviter: { id: successorId, handle: "owner_successor" },
      role: "researcher",
      state: "pending",
      version: 1,
      expiresAt: "2026-08-31T12:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
  ];
  const governanceActions: Record<string, unknown>[] = [];
  const invitationCommands: Record<string, unknown>[] = [];

  await page.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/cloud-api", "");
    if (path === "/api/project-invitations") {
      return route.fulfill({ json: ownInvitations });
    }
    if (path === `/api/project-invitations/${invitationId}`) {
      ownInvitations = [];
      return route.fulfill({ json: { id: invitationId, state: "accepted" } });
    }
    if (path === "/api/projects/discover") {
      return route.fulfill({
        json: [
          {
            id: openProjectId,
            name: "Open research room",
            description: "Bounded discovery only",
            memberCount: 2,
          },
        ],
      });
    }
    if (path === `/api/projects/${openProjectId}/join`) {
      return route.fulfill({ json: { id: openProjectId } });
    }
    if (path === `/api/projects/${project.id}/members`) {
      return route.fulfill({ json: members });
    }
    if (path === `/api/projects/${project.id}/invitations`) {
      if (request.method() === "POST") {
        const command = request.postDataJSON() as Record<string, unknown>;
        invitationCommands.push(command);
        pendingInvitations = [
          {
            id: invitationId,
            projectId: project.id,
            projectName: project.name,
            invitee: { id: researcherId, handle: command.handle },
            inviter: { id: shellUserId, handle: "shell_user" },
            role: command.role,
            state: "pending",
            version: 1,
            expiresAt: "2026-08-31T12:00:00.000Z",
            createdAt: now,
            updatedAt: now,
          },
        ];
        return route.fulfill({ status: 201, json: pendingInvitations[0] });
      }
      return route.fulfill({ json: pendingInvitations });
    }
    if (path === `/api/projects/${project.id}/invitations/${invitationId}`) {
      pendingInvitations = [];
      return route.fulfill({ json: { id: invitationId, state: "revoked" } });
    }
    if (path === `/api/projects/${project.id}/governance-events`) {
      return route.fulfill({
        json: [
          {
            id: "019fbb95-cd76-7920-93fa-e23ba755ef05",
            projectId: project.id,
            eventType: "project_converted",
            actorId: shellUserId,
            createdAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${project.id}/governance`) {
      const command = request.postDataJSON() as {
        action: Record<string, unknown> & { type: string };
      };
      governanceActions.push(command.action);
      const action = command.action;
      project = {
        ...project,
        kind: action.type === "convert_to_shared" ? "shared" : project.kind,
        visibility:
          action.type === "convert_to_shared" ||
          action.type === "set_visibility"
            ? (action.visibility as typeof project.visibility)
            : project.visibility,
        currentUserRole:
          action.type === "transfer_ownership"
            ? "administrator"
            : project.currentUserRole,
        version: project.version + 1,
        updatedAt: now,
      };
      if (action.type === "set_member_role") {
        members = members.map((member) =>
          member.userId === action.userId
            ? {
                ...member,
                role: action.role as "administrator" | "researcher",
                version: member.version + 1,
              }
            : member,
        );
      }
      if (action.type === "remove_member") {
        members = members.filter((member) => member.userId !== action.userId);
      }
      return route.fulfill({ json: project });
    }
    return route.fallback();
  });

  await page.goto("/");
  await connectShellWorkspace(page);
  await expect(page.getByLabel("Project access")).toContainText(
    "Shared administration",
  );
  await page
    .getByLabel("Project access")
    .getByRole("button", { name: "Accept" })
    .click();
  await expect(page.getByLabel("Project access")).toContainText(
    "Invitation accepted.",
  );
  await page
    .getByLabel("Project access")
    .getByRole("button", { name: "Join as Researcher" })
    .click();
  await expect(page.getByLabel("Project access")).toContainText(
    "Joined Open research room as Researcher.",
  );

  await page.getByRole("button", { name: "Project Settings" }).click();
  const governance = page.getByLabel("Project governance");
  await expect(governance).toContainText("personal · private · version 1");
  await governance
    .getByRole("button", { name: "Convert once to shared" })
    .click();
  await expect(governance).toContainText(
    "shared · invitation_only · version 2",
  );
  await governance.getByLabel("Visibility").selectOption("open_to_join");
  await expect(governance).toContainText("open_to_join · version 3");

  await governance.getByLabel("Invite @handle").fill("new_researcher");
  await governance.getByLabel("Proposed role").selectOption("researcher");
  await governance.getByRole("button", { name: "Create invitation" }).click();
  await expect(governance).toContainText("Pending @new_researcher");
  await governance.getByRole("button", { name: "Revoke" }).click();
  await expect(governance).not.toContainText("Pending @new_researcher");

  await governance
    .getByLabel("Role for @role_researcher")
    .selectOption("administrator");
  expect(governanceActions).toContainEqual(
    expect.objectContaining({
      type: "set_member_role",
      userId: researcherId,
      role: "administrator",
      expectedMemberVersion: 1,
    }),
  );
  await governance
    .locator("li")
    .filter({ hasText: "@role_researcher" })
    .getByRole("button", { name: "Remove" })
    .click();
  await governance
    .getByRole("button", { name: "Transfer ownership" })
    .last()
    .click();
  await expect(governance).toContainText("administrator");
  expect(invitationCommands).toEqual([
    expect.objectContaining({ handle: "new_researcher", role: "researcher" }),
  ]);
  expect(governanceActions.map((action) => action.type)).toEqual([
    "convert_to_shared",
    "set_visibility",
    "set_member_role",
    "remove_member",
    "transfer_ownership",
  ]);
  await expect(governance).toContainText("project converted");
});

test("opens verified artifacts first and restores bounded source navigation", async ({
  page,
}) => {
  const fixture = await mockNavigationWorkspace(page);
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${navigationUserId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Active project")).toHaveValue(
    navigationProjectId,
  );

  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  await page.getByLabel("Language view").selectOption("english");
  await page.keyboard.press("Control+f");
  await expect(page.getByLabel("Search transcript")).toBeFocused();
  await page.getByLabel("Search transcript").fill("word");
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(2);
  await expect(page.locator(".transcript-token.search-match")).toHaveCount(2);
  await page.getByLabel("Search transcript").press("Enter");
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await page.getByLabel("Search transcript").press("Shift+Enter");
  await expect(page.getByText("1 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next match" }).click();
  await page.getByLabel("Search transcript").press("Escape");
  await expect(page.getByLabel("Search transcript")).toHaveValue("word");
  await expect(page.getByLabel("Search transcript")).not.toBeFocused();
  await page.keyboard.press("Meta+f");
  await expect(page.getByLabel("Search transcript")).toBeFocused();
  await selectDirectFixturePassage(page);

  const directFrame = page
    .frames()
    .find((frame) =>
      frame.url().includes(`/embed/${directVideo.youtubeVideoId}`),
    );
  if (!directFrame) throw new Error("Expected the direct-video player frame.");
  await directFrame.evaluate(
    (targetOrigin) =>
      window.parent.postMessage(
        JSON.stringify({ info: { currentTime: 1.25 } }),
        targetOrigin,
      ),
    new URL(page.url()).origin,
  );
  await expect(page.locator(".video-details strong")).toHaveText("0:01");

  await page
    .getByLabel("Project destinations")
    .getByRole("button", { name: "Logged" })
    .click();
  const directCard = page.locator(".clip-card").filter({
    hasText: directVideo.title,
  });
  const romanianCard = page.locator(".clip-card").filter({
    hasText: romanianVideo.title,
  });
  await expect(directCard).toBeVisible();
  await directCard.getByRole("button", { name: "Open clip" }).click();
  await expect
    .poll(() => fixture.artifactResolutionRequests)
    .toContain(navigationDirectClipId);
  await expect
    .poll(() => fixture.artifactOpenRequests)
    .toContain(navigationDirectLocatorId);
  await expect(
    page.getByRole("button", { name: "Logged", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await romanianCard.getByRole("button", { name: "Open clip" }).click();
  await expect
    .poll(() => fixture.artifactOpenRequests)
    .toContain(navigationRomanianLocatorId);
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText(/compatible local artifact could not be freshly verified/u),
  ).toBeVisible();
  await expect(page.getByText("Looping logged clip 0:00–0:04")).toBeVisible();
  await expect(page.getByLabel("Clip selection")).toContainText(
    navigationRomanianSelection.text,
  );

  const romanianFrame = page
    .frames()
    .find((frame) =>
      frame.url().includes(`/embed/${romanianVideo.youtubeVideoId}`),
    );
  if (!romanianFrame)
    throw new Error("Expected the Romanian-video player frame.");
  await expect
    .poll(() =>
      romanianFrame.evaluate(
        () =>
          (
            window as typeof window & {
              __receivedPlayerCommands?: Array<{ func?: string }>;
            }
          ).__receivedPlayerCommands?.map((command) => command.func) ?? [],
      ),
    )
    .toEqual(expect.arrayContaining(["seekTo", "playVideo"]));
  const seekCountBeforeLoop = await romanianFrame.evaluate(
    () =>
      (
        window as typeof window & {
          __receivedPlayerCommands?: Array<{ func?: string }>;
        }
      ).__receivedPlayerCommands?.filter((command) => command.func === "seekTo")
        .length ?? 0,
  );
  await romanianFrame.evaluate(
    (targetOrigin) =>
      window.parent.postMessage(
        JSON.stringify({ info: { currentTime: 4.2 } }),
        targetOrigin,
      ),
    new URL(page.url()).origin,
  );
  await expect
    .poll(() =>
      romanianFrame.evaluate(
        () =>
          (
            window as typeof window & {
              __receivedPlayerCommands?: Array<{ func?: string }>;
            }
          ).__receivedPlayerCommands?.filter(
            (command) => command.func === "seekTo",
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(seekCountBeforeLoop);

  await expect
    .poll(() =>
      page.evaluate(
        ({ userId, projectId }) => {
          const raw = localStorage.getItem(
            `vera:navigation:v1:${userId}:${projectId}`,
          );
          if (!raw) return undefined;
          const record = JSON.parse(raw) as {
            backStack?: Array<{ matchIndex?: number }>;
          };
          return record.backStack?.at(-1)?.matchIndex;
        },
        { userId: navigationUserId, projectId: navigationProjectId },
      ),
    )
    .toBe(1);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Current source")).toContainText(
    directVideo.title,
  );
  await expect(page.getByLabel("Search transcript")).toHaveValue("word");
  await expect(page.getByText("2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Language view")).toHaveValue("english");
  await expect(page.getByLabel("Clip selection")).toContainText(
    navigationDirectSelection.text,
  );
  await expect(page.locator(".video-details strong")).toHaveText("0:01");

  await page.waitForTimeout(350);
  fixture.setTranscriptVersion(
    directVideo.id,
    "019fbb95-cd76-7920-93fa-e23ba755ee90",
  );
  await page.reload();
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${navigationUserId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(
    page.getByText(
      /discarded its selection because the active transcript version changed/u,
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Search transcript")).toHaveValue("word");
  await expect(page.getByLabel("Language view")).toHaveValue("english");
  await expect(page.locator(".video-details strong")).toHaveText("0:01");
  await expect(page.getByLabel("Clip selection")).toHaveCount(0);

  await page
    .getByLabel("Project destinations")
    .getByRole("button", { name: "Logged" })
    .click();
  await page
    .locator(".clip-card")
    .filter({ hasText: romanianVideo.title })
    .getByRole("button", { name: "Open clip" })
    .click();
  await expect(page.getByRole("button", { name: "Back" })).toBeEnabled();
  await page
    .getByLabel("Active project")
    .selectOption(navigationOtherProjectId);
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
});

test("discards removed private navigation identities without requesting them", async ({
  page,
}) => {
  await page.addInitScript(
    ({ userId, projectId, snapshot }) => {
      localStorage.setItem(`vera:recent-project:${userId}`, projectId);
      localStorage.setItem(
        `vera:navigation:v1:${userId}:${projectId}`,
        JSON.stringify({ schemaVersion: 1, current: snapshot, backStack: [] }),
      );
    },
    {
      userId: navigationUserId,
      projectId: navigationProjectId,
      snapshot: {
        schemaVersion: 1,
        projectId: navigationProjectId,
        catalogVideoId: romanianVideo.id,
        youtubeVideoId: romanianVideo.youtubeVideoId,
        canonicalUrl: romanianVideo.canonicalUrl,
        title: romanianVideo.title,
        transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee54",
        currentMs: 2_000,
        transcriptView: "english",
        query: "Romanian",
        matchIndex: 0,
        selection: navigationRomanianSelection,
      },
    },
  );
  const fixture = await mockNavigationWorkspace(page, {
    authorizedVideos: [directVideo],
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill(`Bearer ${navigationUserId}|fixture:web`);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Active project")).toHaveValue(
    navigationProjectId,
  );
  await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
  await expect
    .poll(() => fixture.transcriptRequests.includes(romanianVideo.id))
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        ({ userId, projectId }) =>
          localStorage.getItem(`vera:navigation:v1:${userId}:${projectId}`),
        { userId: navigationUserId, projectId: navigationProjectId },
      ),
    )
    .toBeNull();
});

test("keeps verified offline cache review readable but blocks logged work", async ({
  page,
}) => {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee60";
  await mockAuthenticatedWorkspace(page, {
    projectId,
    preferredLanguage: "en",
    workspace: {
      ...workspaceFixture({
        projectId,
        video: romanianVideo,
        preferredLanguage: "en",
      }),
      catalogState: "offline_cached",
    },
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Active project")).toHaveValue(projectId);
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(romanianVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(page.getByText("This is a Romanian example.")).toBeVisible();
  await page.getByLabel("Language view").selectOption("original");
  await expect(
    page.getByText("Acesta este un exemplu românesc."),
  ).toBeVisible();
  await page.getByLabel("Language view").selectOption("english");
  await expect(page.getByText("This is a Romanian example.")).toBeVisible();
  await selectFirstTwoTranscriptRows(page);
  await expect(
    page.getByText(
      "This is verified offline cache review. Reconnect to confirm the current project transcript; Log clip and Log and export are unavailable until then.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log clip" })).toBeDisabled();
  await openMoreClipActions(page);
  await expect(
    page.getByRole("menuitem", { name: "Log and export" }),
  ).toBeDisabled();
});

test("keeps English explicit when preferred translation is unavailable", async ({
  page,
}) => {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee61";
  const workspace = workspaceFixture({
    projectId,
    video: romanianVideo,
    preferredLanguage: "es-MX",
  });
  await mockAuthenticatedWorkspace(page, {
    projectId,
    preferredLanguage: "es-MX",
    workspace: {
      ...workspace,
      preferred: {
        state: "preferred_translation_unavailable",
        targetLanguage: "es-MX",
        reason: "No verified Spanish translation is published.",
      },
    },
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(romanianVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();

  await expect(page.getByLabel("Language view")).toHaveValue("english");
  await expect(page.getByText("This is a Romanian example.")).toBeVisible();
  await expect(
    page.getByLabel("Language view").locator("option[value=preferred]"),
  ).toHaveAttribute("disabled", "");
  await expect(
    page.getByText(
      "Preferred translation unavailable for Spanish (Mexico) (es-MX). Original and English remain available; logging waits for the required preferred evidence.",
    ),
  ).toBeVisible();
  await page.getByLabel("Language view").selectOption("original");
  await expect(
    page.getByText("Acesta este un exemplu românesc."),
  ).toBeVisible();
  await page.getByLabel("Language view").selectOption("english");
  await selectFirstTwoTranscriptRows(page);
  await expect(page.getByRole("button", { name: "Log clip" })).toBeDisabled();
  await openMoreClipActions(page);
  await expect(
    page.getByRole("menuitem", { name: "Log and export" }),
  ).toBeDisabled();
});

test("marks guarded player ranges, attaches overlap explicitly, and logs attested no-speech with context", async ({
  page,
}) => {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ef61";
  const now = "2026-08-24T12:00:00.000Z";
  let clipPostCount = 0;
  let postedClip: Record<string, any> | undefined;
  await mockAuthenticatedWorkspace(page, {
    projectId,
    preferredLanguage: "en",
    workspace: workspaceFixture({
      projectId,
      video: directVideo,
      preferredLanguage: "en",
    }),
  });
  await page.route(
    `**/cloud-api/api/projects/${projectId}/clips`,
    async (route) => {
      if (route.request().method() !== "POST") {
        return route.fulfill({ json: [] });
      }
      clipPostCount += 1;
      postedClip = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ef62",
          projectId,
          catalogVideoId: directVideo.id,
          video: postedClip!.video,
          selection: postedClip!.selection,
          languageEvidence: {
            schemaVersion: 3,
            state: "unavailable",
            reason: "no_speech",
          },
          notes: postedClip!.notes,
          tags: postedClip!.tags,
          researchStatus: "candidate",
          exportStatus: "not_requested",
          createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
    },
  );

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText(/Duration: 2:00/u)).toBeVisible();

  await postFixturePlayerInfo(page, { currentTime: 0.3, duration: 120 });
  const transcriptSearchInput = page.getByLabel("Search transcript");
  await transcriptSearchInput.focus();
  await page.keyboard.press("i");
  await expect(page.getByTestId("player-range-bounds")).toContainText(
    "In: not set",
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "i", repeat: true, bubbles: true }),
    ),
  );
  await page.keyboard.press("Shift+i");
  await expect(page.getByTestId("player-range-bounds")).toContainText(
    "In: not set",
  );
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("i");
  await expect(page.getByTestId("player-range-bounds")).toContainText(
    "In: 0:00",
  );

  await postFixturePlayerInfo(page, { currentTime: 2.9 });
  await transcriptSearchInput.focus();
  await page.keyboard.press("o");
  await expect(page.getByTestId("player-range-bounds")).toContainText(
    "Out: not set",
  );
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("o");
  await expect(page.getByTestId("player-range-bounds")).toContainText(
    "Out: 0:02",
  );

  await page.getByLabel("Speech", { exact: true }).check();
  await page
    .getByRole("button", { name: "Attach overlapping transcript" })
    .click();
  await expect(page.getByLabel("Clip selection")).toContainText(
    "evidence attached with word precision; player provenance is unchanged",
  );
  await page.getByLabel("No speech", { exact: true }).check();
  await expect(page.getByLabel("Clip selection")).toContainText(
    "No speech clips require a description or atomic first comment",
  );
  await expect(page.getByLabel("Clip selection")).not.toContainText(
    "evidence attached with word precision",
  );

  await page.getByRole("button", { name: "Log clip" }).click();
  await expect(page.getByLabel("Clip selection")).toContainText(
    "No-speech and transcript-unavailable clips require a description or first comment.",
  );
  expect(clipPostCount).toBe(0);
  await page
    .getByLabel("Clip description / intended use")
    .fill("Silent visual bridge for the opening montage.");
  await page.getByRole("button", { name: "Log clip" }).click();
  await expect(
    page.getByLabel("Clip selection").getByRole("button", { name: "Logged" }),
  ).toBeDisabled();
  expect(clipPostCount).toBe(1);
  expect(postedClip?.selection).toMatchObject({
    selectionType: "player_time_range",
    sourceStartMs: 300,
    sourceEndMs: 2_900,
    exportStartMs: 300,
    exportEndMs: 2_900,
    origin: "manual_player",
    speechStatus: "no_speech",
    noSpeechAttestation: {
      schemaVersion: 1,
      actor: {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        handle: "e2e_user",
        displayName: "E2E User",
      },
    },
  });
  expect(postedClip).not.toHaveProperty("languageEvidence");
});

test("maps transcript text selection to stable source and export bounds", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const now = "2026-08-01T12:00:00.000Z";
  const existingProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
  const createdProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
  const personalPresetId = "019fbb95-cd76-7920-93fa-e23ba755ee48";
  const existingProjectPresetId = "019fbb95-cd76-7920-93fa-e23ba755ee49";
  const createdProjectPresetId = "019fbb95-cd76-7920-93fa-e23ba755ee50";
  const presetSettings = {
    container: "mp4",
    videoCodec: "h264",
    videoRateControl: { mode: "crf", value: 18 },
    maxWidth: 1_280,
    frameRate: "source",
    audioCodec: "aac",
    audioKilobitsPerSecond: 160,
    omitSubtitleFilesForConfirmedEnglish: false,
    embedEnglishSubtitleTrack: false,
  };
  const presetEntry = (
    id: string,
    scope: "personal" | "project",
    name: string,
    projectId?: string,
  ) => ({
    id,
    scope,
    ...(projectId ? { projectId } : {}),
    currentVersion: 1,
    entityVersion: 1,
    current: {
      presetId: id,
      presetVersion: 1,
      name,
      description: `${name} description`,
      settings: presetSettings,
      createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
      createdAt: now,
    },
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    createdAt: now,
    updatedAt: now,
  });
  const presetDefault = (
    id: string,
    scope: "personal" | "project",
    name: string,
    projectId?: string,
  ) => ({
    scope,
    ...(projectId ? { projectId } : {}),
    presetId: id,
    presetVersion: 1,
    entityVersion: 1,
    snapshot: {
      presetId: id,
      presetVersion: 1,
      name,
      settings: presetSettings,
    },
    description: `${name} description`,
    updatedBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    createdAt: now,
    updatedAt: now,
  });
  const settingsPreview = (
    body: Record<string, any>,
    context: "logged" | "export_only",
    projectPresetId?: string,
  ) => {
    const selected = body.selection.selectedPreset as
      | {
          scope: "personal" | "project";
          presetId: string;
          presetVersion: number;
        }
      | undefined;
    const selectedName =
      selected?.presetId === personalPresetId
        ? "Personal Documentary"
        : selected?.presetId === createdProjectPresetId
          ? "New Essay Edit"
          : selected?.presetId === existingProjectPresetId
            ? "Existing Project Edit"
            : undefined;
    const settings = {
      container: "mp4",
      videoCodec: "h264",
      videoRateControl: { mode: "crf", value: 20 },
      frameRate: "source",
      audioCodec: "aac",
      omitSubtitleFilesForConfirmedEnglish:
        body.selection.overrides.omitSubtitleFilesForConfirmedEnglish ?? false,
      embedEnglishSubtitleTrack: false,
    };
    const snapshot = {
      schemaVersion: 1,
      resolutionKind: "catalog",
      context,
      base: body.selection.base,
      applicationDefaultVersion: 1,
      ...(projectPresetId
        ? {
            contextDefault: {
              presetId: projectPresetId,
              presetVersion: 1,
              name:
                projectPresetId === createdProjectPresetId
                  ? "New Essay Edit"
                  : "Existing Project Edit",
              settings: presetSettings,
            },
          }
        : {}),
      ...(selected
        ? {
            selectedPreset: {
              presetId: selected.presetId,
              presetVersion: selected.presetVersion,
              name: selectedName,
              settings: presetSettings,
            },
            selectedPresetScope: selected.scope,
          }
        : {}),
      overrides: body.selection.overrides,
      overrideFields: Object.keys(body.selection.overrides),
      settings,
      capability: {
        ...CURRENT_EXPORT_WORKER_CAPABILITY,
        validation: "validated",
      },
      resolvedAt: now,
    };
    const { resolvedAt: _resolvedAt, ...stableSnapshot } = snapshot;
    return {
      snapshot: {
        ...snapshot,
        resolutionFingerprint: sha256Fingerprint(stableSnapshot),
      },
      issues: [],
      effectiveSubtitlePolicy:
        body.sourceLanguageClass === "confirmed_english" &&
        settings.omitSubtitleFilesForConfirmedEnglish
          ? {
              requiredSidecars: [],
              subtitleSidecarsOmittedReason: "confirmed_english_user_setting",
            }
          : {
              requiredSidecars:
                body.sourceLanguageClass === "confirmed_english"
                  ? ["english"]
                  : ["original", "english"],
            },
    };
  };
  const batchResponse = (body: Record<string, any>) => ({
    id: "019fbb95-cd76-7920-93fa-e23ba755eeb4",
    projectId: createdProjectId,
    createdAt: now,
    summary: {
      total: 2,
      queued: 2,
      claimed: 0,
      processing: 0,
      needsUserAction: 0,
      complete: 0,
      failed: 0,
      canceled: 0,
      status: "active",
    },
    items: body.items.map((item: Record<string, any>, index: number) => ({
      id: [
        "019fbb95-cd76-7920-93fa-e23ba755eeb5",
        "019fbb95-cd76-7920-93fa-e23ba755eeb6",
      ][index],
      batchId: "019fbb95-cd76-7920-93fa-e23ba755eeb4",
      ordinal: index,
      clipId: item.clipId,
      rootRequestId: [
        "019fbb95-cd76-7920-93fa-e23ba755eeb7",
        "019fbb95-cd76-7920-93fa-e23ba755eeb8",
      ][index],
      currentRequest: {
        id: [
          "019fbb95-cd76-7920-93fa-e23ba755eeb7",
          "019fbb95-cd76-7920-93fa-e23ba755eeb8",
        ][index],
        jobId: [
          "019fbb95-cd76-7920-93fa-e23ba755eeb9",
          "019fbb95-cd76-7920-93fa-e23ba755eeba",
        ][index],
        state: "queued",
      },
    })),
  });
  let clipPostCount = 0;
  let loggedExportPostCount = 0;
  let exportOnlyPostCount = 0;
  let batchExportPostCount = 0;
  let artifactResolutionPostCount = 0;
  let artifactOpenPostCount = 0;
  const artifactActions: string[] = [];
  let batchFixtureEnabled = false;
  const artifactVersionId = "019fbb95-cd76-7920-93fa-e23ba755eec1";
  const artifactLocatorId = "019fbb95-cd76-7920-93fa-e23ba755eec2";
  const artifactRootId = "019fbb95-cd76-7920-93fa-e23ba755eec3";
  const recoveryRootId = "019fbb95-cd76-7920-93fa-e23ba755eec6";
  const clipLibrarySelected = new Set<string>();
  let loggedClip: Record<string, unknown> | undefined;
  let clipComments: Record<string, unknown>[] = [];
  let lastClipBody: Record<string, any> | undefined;
  let lastLoggedExportBody: Record<string, any> | undefined;
  let lastExportOnlyBody: Record<string, any> | undefined;
  let lastBatchExportBody: Record<string, any> | undefined;
  let failExistingPresetDiscovery = false;
  await page.route("**/cloud-api/api/session/profile", async (route) => {
    const request = route.request();
    const body = request.method() === "PATCH" ? request.postDataJSON() : {};
    return route.fulfill({
      json: {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        externalSubject: "fixture:e2e-user",
        handle: "e2e_user",
        displayName: "E2E User",
        preferredLanguage: body.preferredLanguage ?? "en",
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.route("**/cloud-api/api/export-presets", async (route) => {
    return route.fulfill({
      json: {
        presets: [
          presetEntry(personalPresetId, "personal", "Personal Documentary"),
        ],
        default: presetDefault(
          personalPresetId,
          "personal",
          "Personal Documentary",
        ),
      },
    });
  });
  await page.route("**/cloud-api/api/projects**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/cloud-api/api/projects") {
      return route.fulfill({
        json:
          request.method() === "POST"
            ? {
                id: createdProjectId,
                name: "New essay",
                description: "Created without losing the selection",
                kind: "shared",
                visibility: "invitation_only",
                currentUserRole: "owner",
                memberCount: 1,
                version: 1,
                createdAt: now,
                updatedAt: now,
              }
            : [
                {
                  id: existingProjectId,
                  name: "Existing essay",
                  description: "",
                  kind: "shared",
                  visibility: "invitation_only",
                  currentUserRole: "owner",
                  memberCount: 1,
                  version: 1,
                  createdAt: now,
                  updatedAt: now,
                },
              ],
      });
    }
    if (
      path === `/cloud-api/api/projects/${existingProjectId}/videos` ||
      path === `/cloud-api/api/projects/${createdProjectId}/videos`
    ) {
      return route.fulfill({
        json: [
          projectVideoFixture(directVideo, now),
          projectVideoFixture(romanianVideo, now),
        ],
      });
    }
    if (
      path === `/cloud-api/api/projects/${existingProjectId}/export-presets`
    ) {
      if (failExistingPresetDiscovery) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "preset_catalog_unavailable",
              message: "Project presets are temporarily unavailable.",
              retryable: true,
            },
          },
        });
      }
      return route.fulfill({
        json: {
          projectPresets: [
            presetEntry(
              existingProjectPresetId,
              "project",
              "Existing Project Edit",
              existingProjectId,
            ),
          ],
          projectDefault: presetDefault(
            existingProjectPresetId,
            "project",
            "Existing Project Edit",
            existingProjectId,
          ),
          personalPresets: [
            presetEntry(personalPresetId, "personal", "Personal Documentary"),
          ],
          personalDefault: presetDefault(
            personalPresetId,
            "personal",
            "Personal Documentary",
          ),
        },
      });
    }
    if (
      path ===
      `/cloud-api/api/projects/${existingProjectId}/export-settings/preview`
    ) {
      return route.fulfill({
        json: settingsPreview(
          request.postDataJSON(),
          "logged",
          existingProjectPresetId,
        ),
      });
    }
    if (path === `/cloud-api/api/projects/${createdProjectId}/export-presets`) {
      return route.fulfill({
        json: {
          projectPresets: [
            presetEntry(
              createdProjectPresetId,
              "project",
              "New Essay Edit",
              createdProjectId,
            ),
          ],
          projectDefault: presetDefault(
            createdProjectPresetId,
            "project",
            "New Essay Edit",
            createdProjectId,
          ),
          personalPresets: [
            presetEntry(personalPresetId, "personal", "Personal Documentary"),
          ],
          personalDefault: presetDefault(
            personalPresetId,
            "personal",
            "Personal Documentary",
          ),
        },
      });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/export-settings/preview`
    ) {
      return route.fulfill({
        json: settingsPreview(
          request.postDataJSON(),
          "logged",
          createdProjectPresetId,
        ),
      });
    }
    if (path === `/cloud-api/api/projects/${createdProjectId}/clips`) {
      if (request.method() === "GET") {
        return route.fulfill({
          json:
            batchFixtureEnabled && loggedClip
              ? [
                  loggedClip,
                  {
                    ...loggedClip,
                    id: "019fbb95-cd76-7920-93fa-e23ba755eeb2",
                    catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755eeb3",
                    video: {
                      ...(loggedClip.video as Record<string, unknown>),
                      title: "Second batch sibling",
                    },
                  },
                ]
              : loggedClip
                ? [loggedClip]
                : [],
        });
      }
      clipPostCount += 1;
      const body = request.postDataJSON();
      lastClipBody = body;
      loggedClip = {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        projectId: createdProjectId,
        catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
        video: body.video,
        selection: body.selection,
        languageEvidence: body.languageEvidence,
        englishText: body.languageEvidence.english.text,
        ...(body.languageEvidence.native.trackId ===
        body.languageEvidence.english.trackId
          ? {}
          : { originalText: body.languageEvidence.native.text }),
        notes: body.notes,
        tags: ["Opening", "Person: Ada"],
        researchStatus: "candidate",
        exportStatus: "not_requested",
        createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      return route.fulfill({
        status: 201,
        json: loggedClip,
      });
    }
    if (path === `/cloud-api/api/projects/${createdProjectId}/clip-tags`) {
      return route.fulfill({
        json: ["Opening", "Person: Ada", "Theme: Institutions"],
      });
    }
    if (path === `/cloud-api/api/projects/${createdProjectId}/clips.csv`) {
      return route.fulfill({
        contentType: "text/csv",
        body: '"project_id","clip_id"\r\n"019fbb95-cd76-7920-93fa-e23ba755ee41","019fbb95-cd76-7920-93fa-e23ba755ee42"\r\n',
      });
    }
    if (
      path === `/cloud-api/api/projects/${createdProjectId}/clip-comments.csv`
    ) {
      return route.fulfill({
        contentType: "text/csv",
        body: '"project_id","clip_id","comment_id"\r\n',
      });
    }
    if (
      path ===
      `/local-agent/api/projects/${createdProjectId}/clip-comment-outbox/replay`
    ) {
      return route.fulfill({
        json: { applied: 0, queued: 0, conflicts: 0 },
      });
    }
    if (
      path ===
        `/local-agent/api/projects/${createdProjectId}/clips/019fbb95-cd76-7920-93fa-e23ba755ee42/comments` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON();
      const comment = {
        id: "019fbb95-cd76-7920-93fa-e23ba755eec8",
        projectId: createdProjectId,
        clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        author: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          handle: "pilot_researcher",
          displayName: "Pilot Researcher",
        },
        mentions: [],
        status: "active",
        body: body.body,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      clipComments = [...clipComments, comment];
      return route.fulfill({
        status: 201,
        json: {
          state: "applied",
          outboxId: "019fbb95-cd76-7920-93fa-e23ba755eec9",
          comment,
        },
      });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/clips/019fbb95-cd76-7920-93fa-e23ba755ee42/comments`
    ) {
      if (request.method() === "GET") {
        return route.fulfill({
          json: {
            projectId: createdProjectId,
            clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
            comments: clipComments,
            fetchedAt: now,
          },
        });
      }
      const body = request.postDataJSON();
      const comment = {
        id: "019fbb95-cd76-7920-93fa-e23ba755eec8",
        projectId: createdProjectId,
        clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        author: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          handle: "pilot_researcher",
          displayName: "Pilot Researcher",
        },
        mentions: [],
        status: "active",
        body: body.body,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      clipComments = [...clipComments, comment];
      return route.fulfill({ status: 201, json: comment });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/clips/019fbb95-cd76-7920-93fa-e23ba755ee42/follow`
    ) {
      const body = request.postDataJSON();
      return route.fulfill({
        json: {
          projectId: createdProjectId,
          clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          following: body.following,
          version: 1,
          updatedAt: now,
        },
      });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/clips/019fbb95-cd76-7920-93fa-e23ba755ee42`
    ) {
      const body = request.postDataJSON();
      loggedClip = {
        ...loggedClip,
        notes: body.notes,
        tags: body.tags,
        version: Number(loggedClip?.version ?? 1) + 1,
        updatedAt: now,
      };
      return route.fulfill({ json: loggedClip });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/clips/019fbb95-cd76-7920-93fa-e23ba755ee42/exports`
    ) {
      loggedExportPostCount += 1;
      const body = request.postDataJSON();
      lastLoggedExportBody = body;
      return route.fulfill({
        status: 201,
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee44",
          jobId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
          mode: "logged",
          projectId: createdProjectId,
          clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          video: {
            youtubeVideoId: directVideo.youtubeVideoId,
            canonicalUrl: directVideo.canonicalUrl,
            title: directVideo.title,
          },
          selection: body.selection ?? {
            trackId: "019fbb95-cd76-7920-93fa-e23ba755e301",
            transcriptVersion: 1,
            firstSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e311",
            lastSegmentId: "019fbb95-cd76-7920-93fa-e23ba755e312",
            firstTokenId: "019fbb95-cd76-7920-93fa-e23ba755e322",
            lastTokenId: "019fbb95-cd76-7920-93fa-e23ba755e326",
            transcriptStartMs: 300,
            transcriptEndMs: 2_900,
            exportStartMs: 0,
            exportEndMs: 3_400,
            text: "fixture has accurate word timing. Click any word",
            timingPrecision: "word",
          },
          sourceLanguageClass: body.sourceLanguageClass,
          preset: {
            presetId: createdProjectPresetId,
            presetVersion: 1,
            name: "New Essay Edit",
            settings: presetSettings,
          },
          state: "queued",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (
      path === `/cloud-api/api/projects/${createdProjectId}/export-batches` &&
      request.method() === "POST"
    ) {
      batchExportPostCount += 1;
      const body = request.postDataJSON();
      return route.fulfill({
        status: 201,
        json: batchResponse(body),
      });
    }
    if (
      path ===
      `/cloud-api/api/projects/${createdProjectId}/export-batches/019fbb95-cd76-7920-93fa-e23ba755eeb4`
    ) {
      return route.fulfill({
        json: batchResponse({
          items: [
            { clipId: String(loggedClip?.id) },
            { clipId: "019fbb95-cd76-7920-93fa-e23ba755eeb2" },
          ],
        }),
      });
    }
    if (path.endsWith("/transcription-batches")) {
      return route.fulfill({ json: { batches: [] } });
    }
    if (path.endsWith("/review-inbox")) {
      return route.fulfill({ json: { items: [] } });
    }
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/local-agent/api/artifact-roots", async (route) => {
    return route.fulfill({
      json: {
        roots: [
          {
            id: artifactRootId,
            label: "Managed exports",
            platform: "posix",
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: recoveryRootId,
            label: "Recovery exports",
            platform: "posix",
            enabled: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split("/");
      const projectId = parts[4]!;
      const catalogVideoId = parts[6]!;
      const video =
        catalogVideoId === romanianVideo.id ? romanianVideo : directVideo;
      return route.fulfill({
        json: workspaceFixture({
          projectId,
          video,
          preferredLanguage: url.searchParams.get("preferredLanguage") ?? "en",
        }),
      });
    },
  );
  await page.route(
    "**/local-agent/api/projects/*/clips/*/artifact-resolution",
    async (route) => {
      artifactResolutionPostCount += 1;
      return route.fulfill({
        json: {
          state: "reusable_local",
          artifactVersionId,
          locator: artifactLocatorFixture(
            artifactLocatorId,
            artifactVersionId,
            artifactRootId,
            now,
          ),
          freshness: "fresh",
        },
      });
    },
  );
  await page.route("**/local-agent/api/artifact-locators/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1);
    artifactActions.push(String(action));
    if (action === "open") artifactOpenPostCount += 1;
    const locator = artifactLocatorFixture(
      artifactLocatorId,
      artifactVersionId,
      artifactRootId,
      now,
    );
    return route.fulfill({
      json: action === "relink" ? locator : { locator, freshness: "fresh" },
    });
  });
  await page.route(
    "**/local-agent/api/projects/*/clip-library**",
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const projectId = path.split("/")[4]!;
      if (path.endsWith("/selection")) {
        const body = request.postDataJSON();
        for (const clipId of body.pageClipIds as string[]) {
          if ((body.selectedClipIds as string[]).includes(clipId))
            clipLibrarySelected.add(clipId);
          else clipLibrarySelected.delete(clipId);
        }
        return route.fulfill({
          json: {
            selectedClipIds: [...clipLibrarySelected],
          },
        });
      }
      if (path.endsWith("/export-preflight")) {
        const body = request.postDataJSON();
        const outputEstimatedBytes = 150_000_000 * body.clipIds.length;
        const preview = settingsPreview(
          {
            sourceLanguageClass: "foreign",
            selection: body.settingsSelection,
          },
          "logged",
          createdProjectPresetId,
        );
        return route.fulfill({
          json: {
            schemaVersion: 1,
            projectId,
            preflightFingerprint: "a".repeat(64),
            checkedAt: now,
            availableBytes: 8_000_000_000,
            uniqueSourceCount: 1,
            sourceSharingAssurance: "same_worker_profile_only",
            knownSourceBytes: 0,
            unknownSourceCount: 1,
            outputEstimatedBytes,
            promotionReserveBytes: outputEstimatedBytes,
            activeCheckpointReserveBytes: 0,
            safetyReserveBytes: 2_147_483_648,
            knownRequiredBytes: outputEstimatedBytes * 2 + 2_147_483_648,
            decision: "confirmation_required",
            items: body.clipIds.map((clipId: string) => ({
              clipId,
              sourceLanguageClass: "foreign",
              resolvedSettingsSnapshot: preview.snapshot,
              outputEstimatedBytes: 150_000_000,
            })),
          },
        });
      }
      if (path.endsWith("/exports") && request.method() === "POST") {
        batchExportPostCount += 1;
        const body = request.postDataJSON();
        lastBatchExportBody = body;
        return route.fulfill({
          status: 201,
          json: {
            kind: "batch",
            batch: batchResponse({
              items: body.clipIds.map((clipId: string) => ({ clipId })),
            }),
          },
        });
      }
      const pageClips =
        projectId === createdProjectId && loggedClip
          ? batchFixtureEnabled
            ? [
                loggedClip,
                {
                  ...loggedClip,
                  id: "019fbb95-cd76-7920-93fa-e23ba755eeb2",
                  catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755eeb3",
                  video: {
                    ...(loggedClip.video as Record<string, unknown>),
                    title: "Second batch sibling",
                  },
                },
              ]
            : [loggedClip]
          : [];
      const entries = pageClips.map((clip, index) => ({
        clip,
        currentLeaves: [],
        hasMoreLeaves: false,
        completedVersionCount: batchFixtureEnabled && index === 0 ? 1 : 0,
        recentArtifactVersions:
          batchFixtureEnabled && index === 0
            ? [artifactVersionFixture(clip, artifactVersionId, now)]
            : [],
      }));
      return route.fulfill({
        json: {
          projectId,
          entries,
          syncCursor: "1",
          fetchedAt: now,
          query: {
            limit: Number(
              new URL(request.url()).searchParams.get("limit") ?? 25,
            ),
            completed:
              new URL(request.url()).searchParams.get("completed") ?? "any",
          },
          freshness: "fresh",
          cachedAt: now,
          cacheCoverage: "cached_subset",
          selectedClipIds: pageClips
            .map((clip) => String(clip.id))
            .filter((clipId) => clipLibrarySelected.has(clipId)),
          localAvailability:
            batchFixtureEnabled && pageClips.length
              ? [
                  {
                    artifactVersionId,
                    locators: [
                      artifactLocatorFixture(
                        artifactLocatorId,
                        artifactVersionId,
                        artifactRootId,
                        now,
                      ),
                    ],
                  },
                ]
              : [],
        },
      });
    },
  );
  await page.route(
    "**/local-agent/api/export-settings/preview",
    async (route) => {
      const preview = settingsPreview(
        route.request().postDataJSON(),
        "export_only",
      );
      return route.fulfill({
        json: {
          ...preview,
          workerAvailability: {
            discovery: "installed",
            availableRendererIds: ["h264_mp4", "prores_mov"],
            unavailableRendererIds: ["hevc_mkv"],
            ffmpegVersion: "8.1.2",
          },
        },
      });
    },
  );
  await page.route("**/local-agent/api/exports", async (route) => {
    exportOnlyPostCount += 1;
    const body = route.request().postDataJSON();
    lastExportOnlyBody = body;
    return route.fulfill({
      status: 201,
      json: {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee46",
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee47",
        mode: "export_only",
        video: body.video,
        selection: body.selection,
        sourceLanguageClass: body.sourceLanguageClass,
        preset: {
          presetId: personalPresetId,
          presetVersion: 1,
          name: "Personal Documentary",
          settings: presetSettings,
        },
        state: "queued",
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Active project")).toHaveValue(
    existingProjectId,
  );
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();

  await page.evaluate(() => {
    const anchor = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    ).find((token) => token.textContent === "fixture");
    const focus = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    ).find((token) => token.textContent === "any word");
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent) {
      throw new Error("Expected selection fixture tokens.");
    }
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  const panel = page.getByLabel("Clip selection");
  await expect(panel).toContainText(
    "fixture has accurate word timing. Click any word",
  );
  await expect(panel).toContainText("Transcript selection: 0.300s–2.900s");
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("0.300");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("2.900");

  await page.getByRole("button", { name: "Loop preview" }).click();
  const playerFrame = page
    .frames()
    .find((frame) =>
      frame.url().startsWith("https://www.youtube-nocookie.com/embed/"),
    );
  if (!playerFrame) {
    throw new Error("Expected the isolated YouTube player frame.");
  }
  await expect
    .poll(() =>
      playerFrame.evaluate(
        () =>
          (
            window as typeof window & {
              __receivedPlayerCommands?: Array<{ func?: string }>;
            }
          ).__receivedPlayerCommands?.map((command) => command.func) ?? [],
      ),
    )
    .toEqual(expect.arrayContaining(["seekTo", "playVideo"]));
  await expect(
    page.getByRole("button", { name: "Stop preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop preview" }).click();
  await expect
    .poll(() =>
      playerFrame.evaluate(
        () =>
          (
            window as typeof window & {
              __receivedPlayerCommands?: Array<{ func?: string }>;
            }
          ).__receivedPlayerCommands?.map((command) => command.func) ?? [],
      ),
    )
    .toContain("pauseVideo");

  await page.getByRole("button", { name: "Add 0.5s handles" }).click();
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("0.000");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("3.400");
  await expect(panel).toContainText("Transcript selection: 0.300s–2.900s");

  await expect(page.getByLabel("Logging project")).toHaveValue(
    existingProjectId,
  );
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    `project:${existingProjectPresetId}:v1`,
  );
  await expect(page.getByLabel("Export-only preset")).toHaveValue(
    `personal:${personalPresetId}:v1`,
  );
  await expect(
    page
      .getByLabel("Logged export preset")
      .locator("optgroup")
      .allTextContents(),
  ).resolves.toEqual([
    "Existing Project Edit v1 — project default",
    "Personal Documentary v1 — personal default",
  ]);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("New essay");
  await page
    .getByLabel("Description (optional)")
    .fill("Created without losing the selection");
  await page.getByRole("button", { name: "Create and select project" }).click();
  await expect(page.getByLabel("Active project")).toHaveValue(createdProjectId);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  await selectDirectFixturePassage(page);
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    `project:${createdProjectPresetId}:v1`,
  );
  await expect(
    page.getByLabel("Logged export preset").locator("option").allTextContents(),
  ).resolves.not.toContain("Existing Project Edit v1 — project default");
  failExistingPresetDiscovery = true;
  await page.getByLabel("Logging project").selectOption(existingProjectId);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  await selectDirectFixturePassage(page);
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    "built-in:editing-mp4:v1",
  );
  await expect(page.getByLabel("Conversion preset picker")).toContainText(
    "Project presets are temporarily unavailable. Continue with the current valid personal selection or Editing MP4.",
  );
  await openMoreClipActions(page);
  await expect(
    page.getByRole("menuitem", { name: "Export without logging" }),
  ).toBeDisabled();
  await closeMoreClipActions(page);
  failExistingPresetDiscovery = false;
  await page.getByLabel("Logging project").selectOption(createdProjectId);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByLabel("YouTube URL or video ID")
    .fill(directVideo.canonicalUrl);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  await selectDirectFixturePassage(page);
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    `project:${createdProjectPresetId}:v1`,
  );
  await expect(panel).toContainText(
    "fixture has accurate word timing. Click any word",
  );
  await page
    .getByLabel("Clip description / intended use")
    .fill("Use this to establish the central argument.");
  await page
    .getByLabel("First comment (optional)")
    .fill("Verify the source attribution before authoring handoff.");
  await page
    .getByLabel("Topics (optional)")
    .fill("Person: Ada, Opening, person: ada");
  await page.getByRole("button", { name: "Log clip" }).click();
  await expect(panel).toContainText(
    "Logged to New essay. No export was requested.",
  );
  await expect(
    page.getByLabel("Clip selection").getByRole("button", { name: "Logged" }),
  ).toBeDisabled();
  expect(clipPostCount).toBe(1);
  expect(lastClipBody?.firstComment).toEqual({
    body: "Verify the source attribution before authoring handoff.",
  });

  await page
    .getByLabel("Project destinations")
    .getByRole("button", { name: "Logged" })
    .click();
  const clipQueue = page.getByRole("article", { name: /clip library/i });
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText(directVideo.title);
  await expect(clipQueue).toContainText(
    "Use this to establish the central argument.",
  );
  await clipQueue
    .getByRole("button", { name: "Comments", exact: true })
    .click();
  await clipQueue
    .getByPlaceholder("Use @handle to mention a current project member")
    .fill("Keep this live-thread note separate from the clip description.");
  await clipQueue.getByRole("button", { name: "Add comment" }).click();
  await expect(clipQueue).toContainText(
    "Keep this live-thread note separate from the clip description.",
  );
  await clipQueue.getByRole("button", { name: "Unfollow" }).click();
  await expect(clipQueue).toContainText("Clip unfollowed.");
  await clipQueue
    .getByRole("button", { name: "Edit description/Topics" })
    .click();
  await page
    .getByLabel(`Notes for ${directVideo.title}`)
    .fill("Use this in the revised opening.");
  await page
    .getByLabel(`Topics for ${directVideo.title}`)
    .fill("Opening, Theme: Institutions");
  await clipQueue.getByRole("button", { name: "Save clip" }).click();
  await expect(clipQueue).toContainText("Clip description and Topics saved.");
  await clipQueue
    .getByRole("combobox", { name: "Topics", exact: true })
    .fill("Theme: Institutions");
  await clipQueue.getByRole("button", { name: "Apply cloud filters" }).click();
  await expect(clipQueue).toContainText("Use this in the revised opening.");
  await clipQueue.getByLabel("Search clips").fill("institutions");
  await clipQueue.getByRole("button", { name: "Apply cloud filters" }).click();
  await expect(clipQueue).toContainText(directVideo.title);
  await clipQueue.getByRole("button", { name: "Export CSV" }).click();
  await expect(clipQueue).toContainText(
    "Downloaded the project clip log as CSV.",
  );
  await page.getByRole("button", { name: "Review", exact: true }).click();

  await page.getByText("Per-export overrides").click();
  await expect(
    page.getByLabel("Rendering family").locator("option"),
  ).toHaveText([
    "MP4 · H.264 High · AAC",
    "MKV · HEVC Main · AAC — unavailable for local export-only",
    "MOV · ProRes 422 · PCM",
  ]);
  await expect(
    page.getByLabel("Rendering family").locator("option[disabled]"),
  ).toHaveCount(0);
  await expect(
    page.getByText("Logged export availability remains canonical"),
  ).toBeVisible();
  await expect(page.getByLabel("Maximum width").locator("option")).toHaveText([
    "Source",
    "640",
    "1280",
    "1920",
    "3840",
  ]);
  await expect(
    page.getByLabel("Embed an English soft-subtitle track"),
  ).toBeEnabled();
  await expect(
    page.getByLabel("Omit subtitle files for confirmed-English videos"),
  ).not.toBeChecked();
  await page
    .getByLabel("Omit subtitle files for confirmed-English videos")
    .check();
  await openMoreClipActions(page);
  await expect(
    page.getByRole("menuitem", { name: "Log and export" }),
  ).toBeDisabled();
  expect(loggedExportPostCount).toBe(0);
  await closeMoreClipActions(page);
  await page
    .getByLabel(
      "I confirm I am authorized to process this exact YouTube source for export.",
    )
    .check();
  await openMoreClipActions(page);
  await page.getByRole("menuitem", { name: "Log and export" }).click();
  await expect(panel).toContainText(
    "Logged to New essay and queued an export with the New Essay Edit snapshot.",
  );
  await expect(
    page.getByRole("menuitem", { name: "Export queued" }),
  ).toBeDisabled();
  expect(loggedExportPostCount).toBe(1);
  expect(lastLoggedExportBody?.preset).toBeUndefined();
  expect(lastLoggedExportBody?.settingsSelection).toMatchObject({
    selectedPreset: {
      scope: "project",
      presetId: createdProjectPresetId,
      presetVersion: 1,
    },
    overrides: { omitSubtitleFilesForConfirmedEnglish: true },
  });
  expect(lastLoggedExportBody?.expectedResolutionFingerprint).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(lastLoggedExportBody?.sourceRights).toEqual({
    schemaVersion: 1,
    source: "youtube",
    youtubeVideoId: directVideo.youtubeVideoId,
    confirmation: "authorized_to_process",
    disclosureVersion: 1,
  });

  await closeMoreClipActions(page);
  await openMoreClipActions(page);
  await expect(
    page.getByRole("menuitem", { name: "Export without logging" }),
  ).toBeDisabled();
  expect(exportOnlyPostCount).toBe(0);
  await closeMoreClipActions(page);
  await page
    .getByLabel(
      "I confirm I am authorized to process this exact YouTube source for export.",
    )
    .check();
  await openMoreClipActions(page);
  await page.getByRole("menuitem", { name: "Export without logging" }).click();
  await expect(panel).toContainText(
    "Queued a local export-only job with the Personal Documentary snapshot. Nothing was added to a project.",
  );
  await expect(
    page.getByRole("menuitem", { name: "Export-only queued" }),
  ).toBeDisabled();
  expect(exportOnlyPostCount).toBe(1);
  expect(lastExportOnlyBody?.preset).toBeUndefined();
  expect(lastExportOnlyBody?.settingsSelection).toMatchObject({
    selectedPreset: {
      scope: "personal",
      presetId: personalPresetId,
      presetVersion: 1,
    },
    overrides: { omitSubtitleFilesForConfirmedEnglish: true },
  });
  expect(lastExportOnlyBody?.sourceRights).toEqual({
    schemaVersion: 1,
    source: "youtube",
    youtubeVideoId: directVideo.youtubeVideoId,
    confirmation: "authorized_to_process",
    disclosureVersion: 1,
  });

  await page.locator("details.account-menu > summary").click();
  await page.getByLabel("Preferred transcript language").fill("es-MX");
  await page.getByRole("button", { name: "Save preference" }).click();
  await expect(page.getByLabel("Account settings")).toContainText(
    "Saved es-MX. Existing logged clips are unchanged.",
  );
  await page.locator("details.account-menu > summary").click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("YouTube URL or video ID").fill("Romanian001");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("Spanish (es) transcript")).toBeVisible();
  await expect(
    page.getByText("Loaded the exact verified local transcript cache."),
  ).toBeVisible();
  await page.getByLabel("Search transcript").fill("vinculada");
  await expect(page.getByText(/La selección permanece/u)).toBeVisible();
  await page.getByLabel("Search transcript").fill("");
  await page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-testid=transcript-window-row]",
      ),
    );
    const anchor = rows[0]?.querySelector<HTMLElement>(".transcript-text span");
    const focus = rows[1]?.querySelector<HTMLElement>(".transcript-text span");
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent) {
      throw new Error("Expected multilingual cue rows.");
    }
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(page.getByLabel("Clip selection")).toContainText(
    "Este es un ejemplo rumano. La selección permanece vinculada por tiempo.",
  );
  await page.getByLabel("Language view").selectOption("english");
  await expect(page.getByLabel("Clip selection")).toContainText(
    "This is a Romanian example. The selection stays linked by time.",
  );
  await expect(page.getByLabel("Clip selection")).toContainText(
    "Transcript selection: 0.000s–4.000s",
  );
  await page.getByLabel("Language view").selectOption("preferred");
  await page.getByRole("button", { name: "Log clip" }).click();
  expect(clipPostCount).toBe(2);
  expect(lastClipBody?.languageEvidence).toMatchObject({
    schemaVersion: 2,
    native: { language: "ro" },
    english: { language: "en" },
    preferred: { language: "es" },
  });
  expect(lastClipBody?.selection.trackId).toBe(
    lastClipBody?.languageEvidence.preferred.trackId,
  );
  batchFixtureEnabled = true;
  await page
    .getByLabel("Project destinations")
    .getByRole("button", { name: "Logged" })
    .click();
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  const clipSelectors = clipQueue.locator(
    '.clip-library-select input[type="checkbox"]',
  );
  await expect(clipSelectors).toHaveCount(2);
  for (const checkbox of await clipSelectors.all()) {
    await checkbox.check();
  }
  await clipQueue.getByRole("button", { name: "Preflight 2 clips" }).click();
  await expect(clipQueue).toContainText(
    "Source sizes are unavailable until acquisition",
  );
  await clipQueue.getByLabel(/Continue with unknown source sizes/u).check();
  await expect(
    clipQueue.getByRole("button", { name: "Submit durable batch" }),
  ).toBeDisabled();
  expect(batchExportPostCount).toBe(0);
  await clipQueue
    .getByLabel(
      "I confirm I am authorized to process every exact YouTube source listed above for this export.",
    )
    .check();
  await clipQueue.getByRole("button", { name: "Submit durable batch" }).click();
  await expect(clipQueue).toContainText(
    "Queued 2 independent export requests.",
  );
  expect(batchExportPostCount).toBe(1);
  expect(lastBatchExportBody?.sourceRights).toHaveLength(2);
  expect(lastBatchExportBody?.sourceRights).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceRights: {
          schemaVersion: 1,
          source: "youtube",
          youtubeVideoId: romanianVideo.youtubeVideoId,
          confirmation: "authorized_to_process",
          disclosureVersion: 1,
        },
      }),
    ]),
  );
  await clipQueue
    .getByRole("combobox", { name: "Topics", exact: true })
    .fill("");
  await clipQueue.getByLabel("Search clips").fill("");
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("Native — Romanian (ro)");
  await expect(clipQueue).toContainText("English");
  await expect(clipQueue).toContainText("Preferred — Spanish (es)");
  await clipQueue.getByText("Recent immutable artifact history").click();
  await clipQueue.getByRole("button", { name: "Resolve" }).click();
  await expect(clipQueue).toContainText("workstation reusable local");
  await clipQueue.getByRole("button", { name: "Verify" }).click();
  await clipQueue.getByRole("button", { name: "Reveal" }).click();
  await clipQueue
    .locator(".clip-card")
    .filter({ hasText: romanianVideo.title })
    .getByRole("button", { name: "Open clip" })
    .click();
  await clipQueue
    .getByRole("button", { name: "Relink to Recovery exports" })
    .click();
  expect(artifactResolutionPostCount).toBe(1);
  expect(artifactOpenPostCount).toBe(1);
  expect(artifactActions).toEqual(["verify", "reveal", "open", "relink"]);
  await clipQueue.getByRole("button", { name: "Preflight re-export" }).click();
  await expect(clipQueue).toContainText(
    "Source sizes are unavailable until acquisition",
  );
  await expect(clipQueue).toContainText(
    "La selección permanece vinculada por tiempo.",
  );
  await expect(
    clipQueue.getByRole("button", { name: "Submit durable export" }),
  ).toBeDisabled();
  await expect(
    clipQueue.getByLabel(
      "I confirm I am authorized to process every exact YouTube source listed above for this export.",
    ),
  ).not.toBeChecked();
  await page.locator("details.account-menu > summary").click();
  await page.getByLabel("Preferred transcript language").fill("en");
  await page.getByRole("button", { name: "Save preference" }).click();
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("Preferred — Spanish (es)");
});

test("connects an explicit project, controls a batch, and updates review state", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const now = "2026-08-01T12:00:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee30";
  const batchId = "019fbb95-cd76-7920-93fa-e23ba755ee31";
  let batchVersion = 1;
  let batchArchived = false;
  let dispatchStatus = "active";
  let hostedApprovalState: "pending" | "approved" | "revoked" = "pending";
  let hostedApprovalVersion = 1;
  const hostedApprovalCommands: Array<Record<string, unknown>> = [];
  let localProcessingState: "automatic" | "paused" = "automatic";
  let localProcessingVersion = 1;
  let localQueuedJobs = 2;
  let localUnprocessedVideoCount = 3;
  const localProcessingCommands: Array<Record<string, unknown>> = [];
  let keywordSetVersion = 1;
  const projectKeywords: Array<Record<string, any>> = [];
  const keywordSuggestions: Array<Record<string, any>> = [];
  const keywordSuggestionCommands: Array<Record<string, any>> = [];
  const keywordReviewCommands: Array<Record<string, any>> = [];
  const bulkPriorityCommands: Array<Record<string, any>> = [];
  let tamperKeywordArtifact = true;
  let reviewVersion = 1;
  let reviewStatus = "unreviewed";
  let ownFlagActive = true;
  let ownFlagVersion = 1;
  let projectVideoVersion = 1;
  let worklistPriority = "normal";
  let completionPolicy = "researcher_or_administrator";
  let canonicalReviewStatus = "open";
  let canonicalReviewVersion = 1;
  let canonicalReviewCycle = 1;
  let canonicalReviewReason: string | undefined;
  let triageState = "active";
  let triageVersion = 1;
  let triageReason: string | undefined;
  let activityState = "unread";
  let activityVersion = 1;
  let claimVersion = 0;
  let claimGeneration = 0;
  let claimActive = false;
  let workspaceRequestPath: string | undefined;
  let workspaceRequests = 0;
  let itemState = "ready_for_review";
  let itemCancelCommand: Record<string, unknown> | undefined;
  const progress = {
    total: 1,
    queued: 0,
    active: 0,
    readyForReview: 1,
    blocked: 0,
    failed: 0,
    retryableFailed: 0,
    canceled: 0,
    unreviewed: 1,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  };
  const batch = () => ({
    id: batchId,
    projectId,
    name: "Interview research",
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "hosted",
    priority: "normal",
    hostedApproval: {
      state: hostedApprovalState,
      version: hostedApprovalVersion,
      ...(hostedApprovalState === "pending"
        ? {}
        : {
            decidedBy: {
              userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
              handle: "e2e_user",
              displayName: "E2E User",
            },
            decidedAt: now,
          }),
    },
    dispatchStatus,
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    ...(batchArchived
      ? {
          archivedBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          archivedAt: now,
        }
      : {}),
    version: batchVersion,
    createdAt: now,
    updatedAt: now,
  });
  const item = () => ({
    id: "019fbb95-cd76-7920-93fa-e23ba755ee32",
    batchId,
    inputIndex: 0,
    input: "https://youtu.be/M7lc1UVf-VE",
    status: "existing-transcript",
    processingNeed: "reuse-shared",
    youtubeVideoId: "M7lc1UVf-VE",
    canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    title: "Fixture review video",
    channel: "Fixture channel",
    catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee33",
    activeTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee34",
    state: itemState,
    reviewStatus,
    attempt: 0,
    version: reviewVersion,
    createdAt: now,
    updatedAt: now,
  });
  const batchResponse = () => ({
    batch: batch(),
    items: [item()],
    summary: {
      total: 1,
      ready: 0,
      existingTranscripts: 1,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress,
  });
  const keywordArtifact = () => {
    const keyword = projectKeywords[0];
    const evidenceAlias = keyword?.aliases?.[1];
    return {
      schemaVersion: 1,
      projectId,
      projectVideoId: directVideo.id,
      transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee34",
      keywordSetVersion,
      scannerSchemaVersion: 1,
      occurrences:
        keyword && evidenceAlias
          ? [
              {
                id: "019fbb95-cd76-7920-93fa-e23ba755eeba",
                keywordId: keyword.id,
                startMs: 1_000,
                endMs: 1_800,
                timingPrecision: "word",
                evidence: [
                  {
                    keywordId: keyword.id,
                    aliasId: evidenceAlias.id,
                    trackId: englishWordFixture.track.id,
                    language: "en",
                    segmentIds: [englishWordFixture.segments[0]!.id],
                    startMs: 1_000,
                    endMs: 1_800,
                    timingPrecision: "word",
                    context: "A durable workflow keeps research accurate.",
                  },
                ],
              },
            ]
          : [],
    };
  };
  const keywordArtifactBytes = () =>
    Buffer.from(JSON.stringify(keywordArtifact()));
  const keywordArtifactDescriptor = () => {
    const bytes = keywordArtifactBytes();
    return {
      objectKey: `keyword-scans/${projectId}/${directVideo.id}/019fbb95-cd76-7920-93fa-e23ba755eeb8/matches.json`,
      objectVersionId: "keyword-artifact-v1",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      schemaVersion: 1,
    };
  };
  const worklistResponse = (view = "all") => {
    const visible =
      view === "dismissed"
        ? triageState === "dismissed"
        : view === "reviewed"
          ? triageState === "active" && canonicalReviewStatus === "completed"
          : view === "queue"
            ? triageState === "active" && canonicalReviewStatus === "open"
            : true;
    return {
      items: visible
        ? [
            {
              projectId,
              video: projectVideoFixture(directVideo, now),
              projectVideoVersion,
              priority: worklistPriority,
              completionPolicy,
              triage:
                triageState === "dismissed"
                  ? {
                      state: "dismissed",
                      version: triageVersion,
                      dismissedAt: now,
                      dismissedBy: {
                        userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                        handle: "e2e_user",
                        displayName: "E2E User",
                      },
                      reason: triageReason,
                    }
                  : { state: "active", version: triageVersion },
              unreadActivityCount: activityState === "unread" ? 1 : 0,
              ...(claimVersion
                ? {
                    claim: {
                      claimant: {
                        userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                        handle: "e2e_user",
                        displayName: "E2E User",
                      },
                      isCurrentUser: true,
                      active: claimActive,
                      generation: claimGeneration,
                      version: claimVersion,
                      claimedAt: now,
                      heartbeatAt: now,
                      expiresAt: "2026-08-24T12:05:00.000Z",
                    },
                  }
                : {}),
              review: {
                id:
                  canonicalReviewCycle === 1
                    ? "019fbb95-cd76-7920-93fa-e23ba755ee37"
                    : "019fbb95-cd76-7920-93fa-e23ba755ee38",
                cycleNumber: canonicalReviewCycle,
                status: canonicalReviewStatus,
                version: canonicalReviewVersion,
                openedAt: now,
                ...(canonicalReviewReason
                  ? { reopenReason: canonicalReviewReason }
                  : {}),
                ...(canonicalReviewStatus === "completed"
                  ? {
                      completionPolicy,
                      completedAt: now,
                      completedBy: {
                        userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                        handle: "e2e_user",
                        displayName: "E2E User",
                      },
                      completionBasis: "ready_transcript",
                      transcriptVersionId:
                        "019fbb95-cd76-7920-93fa-e23ba755ee34",
                    }
                  : {}),
              },
              activeTranscriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee34",
              activeFlagCount: ownFlagActive ? 1 : 0,
              flaggers: ownFlagActive
                ? [
                    {
                      userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                      handle: "e2e_user",
                      displayName: "E2E User",
                      flaggedAt: now,
                    },
                  ]
                : [],
              flaggersTruncated: false,
              ownFlag: {
                active: ownFlagActive,
                version: ownFlagVersion,
                createdAt: now,
                updatedAt: now,
                ...(!ownFlagActive ? { deactivatedAt: now } : {}),
              },
              processing: {
                state: "ready",
                batchId,
                batchItemId: item().id,
                attempt: 0,
                updatedAt: now,
              },
              keywordScan: {
                projectId,
                projectVideoId: directVideo.id,
                scanId: "019fbb95-cd76-7920-93fa-e23ba755eeb8",
                status: "current",
                transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee34",
                keywordSetVersion,
                scannerSchemaVersion: 1,
                occurrenceCount: projectKeywords.length ? 1 : 0,
                matchedKeywordCount: projectKeywords.length ? 1 : 0,
                keywordCounts: projectKeywords.length
                  ? [
                      {
                        keywordId: projectKeywords[0]!.id,
                        occurrenceCount: 1,
                      },
                    ]
                  : [],
                approvedKeywordCount: projectKeywords.length,
                matchesPerMinute: projectKeywords.length ? 1 : 0,
                durationMs: 60_000,
                artifact: keywordArtifactDescriptor(),
                completedAt: now,
              },
              clipCount: 2,
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [],
      total: visible ? 1 : 0,
    };
  };
  const activityResponse = () => ({
    items: [
      {
        eventId: "019fbb95-cd76-7920-93fa-e23ba755ee39",
        projectId,
        videoId: directVideo.id,
        videoTitle: "Fixture review video",
        eventType: "video_restored",
        actor: {
          userId: "019fbb95-cd76-7920-93fa-e23ba755ee35",
          handle: "fixture_admin",
          displayName: "Fixture Admin",
        },
        reason: "Returned to the research queue.",
        state: activityState,
        version: activityVersion,
        createdAt: now,
        ...(activityState === "seen" ? { seenAt: now } : {}),
      },
    ],
    unreadCount: activityState === "unread" ? 1 : 0,
  });
  const keywordActor = {
    userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    handle: "e2e_user",
    displayName: "E2E User",
  };
  const keywordCatalogResponse = () => ({
    projectId,
    currentUserId: keywordActor.userId,
    keywordSetVersion,
    keywords: projectKeywords,
    suggestions: keywordSuggestions,
  });
  const localProcessingResponse = () => ({
    projectId,
    policy: {
      state: localProcessingState,
      version: localProcessingVersion,
      ...(localProcessingVersion === 1
        ? {}
        : {
            updatedBy: {
              userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
              handle: "e2e_user",
              displayName: "E2E User",
            },
            updatedAt: now,
          }),
    },
    workload: {
      queuedJobs: localQueuedJobs,
      activeJobs: 1,
      queuedKnownDurationMs: 120_000,
      activeKnownDurationMs: 60_000,
      queuedUnknownDurationCount: 1,
      activeUnknownDurationCount: 0,
      unprocessedActiveVideoCount: localUnprocessedVideoCount,
    },
  });

  await page.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/cloud-api", "");
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Essay project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: {
          batches: batchArchived ? [] : [{ batch: batch(), progress }],
        },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`) {
      return route.fulfill({
        json: {
          items:
            itemState === "ready_for_review"
              ? [{ ...item(), batchName: "Interview research" }]
              : [],
        },
      });
    }
    if (path === `/api/projects/${projectId}/videos`) {
      return route.fulfill({ json: [projectVideoFixture(directVideo, now)] });
    }
    if (path === `/api/projects/${projectId}/worklist`) {
      return route.fulfill({
        json: worklistResponse(url.searchParams.get("view") ?? "all"),
      });
    }
    if (
      path ===
      `/api/projects/${projectId}/keyword-scans/019fbb95-cd76-7920-93fa-e23ba755eeb8/artifact-download`
    ) {
      return route.fulfill({
        json: {
          scanId: "019fbb95-cd76-7920-93fa-e23ba755eeb8",
          artifact: keywordArtifactDescriptor(),
          downloadUrl:
            "http://127.0.0.1:43112/keyword-artifact-fixture/matches.json",
          expiresAt: "2026-08-24T12:05:00.000Z",
        },
      });
    }
    if (path === `/api/projects/${projectId}/activity`) {
      return route.fulfill({ json: activityResponse() });
    }
    if (path === `/api/projects/${projectId}/keywords`) {
      return route.fulfill({ json: keywordCatalogResponse() });
    }
    if (
      path === `/api/projects/${projectId}/keyword-suggestions` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, any>;
      keywordSuggestionCommands.push(body);
      expect(body.idempotencyKey).toMatch(
        /^workbench-keyword-suggestion:[a-f0-9]{64}$/,
      );
      const suggestion = {
        id:
          keywordSuggestions.length === 0
            ? "019fbb95-cd76-7920-93fa-e23ba755eeb4"
            : "019fbb95-cd76-7920-93fa-e23ba755eeb7",
        projectId,
        ...(body.keywordId ? { keywordId: body.keywordId } : {}),
        ...(body.proposedLabel ? { proposedLabel: body.proposedLabel } : {}),
        ...(body.proposedDescription
          ? { proposedDescription: body.proposedDescription }
          : {}),
        language: body.language,
        phrase: body.phrase,
        normalizedPhrase: String(body.phrase).toLocaleLowerCase("en-US"),
        ...(body.rationale ? { rationale: body.rationale } : {}),
        state: "pending",
        version: 1,
        proposedBy: keywordActor,
        createdAt: now,
        updatedAt: now,
      };
      keywordSuggestions.push(suggestion);
      return route.fulfill({
        json: { resolution: "created", suggestion },
      });
    }
    const keywordReviewMatch = path.match(
      new RegExp(
        `^/api/projects/${projectId}/keyword-suggestions/([^/]+)/review$`,
      ),
    );
    if (keywordReviewMatch && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, any>;
      keywordReviewCommands.push(body);
      expect(body.idempotencyKey).toMatch(
        /^workbench-keyword-review:[a-f0-9]{64}$/,
      );
      const suggestion = keywordSuggestions.find(
        (entry) => entry.id === keywordReviewMatch[1],
      )!;
      expect(body.expectedSuggestionVersion).toBe(suggestion.version);
      expect(body.expectedKeywordSetVersion).toBe(keywordSetVersion);
      suggestion.state = body.action === "approve" ? "approved" : "rejected";
      suggestion.version += 1;
      suggestion.reviewedBy = keywordActor;
      suggestion.reviewedAt = now;
      suggestion.updatedAt = now;
      if (body.reason) suggestion.reviewReason = body.reason;
      if (body.action === "approve") {
        const keywordId = "019fbb95-cd76-7920-93fa-e23ba755eeb5";
        const alias = {
          id: "019fbb95-cd76-7920-93fa-e23ba755eeb6",
          projectId,
          keywordId,
          language: suggestion.language,
          phrase: suggestion.phrase,
          normalizedPhrase: suggestion.normalizedPhrase,
          enabled: true,
          version: 1,
          createdBy: keywordActor,
          createdAt: now,
          updatedAt: now,
        };
        const evidenceAlias = {
          ...alias,
          id: "019fbb95-cd76-7920-93fa-e23ba755eeb9",
          phrase: "accurate",
          normalizedPhrase: "accurate",
        };
        const keyword = {
          id: keywordId,
          projectId,
          label: suggestion.proposedLabel,
          ...(suggestion.proposedDescription
            ? { description: suggestion.proposedDescription }
            : {}),
          enabled: true,
          version: 1,
          createdBy: keywordActor,
          createdAt: now,
          updatedAt: now,
          aliases: [alias, evidenceAlias],
        };
        suggestion.keywordId = keywordId;
        projectKeywords.push(keyword);
        keywordSetVersion += 1;
        return route.fulfill({
          json: {
            projectId,
            keywordSetVersion,
            suggestion,
            keyword,
            alias,
          },
        });
      }
      return route.fulfill({
        json: { projectId, keywordSetVersion, suggestion },
      });
    }
    const keywordWithdrawMatch = path.match(
      new RegExp(
        `^/api/projects/${projectId}/keyword-suggestions/([^/]+)/withdraw$`,
      ),
    );
    if (keywordWithdrawMatch && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, any>;
      const suggestion = keywordSuggestions.find(
        (entry) => entry.id === keywordWithdrawMatch[1],
      )!;
      expect(body.expectedSuggestionVersion).toBe(suggestion.version);
      expect(body.idempotencyKey).toMatch(
        /^workbench-keyword-withdrawal:[a-f0-9]{64}$/,
      );
      suggestion.state = "withdrawn";
      suggestion.version += 1;
      suggestion.withdrawnBy = keywordActor;
      suggestion.withdrawnAt = now;
      if (body.reason) suggestion.withdrawReason = body.reason;
      suggestion.updatedAt = now;
      return route.fulfill({
        json: { projectId, keywordSetVersion, suggestion },
      });
    }
    const keywordAliasUpdateMatch = path.match(
      new RegExp(
        `^/api/projects/${projectId}/keywords/([^/]+)/aliases/([^/]+)$`,
      ),
    );
    if (keywordAliasUpdateMatch && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, any>;
      const keyword = projectKeywords.find(
        (entry) => entry.id === keywordAliasUpdateMatch[1],
      )!;
      const alias = keyword.aliases.find(
        (entry: Record<string, any>) => entry.id === keywordAliasUpdateMatch[2],
      )!;
      expect(body.expectedAliasVersion).toBe(alias.version);
      expect(body.expectedKeywordSetVersion).toBe(keywordSetVersion);
      expect(body.idempotencyKey).toMatch(
        /^workbench-keyword-alias-update:[a-f0-9]{64}$/,
      );
      if (body.language !== undefined) alias.language = body.language;
      if (body.phrase !== undefined) {
        alias.phrase = body.phrase;
        alias.normalizedPhrase = String(body.phrase).toLocaleLowerCase("en-US");
      }
      if (body.enabled !== undefined) alias.enabled = body.enabled;
      alias.version += 1;
      alias.updatedBy = keywordActor;
      alias.updatedAt = now;
      keywordSetVersion += 1;
      return route.fulfill({
        json: { projectId, keywordSetVersion, keyword, alias },
      });
    }
    const keywordUpdateMatch = path.match(
      new RegExp(`^/api/projects/${projectId}/keywords/([^/]+)$`),
    );
    if (keywordUpdateMatch && request.method() === "PATCH") {
      const body = request.postDataJSON() as Record<string, any>;
      const keyword = projectKeywords.find(
        (entry) => entry.id === keywordUpdateMatch[1],
      )!;
      expect(body.expectedKeywordVersion).toBe(keyword.version);
      expect(body.expectedKeywordSetVersion).toBe(keywordSetVersion);
      expect(body.idempotencyKey).toMatch(
        /^workbench-keyword-update:[a-f0-9]{64}$/,
      );
      if (body.label !== undefined) keyword.label = body.label;
      if (body.description === null) delete keyword.description;
      else if (body.description !== undefined)
        keyword.description = body.description;
      if (body.enabled !== undefined) keyword.enabled = body.enabled;
      keyword.version += 1;
      keyword.updatedBy = keywordActor;
      keyword.updatedAt = now;
      keywordSetVersion += 1;
      return route.fulfill({ json: { projectId, keywordSetVersion, keyword } });
    }
    if (path === `/api/projects/${projectId}/local-processing`) {
      if (request.method() === "GET") {
        return route.fulfill({ json: localProcessingResponse() });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      localProcessingCommands.push(body);
      expect(body.expectedVersion).toBe(localProcessingVersion);
      expect(body.idempotencyKey).toMatch(
        /^workbench-local-processing:[a-f0-9]{64}$/,
      );
      localProcessingState = body.state as "automatic" | "paused";
      localProcessingVersion += 1;
      const enqueuedCount =
        localProcessingState === "automatic"
          ? Math.min(localUnprocessedVideoCount, 50)
          : 0;
      localQueuedJobs += enqueuedCount;
      localUnprocessedVideoCount -= enqueuedCount;
      return route.fulfill({
        json: {
          ...localProcessingResponse(),
          enqueuedCount,
          remainingUnprocessedCount: localUnprocessedVideoCount,
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/activity/seen` &&
      request.method() === "PATCH"
    ) {
      activityState = "seen";
      activityVersion += 1;
      return route.fulfill({
        json: { projectId, items: activityResponse().items },
      });
    }
    if (
      path === `/api/projects/${projectId}/worklist/triage` &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON();
      triageState = body.action === "dismiss" ? "dismissed" : "active";
      triageReason =
        body.action === "dismiss" ? String(body.reason) : undefined;
      triageVersion += 1;
      projectVideoVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          items: worklistResponse("all").items.map((entry) => ({
            videoId: entry.video.id,
            projectVideoVersion: entry.projectVideoVersion,
            triage: entry.triage,
          })),
          cancellation: {
            queuedJobsCanceled: body.action === "dismiss" ? 1 : 0,
            activeJobsRequested: 0,
            requestsRevoked: 0,
          },
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/worklist/priority` &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON() as Record<string, any>;
      bulkPriorityCommands.push(body);
      worklistPriority = String(body.priority);
      projectVideoVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          priority: worklistPriority,
          items: [
            {
              projectId,
              videoId: directVideo.id,
              priority: worklistPriority,
              completionPolicy,
              projectVideoVersion,
              updatedAt: now,
            },
          ],
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/worklist/${directVideo.id}/claim` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON();
      if (body.action === "release") {
        claimVersion = 0;
        claimActive = false;
        return route.fulfill({ json: { projectId, videoId: directVideo.id } });
      }
      if (body.action === "renew") claimVersion += 1;
      else {
        claimVersion += 1;
        claimGeneration += 1;
      }
      claimActive = true;
      return route.fulfill({
        json: {
          projectId,
          videoId: directVideo.id,
          claim: worklistResponse().items[0]!.claim,
        },
      });
    }
    if (
      path ===
        `/api/projects/${projectId}/worklist/${directVideo.id}/governance` &&
      request.method() === "PATCH"
    ) {
      const body = request.postDataJSON();
      if (body.priority) worklistPriority = String(body.priority);
      if (body.completionPolicy)
        completionPolicy = String(body.completionPolicy);
      projectVideoVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          videoId: directVideo.id,
          priority: worklistPriority,
          completionPolicy,
          projectVideoVersion,
          updatedAt: now,
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/worklist/${directVideo.id}/review` &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON();
      if (body.action === "complete") {
        canonicalReviewStatus = "completed";
        canonicalReviewVersion += 1;
      } else {
        canonicalReviewStatus = "open";
        canonicalReviewVersion = 1;
        canonicalReviewCycle += 1;
        canonicalReviewReason = String(body.reason);
      }
      return route.fulfill({
        json: {
          projectId,
          videoId: directVideo.id,
          review: worklistResponse().items[0]!.review,
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/worklist/${directVideo.id}/flag` &&
      request.method() === "PATCH"
    ) {
      ownFlagActive = Boolean(request.postDataJSON().active);
      ownFlagVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          videoId: directVideo.id,
          flag: worklistResponse().items[0]!.ownFlag,
        },
      });
    }
    if (
      path === `/api/projects/${projectId}/transcription-batches/${batchId}` &&
      request.method() === "GET"
    ) {
      return route.fulfill({ json: batchResponse() });
    }
    if (
      path.endsWith(
        `/transcription-batches/${batchId}/items/019fbb95-cd76-7920-93fa-e23ba755ee32/cancel`,
      ) &&
      request.method() === "POST"
    ) {
      itemCancelCommand = request.postDataJSON();
      expect(itemCancelCommand?.expectedVersion).toBe(reviewVersion);
      expect(itemCancelCommand?.idempotencyKey).toMatch(
        /^transcription-batch-item-cancel:[a-f0-9]{64}$/,
      );
      itemState = "canceled";
      reviewVersion += 1;
      progress.readyForReview = 0;
      progress.canceled = 1;
      progress.unreviewed = 0;
      progress.reviewing = 0;
      return route.fulfill({
        json: {
          projectId,
          batchId,
          item: item(),
          outcome: "canceled",
          jobCancellationRequested: false,
        },
      });
    }
    if (path.endsWith(`/transcription-batches/${batchId}/control`)) {
      dispatchStatus = "paused";
      batchVersion += 1;
      return route.fulfill({ json: batchResponse() });
    }
    if (
      path.endsWith(`/transcription-batches/${batchId}/archive`) &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(body.expectedVersion).toBe(batchVersion);
      expect(body.idempotencyKey).toMatch(
        /^transcription-batch-archive:[a-f0-9]{64}$/,
      );
      batchArchived = true;
      dispatchStatus = "canceled";
      batchVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          batch: batch(),
          outcome: "archived",
        },
      });
    }
    if (
      path.endsWith(`/transcription-batches/${batchId}/hosted-approval`) &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      hostedApprovalCommands.push(body);
      expect(body.expectedVersion).toBe(hostedApprovalVersion);
      expect(body.idempotencyKey).toMatch(
        /^workbench-hosted-approval:[a-f0-9]{64}$/,
      );
      hostedApprovalState = body.action === "approve" ? "approved" : "revoked";
      hostedApprovalVersion += 1;
      return route.fulfill({
        json: {
          projectId,
          batchId,
          approval: batch().hostedApproval,
        },
      });
    }
    if (path.includes("/review-inbox/") && request.method() === "PATCH") {
      reviewStatus = String(request.postDataJSON().reviewStatus);
      reviewVersion += 1;
      progress.unreviewed = 0;
      progress.reviewing = 1;
      return route.fulfill({
        json: { ...item(), batchName: "Interview research" },
      });
    }
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/keyword-artifact-fixture/**", async (route) => {
    const bytes = keywordArtifactBytes();
    return route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "application/json",
      },
      body: tamperKeywordArtifact
        ? Buffer.concat([bytes, Buffer.from(" ")])
        : bytes,
    });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => {
      const url = new URL(route.request().url());
      workspaceRequestPath = `${url.pathname}${url.search}`;
      workspaceRequests += 1;
      if (workspaceRequests === 1) {
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "transcript_unavailable",
              message: "Fixture transcript temporarily unavailable.",
              retryable: true,
            },
          },
        });
      }
      return route.fulfill({
        json: workspaceFixture({
          projectId,
          video: directVideo,
          preferredLanguage: url.searchParams.get("preferredLanguage") ?? "en",
        }),
      });
    },
  );

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByLabel("Active project")).toHaveValue(projectId);
  await page.getByLabel("Import CSV").setInputFiles({
    name: "research.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Title,YouTube URL\nFirst,ReadyVideo1\nSecond,https://youtu.be/ReadyVideo2\n",
    ),
  });
  await expect(page.getByLabel("YouTube URL column")).toHaveValue("1");
  await page.getByRole("button", { name: "Use CSV values" }).click();
  await expect(
    page.getByLabel("YouTube URLs or video IDs, one per line"),
  ).toHaveValue("ReadyVideo1\nhttps://youtu.be/ReadyVideo2");
  await expect(
    page.getByText("Interview research", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: /Ready, stage 8 of 8; time remaining unknown/u,
    }),
  ).toBeVisible();
  const canonicalWorklist = page.getByLabel("Project video worklist");
  await expect(canonicalWorklist).toContainText("Fixture review video");
  await expect(canonicalWorklist).toContainText("Flagged by @e2e_user");
  await expect(canonicalWorklist).toContainText("transcript ready · 2 clips");
  await expect(canonicalWorklist).toContainText("New for you · 1");
  const noMatchesGroup = canonicalWorklist.getByLabel(
    "No matches keyword results",
  );
  const promisingGroup = canonicalWorklist.getByLabel(
    "Promising keyword results",
  );
  await expect(noMatchesGroup.getByRole("heading")).toHaveText("No matches 1");
  await expect(noMatchesGroup).toContainText(
    "Current scan · genuine zero matches · no triage change",
  );
  await expect(promisingGroup.getByRole("heading")).toHaveText("Promising 0");
  await canonicalWorklist
    .getByLabel("Keyword scan state")
    .selectOption("stale");
  await expect(noMatchesGroup).not.toContainText("Fixture review video");
  await canonicalWorklist
    .getByLabel("Keyword scan state")
    .selectOption("current");
  await expect(noMatchesGroup).toContainText("Fixture review video");
  await canonicalWorklist.getByLabel("Keyword scan state").selectOption("all");
  const activityInbox = page.locator(".activity-inbox-card");
  await expect(activityInbox).toContainText("video restored by @fixture_admin");
  await activityInbox.getByRole("button", { name: "Mark seen" }).click();
  await expect(activityInbox).toContainText("seen");
  await expect(canonicalWorklist).not.toContainText("New for you");
  await canonicalWorklist.getByRole("button", { name: "Claim review" }).click();
  await expect(canonicalWorklist).toContainText("Claimed by you");
  await canonicalWorklist.getByRole("button", { name: "Renew claim" }).click();
  await canonicalWorklist
    .getByLabel("Priority for Fixture review video")
    .selectOption("high");
  await expect(canonicalWorklist).toContainText("Priority high");
  await canonicalWorklist
    .getByLabel("Review completion policy for Fixture review video")
    .selectOption("administrator_only");
  await canonicalWorklist
    .getByRole("button", { name: "Complete review" })
    .click();
  await expect(canonicalWorklist).not.toContainText("Fixture review video");
  await canonicalWorklist
    .getByRole("button", { name: "Reviewed", exact: true })
    .click();
  await expect(canonicalWorklist).toContainText("review cycle 1 completed");
  page.once("dialog", (dialog) => dialog.accept("New evidence arrived."));
  await canonicalWorklist
    .getByRole("button", { name: "Reopen review" })
    .click();
  await expect(canonicalWorklist).not.toContainText("Fixture review video");
  await canonicalWorklist
    .getByRole("button", { name: "Queue", exact: true })
    .click();
  await expect(canonicalWorklist).toContainText(
    "review cycle 2 open · reopened: New evidence arrived.",
  );
  await canonicalWorklist
    .getByRole("button", { name: "Remove my flag" })
    .click();
  await expect(canonicalWorklist).toContainText("No active flags");
  await canonicalWorklist
    .getByRole("button", { name: "Restore my flag" })
    .click();
  await expect(canonicalWorklist).toContainText("Flagged by @e2e_user");
  await canonicalWorklist.getByLabel("Select Fixture review video").check();
  page.once("dialog", (dialog) => dialog.accept("Not useful for this cut."));
  await canonicalWorklist
    .getByRole("button", { name: "Dismiss selected (1)" })
    .click();
  await expect(canonicalWorklist).not.toContainText("Fixture review video");
  await canonicalWorklist
    .getByRole("button", { name: "Dismissed", exact: true })
    .click();
  await expect(canonicalWorklist).toContainText(
    "Dismissed by @e2e_user · Not useful for this cut.",
  );
  await canonicalWorklist.getByLabel("Select Fixture review video").check();
  await canonicalWorklist
    .getByRole("button", { name: "Restore selected (1)" })
    .click();
  await expect(canonicalWorklist).not.toContainText("Fixture review video");
  await canonicalWorklist
    .getByRole("button", { name: "Queue", exact: true })
    .click();
  await expect(canonicalWorklist).toContainText("Active in worklist");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.locator(".review-card").getByText("Fixture review video", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .locator(".review-card")
    .getByRole("button", { name: "Open video" })
    .click();
  await expect(
    page.getByRole("heading", { name: "No active project transcript" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture transcript temporarily unavailable."),
  ).toBeVisible();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry transcript" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  expect(workspaceRequests).toBe(2);
  expect(workspaceRequestPath).toBe(
    `/local-agent/api/projects/${projectId}/videos/${directVideo.id}/transcript?preferredLanguage=en`,
  );

  await page.locator(".review-card > summary").click();
  await page
    .getByLabel("Review status for Fixture review video")
    .selectOption("reviewing");
  await expect(
    page.getByLabel("Review status for Fixture review video"),
  ).toHaveValue("reviewing");

  await page.getByRole("button", { name: "Project Settings" }).click();
  const localProcessing = page.getByLabel("Local processing policy");
  await expect(localProcessing).toContainText(
    "Policy: automatic · safe historical default",
  );
  await expect(localProcessing).toContainText(
    "Queued 2 · known load 2m · 1 unknown duration",
  );
  await expect(localProcessing).toContainText("Active 1 · known load 1m");
  await expect(localProcessing).toContainText("3 active videos not yet queued");
  await localProcessing
    .getByRole("button", { name: "Pause new local starts" })
    .click();
  await expect(localProcessing).toContainText(
    "Policy: paused · last changed by @e2e_user",
  );
  await localProcessing
    .getByRole("button", { name: "Resume and queue up to 50" })
    .click();
  await expect(localProcessing).toContainText(
    "Policy: automatic · last changed by @e2e_user",
  );
  await expect(localProcessing).toContainText(
    "Queued 5 · known load 2m · 1 unknown duration",
  );
  await expect(localProcessing).not.toContainText("not yet queued");
  expect(localProcessingCommands).toHaveLength(2);
  expect(localProcessingCommands.map((command) => command.state)).toEqual([
    "paused",
    "automatic",
  ]);
  expect(
    localProcessingCommands.map((command) => command.expectedVersion),
  ).toEqual([1, 2]);
  expect(localProcessingCommands[0]!.idempotencyKey).not.toBe(
    localProcessingCommands[1]!.idempotencyKey,
  );

  const projectKeywordCard = page.getByLabel("Project keywords");
  await expect(projectKeywordCard).toContainText("These are not clip tags");
  await expect(projectKeywordCard).toContainText(
    "No approved project keywords yet.",
  );
  await projectKeywordCard
    .getByLabel("New keyword label")
    .fill("Climate change");
  await projectKeywordCard
    .getByLabel("Keyword description")
    .fill("Positive literal research phrase");
  await projectKeywordCard.getByLabel("Keyword alias language").fill("en");
  await projectKeywordCard
    .getByLabel("Literal keyword phrase")
    .fill("Climate change");
  await projectKeywordCard
    .getByLabel("Keyword suggestion rationale")
    .fill("Core research vocabulary");
  await projectKeywordCard
    .getByRole("button", { name: "Suggest project keyword" })
    .click();
  await expect(projectKeywordCard).toContainText("Pending suggestions 1");
  await expect(projectKeywordCard).toContainText(
    "English (en): Climate change",
  );
  await expect(projectKeywordCard).toContainText(
    "No approved project keywords yet.",
  );
  await projectKeywordCard
    .getByRole("button", { name: "Approve Climate change" })
    .click();
  await expect(projectKeywordCard).toContainText("Approved vocabulary");
  await expect(projectKeywordCard).toContainText("Climate change");
  await expect(
    projectKeywordCard.getByLabel("Aliases for Climate change"),
  ).toContainText("English (en): Climate change");
  await expect(projectKeywordCard).toContainText("Pending suggestions 0");
  await expect(projectKeywordCard).toContainText("v2");
  await projectKeywordCard
    .getByLabel("Description for Climate change")
    .fill("Updated scan description");
  await projectKeywordCard
    .getByRole("button", { name: "Save keyword" })
    .click();
  await expect(projectKeywordCard).toContainText("Updated scan description");
  await expect(projectKeywordCard).toContainText("v3");
  await projectKeywordCard
    .getByRole("button", { name: "Disable keyword" })
    .click();
  await expect(projectKeywordCard).toContainText("Disabled · version 3");
  await projectKeywordCard
    .getByRole("button", { name: "Disable alias" })
    .first()
    .click();
  await expect(
    projectKeywordCard.getByLabel("Aliases for Climate change"),
  ).toContainText("disabled");
  await expect(projectKeywordCard).toContainText("v5");
  await projectKeywordCard
    .getByRole("button", { name: "Enable keyword" })
    .click();
  await expect(projectKeywordCard).toContainText("Enabled · version 4");
  await expect(projectKeywordCard).toContainText("v6");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(promisingGroup.getByRole("heading")).toHaveText("Promising 1");
  await expect(promisingGroup).toContainText("Current keyword evidence");
  await expect(promisingGroup).toContainText(
    "Coverage 1/1 · 1 occurrence · 1.00 per minute",
  );
  await expect(noMatchesGroup.getByRole("heading")).toHaveText("No matches 0");
  await canonicalWorklist
    .getByLabel("Approved keyword filter")
    .selectOption("019fbb95-cd76-7920-93fa-e23ba755eeb5");
  await expect(promisingGroup).toContainText("Fixture review video");

  await promisingGroup
    .getByRole("button", { name: "Show verified keyword evidence" })
    .click();
  await expect(promisingGroup.getByRole("alert")).toContainText(
    "Keyword evidence size verification failed.",
  );
  await expect(promisingGroup.locator(".keyword-context-row")).toHaveCount(0);
  tamperKeywordArtifact = false;
  await promisingGroup
    .getByRole("button", { name: "Retry evidence verification" })
    .click();
  const verifiedEvidence = promisingGroup.getByRole("button", {
    name: /0:01\.000 · accurate · English \(en\) · word · A durable workflow keeps research accurate\./,
  });
  await expect(verifiedEvidence).toBeVisible();
  await verifiedEvidence.click();
  await expect(page.getByLabel("Search transcript")).toHaveValue("accurate");
  await expect(
    page.getByText("Opened verified keyword evidence at 1s with word timing."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await canonicalWorklist.getByLabel("Select Fixture review video").check();
  page.once("dialog", (dialog) => dialog.accept());
  await canonicalWorklist
    .getByRole("button", { name: "Set high priority" })
    .click();
  await expect(canonicalWorklist).toContainText("Priority high");
  expect(bulkPriorityCommands).toHaveLength(1);
  expect(bulkPriorityCommands[0]).toMatchObject({
    priority: "high",
    items: [
      {
        videoId: directVideo.id,
        expectedProjectVideoVersion: projectVideoVersion - 1,
      },
    ],
  });
  expect(bulkPriorityCommands[0]!.idempotencyKey).toMatch(
    /^workbench-bulk-priority:[a-f0-9]{64}$/,
  );
  await canonicalWorklist
    .getByLabel("Approved keyword filter")
    .selectOption("");

  await page.getByRole("button", { name: "Project Settings" }).click();
  await projectKeywordCard
    .getByLabel("Keyword suggestion target")
    .selectOption("019fbb95-cd76-7920-93fa-e23ba755eeb5");
  await expect(
    projectKeywordCard.getByLabel("New keyword label"),
  ).toBeDisabled();
  await projectKeywordCard.getByLabel("Keyword alias language").fill("es");
  await projectKeywordCard
    .getByLabel("Literal keyword phrase")
    .fill("Cambio climático");
  await projectKeywordCard
    .getByRole("button", { name: "Suggest project keyword" })
    .click();
  await expect(projectKeywordCard).toContainText(
    "Spanish (es): Cambio climático",
  );
  page.once("dialog", (dialog) => dialog.accept("Duplicate direction"));
  await projectKeywordCard
    .getByRole("button", { name: "Withdraw Cambio climático" })
    .click();
  await expect(projectKeywordCard).toContainText("Pending suggestions 0");
  await expect(projectKeywordCard).toContainText(
    "2 reviewed suggestion records retained.",
  );
  await expect(projectKeywordCard).toContainText("v6");
  expect(keywordSuggestionCommands).toHaveLength(2);
  expect(keywordReviewCommands).toHaveLength(1);
  expect(keywordReviewCommands.map((command) => command.action)).toEqual([
    "approve",
  ]);
  expect(
    keywordReviewCommands.map((command) => command.expectedSuggestionVersion),
  ).toEqual([1]);
  expect(
    keywordReviewCommands.map((command) => command.expectedKeywordSetVersion),
  ).toEqual([1]);

  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText("Hosted processing: Pending")).toBeVisible();
  await page.getByRole("button", { name: "Approve hosted processing" }).click();
  await expect(page.getByText("Hosted processing: Approved")).toBeVisible();
  await page.getByRole("button", { name: "Revoke hosted approval" }).click();
  await expect(page.getByText("Hosted processing: Revoked")).toBeVisible();
  expect(hostedApprovalCommands).toHaveLength(2);
  expect(hostedApprovalCommands.map((command) => command.action)).toEqual([
    "approve",
    "revoke",
  ]);
  expect(
    hostedApprovalCommands.map((command) => command.expectedVersion),
  ).toEqual([1, 2]);
  expect(hostedApprovalCommands[0]!.idempotencyKey).not.toBe(
    hostedApprovalCommands[1]!.idempotencyKey,
  );

  await page.getByRole("button", { name: "Pause pending" }).click();
  await expect(page.getByText(/paused · 1 ready/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Show batch history" }),
  ).toBeVisible();
  await expect(page.locator(".review-card")).not.toContainText(
    "Fixture review video",
  );
  expect(itemCancelCommand).toBeDefined();
  await page.getByRole("button", { name: "Show batch history" }).click();
  await page
    .locator(".batch-list-item")
    .filter({ hasText: "Interview research" })
    .click();
  await page.getByRole("button", { name: "Remove from list" }).click();
  await expect(page.getByText("Batch removed from the list.")).toBeVisible();
  await expect(page.locator(".batch-list-item")).toHaveCount(0);
});

test("accepts an explicit language when provider and creator evidence are unknown", async ({
  page,
}) => {
  const now = "2026-08-25T12:00:00.000Z";
  const projectId = "029fbb95-cd76-7920-93fa-e23ba755ee70";
  const batchId = "029fbb95-cd76-7920-93fa-e23ba755ee71";
  const itemId = "029fbb95-cd76-7920-93fa-e23ba755ee72";
  const videoId = "029fbb95-cd76-7920-93fa-e23ba755ee73";
  let confirmed = false;
  let decisionBody: Record<string, unknown> | undefined;
  const gate = () =>
    confirmed
      ? {
          state: "ready" as const,
          status: "confirmed" as const,
          decision: {
            id: "029fbb95-cd76-7920-93fa-e23ba755ee74",
            projectId,
            videoId,
            decisionVersion: 1,
            status: "confirmed" as const,
            basis: "user_confirmation" as const,
            resolvedLanguage: "dz",
            actorId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
            createdAt: now,
          },
          remediationReason: "none" as const,
        }
      : {
          state: "needs_language_confirmation" as const,
          status: "unverified" as const,
          remediationReason: "confirm_language" as const,
        };
  const batch = {
    id: batchId,
    projectId,
    name: "Unknown language gate batch",
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  const progress = () => ({
    total: 1,
    queued: confirmed ? 1 : 0,
    active: 0,
    readyForReview: 0,
    blocked: confirmed ? 0 : 1,
    failed: 0,
    retryableFailed: 0,
    canceled: 0,
    unreviewed: 1,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  });
  const batchResponse = () => ({
    batch,
    items: [
      {
        id: itemId,
        batchId,
        inputIndex: 0,
        input: "UnknownLanguage001",
        status: "ready",
        processingNeed: "transcription",
        youtubeVideoId: "UnknownLanguage001",
        title: "Unknown-language fixture",
        catalogVideoId: videoId,
        state: confirmed ? "queued" : "needs_language_confirmation",
        reviewStatus: "unreviewed",
        attempt: 0,
        version: 1,
        languageGate: gate(),
        createdAt: now,
        updatedAt: now,
      },
    ],
    summary: {
      total: 1,
      ready: 1,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: progress(),
  });
  await page.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/cloud-api", "");
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Unknown language fixture project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: { batches: [{ batch, progress: progress() }] },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`) {
      return route.fulfill({ json: { items: [] } });
    }
    if (
      path === `/api/projects/${projectId}/transcription-batches/${batchId}`
    ) {
      return route.fulfill({ json: batchResponse() });
    }
    if (
      path === `/api/projects/${projectId}/videos/${videoId}/language-decisions`
    ) {
      decisionBody = request.postDataJSON();
      confirmed = true;
      return route.fulfill({
        json: { decision: gate().decision, gate: gate() },
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const fieldset = page.getByRole("group", {
    name: "Language confirmation required",
  });
  const languageInput = fieldset.getByLabel(
    "Confirmed spoken language for Unknown-language fixture",
  );
  const confirmButton = fieldset.getByRole("button", {
    name: "Confirm language and retry",
  });
  await expect(fieldset).toContainText("Provider-reported language: Unknown");
  await expect(fieldset).toContainText("Creator-reported language: Unknown");
  await expect(languageInput).toBeEnabled();
  await expect(languageInput).toHaveAttribute(
    "placeholder",
    "Choose or type a language code",
  );
  const suggestionsId = await languageInput.getAttribute("list");
  expect(suggestionsId).toBeTruthy();
  await expect(page.locator(`#${suggestionsId} option[value="dz"]`)).toHaveText(
    "Dzongkha (dz)",
  );
  await expect(confirmButton).toBeDisabled();

  await languageInput.fill("?");
  await expect(fieldset.getByRole("alert")).toContainText(
    "Enter a valid BCP-47 language tag",
  );
  await expect(confirmButton).toBeDisabled();

  await languageInput.fill("dz");
  await expect(fieldset).toContainText("Selected: Dzongkha (dz)");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(fieldset).toHaveCount(0);
  expect(decisionBody).toMatchObject({
    expectedDecisionVersion: 0,
    resolvedLanguage: "dz",
    basis: "user_confirmation",
    batchItemId: itemId,
    expectedBatchItemVersion: 1,
  });
});

test("confirms a language-gated batch item through the catalog worklist", async ({
  page,
  context,
}) => {
  const now = "2026-08-23T12:00:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee70";
  const batchId = "019fbb95-cd76-7920-93fa-e23ba755ee71";
  const itemId = "019fbb95-cd76-7920-93fa-e23ba755ee72";
  const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee73";
  let decisionVersion = 1;
  let postCount = 0;
  let gateState: "needs_language_confirmation" | "needs_translation" | "ready" =
    "needs_language_confirmation";
  let lastBody: Record<string, unknown> | undefined;
  const decisionBodies: Record<string, unknown>[] = [];
  const languageGate = () =>
    gateState === "ready"
      ? {
          state: "ready" as const,
          status: "confirmed" as const,
          creatorReportedLanguage: "dz",
          providerEvidence: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee74",
            projectId,
            videoId,
            source: "caption" as const,
            provider: "fixture-captions",
            reportedLanguage: "ko",
            trackFingerprint: "a".repeat(64),
            captionKind: "automatic" as const,
            createdAt: now,
          },
          decision: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee75",
            projectId,
            videoId,
            decisionVersion,
            status: "confirmed" as const,
            basis: "user_confirmation" as const,
            resolvedLanguage: "dz",
            evidenceId: "019fbb95-cd76-7920-93fa-e23ba755ee74",
            actorId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
            createdAt: now,
          },
          remediationReason: "none" as const,
        }
      : {
          state: gateState,
          status: "conflict" as const,
          creatorReportedLanguage: "dz",
          providerEvidence: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee74",
            projectId,
            videoId,
            source: "caption" as const,
            provider: "fixture-captions",
            reportedLanguage: "ko",
            trackFingerprint: "a".repeat(64),
            captionKind: "automatic" as const,
            createdAt: now,
          },
          decision: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee75",
            projectId,
            videoId,
            decisionVersion,
            status: "conflict" as const,
            basis: "creator_metadata" as const,
            resolvedLanguage: "dz",
            evidenceId: "019fbb95-cd76-7920-93fa-e23ba755ee74",
            actorId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
            createdAt: now,
          },
          ...(gateState === "needs_translation"
            ? {
                translationCapability: {
                  provider: "fixture-translate",
                  operation: "translation" as const,
                  sourceLanguage: "dz",
                  targetLanguage: "en",
                  state: "unsupported" as const,
                  reason: "language_not_supported" as const,
                },
                remediationReason: "select_supported_provider" as const,
              }
            : { remediationReason: "resolve_conflict" as const }),
        };
  const item = () => ({
    id: itemId,
    batchId,
    inputIndex: 0,
    input: "GatedFixture001",
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: "GatedFixture001",
    title: "Language-gated fixture",
    catalogVideoId: videoId,
    state: gateState === "ready" ? "queued" : "needs_language_confirmation",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 3,
    languageGate: languageGate(),
    createdAt: now,
    updatedAt: now,
  });
  const batch = () => ({
    id: batchId,
    projectId,
    name: "Language gate batch",
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const batchResponse = () => ({
    batch: batch(),
    items: [item()],
    summary: {
      total: 1,
      ready: 1,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: {
      total: 1,
      queued: gateState === "ready" ? 1 : 0,
      active: 0,
      readyForReview: 0,
      blocked: gateState === "ready" ? 0 : 1,
      failed: 0,
      retryableFailed: 0,
      canceled: 0,
      unreviewed: 1,
      reviewing: 0,
      reviewed: 0,
      skipped: 0,
    },
  });
  await page.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/cloud-api", "");
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Language fixture project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: {
          batches: [{ batch: batch(), progress: batchResponse().progress }],
        },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`) {
      return route.fulfill({ json: { items: [] } });
    }
    if (
      path === `/api/projects/${projectId}/transcription-batches/${batchId}`
    ) {
      return route.fulfill({ json: batchResponse() });
    }
    if (
      path === `/api/projects/${projectId}/videos/${videoId}/language-decisions`
    ) {
      lastBody = request.postDataJSON();
      decisionBodies.push(lastBody!);
      postCount += 1;
      if (postCount === 1) {
        decisionVersion = 2;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "stale_version",
              message: "Decision changed.",
              retryable: true,
            },
          },
        });
      }
      if (postCount === 2) {
        gateState = "needs_translation";
        return route.fulfill({
          json: { decision: languageGate().decision, gate: languageGate() },
        });
      }
      gateState = "ready";
      return route.fulfill({
        json: { decision: languageGate().decision, gate: languageGate() },
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const fieldset = page.getByRole("group", {
    name: "Language confirmation required",
  });
  await expect(fieldset).toContainText("Provider-reported language: ko");
  await expect(fieldset).toContainText("Creator-reported language: dz");
  await expect(fieldset).toContainText("Current resolved language: dz");
  await expect(fieldset).toContainText(
    "Status: conflict. Basis: creator_metadata.",
  );
  await expect(
    fieldset
      .getByLabel("Confirmed spoken language for Language-gated fixture")
      .locator("option"),
  ).toHaveText(["dz", "ko"]);
  await expect(page.getByRole("button", { name: "Open video" })).toHaveCount(0);

  await fieldset
    .getByRole("button", { name: "Confirm language and retry" })
    .click();
  await expect(fieldset).toContainText("Decision changed.");
  expect(lastBody).toMatchObject({
    expectedDecisionVersion: 1,
    resolvedLanguage: "dz",
    basis: "user_confirmation",
    evidenceId: "019fbb95-cd76-7920-93fa-e23ba755ee74",
    batchItemId: itemId,
    expectedBatchItemVersion: 3,
  });
  expect(JSON.stringify(lastBody)).not.toMatch(
    /fixture-captions|GatedFixture001|https?:|path/i,
  );

  await fieldset
    .getByRole("button", { name: "Confirm language and retry" })
    .click();
  await expect(fieldset).toContainText(
    "Translation is unsupported (language not supported).",
  );
  await expect(
    fieldset.getByRole("button", {
      name: "Choose a supported language to retry",
    }),
  ).toBeDisabled();
  expect(decisionBodies[1]?.idempotencyKey).toBe(
    decisionBodies[0]?.idempotencyKey,
  );
  await fieldset
    .getByLabel("Confirmed spoken language for Language-gated fixture")
    .selectOption("ko");

  await fieldset
    .getByRole("button", { name: "Confirm language and retry" })
    .click();
  await expect(fieldset).toHaveCount(0);
  expect(decisionBodies[2]?.idempotencyKey).not.toBe(
    decisionBodies[1]?.idempotencyKey,
  );
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Language confirmation required" }),
  ).toHaveCount(0);

  const secondClient = await context.newPage();
  await secondClient.goto("/");
  await secondClient
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await secondClient.getByRole("button", { name: "Connect" }).click();
  await expect(
    secondClient.getByRole("group", { name: "Language confirmation required" }),
  ).toHaveCount(0);
  await secondClient.close();
});

test("does not leak a delayed language gate after changing projects", async ({
  page,
}) => {
  const now = "2026-08-23T12:00:00.000Z";
  const projectA = "019fbb95-cd76-7920-93fa-e23ba755ee80";
  const projectB = "019fbb95-cd76-7920-93fa-e23ba755ee81";
  const batchA = "019fbb95-cd76-7920-93fa-e23ba755ee82";
  const batchB = "019fbb95-cd76-7920-93fa-e23ba755ee83";
  let resolveDelayedBatchA: (() => void) | undefined;
  const delayedBatchA = new Promise<void>((resolve) => {
    resolveDelayedBatchA = resolve;
  });
  let batchARequested = false;
  const batch = (id: string, projectId: string, name: string) => ({
    id,
    projectId,
    name,
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const progress = {
    total: 1,
    queued: 0,
    active: 0,
    readyForReview: 0,
    blocked: 1,
    failed: 0,
    retryableFailed: 0,
    canceled: 0,
    unreviewed: 1,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  };
  const gateItem = {
    id: "019fbb95-cd76-7920-93fa-e23ba755ee84",
    batchId: batchA,
    inputIndex: 0,
    input: "DelayedGateFixture001",
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: "DelayedGateFixture001",
    title: "Delayed language gate",
    catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee85",
    state: "needs_language_confirmation",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 1,
    languageGate: {
      state: "needs_language_confirmation",
      status: "conflict",
      creatorReportedLanguage: "dz",
      remediationReason: "resolve_conflict",
    },
    createdAt: now,
    updatedAt: now,
  };
  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectA,
            name: "Project A",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: projectB,
            name: "Project B",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    const projectId = path.match(/^\/api\/projects\/([^/]+)/)?.[1];
    if (projectId && path.endsWith("/transcription-batches")) {
      const selected =
        projectId === projectA
          ? batch(batchA, projectA, "A batch")
          : batch(batchB, projectB, "B batch");
      return route.fulfill({
        json: { batches: [{ batch: selected, progress }] },
      });
    }
    if (projectId && path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith(`/transcription-batches/${batchA}`)) {
      batchARequested = true;
      await delayedBatchA;
      return route.fulfill({
        json: {
          batch: batch(batchA, projectA, "A batch"),
          items: [gateItem],
          summary: {
            total: 1,
            ready: 1,
            existingTranscripts: 0,
            duplicates: 0,
            unsupported: 0,
            metadataFailed: 0,
          },
          progress,
        },
      });
    }
    if (path.endsWith(`/transcription-batches/${batchB}`)) {
      return route.fulfill({
        json: {
          batch: batch(batchB, projectB, "B batch"),
          items: [],
          summary: {
            total: 0,
            ready: 0,
            existingTranscripts: 0,
            duplicates: 0,
            unsupported: 0,
            metadataFailed: 0,
          },
          progress: { ...progress, total: 0, blocked: 0, unreviewed: 0 },
        },
      });
    }
    if (path === `/api/projects/${projectA}/keywords`) {
      return route.fulfill({
        json: {
          projectId: projectA,
          keywordSetVersion: 2,
          keywords: [
            {
              id: "019fbb95-cd76-7920-93fa-e23ba755ee86",
              projectId: projectA,
              label: "Project A only keyword",
              enabled: true,
              version: 1,
              createdBy: {
                userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                handle: "e2e_user",
                displayName: "E2E User",
              },
              createdAt: now,
              updatedAt: now,
              aliases: [
                {
                  id: "019fbb95-cd76-7920-93fa-e23ba755ee87",
                  projectId: projectA,
                  keywordId: "019fbb95-cd76-7920-93fa-e23ba755ee86",
                  language: "en",
                  phrase: "Project A only keyword",
                  normalizedPhrase: "project a only keyword",
                  enabled: true,
                  version: 1,
                  createdBy: {
                    userId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
                    handle: "e2e_user",
                    displayName: "E2E User",
                  },
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
          ],
          suggestions: [],
        },
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => batchARequested).toBe(true);
  await page.getByRole("button", { name: "Project Settings" }).click();
  await expect(page.getByLabel("Project keywords")).toContainText(
    "Project A only keyword",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Keyword result group").selectOption("action_needed");
  await page.getByLabel("Keyword scan state").selectOption("failed");
  await page
    .getByLabel("Approved keyword filter")
    .selectOption("019fbb95-cd76-7920-93fa-e23ba755ee86");
  await page.getByLabel("Keyword result sort").selectOption("recency");
  await page.getByLabel("Active project").selectOption(projectB);
  await expect(page.getByText("B batch", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Project Settings" }).click();
  await expect(page.getByLabel("Project keywords")).not.toContainText(
    "Project A only keyword",
  );
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByLabel("Keyword result group")).toHaveValue("all");
  await expect(page.getByLabel("Keyword scan state")).toHaveValue("all");
  await expect(page.getByLabel("Approved keyword filter")).toHaveValue("");
  await expect(page.getByLabel("Keyword result sort")).toHaveValue("coverage");
  await expect(
    page
      .getByLabel("Approved keyword filter")
      .locator('option[value="019fbb95-cd76-7920-93fa-e23ba755ee86"]'),
  ).toHaveCount(0);
  resolveDelayedBatchA?.();
  await expect(
    page.getByText("Delayed language gate", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Language confirmation required" }),
  ).toHaveCount(0);
});

test("does not render an older delayed batch selection in the same project", async ({
  page,
}) => {
  const now = "2026-08-24T00:00:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee90";
  const batchAId = "019fbb95-cd76-7920-93fa-e23ba755ee91";
  const batchBId = "019fbb95-cd76-7920-93fa-e23ba755ee92";
  let releaseBatchA: (() => void) | undefined;
  let batchARequested = false;
  const delayedBatchA = new Promise<void>((resolve) => {
    releaseBatchA = resolve;
  });
  const batch = (id: string, name: string) => ({
    id,
    projectId,
    name,
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const progress = {
    total: 0,
    queued: 0,
    active: 0,
    readyForReview: 0,
    blocked: 0,
    failed: 0,
    retryableFailed: 0,
    canceled: 0,
    unreviewed: 0,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  };
  const response = (id: string, name: string, items: unknown[] = []) => ({
    batch: batch(id, name),
    items,
    summary: {
      total: items.length,
      ready: items.length,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: {
      ...progress,
      total: items.length,
      blocked: items.length,
      unreviewed: items.length,
    },
  });
  const delayedGateItem = {
    id: "019fbb95-cd76-7920-93fa-e23ba755ee93",
    batchId: batchAId,
    inputIndex: 0,
    input: "DelayedSameProject001",
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: "DelayedSameProject001",
    title: "Older delayed language gate",
    catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee94",
    state: "needs_language_confirmation",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 1,
    languageGate: {
      state: "needs_language_confirmation",
      status: "conflict",
      creatorReportedLanguage: "dz",
      remediationReason: "resolve_conflict",
    },
    createdAt: now,
    updatedAt: now,
  };
  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Same-project fixture",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: {
          batches: [
            { batch: batch(batchAId, "Batch A delayed"), progress },
            { batch: batch(batchBId, "Batch B current"), progress },
          ],
        },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`)
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith(`/transcription-batches/${batchAId}`)) {
      batchARequested = true;
      await delayedBatchA;
      return route.fulfill({
        json: response(batchAId, "Batch A delayed", [delayedGateItem]),
      });
    }
    if (path.endsWith(`/transcription-batches/${batchBId}`)) {
      return route.fulfill({
        json: response(batchBId, "Batch B current"),
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => batchARequested).toBe(true);
  const batchBButton = page.getByRole("button", { name: /Batch B current/ });
  await batchBButton.click();
  await expect(batchBButton).toHaveClass(/selected/);
  releaseBatchA?.();
  await expect(
    page.getByRole("group", { name: "Language confirmation required" }),
  ).toHaveCount(0);
  await expect(page.getByText("Older delayed language gate")).toHaveCount(0);
  await expect(batchBButton).toHaveClass(/selected/);
});

test("keeps a newer batch selected when an older language confirmation completes", async ({
  page,
}) => {
  const now = "2026-08-24T00:05:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee95";
  const batchAId = "019fbb95-cd76-7920-93fa-e23ba755ee96";
  const batchBId = "019fbb95-cd76-7920-93fa-e23ba755ee97";
  const itemId = "019fbb95-cd76-7920-93fa-e23ba755ee98";
  const videoId = "019fbb95-cd76-7920-93fa-e23ba755ee99";
  let releaseConfirmation: (() => void) | undefined;
  let confirmationStarted = false;
  let confirmationCompleted = false;
  const delayedConfirmation = new Promise<void>((resolve) => {
    releaseConfirmation = resolve;
  });
  const batch = (id: string, name: string) => ({
    id,
    projectId,
    name,
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const progress = {
    total: 0,
    queued: 0,
    active: 0,
    readyForReview: 0,
    blocked: 0,
    failed: 0,
    retryableFailed: 0,
    canceled: 0,
    unreviewed: 0,
    reviewing: 0,
    reviewed: 0,
    skipped: 0,
  };
  const languageGate = {
    state: "needs_language_confirmation" as const,
    status: "conflict" as const,
    creatorReportedLanguage: "dz",
    providerEvidence: {
      id: "019fbb95-cd76-7920-93fa-e23ba755ee9a",
      projectId,
      videoId,
      source: "caption" as const,
      provider: "fixture-captions",
      reportedLanguage: "ko",
      captionKind: "automatic" as const,
      createdAt: now,
    },
    remediationReason: "resolve_conflict" as const,
  };
  const gatedItem = {
    id: itemId,
    batchId: batchAId,
    inputIndex: 0,
    input: "ConfirmRace001",
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: "ConfirmRace001",
    title: "Confirmation race gate",
    catalogVideoId: videoId,
    state: "needs_language_confirmation",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 1,
    languageGate,
    createdAt: now,
    updatedAt: now,
  };
  const batchResponse = (id: string, name: string, items: unknown[]) => ({
    batch: batch(id, name),
    items,
    summary: {
      total: items.length,
      ready: items.length,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: {
      ...progress,
      total: items.length,
      blocked: items.length,
      unreviewed: items.length,
    },
  });
  await page.route("**/cloud-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/cloud-api",
      "",
    );
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Confirmation race project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: {
          batches: [
            { batch: batch(batchAId, "Batch A confirmation"), progress },
            { batch: batch(batchBId, "Batch B selected"), progress },
          ],
        },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`)
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith(`/transcription-batches/${batchAId}`)) {
      return route.fulfill({
        json: batchResponse(batchAId, "Batch A confirmation", [gatedItem]),
      });
    }
    if (path.endsWith(`/transcription-batches/${batchBId}`)) {
      return route.fulfill({
        json: batchResponse(batchBId, "Batch B selected", []),
      });
    }
    if (
      path === `/api/projects/${projectId}/videos/${videoId}/language-decisions`
    ) {
      confirmationStarted = true;
      await delayedConfirmation;
      confirmationCompleted = true;
      return route.fulfill({
        json: {
          decision: {
            id: "019fbb95-cd76-7920-93fa-e23ba755ee9b",
            projectId,
            videoId,
            decisionVersion: 1,
            status: "confirmed",
            basis: "user_confirmation",
            resolvedLanguage: "dz",
            actorId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
            createdAt: now,
          },
          gate: {
            state: "ready",
            status: "confirmed",
            remediationReason: "none",
          },
        },
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });

  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page
    .getByRole("group", { name: "Language confirmation required" })
    .getByRole("button", { name: "Confirm language and retry" })
    .click();
  await expect.poll(() => confirmationStarted).toBe(true);
  const batchBButton = page.getByRole("button", { name: /Batch B selected/ });
  await batchBButton.click();
  await expect(batchBButton).toHaveClass(/selected/);
  releaseConfirmation?.();
  await expect.poll(() => confirmationCompleted).toBe(true);
  await expect(
    page.getByRole("group", { name: "Language confirmation required" }),
  ).toHaveCount(0);
  await expect(batchBButton).toHaveClass(/selected/);
});

test("imports two timed tracks and takes over a delayed finalizer without re-uploading", async ({
  page,
  context,
}) => {
  const now = "2026-08-24T01:00:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755eaa1";
  const batchId = "019fbb95-cd76-7920-93fa-e23ba755eaa2";
  const itemId = "019fbb95-cd76-7920-93fa-e23ba755eaa3";
  const videoId = "019fbb95-cd76-7920-93fa-e23ba755eaa4";
  const importId = "019fbb95-cd76-7920-93fa-e23ba755eaa5";
  const decisionId = "019fbb95-cd76-7920-93fa-e23ba755eaa6";
  const candidateId = "019fbb95-cd76-7920-93fa-e23ba755eaa7";
  const transcriptVersionId = "019fbb95-cd76-7920-93fa-e23ba755eaa8";
  const originalTrackId = "019fbb95-cd76-7920-93fa-e23ba755eaa9";
  const englishTrackId = "019fbb95-cd76-7920-93fa-e23ba755eaaa";
  const projectB = "019fbb95-cd76-7920-93fa-e23ba755eab1";
  const batchB = "019fbb95-cd76-7920-93fa-e23ba755eab2";
  let finalized = false;
  let finalizationInProgress = false;
  let finalizeAttempts = 0;
  let delayUploads = false;
  let reviewAttempts = 0;
  let activated = false;
  let releaseFirstReview: (() => void) | undefined;
  const delayedFirstReview = new Promise<void>(
    (resolve) => (releaseFirstReview = resolve),
  );
  let releaseUploads: (() => void) | undefined;
  const delayedUploads = new Promise<void>(
    (resolve) => (releaseUploads = resolve),
  );
  const putBodies: Buffer[] = [];
  const batch = () => ({
    id: batchId,
    projectId,
    name: "Timed import",
    targetLanguage: "en",
    transcriptionProfile: "default",
    sourcePolicy: "prefer-existing",
    executionLocation: "local",
    priority: "normal",
    dispatchStatus: "active",
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const item = () => ({
    id: itemId,
    batchId,
    inputIndex: 0,
    input: "TimedImport001",
    status: "ready",
    processingNeed: "transcription",
    youtubeVideoId: "TimedImport001",
    title: "Timed import fixture",
    catalogVideoId: videoId,
    state: "needs_language_confirmation",
    reviewStatus: "unreviewed",
    attempt: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    languageGate: {
      state: "needs_translation",
      status: "confirmed",
      creatorReportedLanguage: "dz",
      decision: {
        id: decisionId,
        projectId,
        videoId,
        decisionVersion: 1,
        status: "confirmed",
        basis: "user_confirmation",
        resolvedLanguage: "dz",
        actorId: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        createdAt: now,
      },
      translationCapability: {
        provider: "fixture-translate",
        operation: "translation",
        sourceLanguage: "dz",
        targetLanguage: "en",
        state: "unsupported",
        reason: "language_not_supported",
      },
      remediationReason: "select_supported_provider",
    },
  });
  const response = () => ({
    batch: batch(),
    items: [item()],
    summary: {
      total: 1,
      ready: 1,
      existingTranscripts: 0,
      duplicates: 0,
      unsupported: 0,
      metadataFailed: 0,
    },
    progress: {
      total: 1,
      queued: 0,
      active: 0,
      readyForReview: finalized ? 1 : 0,
      blocked: finalized ? 0 : 1,
      failed: 0,
      retryableFailed: 0,
      canceled: 0,
      unreviewed: 1,
      reviewing: 0,
      reviewed: 0,
      skipped: 0,
    },
  });
  await context.route("**/timed-upload/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PUT",
          "access-control-allow-headers": "content-type",
        },
      });
    }
    putBodies.push(Buffer.from(route.request().postDataBuffer() ?? []));
    if (delayUploads) await delayedUploads;
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "x-amz-version-id": `version-${putBodies.length}`,
      },
    });
  });
  await context.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/cloud-api", "");
    if (path === "/api/projects")
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Timed import project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: projectB,
            name: "Other project",
            description: "",
            kind: "shared",
            visibility: "invitation_only",
            currentUserRole: "owner",
            memberCount: 1,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    if (path === `/api/projects/${projectB}/transcription-batches`)
      return route.fulfill({
        json: {
          batches: [
            {
              batch: {
                ...batch(),
                id: batchB,
                projectId: projectB,
                name: "Other batch",
              },
              progress: { ...response().progress, total: 0, blocked: 0 },
            },
          ],
        },
      });
    if (path === `/api/projects/${projectB}/review-inbox`)
      return route.fulfill({ json: { items: [] } });
    if (path === `/api/projects/${projectB}/transcription-batches/${batchB}`)
      return route.fulfill({
        json: {
          batch: {
            ...batch(),
            id: batchB,
            projectId: projectB,
            name: "Other batch",
          },
          items: [],
          summary: {
            total: 0,
            ready: 0,
            existingTranscripts: 0,
            duplicates: 0,
            unsupported: 0,
            metadataFailed: 0,
          },
          progress: { ...response().progress, total: 0, blocked: 0 },
        },
      });
    if (path === `/api/projects/${projectId}/transcription-batches`)
      return route.fulfill({
        json: { batches: [{ batch: batch(), progress: response().progress }] },
      });
    if (path === `/api/projects/${projectId}/review-inbox`)
      return route.fulfill({ json: { items: [] } });
    if (path === `/api/projects/${projectId}/transcription-batches/${batchId}`)
      return route.fulfill({ json: response() });
    const base = `/api/projects/${projectId}/videos/${videoId}/timed-transcript-imports`;
    if (path === base && url.searchParams.get("batchItemId") === itemId)
      return finalized
        ? route.fulfill({
            json: {
              importId,
              projectId,
              catalogVideoId: videoId,
              batchItemId: itemId,
              state: "finalized",
              version: 1,
              sourceLanguage: "dz",
              targetLanguage: "en",
              languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
              languageDecisionVersion: 1,
              createdAt: now,
              expiresAt: now,
              candidate: {
                candidateId: "019fbb95-cd76-7920-93fa-e23ba755eaa7",
                transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755eaa8",
                timingPrecision: "cue",
                finalizedAt: now,
              },
            },
          })
        : finalizationInProgress
          ? route.fulfill({
              json: {
                importId,
                projectId,
                catalogVideoId: videoId,
                batchItemId: itemId,
                state: "finalizing",
                version: 1,
                sourceLanguage: "dz",
                targetLanguage: "en",
                languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
                languageDecisionVersion: 1,
                createdAt: now,
                expiresAt: now,
              },
            })
          : route.fulfill({
              status: 404,
              json: {
                error: {
                  code: "not_found",
                  message: "Not found",
                  retryable: false,
                },
              },
            });
    if (path === base && request.method() === "POST")
      return route.fulfill({
        json: {
          importId,
          projectId,
          catalogVideoId: videoId,
          batchItemId: itemId,
          sourceLanguage: "dz",
          languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
          languageDecisionVersion: 1,
          expiresAt: now,
          targets: [
            {
              role: "original",
              format: "srt",
              objectKey: "private",
              uploadUrl: "/timed-upload/original",
            },
            {
              role: "english",
              format: "vtt",
              objectKey: "private",
              uploadUrl: "/timed-upload/english",
            },
          ],
        },
      });
    if (path === `${base}/${importId}/finalize`) {
      finalizeAttempts += 1;
      if (finalizeAttempts === 1) {
        return route.fulfill({
          status: 422,
          json: {
            error: {
              code: "cue_out_of_bounds",
              message: "Timed cue is outside the video duration.",
              retryable: false,
            },
          },
        });
      }
      if (finalizeAttempts === 2) {
        finalizationInProgress = true;
        return route.fulfill({
          json: {
            importId,
            projectId,
            catalogVideoId: videoId,
            batchItemId: itemId,
            state: "finalizing",
            version: 1,
            sourceLanguage: "dz",
            targetLanguage: "en",
            languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
            languageDecisionVersion: 1,
            createdAt: now,
            expiresAt: now,
          },
        });
      }
      finalized = true;
      finalizationInProgress = false;
      return route.fulfill({
        json: {
          importId,
          projectId,
          catalogVideoId: videoId,
          batchItemId: itemId,
          state: "finalized",
          version: 1,
          sourceLanguage: "dz",
          targetLanguage: "en",
          languageDecisionId: "019fbb95-cd76-7920-93fa-e23ba755eaa6",
          languageDecisionVersion: 1,
          createdAt: now,
          expiresAt: now,
          candidate: {
            candidateId: "019fbb95-cd76-7920-93fa-e23ba755eaa7",
            transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755eaa8",
            timingPrecision: "cue",
            finalizedAt: now,
          },
        },
      });
    }
    const candidateBase = `/api/projects/${projectId}/videos/${videoId}/timed-transcript-candidates/${candidateId}`;
    if (path === `${candidateBase}/review`) {
      reviewAttempts += 1;
      if (reviewAttempts === 1) await delayedFirstReview;
      return route.fulfill({
        json: {
          candidateId,
          importId,
          transcriptVersionId,
          projectId,
          catalogVideoId: videoId,
          projectVideoVersion: 3,
          languageDecisionId: decisionId,
          languageDecisionVersion: 1,
          finalizedAt: now,
          offset: 0,
          limit: 25,
          hasMore: false,
          original: {
            trackId: originalTrackId,
            trackVersion: 1,
            language: "dz",
            kind: "original",
            source: "manual-import",
            provider: "researcher-timed-import",
            timingPrecision: "cue",
            contentSha256: "a".repeat(64),
            totalCues: 1,
            cues: [
              {
                id: "019fbb95-cd76-7920-93fa-e23ba755eaab",
                ordinal: 0,
                startMs: 0,
                endMs: 1_000,
                text: "ཀ",
              },
            ],
          },
          english: {
            trackId: englishTrackId,
            trackVersion: 1,
            language: "en",
            kind: "english",
            source: "manual-import",
            provider: "researcher-timed-import",
            sourceTrackId: originalTrackId,
            timingPrecision: "cue",
            contentSha256: "b".repeat(64),
            totalCues: 1,
            cues: [
              {
                id: "019fbb95-cd76-7920-93fa-e23ba755eaac",
                ordinal: 0,
                startMs: 0,
                endMs: 1_000,
                text: "English",
              },
            ],
          },
        },
      });
    }
    if (path === `${candidateBase}/activate`) {
      activated = true;
      return route.fulfill({
        json: {
          activationId: "019fbb95-cd76-7920-93fa-e23ba755eaad",
          state: "activated",
          projectId,
          catalogVideoId: videoId,
          importId,
          candidateId,
          transcriptVersionId,
          languageDecisionId: decisionId,
          languageDecisionVersion: 1,
          projectVideoVersion: 4,
          activatedAt: now,
        },
      });
    }
    const localProcessing = defaultLocalProcessingStatus(path);
    if (localProcessing) return route.fulfill({ json: localProcessing });
    const keywordCatalog = defaultProjectKeywordCatalog(path);
    if (keywordCatalog) return route.fulfill({ json: keywordCatalog });
    if (path.includes("/worklist")) {
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await page.getByLabel("Timed original transcript").setInputFiles({
    name: "original.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nཀ\n"),
  });
  await page.getByLabel("Timed English transcript").setInputFiles({
    name: "english.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEnglish\n"),
  });
  delayUploads = true;
  await page.getByRole("button", { name: "Import timed transcripts" }).click();
  await expect.poll(() => putBodies.length).toBeGreaterThan(0);
  await page.getByLabel("Active project").selectOption(projectB);
  await expect(page.getByText("Other batch", { exact: true })).toBeVisible();
  releaseUploads?.();
  await expect(
    page.getByText("Timed bilingual candidate finalized for review."),
  ).toHaveCount(0);
  expect(finalizeAttempts).toBe(0);
  delayUploads = false;
  await page.getByLabel("Active project").selectOption(projectId);
  await page.getByLabel("Timed original transcript").setInputFiles({
    name: "original.srt",
    mimeType: "application/x-subrip",
    buffer: Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nཀ\n"),
  });
  await page.getByLabel("Timed English transcript").setInputFiles({
    name: "english.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nEnglish\n"),
  });
  await page.getByRole("button", { name: "Import timed transcripts" }).click();
  await expect(
    page.getByText("Timed cue is outside the video duration."),
  ).toBeVisible();
  await expect(
    page.getByText("Timed bilingual candidate finalized for review."),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Import timed transcripts" }).click();
  await expect(
    page.getByText(
      "Finalization is still in progress. Retrying confirmation shortly.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Timed bilingual candidate finalized for review."),
  ).toHaveCount(0);
  await expect.poll(() => reviewAttempts).toBe(1);
  await page.getByLabel("Active project").selectOption(projectB);
  releaseFirstReview?.();
  await expect(
    page.getByRole("heading", {
      name: "Review corrected bilingual transcript",
    }),
  ).toHaveCount(0);
  await page.getByLabel("Active project").selectOption(projectId);
  await expect(
    page.getByRole("heading", {
      name: "Review corrected bilingual transcript",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^English$/u }),
  ).toBeVisible();
  await expect(page.getByText("ཀ", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Activate this exact version" })
    .click();
  await expect.poll(() => activated).toBe(true);
  await expect(
    page.getByRole("button", { name: "Corrected version active" }),
  ).toBeDisabled();
  // The retry reuses the durable in-memory receipts and only repeats finalize.
  expect(putBodies).toHaveLength(4);
});

function artifactLocatorFixture(
  id: string,
  artifactVersionId: string,
  rootId: string,
  now: string,
) {
  return {
    id,
    artifactVersionId,
    rootId,
    platform: "posix",
    availability: "verified",
    manifestSha256: "2".repeat(64),
    manifestSchemaVersion: 2,
    checkedAt: now,
    lastVerifiedAt: now,
  };
}

function artifactVersionFixture(
  clip: Record<string, any>,
  artifactVersionId: string,
  now: string,
) {
  const requestId = "019fbb95-cd76-7920-93fa-e23ba755eec4";
  const packageIdentity = `clip-${requestId}`;
  const settings = {
    container: "mp4",
    videoCodec: "h264",
    videoRateControl: { mode: "crf", value: 20 },
    maxWidth: 1920,
    frameRate: "source",
    audioCodec: "aac",
    audioKilobitsPerSecond: 192,
    omitSubtitleFilesForConfirmedEnglish: true,
    embedEnglishSubtitleTrack: false,
  };
  const resolvedSettingsSnapshot = {
    schemaVersion: 1,
    resolutionKind: "catalog",
    context: "logged",
    base: "application_default",
    applicationDefaultVersion: 1,
    overrides: {},
    overrideFields: [],
    settings,
    capability: {
      ...CURRENT_EXPORT_WORKER_CAPABILITY,
      validation: "validated",
    },
    resolutionFingerprint: "a".repeat(64),
    resolvedAt: now,
  };
  const artifact = (role: string, hash: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: hash.repeat(64),
    sourceAttempt: 1,
    validatedAt: now,
  });
  const durationMs = clip.selection.exportEndMs - clip.selection.exportStartMs;
  return {
    artifactVersionId,
    requestId,
    jobId: "019fbb95-cd76-7920-93fa-e23ba755eec5",
    projectId: clip.projectId,
    clipId: clip.id,
    requestOrigin: "clip_library",
    packageIdentity,
    video: clip.video,
    selection: clip.selection,
    sourceLanguageClass: "confirmed_english",
    preset: { presetVersion: 1, name: "Editing MP4", settings },
    resolvedSettingsSnapshot,
    resolvedExportBounds: {
      startMs: clip.selection.exportStartMs,
      endMs: clip.selection.exportEndMs,
      sourceAttempt: 1,
      resolvedAt: now,
    },
    renderedMediaProvenance: {
      durationMs,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: "b".repeat(64),
      observedProperties: {
        schemaVersion: 1,
        container: { formatNames: ["mp4"] },
        streamCounts: {
          total: 2,
          video: 1,
          audio: 1,
          subtitle: 0,
          data: 0,
          other: 0,
        },
        video: {
          codec: "h264",
          profile: "High",
          pixelFormat: "yuv420p",
          width: 1920,
          height: 1080,
          sampleAspectRatio: { numerator: 1, denominator: 1 },
          displayAspectRatio: { numerator: 16, denominator: 9 },
          averageFrameRate: { numerator: 30, denominator: 1 },
        },
        audio: {
          codec: "aac",
          sampleRate: 48000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationMs,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: now,
    },
    thumbnailProvenance: {
      extractionTimeMs: Math.floor(durationMs / 2),
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: now,
    },
    subtitleOmissionProvenance: {
      policy: "confirmed_english_user_setting",
      sourceAttempt: 1,
      validatedAt: now,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("manifest_json", "2"),
      artifact("thumbnail_jpg", "3"),
      artifact("video_mp4", "4"),
    ],
    manifest: { contentSha256: "2".repeat(64), schemaVersion: "unknown" },
    resultFingerprint: "f".repeat(64),
    completedAt: now,
  };
}
