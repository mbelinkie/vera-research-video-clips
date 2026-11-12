import { expect, test, type Page } from "@playwright/test";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import captionFixture from "../fixtures/transcripts/auto-word-timed.json" with { type: "json" };
import englishFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const liveProject = "019fbb95-cd76-7920-93fa-e23ba755ee40";
const secondProject = "019fbb95-cd76-7920-93fa-e23ba755ee48";
const liveBatch = "019fbb95-cd76-7920-93fa-e23ba755ee41";
const liveItem = "019fbb95-cd76-7920-93fa-e23ba755ee42";
const catalogVideo = "019fbb95-cd76-7920-93fa-e23ba755ee43";
const liveVersion = "019fbb95-cd76-7920-93fa-e23ba755ee44";
const liveVideo = "M7lc1UVf-VE";
const liveTime = "2026-11-12T12:00:00.000Z";

function fakeBatch(
  projectId: string,
  batchId: string,
  youtubeVideoId: string,
  state: "ready_for_review" | "transcribing" | "failed",
  overrides: Record<string, unknown> = {},
) {
  return {
    batch: {
      id: batchId,
      projectId,
      name: "Immediate review",
      targetLanguage: "en",
      transcriptionProfile: "default",
      sourcePolicy: "prefer-existing",
      executionLocation: "local",
      priority: "high",
      dispatchStatus: "active",
      createdBy: "019fbb95-cd76-7920-93fa-e23ba755ee36",
      version: 1,
      createdAt: liveTime,
      updatedAt: liveTime,
    },
    items: [
      {
        id: liveItem,
        batchId,
        inputIndex: 0,
        input: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        youtubeVideoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        catalogVideoId: catalogVideo,
        status: "ready",
        processingNeed: "transcription",
        state,
        ...(state === "ready_for_review"
          ? { activeTranscriptVersionId: liveVersion }
          : {}),
        reviewStatus: "unreviewed",
        attempt: 0,
        version: 1,
        createdAt: liveTime,
        updatedAt: liveTime,
        ...overrides,
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
    progress: {
      total: 1,
      queued: 0,
      active: state === "transcribing" ? 1 : 0,
      readyForReview: state === "ready_for_review" ? 1 : 0,
      blocked: 0,
      failed: state === "failed" ? 1 : 0,
      retryableFailed: 0,
      canceled: 0,
      unreviewed: 1,
      reviewing: 0,
      reviewed: 0,
      skipped: 0,
    },
  };
}

function verifiedFixture(videoId: string, kind: "caption" | "asr") {
  const original = kind === "caption" ? captionFixture : englishFixture;
  const transcript = normalizeTranscriptFixture({
    ...original,
    track: {
      ...original.track,
      videoId,
      ...(kind === "asr" ? { timingPrecision: "cue" } : {}),
    },
    tokens:
      kind === "asr"
        ? original.tokens.map(
            ({ startMs: _start, endMs: _end, ...token }) => token,
          )
        : original.tokens,
  });
  return {
    transcriptVersionId: liveVersion,
    source: "verified-local-cache",
    transcript,
  };
}

async function connectFakeProject(page: Page, projects = [liveProject]) {
  await page.route("**/cloud-api/api/projects", (route) =>
    route.fulfill({
      json: projects.map((id, index) => ({
        id,
        name: index === 0 ? "Personal research" : "Second research",
        description: "",
        version: 1,
        createdAt: liveTime,
        updatedAt: liveTime,
      })),
    }),
  );
  await page.goto("/");
  await page
    .getByLabel("Development session credential")
    .fill("Bearer 019fbb95-cd76-7920-93fa-e23ba755ee36|fixture:web");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByLabel("Target project")).toHaveValue(projects[0]!);
}

test("a normal launch never substitutes the API demo transcript", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Load a video" }),
  ).toBeVisible();
  await expect(page.getByText(/navigation fixture/i)).toHaveCount(0);
});

