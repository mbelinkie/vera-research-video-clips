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

test("timed auto-caption fixture seeks exact starts and retains derived-end selection through queue and export", async ({
  page,
}) => {
  const projectId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
  const now = "2026-08-01T12:00:00.000Z";
  let loggedSelection: Record<string, unknown> | undefined;
  let exportedSelection: Record<string, unknown> | undefined;
  let loggedExportRequests = 0;
  await page.route("**/cloud-api/api/projects**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/cloud-api/api/projects") {
      return route.fulfill({
        json: [
          {
            id: projectId,
            name: "Caption evidence",
            description: "",
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
    }
    if (
      path === `/cloud-api/api/projects/${projectId}/clips` &&
      route.request().method() === "POST"
    ) {
      const body = route.request().postDataJSON();
      loggedSelection = body.selection;
      return route.fulfill({
        status: 201,
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          projectId,
          catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
          video: body.video,
          selection: body.selection,
          englishText: body.englishText,
          notes: body.notes,
          tags: body.tags,
          researchStatus: "candidate",
          exportStatus: "not_requested",
          createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (path.endsWith("/exports") && route.request().method() === "POST") {
      loggedExportRequests += 1;
      const body = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee44",
          jobId: "019fbb95-cd76-7920-93fa-e23ba755ee45",
          mode: "logged",
          projectId,
          clipId: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          video: {
            youtubeVideoId: "M7lc1UVf-VE",
            canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
            title: "YouTube IFrame API demo",
          },
          selection: loggedSelection,
          sourceLanguageClass: body.sourceLanguageClass,
          preset: body.preset,
          state: "queued",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (path.endsWith("/transcription-batches"))
      return route.fulfill({ json: { batches: [] } });
    if (path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/clips")) return route.fulfill({ json: [] });
    if (path.endsWith("/clip-tags")) return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: "not found" } });
  });
  await page.route("**/local-agent/api/exports", async (route) => {
    const body = route.request().postDataJSON();
    exportedSelection = body.selection;
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
  await page.goto("/?fixture=auto-word-timed");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(
    page.getByText("Exact caption word starts · derived ends (estimates)"),
  ).toBeVisible();
  await expect(page.getByText(/Timed auto-caption test fixture/)).toBeVisible();
  await expect(page.getByRole("button", { name: "closely" })).toHaveAttribute(
    "title",
    "Exact caption word start 11.840s; derived end (estimate) 12.030s",
  );
  await page.getByRole("button", { name: "closely" }).click();
  await expect(
    page.getByText(/Exact caption start requested 11.840s/),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(11.84);

  await page.evaluate(() => {
    const words = Array.from(
      document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
    );
    const anchor = words.find((word) => word.textContent === "closely");
    const focus = words.find((word) => word.textContent === "please");
    if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent)
      throw new Error("Missing timed-caption words");
    const range = document.createRange();
    range.setStart(anchor.firstChild, 0);
    range.setEnd(focus.firstChild, focus.textContent.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  const panel = page.getByLabel("Clip selection");
  await expect(panel).toContainText("closely now please");
  await expect(panel).toContainText(
    "Exact caption start · derived end (estimate)",
  );
  await expect(panel).toContainText("Transcript selection: 11.840s–13.100s");
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("11.840");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("13.100");
  await page.getByRole("button", { name: "Loop preview" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(11.84);
  await page.getByRole("button", { name: "Stop preview" }).click();
  await page.getByRole("button", { name: "Add 0.5s handles" }).click();
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("11.340");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("13.600");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Logging project")).toHaveValue(projectId);
  await page.getByRole("button", { name: "Queue / log only" }).click();
  await expect(panel).toContainText(
    "Logged to Caption evidence. No export was requested.",
  );
  expect(loggedSelection).toMatchObject({
    transcriptStartMs: 11_840,
    transcriptEndMs: 13_100,
    exportStartMs: 11_340,
    exportEndMs: 13_600,
    timingPrecision: "estimated",
    endTiming: "derived",
  });
  await page.getByRole("button", { name: "Export + log" }).click();
  await expect(panel).toContainText("queued an export");
  expect(loggedExportRequests).toBe(1);
  await page.getByRole("button", { name: "Export only" }).click();
  await expect(panel).toContainText("Queued a local export-only job");
  expect(exportedSelection).toEqual(loggedSelection);
});

test("maps transcript text selection to stable source and export bounds", async ({
  page,
}) => {
  const now = "2026-08-01T12:00:00.000Z";
  const existingProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee40";
  const createdProjectId = "019fbb95-cd76-7920-93fa-e23ba755ee41";
  let clipPostCount = 0;
  let loggedExportPostCount = 0;
  let exportOnlyPostCount = 0;
  let loggedClip: Record<string, unknown> | undefined;
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
    if (path === `/cloud-api/api/projects/${createdProjectId}/clips`) {
      if (request.method() === "GET") {
        return route.fulfill({ json: loggedClip ? [loggedClip] : [] });
      }
      clipPostCount += 1;
      const body = request.postDataJSON();
      loggedClip = {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        projectId: createdProjectId,
        catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
        video: body.video,
        selection: body.selection,
        englishText: body.englishText,
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
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("New essay");
  await page
    .getByLabel("Description (optional)")
    .fill("Created without losing the selection");
  await page.getByRole("button", { name: "Create and select project" }).click();
  await expect(page.getByLabel("Logging project")).toHaveValue(
    createdProjectId,
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

  await page.getByText("Export settings — Editing MP4").click();
  await expect(
    page.getByLabel("Omit subtitle files for confirmed-English videos"),
  ).not.toBeChecked();
  await page
    .getByLabel("Omit subtitle files for confirmed-English videos")
    .check();
  await page.getByRole("button", { name: "Export + log" }).click();
  await expect(panel).toContainText(
    "Logged to New essay and queued an export with the Editing MP4 snapshot.",
  );
  await expect(
    page.getByRole("button", { name: "Export queued" }),
  ).toBeDisabled();
  expect(loggedExportPostCount).toBe(1);

  await page.getByRole("button", { name: "Export only" }).click();
  await expect(panel).toContainText(
    "Queued a local export-only job with the Editing MP4 snapshot. Nothing was added to a project.",
  );
  await expect(
    page.getByRole("button", { name: "Export-only queued" }),
  ).toBeDisabled();
  expect(exportOnlyPostCount).toBe(1);
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
