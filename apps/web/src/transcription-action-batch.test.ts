import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedProjectCatalog } from "@research-video/catalog";
import {
  ProjectVideoWorklistQuerySchema,
  RetryTranscriptionBatchItemRequestSchema,
  type DesktopApiRequest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import {
  pollWorkspaceRetry,
  retryWorkspaceTranscript,
  type WorkspaceRetry,
} from "./desktop-transcript-retry.ts";

import {
  findRetryableTranscriptionItem,
  selectTranscriptionBatchId,
} from "./transcription-action-batch.ts";

describe("action-required transcription batch selection", () => {
  it("surfaces a hidden automatic batch that needs language confirmation", () => {
    expect(
      selectTranscriptionBatchId(
        [],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "automatic-batch",
            },
          },
        ],
        "",
      ),
    ).toBe("automatic-batch");
  });

  it("preserves an explicitly selected listed batch", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual-one" } }, { batch: { id: "manual-two" } }],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "automatic-batch",
            },
          },
        ],
        "manual-two",
      ),
    ).toBe("manual-two");
  });

  it("does not retain a stale hidden batch after its action resolves", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual-one" } }],
        [
          {
            processing: { state: "queued", batchId: "automatic-batch" },
          },
        ],
        "automatic-batch",
      ),
    ).toBe("manual-one");
  });

  it("uses only the first exact language gate with a batch ID in canonical order", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "manual" } }],
        [
          { processing: { state: "queued", batchId: "unrelated" } },
          { processing: { state: "needs_language_confirmation" } },
          {
            processing: { state: "needs_translation", batchId: "translation" },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "first-exact-gate",
            },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "second-exact-gate",
            },
          },
        ],
        "stale-hidden-batch",
      ),
    ).toBe("first-exact-gate");
  });

  it("does not expose unrelated hidden batches when no exact gate remains", () => {
    expect(
      selectTranscriptionBatchId(
        [],
        [
          { processing: { state: "queued", batchId: "old-hidden" } },
          { processing: { state: "ready", batchId: "another-hidden" } },
          { processing: { state: "needs_language_confirmation" } },
        ],
        "old-hidden",
      ),
    ).toBeUndefined();
  });

  it("falls back to the first listed batch when a stale selection disappears", () => {
    expect(
      selectTranscriptionBatchId(
        [{ batch: { id: "first-listed" } }, { batch: { id: "second-listed" } }],
        [],
        "no-longer-listed",
      ),
    ).toBe("first-listed");
  });

  it("keeps a selected listed batch ahead of several hidden language gates", () => {
    expect(
      selectTranscriptionBatchId(
        [
          { batch: { id: "first-listed" } },
          { batch: { id: "selected-listed" } },
        ],
        [
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "hidden-one",
            },
          },
          {
            processing: {
              state: "needs_language_confirmation",
              batchId: "hidden-two",
            },
          },
        ],
        "selected-listed",
      ),
    ).toBe("selected-listed");
  });
});

