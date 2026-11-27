import { expect, test, type Page } from "@playwright/test";
import {
  CreateClipCandidateRequestSchema,
  CreateClipExportRequestSchema,
  CreateExportOnlyRequestSchema,
} from "@research-video/contracts";
import { normalizeTranscriptFixture } from "@research-video/transcript";
import captionFixture from "../fixtures/transcripts/auto-word-timed.json" with { type: "json" };
import englishFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const unexpectedPageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  unexpectedPageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // Specific synthetic routes registered by each test take precedence.
  // No unhandled API request may reach a backend, even if one is running.
  const isBackend = (url: URL) =>
    url.pathname.startsWith("/cloud-api/") ||
    url.pathname.startsWith("/local-agent/");
  await page.route(
    (url) => url.origin !== "http://127.0.0.1:43112" || isBackend(url),
    (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:43112") return route.abort();
      return route.fulfill({ status: 404, json: {} });
    },
  );
});

test.afterEach(({ page }) => {
  expect(unexpectedPageErrors.get(page)).toEqual([]);
});

async function waitForHostedPlayer(page: Page) {
  await expect(page.locator(".player-frame")).toHaveAttribute(
    "data-player-state",
    "ready",
  );
}

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
      transcriptionExecutionPolicy: {
        schemaVersion: 1,
        execution: "local",
        fallback: "local",
      },
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
        kind: "shared",
        visibility: "invitation_only",
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