for (const source of ["caption", "asr", "failed"] as const) {
  test(`immediate ${source} workflow uses the exact batch and verified local transcript`, async ({
    page,
  }) => {
    let postCount = 0;
    let exactPolls = 0;
    let localGets = 0;
    await page.route("**/cloud-api/api/projects/**", (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/review-inbox"))
        return route.fulfill({ json: { items: [] } });
      if (
        path.endsWith("/transcription-batches") &&
        request.method() === "GET"
      ) {
        const failed = fakeBatch(liveProject, liveBatch, liveVideo, "failed", {
          error: {
            code: "worker_execution_failed",
            message: "/private/model/token SECRET",
          },
        });
        return route.fulfill({
          json: {
            batches:
              source === "failed"
                ? [{ batch: failed.batch, progress: failed.progress }]
                : [],
          },
        });
      }
      if (
        path.endsWith("/transcription-batches") &&
        request.method() === "POST"
      ) {
        postCount += 1;
        expect(request.postDataJSON()).toMatchObject({
          inputs: [`https://www.youtube.com/watch?v=${liveVideo}`],
          targetLanguage: "en",
          executionLocation: "local",
          sourcePolicy: "prefer-existing",
        });
        return route.fulfill({
          json: fakeBatch(
            liveProject,
            liveBatch,
            liveVideo,
            source === "asr"
              ? "transcribing"
              : source === "failed"
                ? "failed"
                : "ready_for_review",
            source === "failed"
              ? {
                  error: {
                    code: "worker_execution_failed",
                    message: "/private/model/token SECRET",
                  },
                }
              : {},
          ),
        });
      }
      if (path.endsWith(`/transcription-batches/${liveBatch}`)) {
        exactPolls += 1;
        return route.fulfill({
          json: fakeBatch(
            liveProject,
            liveBatch,
            liveVideo,
            source === "failed" ? "failed" : "ready_for_review",
            source === "failed"
              ? {
                  error: {
                    code: "worker_execution_failed",
                    message: "/private/model/token SECRET",
                  },
                }
              : {},
          ),
        });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route("**/local-agent/api/projects/**", (route) => {
      localGets += 1;
      expect(new URL(route.request().url()).pathname).toBe(
        `/local-agent/api/projects/${liveProject}/videos/${catalogVideo}/transcript`,
      );
      return route.fulfill({
        json: verifiedFixture(liveVideo, source === "asr" ? "asr" : "caption"),
      });
    });
    await connectFakeProject(page);
    await page
      .getByLabel("YouTube URL or video ID")
      .fill(`https://youtu.be/${liveVideo}`);
    await page.getByRole("button", { name: "Load video" }).click();
    if (source === "failed") {
      await expect(
        page
          .getByText(
            "Transcript processing failed; check the local worker and retry.",
          )
          .first(),
      ).toBeVisible();
      expect(localGets).toBe(0);
      await expect(page.getByText("/private/model/token SECRET")).toHaveCount(
        0,
      );
      await expect(page.getByTestId("transcript-window-row")).toHaveCount(0);
    } else {
      await expect(
        page.getByText("Verified English transcript ready.").first(),
      ).toBeVisible();
      await expect(page.getByTestId("transcript-window-row")).toHaveCount(
        source === "caption" ? 3 : 2,
      );
      await expect(
        page.getByText(/test fixture—not|Navigation fixture for the API demo/),
      ).toHaveCount(0);
      if (source === "caption") {
        await page.getByRole("button", { name: "closely" }).click();
        await expect(
          page.getByText(/Exact caption start requested 11.840s/),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")),
          )
          .toBe(11.84);
      } else {
        await page
          .getByRole("button", { name: "any word", exact: true })
          .click();
        await expect(page.getByText("Cue requested 0:01.")).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")),
          )
          .toBe(1.8);
        expect(exactPolls).toBeGreaterThan(0);
      }
      expect(localGets).toBe(1);
    }
    expect(postCount).toBe(1);
  });
}

test("switching project and video discards late transcript responses", async ({
  page,
}) => {
  const otherVideo = "abcdefghijk";
  let releaseFirst!: () => void;
  const holdFirst = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let firstRead = 0;
  const submitted: string[] = [];

  await page.route("**/cloud-api/api/projects/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (path.endsWith("/transcription-batches") && request.method() === "GET")
      return route.fulfill({ json: { batches: [] } });
    if (
      path.endsWith("/transcription-batches") &&
      request.method() === "POST"
    ) {
      const projectId = path.split("/")[4]!;
      const submittedVideo = new URL(
        request.postDataJSON().inputs[0],
      ).searchParams.get("v")!;
      submitted.push(`${projectId}:${submittedVideo}`);
      return route.fulfill({
        json: fakeBatch(
          projectId,
          liveBatch,
          submittedVideo,
          "ready_for_review",
        ),
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.route("**/local-agent/api/projects/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes(`/projects/${liveProject}/`)) {
      firstRead += 1;
      await holdFirst;
      try {
        await route.fulfill({ json: verifiedFixture(liveVideo, "caption") });
      } catch {
        // The old request was intentionally aborted on project change.
      }
    } else {
      const videoId = submitted.at(-1)!.split(":")[1]!;
      await route.fulfill({
        json: verifiedFixture(
          videoId,
          videoId === otherVideo ? "caption" : "asr",
        ),
      });
    }
  });

  await connectFakeProject(page, [liveProject, secondProject]);
  await page.getByLabel("YouTube URL or video ID").fill(liveVideo);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect.poll(() => firstRead).toBe(1);

  await page.getByLabel("Target project").selectOption(secondProject);
  await expect(
    page.getByRole("button", { name: "fixture", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "closely" })).toHaveCount(0);
  releaseFirst();
  await expect(
    page.getByRole("button", { name: "fixture", exact: true }),
  ).toBeVisible();

  await page.getByLabel("YouTube URL or video ID").fill(otherVideo);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByRole("button", { name: "closely" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "fixture", exact: true }),
  ).toHaveCount(0);
  expect(submitted).toEqual([
    `${liveProject}:${liveVideo}`,
    `${secondProject}:${liveVideo}`,
    `${secondProject}:${otherVideo}`,
  ]);
});

test("rejects a mismatched immutable version without showing any transcript", async ({
  page,
}) => {
  await page.route("**/cloud-api/api/projects/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/review-inbox"))
      return route.fulfill({ json: { items: [] } });
    if (
      path.endsWith("/transcription-batches") &&
      route.request().method() === "GET"
    )
      return route.fulfill({ json: { batches: [] } });
    if (
      path.endsWith("/transcription-batches") &&
      route.request().method() === "POST"
    )
      return route.fulfill({
        json: fakeBatch(liveProject, liveBatch, liveVideo, "ready_for_review"),
      });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/local-agent/api/projects/**", (route) =>
    route.fulfill({
      json: {
        ...verifiedFixture(liveVideo, "caption"),
        transcriptVersionId: "019fbb95-cd76-7920-93fa-e23ba755ee99",
      },
    }),
  );
  await connectFakeProject(page);
  await page.getByLabel("YouTube URL or video ID").fill(liveVideo);
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(
    page.getByText(/Unable to load a verified transcript/).first(),
  ).toBeVisible();
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(0);
  await expect(page.getByText("closely", { exact: true })).toHaveCount(0);
});

for (const mismatch of ["project", "video", "batch"] as const) {
  test(`refuses a ${mismatch} identity mismatch before reading local transcript`, async ({
    page,
  }) => {
    let localGets = 0;
    const ready = fakeBatch(
      liveProject,
      liveBatch,
      liveVideo,
      "ready_for_review",
    );
    const invalid = {
      ...ready,
      batch: {
        ...ready.batch,
        ...(mismatch === "project" ? { projectId: secondProject } : {}),
      },
      items: ready.items.map((item) => ({
        ...item,
        ...(mismatch === "video" ? { youtubeVideoId: "abcdefghijk" } : {}),
        ...(mismatch === "batch" ? { batchId: secondProject } : {}),
      })),
    };
    await page.route("**/cloud-api/api/projects/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/review-inbox"))
        return route.fulfill({ json: { items: [] } });
      if (
        path.endsWith("/transcription-batches") &&
        route.request().method() === "GET"
      )
        return route.fulfill({ json: { batches: [] } });
      if (
        path.endsWith("/transcription-batches") &&
        route.request().method() === "POST"
      )
        return route.fulfill({ json: invalid });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.route("**/local-agent/api/projects/**", (route) => {
      localGets += 1;
      return route.fulfill({ json: verifiedFixture(liveVideo, "caption") });
    });
    await connectFakeProject(page);
    await page.getByLabel("YouTube URL or video ID").fill(liveVideo);
    await page.getByRole("button", { name: "Load video" }).click();
    await expect(
      page.getByText(/Unable to load a verified transcript/).first(),
    ).toBeVisible();
    expect(localGets).toBe(0);
    await expect(page.getByTestId("transcript-window-row")).toHaveCount(0);
  });
}

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
  await page.goto("/?fixture=english-word");

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
  await page.goto("/?fixture=english-word");
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
