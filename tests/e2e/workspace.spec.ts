import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class MockPlayer {
      private currentTime = 0;

      constructor(
        _element: HTMLElement,
        options: { events: { onReady(): void } },
      ) {
        queueMicrotask(() => options.events.onReady());
      }

      cueVideoById() {}
      destroy() {}
      getCurrentTime() {
        return this.currentTime;
      }
      seekTo(seconds: number) {
        this.currentTime = seconds;
        Object.assign(window, { __lastSeekSeconds: seconds });
      }
      playVideo() {
        Object.assign(window, {
          __playCalls: Number(Reflect.get(window, "__playCalls") ?? 0) + 1,
        });
      }
      pauseVideo() {
        Object.assign(window, {
          __pauseCalls: Number(Reflect.get(window, "__pauseCalls") ?? 0) + 1,
        });
      }
    }

    Object.assign(window, {
      YT: { Player: MockPlayer, PlayerState: { PLAYING: 1 } },
    });
  });
});

test("loads a canonical YouTube video and seeks from its transcript", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Navigate video by transcript" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("word timing", { exact: true })).toBeVisible();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(2);
  await page.getByRole("button", { name: "any word", exact: true }).click();

  await expect(page.getByText("Word requested 0:02.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(2.2);

  await page.getByLabel("Search transcript").fill("accurate");
  await expect(page.getByText("1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(page.getByText("Cue requested 0:00.")).toBeVisible();
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
    page.getByRole("heading", { name: "Load a video" }),
  ).toBeVisible();
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
  let clipPostCount = 0;
  let loggedExportPostCount = 0;
  let exportOnlyPostCount = 0;
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
    if (path === `/cloud-api/api/projects/${createdProjectId}/clips`) {
      if (request.method() === "GET") {
        return route.fulfill({ json: loggedClip ? [loggedClip] : [] });
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
            youtubeVideoId: "M7lc1UVf-VE",
            canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
            title: "YouTube IFrame API demo",
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
          preset: body.preset,
          state: "queued",
          createdAt: now,
          updatedAt: now,
        },
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
        preset: body.preset,
        state: "queued",
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Load video" }).click();

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
  await expect(
    page.getByRole("button", { name: "Stop preview" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(0.3);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__playCalls")))
    .toBe(1);
  await page.getByRole("button", { name: "Stop preview" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__pauseCalls")))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Add 0.5s handles" }).click();
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("0.000");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("3.400");
  await expect(panel).toContainText("Transcript selection: 0.300s–2.900s");

  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
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
  await expect(page.getByLabel("Logging project")).toHaveValue(
    createdProjectId,
  );
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    `project:${createdProjectPresetId}:v1`,
  );
  await expect(
    page.getByLabel("Logged export preset").locator("option").allTextContents(),
  ).resolves.not.toContain("Existing Project Edit v1 — project default");
  failExistingPresetDiscovery = true;
  await page.getByLabel("Logging project").selectOption(existingProjectId);
  await expect(page.getByLabel("Logged export preset")).toHaveValue(
    "built-in:editing-mp4:v1",
  );
  await expect(page.getByLabel("Conversion preset picker")).toContainText(
    "Project presets are temporarily unavailable. Continue with the current valid personal selection or Editing MP4.",
  );
  await expect(page.getByRole("button", { name: "Export only" })).toBeEnabled();
  failExistingPresetDiscovery = false;
  await page.getByLabel("Logging project").selectOption(createdProjectId);
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

  const clipQueue = page.getByRole("article", { name: /clip queue/i });
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("YouTube IFrame API demo");
  await expect(clipQueue).toContainText(
    "Use this to establish the central argument.",
  );
  await clipQueue.getByRole("button", { name: "Edit notes/tags" }).click();
  await page
    .getByLabel("Notes for YouTube IFrame API demo")
    .fill("Use this in the revised opening.");
  await page
    .getByLabel("Tags for YouTube IFrame API demo")
    .fill("Opening, Theme: Institutions");
  await clipQueue.getByRole("button", { name: "Save clip" }).click();
  await expect(clipQueue).toContainText("Clip notes and tags saved.");
  await clipQueue.getByLabel("Filter tag").selectOption("Theme: Institutions");
  await expect(clipQueue).toContainText("Use this in the revised opening.");
  await clipQueue.getByLabel("Search clips").fill("institutions");
  await expect(clipQueue).toContainText("YouTube IFrame API demo");
  await clipQueue.getByRole("button", { name: "Export CSV" }).click();
  await expect(clipQueue).toContainText(
    "Downloaded the project clip log as CSV.",
  );

  await page.getByText("Built-in Editing MP4 settings").click();
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
  expect(lastLoggedExportBody?.preset).toEqual({
    presetId: createdProjectPresetId,
    presetVersion: 1,
    name: "New Essay Edit",
    settings: presetSettings,
  });

  await page.getByRole("button", { name: "Export only" }).click();
  await expect(panel).toContainText(
    "Queued a local export-only job with the Personal Documentary snapshot. Nothing was added to a project.",
  );
  await expect(
    page.getByRole("button", { name: "Export-only queued" }),
  ).toBeDisabled();
  expect(exportOnlyPostCount).toBe(1);
  expect(lastExportOnlyBody?.preset).toEqual({
    presetId: personalPresetId,
    presetVersion: 1,
    name: "Personal Documentary",
    settings: presetSettings,
  });

  await page.getByLabel("Preferred transcript language").fill("es-MX");
  await page.getByRole("button", { name: "Save preference" }).click();
  await expect(page.getByLabel("Account settings")).toContainText(
    "Saved es-MX. Existing logged clips are unchanged.",
  );
  await page.getByLabel("YouTube URL or video ID").fill("Romanian001");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText("es transcript")).toBeVisible();
  await expect(page.getByText(/Romanian → English \+ Spanish/u)).toBeVisible();
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
  await clipQueue.getByLabel("Filter tag").selectOption("");
  await clipQueue.getByLabel("Search clips").fill("");
  await clipQueue.getByRole("button", { name: "Refresh" }).click();
  await expect(clipQueue).toContainText("Native (ro)");
  await expect(clipQueue).toContainText("English");
  await expect(clipQueue).toContainText("Preferred (es)");
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
    .getByLabel("Review status for Fixture review video")
    .selectOption("reviewing");
  await expect(
    page.getByLabel("Review status for Fixture review video"),
  ).toHaveValue("reviewing");

  await page.getByRole("button", { name: "Pause pending" }).click();
  await expect(page.getByText(/paused · 1 ready/)).toBeVisible();
});