for (const delayed of [false, true]) {
  test(`batch preflight resets on project switch (${delayed ? "late" : "completed"} response)`, async ({
    page,
  }) => {
    let releaseFirst!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requests: string[] = [];
    const titleA = "First project preflight fixture";
    const titleB = "Second project preflight fixture";
    await page.route("**/cloud-api/api/projects/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/review-inbox"))
        return route.fulfill({ json: { items: [] } });
      if (path.endsWith("/transcription-batches"))
        return route.fulfill({ json: { batches: [] } });
      if (path.endsWith("/videos/preflight")) {
        const projectId = path.split("/")[4]!;
        const { inputs, ...options } = request.postDataJSON();
        requests.push(projectId);
        expect(inputs).toEqual([liveVideo]);
        expect(options.priority).toBe("high");
        if (delayed && projectId === liveProject) await holdFirst;
        return route.fulfill({
          json: {
            projectId,
            options,
            items: [
              {
                inputIndex: 0,
                input: liveVideo,
                status: "ready",
                processingNeed: "transcription",
                title: projectId === liveProject ? titleA : titleB,
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
          },
        });
      }
      return route.fulfill({ status: 404, json: {} });
    });

    await connectFakeProject(page, [liveProject, secondProject]);
    const queue = page.getByRole("region", { name: "Transcription queue" });
    const inputs = queue.getByLabel("YouTube URLs or video IDs, one per line");
    const preflight = queue.getByRole("button", { name: "Preflight 1" });
    const create = queue.getByRole("button", { name: "Create batch" });
    await inputs.fill(liveVideo);
    await queue.getByLabel("Priority").selectOption("high");
    await expect(create).toBeDisabled();
    await preflight.click();
    await expect.poll(() => requests).toEqual([liveProject]);
    if (!delayed) {
      await expect(queue.getByText(titleA)).toBeVisible();
      await expect(create).toBeEnabled();
    }

    await page.getByLabel("Target project").selectOption(secondProject);
    if (delayed) releaseFirst();
    await expect(preflight).toBeEnabled();
    await expect(queue.getByText(titleA)).toHaveCount(0);
    await expect(create).toBeDisabled();
    await expect(inputs).toHaveValue(liveVideo);
    await expect(queue.getByLabel("Priority")).toHaveValue("high");
    await preflight.click();
    await expect.poll(() => requests).toEqual([liveProject, secondProject]);
    await expect(queue.getByText(titleB)).toBeVisible();
    await expect(create).toBeEnabled();

    // Existing input and option invalidation still requires a fresh preflight.
    await queue.getByLabel("Priority").selectOption("normal");
    await expect(queue.getByText(titleB)).toHaveCount(0);
    await expect(create).toBeDisabled();
  });
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
      await waitForHostedPlayer(page);
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
        options: {
          videoId: string;
          events: {
            onReady(): void;
            onStateChange(event: { data: number }): void;
            onError(event: { data: number }): void;
          };
        },
      ) {
        queueMicrotask(() => options.events.onReady());
        Object.assign(window, {
          __triggerYouTubeEnded: () =>
            options.events.onStateChange({ data: 0 }),
        });
      }

      cueVideoById() {}
      destroy() {}
      loadVideoById(options: {
        videoId: string;
        startSeconds: number;
        endSeconds: number;
      }) {
        this.currentTime = options.startSeconds;
        const calls = (Reflect.get(window, "__loadVideoByIdCalls") ??
          []) as (typeof options)[];
        calls.push(options);
        Object.assign(window, {
          __loadVideoByIdCalls: calls,
          __lastSeekSeconds: options.startSeconds,
          __playCalls: Number(Reflect.get(window, "__playCalls") ?? 0) + 1,
        });
      }
      getDuration() {
        return 4000; // synthetic duration includes the last timed-caption cue
      }
      getCurrentTime() {
        return this.currentTime;
      }
      seekTo(seconds: number) {
        this.currentTime = seconds;
        Object.assign(window, { __lastSeekSeconds: seconds });
      }
      pauseVideo() {
        Object.assign(window, {
          __pauseCalls: Number(Reflect.get(window, "__pauseCalls") ?? 0) + 1,
        });
      }
      playVideo() {
        Object.assign(window, {
          __playCalls: Number(Reflect.get(window, "__playCalls") ?? 0) + 1,
        });
      }
    }

    Object.assign(window, {
      YT: {
        Player: MockPlayer,
        PlayerState: { ENDED: 0, PAUSED: 2, PLAYING: 1 },
      },
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
  await waitForHostedPlayer(page);
  await page.getByRole("button", { name: "any word", exact: true }).click();

  await expect(page.getByText("Word requested 0:02.")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(2.2);
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__playCalls")))
    .toBe(1);

  await page.getByLabel("Search transcript").fill("accurate");
  await expect(page.getByText("1 of 1")).toBeVisible();
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect(page.getByText("Cue requested 0:00.")).toBeVisible();
});

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

test("desktop player waits for readiness and plays from a transcript word", async ({
  page,
}) => {
  await page.route("https://www.youtube-nocookie.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><body><script>
        document.body.dataset.listens = "0";
        document.body.dataset.ready = "false";
        window.__receivedPlayerCommands = [];
        window.addEventListener("message", ({ data, source, origin }) => {
          const message = JSON.parse(data);
          if (message.event === "listening") {
            const attempts = Number(document.body.dataset.listens) + 1;
            document.body.dataset.listens = String(attempts);
            if (attempts === 2) {
              document.body.dataset.ready = "true";
              source.postMessage(JSON.stringify({ event: "onReady" }), origin);
            }
          }
          if (message.event === "command") {
            if (document.body.dataset.ready !== "true") {
              document.body.dataset.earlyCommand = message.func;
            }
            window.__receivedPlayerCommands.push(message);
            if (message.func === "playVideo") {
              source.postMessage(
                JSON.stringify({ info: { playerState: 1 } }),
                origin,
              );
            }
          }
        });
      </script>`,
    }),
  );
  await page.goto("/?fixture=english-word");
  await expect(
    page.getByRole("heading", { name: "Navigate video by transcript" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.assign(window, { researchVideoDesktop: {} });
  });
  await page.getByRole("button", { name: "Load video" }).click();

  const player = page.frameLocator('iframe[title="YouTube video player"]');
  await expect(page.getByRole("button", { name: "Play video" })).toBeEnabled();
  await expect(player.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(player.locator("body")).not.toHaveAttribute(
    "data-early-command",
    /./u,
  );
  await page.getByRole("button", { name: "any word", exact: true }).click();
  await expect(page.getByText("Word requested 0:02.")).toBeVisible();
  await expect
    .poll(() =>
      player.locator("body").evaluate((body) => {
        const commands = Reflect.get(
          body.ownerDocument.defaultView!,
          "__receivedPlayerCommands",
        ) as Array<{ func?: string; args?: unknown[] }> | undefined;
        return commands?.filter((command) =>
          ["seekTo", "playVideo"].includes(command.func ?? ""),
        );
      }),
    )
    .toEqual([
      { event: "command", func: "seekTo", args: [2.2, true] },
      { event: "command", func: "playVideo", args: [] },
    ]);
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
            kind: "shared",
            visibility: "invitation_only",
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
      const body = CreateClipCandidateRequestSchema.parse(
        route.request().postDataJSON(),
      );
      expect(body.languageEvidence).toMatchObject({
        schemaVersion: 2,
        native: {
          role: "native",
          language: "en",
          trackId: captionFixture.track.id,
          trackVersion: 1,
        },
        english: {
          role: "english",
          language: "en",
          trackId: captionFixture.track.id,
          trackVersion: 1,
        },
      });
      expect(body.languageEvidence?.english.text).toContain(
        "closely now please",
      );
      loggedSelection = body.selection;
      return route.fulfill({
        status: 201,
        json: {
          id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
          projectId,
          catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
          video: body.video,
          selection: body.selection,
          languageEvidence: body.languageEvidence,
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
      const body = CreateClipExportRequestSchema.parse(
        route.request().postDataJSON(),
      );
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
          sourceRights: body.sourceRights,
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
    const body = CreateExportOnlyRequestSchema.parse(
      route.request().postDataJSON(),
    );
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
        sourceRights: body.sourceRights,
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
  await waitForHostedPlayer(page);
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
  const rangeLoads = () =>
    page.evaluate(
      () =>
        (Reflect.get(window, "__loadVideoByIdCalls") ?? []) as Array<{
          videoId: string;
          startSeconds: number;
          endSeconds: number;
        }>,
    );
  const expectRangeLoadCount = async (count: number) =>
    expect.poll(async () => (await rangeLoads()).length).toBe(count);

  await page.getByRole("button", { name: "Loop preview" }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(11.84);
  await expectRangeLoadCount(1);
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 11.84,
    endSeconds: 13.1,
  });
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole("button", { name: "now" }).click();
  await expectRangeLoadCount(2);
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 12.03,
    endSeconds: 13.1,
  });
  await page.evaluate(() => {
    const triggerEnded = Reflect.get(window, "__triggerYouTubeEnded");
    if (typeof triggerEnded !== "function")
      throw new Error("Missing YouTube ended event mock.");
    triggerEnded();
  });
  await expectRangeLoadCount(3);
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 11.84,
    endSeconds: 13.1,
  });
  await page.getByRole("button", { name: "Add 0.5s handles" }).click();
  await expect(page.getByLabel("Export start (seconds)")).toHaveValue("11.340");
  await expect(page.getByLabel("Export end (seconds)")).toHaveValue("13.600");
  await expectRangeLoadCount(4);
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 11.34,
    endSeconds: 13.6,
  });
  await page.getByRole("button", { name: "Stop preview" }).click();
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
  await page
    .getByLabel(
      /I confirm I am authorized to process this exact YouTube source/,
    )
    .check();
  await page.getByRole("button", { name: "Export + log" }).click();
  await expect(panel).toContainText("queued an export");
  expect(loggedExportRequests).toBe(1);
  await page.getByRole("button", { name: "Export only" }).click();
  await expect(panel).toContainText("Queued a local export-only job");
  expect(exportedSelection).toEqual(loggedSelection);
});

test("updates a running preview when the selected passage changes", async ({
  page,
}) => {
  await page.goto("/?fixture=auto-word-timed");
  await page.getByRole("button", { name: "Load video" }).click();
  await expect(page.getByText(/Timed auto-caption test fixture/)).toBeVisible();

  const selectRange = async (anchorText: string, focusText: string) => {
    await page.evaluate(
      ({ anchorText, focusText }) => {
        const words = Array.from(
          document.querySelectorAll<HTMLElement>("[data-transcript-token-id]"),
        );
        const anchor = words.find((word) => word.textContent === anchorText);
        const focus = words.find((word) => word.textContent === focusText);
        if (!anchor?.firstChild || !focus?.firstChild || !focus.textContent)
          throw new Error("Missing transcript words for selection.");
        const range = document.createRange();
        range.setStart(anchor.firstChild, 0);
        range.setEnd(focus.firstChild, focus.textContent.length);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        focus.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      },
      { anchorText, focusText },
    );
  };
  const rangeLoads = () =>
    page.evaluate(
      () =>
        (Reflect.get(window, "__loadVideoByIdCalls") ?? []) as Array<{
          videoId: string;
          startSeconds: number;
          endSeconds: number;
        }>,
    );

  await waitForHostedPlayer(page);
  await selectRange("closely", "please");
  const panel = page.getByLabel("Clip selection");
  await expect(panel).toContainText("Transcript selection: 11.840s–13.100s");
  await page.getByRole("button", { name: "Loop preview" }).click();
  await expect(
    page.getByRole("button", { name: "Stop preview" }),
  ).toBeVisible();
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 11.84,
    endSeconds: 13.1,
  });

  await selectRange("Résumé", "José");
  await expect(panel).toContainText("Transcript selection: 13.200s–14.700s");
  await expect(
    page.getByRole("button", { name: "Stop preview" }),
  ).toBeVisible();
  expect((await rangeLoads()).at(-1)).toEqual({
    videoId: "M7lc1UVf-VE",
    startSeconds: 13.2,
    endSeconds: 14.7,
  });

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole("button", { name: "Look" }).click();
  await expect(
    page.getByRole("button", { name: "Loop preview" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "__lastSeekSeconds")))
    .toBe(11.5);
  expect(await rangeLoads()).toHaveLength(2);
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
                kind: "shared",
                visibility: "invitation_only",
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
      const body = CreateClipCandidateRequestSchema.parse(
        request.postDataJSON(),
      );
      expect(body.languageEvidence).toMatchObject({
        schemaVersion: 2,
        native: {
          role: "native",
          language: "en",
          trackId: englishFixture.track.id,
          trackVersion: 1,
        },
        english: {
          role: "english",
          language: "en",
          trackId: englishFixture.track.id,
          trackVersion: 1,
        },
      });
      expect(body.languageEvidence?.english.text).toContain(
        "fixture has accurate word timing. Click any word",
      );
      loggedClip = {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee42",
        projectId: createdProjectId,
        catalogVideoId: "019fbb95-cd76-7920-93fa-e23ba755ee43",
        video: body.video,
        selection: body.selection,
        languageEvidence: body.languageEvidence,
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
      const body = CreateClipExportRequestSchema.parse(request.postDataJSON());
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
          selection: loggedClip?.selection,
          sourceLanguageClass: body.sourceLanguageClass,
          sourceRights: body.sourceRights,
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
    const body = CreateExportOnlyRequestSchema.parse(
      route.request().postDataJSON(),
    );
    return route.fulfill({
      status: 201,
      json: {
        id: "019fbb95-cd76-7920-93fa-e23ba755ee46",
        jobId: "019fbb95-cd76-7920-93fa-e23ba755ee47",
        mode: "export_only",
        video: body.video,
        selection: body.selection,
        sourceLanguageClass: body.sourceLanguageClass,
        sourceRights: body.sourceRights,
        preset: body.preset,
        state: "queued",
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.goto("/?fixture=english-word");
  await page.getByRole("button", { name: "Load video" }).click();

  await waitForHostedPlayer(page);
  await expect(page.getByTestId("transcript-window-row")).toHaveCount(2);
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
  await page
    .getByLabel(
      /I confirm I am authorized to process this exact YouTube source/,
    )
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
    transcriptionExecutionPolicy: {
      schemaVersion: 1,
      execution: "local",
      fallback: "local",
    },
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
            kind: "shared",
            visibility: "invitation_only",
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