describe("selected-video transcript retry", () => {
  it("selects only the exact retryable failed video from the newest batch", () => {
    expect(
      findRetryableTranscriptionItem(
        [
          {
            batch: { id: "newer", version: 4 },
            items: [
              {
                id: "other-video",
                catalogVideoId: "catalog-other",
                state: "failed",
                version: 7,
                error: { retryable: true },
              },
            ],
          },
          {
            batch: { id: "exact-batch", version: 3 },
            items: [
              {
                id: "exact-item",
                catalogVideoId: "catalog-selected",
                state: "failed",
                version: 9,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
      ),
    ).toEqual({
      batchId: "exact-batch",
      batchVersion: 3,
      itemId: "exact-item",
      itemVersion: 9,
    });
  });

  it("rejects nonretryable, nonfailed, and identity-mismatched items", () => {
    expect(
      findRetryableTranscriptionItem(
        [
          {
            batch: { id: "batch", version: 1 },
            items: [
              {
                id: "not-retryable",
                catalogVideoId: "catalog-selected",
                state: "failed",
                version: 1,
                error: { retryable: false },
              },
              {
                id: "already-queued",
                catalogVideoId: "catalog-selected",
                state: "queued",
                version: 2,
                error: { retryable: true },
              },
            ],
          },
        ],
        "catalog-selected",
      ),
    ).toBeUndefined();
  });
});

describe("desktop Retry transcript action through the fake API bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { mode: "automatic", retryable: true, race: undefined },
    { mode: "manual", retryable: true, race: undefined },
    { mode: "automatic", retryable: false, race: undefined },
    { mode: "automatic", retryable: true, race: "initial" },
    { mode: "automatic", retryable: true, race: "initial-error" },
    { mode: "automatic", retryable: true, race: "poll" },
    { mode: "automatic", retryable: true, race: "poll-before-cleanup" },
    { mode: "automatic", retryable: true, race: "poll-error" },
  ])(
    "handles $mode processing (retryable=$retryable, race=$race)",
    async ({ mode, retryable, race }) => {
      const database = new PGlite();
      try {
        await runCloudMigrations(database);
        const catalog = new SharedProjectCatalog(
          database,
          new MemoryTranscriptObjectStore(),
        );
        const actor = {
          userId: randomUUID(),
          externalSubject: "fixture:desktop-retry",
        };
        await catalog.registerUser(actor, "Retry Fixture", "retry_fixture");
        const project = await catalog.createProject(actor, {
          name: "Generated retry fixture",
        });
        const metadata = {
          youtubeVideoId: "RetryItem01",
          canonicalUrl: "https://www.youtube.com/watch?v=RetryItem01",
          title: "Generated selected video",
          sourceLanguage: "en",
        };
        const video = await catalog.addVideo(actor, project.id, metadata, {
          automaticLocalProcessing: mode === "automatic",
        });
        if (mode === "manual") {
          await catalog.createTranscriptionBatch(actor, {
            projectId: project.id,
            name: "Manual fixture",
            options: {
              targetLanguage: "en",
              transcriptionProfile: "default",
              sourcePolicy: "prefer-existing",
              executionLocation: "local",
              priority: "normal",
            },
            items: [
              {
                ...metadata,
                inputIndex: 0,
                input: metadata.canonicalUrl,
                status: "ready",
                processingNeed: "transcription",
              },
            ],
          });
        }
        const claim = await catalog.claimTranscriptionJob(actor, "local", 120);
        expect(claim).toBeDefined();
        await catalog.failTranscriptionJob(actor, claim!.job.id, {
          attempt: claim!.lease.attempt,
          code: "generated_failure",
          message: "Generated failure",
          retryable,
        });
        const row = (
          await catalog.listProjectVideoWorklist(actor, project.id, {
            limit: 50,
          })
        ).items.find((item) => item.video.id === video.id)!;
        expect(row.processing).toMatchObject({
          state: "failed",
          error: { retryable },
        });
        const batchId = row.processing.batchId!;
        const itemId = row.processing.batchItemId!;
        const detail = await catalog.getTranscriptionBatch(
          actor,
          project.id,
          batchId,
        );
        const failedItem = detail.items.find((item) => item.id === itemId)!;
        expect(failedItem).toMatchObject({
          catalogVideoId: video.id,
          state: "failed",
        });
        const listed = await catalog.listTranscriptionBatches(
          actor,
          project.id,
        );
        expect(listed.batches.map((entry) => entry.batch.id)).toEqual(
          mode === "manual" ? [batchId] : [],
        );

        const base = `/api/projects/${project.id}`;
        const retryPath = `${base}/transcription-batches/${batchId}/items/${itemId}/retry`;
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let markHeld!: () => void;
        const reachedHold = new Promise<void>((resolve) => {
          markHeld = resolve;
        });
        let polling = false;
        let holdPoll = true;
        let replay = false;
        let retryResult: unknown;
        const request = vi.fn(async (input: DesktopApiRequest) => {
          const url = new URL(input.path, "https://fixture.invalid");
          let payload: unknown;
          if (input.method === "GET" && url.pathname === `${base}/worklist`) {
            // Force a second page in the automatic case and an absent row in the
            // manual case to exercise the existing listed-batch fallback.
            if (mode === "manual") payload = { items: [], total: 0 };
            else if (!url.searchParams.has("cursor"))
              payload = { items: [], total: 1, nextCursor: "fixture+page" };
            else {
              expect(url.searchParams.get("cursor")).toBe("fixture+page");
              payload = replay
                ? { items: [row], total: 1 }
                : await catalog.listProjectVideoWorklist(
                    actor,
                    project.id,
                    ProjectVideoWorklistQuerySchema.parse({ limit: 50 }),
                  );
            }
          } else if (
            input.method === "GET" &&
            url.pathname === `${base}/transcription-batches`
          ) {
            payload = await catalog.listTranscriptionBatches(actor, project.id);
          } else if (
            input.method === "GET" &&
            url.pathname === `${base}/transcription-batches/${batchId}`
          ) {
            if (polling) {
              if (holdPoll && race?.startsWith("poll")) {
                markHeld();
                await held;
                if (race === "poll-error")
                  throw new Error("late A poll failure");
              }
              payload = {
                ...detail,
                items: detail.items.map((item) => ({
                  ...item,
                  state: "ready_for_review",
                })),
              };
            } else {
              payload = replay
                ? detail
                : await catalog.getTranscriptionBatch(
                    actor,
                    project.id,
                    batchId,
                  );
            }
          } else if (input.method === "POST" && url.pathname === retryPath) {
            const command = RetryTranscriptionBatchItemRequestSchema.parse(
              JSON.parse(input.body!),
            );
            expect(command).toEqual({
              expectedVersion: failedItem.version,
              idempotencyKey: `workspace-transcript-retry:${project.id}:${itemId}:v${failedItem.version}`,
            });
            payload = replay
              ? retryResult
              : await catalog.retryTranscriptionBatchItem(
                  actor,
                  project.id,
                  batchId,
                  itemId,
                  command,
                );
            retryResult = payload;
            if (race?.startsWith("initial") && !replay) {
              markHeld();
              await held;
              if (race === "initial-error")
                throw new Error("late A retry failure");
            }
          } else {
            throw new Error(
              `Unexpected fake API request: ${input.method} ${input.path}`,
            );
          }
          return {
            status: 200,
            body: JSON.stringify(payload),
            contentType: "application/json",
          };
        });
        let tick: (() => void) | undefined;
        const clearInterval = vi.fn(() => {
          tick = undefined;
        });
        vi.stubGlobal("window", {
          researchVideoDesktop: { request },
          setInterval: (callback: () => void) => {
            tick = callback;
            return 17;
          },
          clearInterval,
        });
        const state = vi.fn();
        const message = vi.fn();
        const reload = vi.fn();
        const pending = vi.fn<(retry: WorkspaceRetry | undefined) => void>();
        const target = { projectId: project.id, catalogVideoId: video.id };
        let current = { ...target, generation: 1 };
        const callbacks = {
          setWorkspaceLoadState: state,
          setWorkspaceMessage: message,
          setWorkspaceReload: reload,
          setWorkspaceRetry: pending,
        };
        const startRetry = (attempt = current) =>
          retryWorkspaceTranscript({
            authorization: "desktop-connected",
            target,
            projectId: project.id,
            attempt,
            isCurrent: () => current === attempt,
            ...callbacks,
          });
        const startPoll = (attempt: WorkspaceRetry) =>
          pollWorkspaceRetry({
            authorization: "desktop-connected",
            pendingRetry: attempt,
            isCurrent: () =>
              current.generation === attempt.generation &&
              current.projectId === attempt.projectId &&
              current.catalogVideoId === attempt.catalogVideoId,
            ...callbacks,
          });
        const clearWrites = () => {
          state.mockClear();
          message.mockClear();
          reload.mockClear();
          pending.mockClear();
        };
        const switchToB = () => {
          current = { ...current, catalogVideoId: randomUUID(), generation: 2 };
          clearWrites();
        };
        const assertNoWrites = () => {
          expect(state).not.toHaveBeenCalled();
          expect(message).not.toHaveBeenCalled();
          expect(reload).not.toHaveBeenCalled();
          expect(pending).not.toHaveBeenCalled();
        };
        const action = startRetry();
        if (race?.startsWith("initial")) {
          await reachedHold;
          switchToB();
          release();
          await action;
          assertNoWrites();
        } else {
          await action;
          if (race) {
            const attempt = pending.mock.lastCall?.[0];
            expect(attempt).toBeDefined();
            polling = true;
            const stop = startPoll(attempt!);
            await reachedHold;
            const oldTick = tick!;
            switchToB();
            if (race !== "poll-before-cleanup") stop();
            release();
            await new Promise<void>((resolve) => setImmediate(resolve));
            assertNoWrites();
            // Even before React's passive cleanup, invalidation must prevent
            // another request. After cleanup, the captured callback is inert.
            const requestCount = request.mock.calls.length;
            oldTick();
            expect(request.mock.calls).toHaveLength(requestCount);
            stop();
            expect(clearInterval).toHaveBeenCalledWith(17);
            expect(tick).toBeUndefined();
          }
        }
        if (race) {
          // Returning to A starts a new generation. Use a generated failed-job
          // snapshot and successful retry response rather than a live provider.
          current = { ...target, generation: 3 };
          replay = true;
          polling = false;
          holdPoll = false;
          await startRetry();
          const attempt = pending.mock.lastCall?.[0];
          expect(attempt).toMatchObject({ ...current, batchId, itemId });
          polling = true;
          const stop = startPoll(attempt!);
          await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
          expect(message).toHaveBeenLastCalledWith(
            "Transcript published. Loading it now…",
          );
          stop();
          return;
        }
        const posts = request.mock.calls
          .map(([input]) => input)
          .filter((input) => input.method === "POST");
        if (retryable) {
          expect(posts.map((input) => input.path)).toEqual([retryPath]);
          expect(pending).toHaveBeenLastCalledWith({
            ...current,
            batchId,
            itemId,
          });
          expect(state).toHaveBeenLastCalledWith("unavailable");
          expect(message).toHaveBeenLastCalledWith(
            expect.stringContaining("Retry queued"),
          );
          expect(reload).not.toHaveBeenCalled();
          const reclaimed = await catalog.claimTranscriptionJob(
            actor,
            "local",
            120,
          );
          expect(reclaimed?.job.id).toBe(claim!.job.id);
        } else {
          expect(posts).toEqual([]);
          expect(pending).toHaveBeenLastCalledWith(undefined);
          expect(state).toHaveBeenLastCalledWith("failed");
          expect(message).toHaveBeenLastCalledWith(
            expect.stringContaining("No retryable failed job exists"),
          );
          expect(reload).toHaveBeenCalledOnce();
          expect(
            await catalog.claimTranscriptionJob(actor, "local", 120),
          ).toBeFalsy();
        }
      } finally {
        await database.close();
      }
    },
    30_000,
  );
});
