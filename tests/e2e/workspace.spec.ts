import { expect, test, type Page } from "@playwright/test";
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

function projectVideoFixture(
  video: typeof directVideo | typeof romanianVideo,
  now: string,
) {
  return { ...video, version: 1, createdAt: now, updatedAt: now };
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

test.beforeEach(async ({ page }) => {
  await page.route(
    "https://www.youtube-nocookie.com/embed/**",
    async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><script>
          window.__receivedPlayerCommands = [];
          window.addEventListener("message", (event) => {
            let message;
            try { message = JSON.parse(event.data); } catch { return; }
            window.__receivedPlayerCommands.push(message);
            if (message.event !== "command") return;
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

  await expect(
    page.getByRole("heading", { name: "Navigate video by transcript" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "Open a project video" }),
  ).toBeVisible();
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
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${input.projectId}/videos`) {
      return route.fulfill({ json: [projectVideoFixture(romanianVideo, now)] });
    }
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route(
    "**/local-agent/api/projects/*/videos/*/transcript?*",
    async (route) => route.fulfill({ json: input.workspace }),
  );
}

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
  await expect(page.getByLabel("Target project")).toHaveValue(projectId);
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
      "This is verified offline cache review. Reconnect to confirm the current project transcript; Queue / log only and Export + log are unavailable until then.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Queue / log only" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Export + log" }),
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
      "Preferred translation unavailable for es-MX. Original and English remain available; logging waits for the required preferred evidence.",
    ),
  ).toBeVisible();
  await page.getByLabel("Language view").selectOption("original");
  await expect(
    page.getByText("Acesta este un exemplu românesc."),
  ).toBeVisible();
  await page.getByLabel("Language view").selectOption("english");
  await selectFirstTwoTranscriptRows(page);
  await expect(
    page.getByRole("button", { name: "Queue / log only" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Export + log" }),
  ).toBeDisabled();
});

test("maps transcript text selection to stable source and export bounds", async ({
  page,
}) => {
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
  let lastClipBody: Record<string, any> | undefined;
  let lastLoggedExportBody: Record<string, any> | undefined;
  let lastExportOnlyBody: Record<string, any> | undefined;
  let failExistingPresetDiscovery = false;
  await page.route("**/cloud-api/api/session/profile", async (route) => {
    const request = route.request();
    const body = request.method() === "PATCH" ? request.postDataJSON() : {};
    return route.fulfill({
      json: {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee36",
        externalSubject: "fixture:e2e-user",
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
                version: 1,
                createdAt: now,
                updatedAt: now,
              }
            : [
                {
                  id: existingProjectId,
                  name: "Existing essay",
                  description: "",
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
  await expect(page.getByLabel("Target project")).toHaveValue(
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
  await expect(page.getByLabel("Target project")).toHaveValue(createdProjectId);
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
  await expect(page.getByRole("button", { name: "Export only" })).toBeEnabled();
  failExistingPresetDiscovery = false;
  await page.getByLabel("Logging project").selectOption(createdProjectId);
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
    .getByLabel("Notes / intended use")
    .fill("Use this to establish the central argument.");
  await page.getByLabel("Clip tags").fill("Person: Ada, Opening, person: ada");
  await page.getByRole("button", { name: "Queue / log only" }).click();
  await expect(panel).toContainText(
    "Logged to New essay. No export was requested.",
  );
  await expect(page.getByRole("button", { name: "Logged" })).toBeDisabled();
  expect(clipPostCount).toBe(1);

  const clipQueue = page.getByRole("article", { name: /clip library/i });
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText(directVideo.title);
  await expect(clipQueue).toContainText(
    "Use this to establish the central argument.",
  );
  await clipQueue.getByRole("button", { name: "Edit notes/tags" }).click();
  await page
    .getByLabel(`Notes for ${directVideo.title}`)
    .fill("Use this in the revised opening.");
  await page
    .getByLabel(`Tags for ${directVideo.title}`)
    .fill("Opening, Theme: Institutions");
  await clipQueue.getByRole("button", { name: "Save clip" }).click();
  await expect(clipQueue).toContainText("Clip notes and tags saved.");
  await clipQueue.getByLabel("Filter tag").selectOption("Theme: Institutions");
  await clipQueue.getByRole("button", { name: "Apply cloud filters" }).click();
  await expect(clipQueue).toContainText("Use this in the revised opening.");
  await clipQueue.getByLabel("Search clips").fill("institutions");
  await clipQueue.getByRole("button", { name: "Apply cloud filters" }).click();
  await expect(clipQueue).toContainText(directVideo.title);
  await clipQueue.getByRole("button", { name: "Export CSV" }).click();
  await expect(clipQueue).toContainText(
    "Downloaded the project clip log as CSV.",
  );

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
  await page.getByRole("button", { name: "Export + log" }).click();
  await expect(panel).toContainText(
    "Logged to New essay and queued an export with the New Essay Edit snapshot.",
  );
  await expect(
    page.getByRole("button", { name: "Export queued" }),
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

  await page.getByRole("button", { name: "Export only" }).click();
  await expect(panel).toContainText(
    "Queued a local export-only job with the Personal Documentary snapshot. Nothing was added to a project.",
  );
  await expect(
    page.getByRole("button", { name: "Export-only queued" }),
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

  await page.getByLabel("Preferred transcript language").fill("es-MX");
  await page.getByRole("button", { name: "Save preference" }).click();
  await expect(page.getByLabel("Account settings")).toContainText(
    "Saved es-MX. Existing logged clips are unchanged.",
  );
  await page.getByLabel("YouTube URL or video ID").fill("Romanian001");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("es transcript")).toBeVisible();
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
  await page.getByRole("button", { name: "Queue / log only" }).click();
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
  await clipQueue.getByRole("button", { name: "Submit durable batch" }).click();
  await expect(clipQueue).toContainText(
    "Queued 2 independent export requests.",
  );
  expect(batchExportPostCount).toBe(1);
  await clipQueue.getByLabel("Filter tag").selectOption("");
  await clipQueue.getByLabel("Search clips").fill("");
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("Native (ro)");
  await expect(clipQueue).toContainText("English");
  await expect(clipQueue).toContainText("Preferred (es)");
  await clipQueue.getByText("Recent immutable artifact history").click();
  await clipQueue.getByRole("button", { name: "Resolve" }).click();
  await expect(clipQueue).toContainText("workstation reusable local");
  await clipQueue.getByRole("button", { name: "Verify" }).click();
  await clipQueue.getByRole("button", { name: "Reveal" }).click();
  await clipQueue.getByRole("button", { name: "Open clip" }).click();
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
  await page.getByLabel("Preferred transcript language").fill("en");
  await page.getByRole("button", { name: "Save preference" }).click();
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("Preferred (es)");
});

test("connects an explicit project, controls a batch, and updates review state", async ({
  page,
}) => {
  const now = "2026-08-01T12:00:00.000Z";
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee30";
  const batchId = "019fbb95-cd76-7920-93fa-e23ba755ee31";
  let batchVersion = 1;
  let dispatchStatus = "active";
  let reviewVersion = 1;
  let reviewStatus = "unreviewed";
  let workspaceRequestPath: string | undefined;
  let workspaceRequests = 0;
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
    executionLocation: "local",
    priority: "normal",
    dispatchStatus,
    createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
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
    state: "ready_for_review",
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

  await page.route("**/cloud-api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/cloud-api", "");
    if (path === "/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Essay project",
            description: "",
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (path === `/api/projects/${projectId}/transcription-batches`) {
      return route.fulfill({
        json: { batches: [{ batch: batch(), progress }] },
      });
    }
    if (path === `/api/projects/${projectId}/review-inbox`) {
      return route.fulfill({
        json: { items: [{ ...item(), batchName: "Interview research" }] },
      });
    }
    if (path === `/api/projects/${projectId}/videos`) {
      return route.fulfill({ json: [projectVideoFixture(directVideo, now)] });
    }
    if (
      path === `/api/projects/${projectId}/transcription-batches/${batchId}` &&
      request.method() === "GET"
    ) {
      return route.fulfill({ json: batchResponse() });
    }
    if (path.endsWith(`/transcription-batches/${batchId}/control`)) {
      dispatchStatus = "paused";
      batchVersion += 1;
      return route.fulfill({ json: batchResponse() });
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
    return route.fulfill({ status: 404, json: { error: "not found" } });
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

  await expect(page.getByLabel("Target project")).toHaveValue(projectId);
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

  await page
    .getByLabel("Review status for Fixture review video")
    .selectOption("reviewing");
  await expect(
    page.getByLabel("Review status for Fixture review video"),
  ).toHaveValue("reviewing");

  await page.getByRole("button", { name: "Pause pending" }).click();
  await expect(page.getByText(/paused · 1 ready/)).toBeVisible();
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
