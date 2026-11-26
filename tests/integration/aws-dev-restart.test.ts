import { execFile, fork, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { HttpActiveTranscriptCatalogClient } from "@research-video/sync";
import { LocalTranscriptObjectStore } from "@research-video/storage";
import { expect, it } from "vitest";

import {
  createTranscriptPipelineExecutor,
  HttpTranscriptPublicationClient,
} from "../../apps/worker/src/pipeline.ts";
import {
  ClaimingTranscriptionWorker,
  HttpTranscriptionWorkerControlPlane,
} from "../../apps/worker/src/worker.ts";

it("preserves published bytes and fences accepted work across API process deaths", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-125-restart-"));
  const queueFile = join(root, "queue.json");
  await writeFile(queueFile, "[]");
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  socket.close();
  await once(socket, "close");
  const { port } = address;
  const baseUrl = `http://127.0.0.1:${port}`;
  const authorization = `Bearer ${randomUUID()}|fixture:owner`;
  const outsider = `Bearer ${randomUUID()}|fixture:outsider`;
  const baseTime = Date.parse("2026-11-26T12:00:00.000Z");
  const fixture = fileURLToPath(
    new URL("../fixtures/aws-dev-restart-api.ts", import.meta.url),
  );
  let api: ChildProcess | undefined;
  const start = async (seconds: number, mode = "sqs") => {
    const timestamp = new Date(baseTime + seconds * 1_000).toISOString();
    api = fork(fixture, [root, String(port), timestamp, mode], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const result = await Promise.race([
      once(api, "message"),
      once(api, "exit").then(([code]) => {
        throw new Error(`Fixture exited: ${code}`);
      }),
    ]);
    expect(result[0]).toBe("ready");
  };
  const stop = async () => {
    if (!api || api.exitCode !== null || api.signalCode !== null) return;
    const exited = once(api, "exit");
    api.kill("SIGKILL");
    await exited;
    api = undefined;
  };
  const request = (path: string, body?: unknown, auth = authorization) =>
    fetch(`${baseUrl}${path}`, {
      headers: {
        authorization: auth,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined
        ? { method: "POST", body: JSON.stringify(body) }
        : {}),
    });
  const json = async <T>(
    path: string,
    status: number,
    body?: unknown,
    auth?: string,
  ) => {
    const response = await request(path, body, auth);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  const control = new HttpTranscriptionWorkerControlPlane({
    baseUrl,
    authorization,
    executionLocation: "local",
    leaseSeconds: 30,
  });
  const reader = new HttpActiveTranscriptCatalogClient(baseUrl, authorization);
  const scratchRoot = join(root, "worker");
  await mkdir(scratchRoot);
  const captions = await readFile(
    new URL("../fixtures/transcripts/auto-word-timed.vtt", import.meta.url),
  );
  let staleJobId: string | undefined;
  const worker = new ClaimingTranscriptionWorker(
    control,
    createTranscriptPipelineExecutor({
      scratchRoot,
      publication: new HttpTranscriptPublicationClient({
        baseUrl,
        authorization,
        fetcher: async (url, options) => {
          if (staleJobId && String(url).endsWith(`/${staleJobId}/finalize`)) {
            const { attempt, ...grant } = JSON.parse(String(options?.body));
            expect(attempt).toBe(2);
            await json("/api/transcripts/finalize", 409, grant);
            await json(`/api/transcription-jobs/${staleJobId}/finalize`, 409, {
              ...grant,
              attempt: 1,
            });
          }
          return fetch(url, options);
        },
      }),
      captions: {
        discover: async () => [
          {
            id: "fixture:en",
            language: "en",
            kind: "automatic",
            translatable: false,
            downloadAccess: "available",
          },
        ],
        acquire: async (videoId, track, directory) => {
          const path = join(directory, "captions.vtt");
          await writeFile(path, captions);
          return {
            videoId,
            track,
            path,
            format: "vtt",
            byteSize: captions.length,
            provider: "fixture",
          };
        },
      },
    }),
  );
  const pump = (fault?: string) =>
    json("/fixture/pump", fault ? 500 : 200, fault ? { fault } : {});
  try {
    await start(0, "memory");
    await json("/api/session/register", 200, { displayName: "Owner" });
    await json(
      "/api/session/register",
      200,
      { displayName: "Outsider" },
      outsider,
    );
    const project = await json<{ id: string }>("/api/projects", 201, {
      name: "Synthetic restart",
    });
    const batches = `/api/projects/${project.id}/transcription-batches`;
    const submit = (video: string, executionLocation = "local") =>
      json<{
        batch: { id: string; version: number };
        items: [
          {
            id: string;
            version: number;
            catalogVideoId: string;
            jobId: string;
          },
        ];
      }>(batches, 201, {
        name: "Synthetic",
        inputs: [video],
        executionLocation,
      });
    const first = (await submit("TEST0000001")).items[0];
    expect(await worker.runOnce()).toBe("processed");
    const published = await reader.getActiveTranscript(
      project.id,
      first.catalogVideoId,
    );
    const store = new LocalTranscriptObjectStore(join(root, "objects"));
    const inventory = join(root, "inventory");
    await mkdir(inventory);
    const entries = [];
    for (const target of published.downloads) {
      const response = await fetch(target.downloadUrl);
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        target.sha256,
      );
      await writeFile(join(inventory, target.type), bytes);
      entries.push({
        transcriptVersionId: published.transcriptVersionId,
        type: target.type,
        file: target.type,
        objectVersionId: target.objectVersionId,
      });
    }
    const indexPath = join(inventory, "index.json");
    await writeFile(indexPath, JSON.stringify(entries));
    const verify = async () => {
      const actual = await reader.getActiveTranscript(
        project.id,
        first.catalogVideoId,
      );
      expect(actual.transcriptVersionId).toBe(published.transcriptVersionId);
      expect(actual.manifest).toEqual(published.manifest);
      const targets = actual.downloads;
      for (const target of targets) {
        const response = await fetch(target.downloadUrl);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          await readFile(join(inventory, target.type)),
        );
      }
      expect(
        (
          await request(
            `/api/projects/${project.id}/videos/${first.catalogVideoId}/transcripts/active`,
            undefined,
            outsider,
          )
        ).status,
      ).toBe(403);
    };

    const legacy = (await submit("TEST0000002")).items[0];
    expect(await control.claim()).toMatchObject({
      job: { id: legacy.jobId },
      lease: { attempt: 1 },
    });
    const recovered = (await submit("TEST0000003")).items[0];
    const paused = await submit("TEST0000004");
    await json(`${batches}/${paused.batch.id}/control`, 200, {
      action: "pause_pending",
      expectedVersion: paused.batch.version,
    });
    const canceled = await submit("TEST0000005");
    await json(
      `${batches}/${canceled.batch.id}/items/${canceled.items[0].id}/cancel`,
      200,
      {
        idempotencyKey: "synthetic-cancel",
        expectedVersion: canceled.items[0].version,
      },
    );
    const pending = await submit("TEST0000006", "hosted");
    const staleSignals = [paused, canceled, pending].map(
      ({ items: [item] }, index) => ({
        schemaVersion: 1,
        jobId: item.jobId,
        executionLocation: index === 2 ? "hosted" : "local",
      }),
    );
    const reservation = await json<boolean[]>("/fixture/reserve-twice", 200, {
      jobId: recovered.jobId,
    });
    expect(reservation.sort()).toEqual([false, true]);
    expect(await readFile(queueFile, "utf8")).toBe("[]");
    await stop();

    await start(301);
    await verify();
    expect(await worker.runOnce()).toBe("processed"); // Pre-upgrade lease had no SQS receipt.
    expect(await control.claim()).toBeUndefined();
    await pump("receive");
    const [message] = JSON.parse(await readFile(queueFile, "utf8"));
    expect(message).toMatchObject({ jobId: recovered.jobId });
    expect(await control.claim()).toBeUndefined(); // Send alone grants no worker authority.
    await stop();

    await start(302);
    await verify();
    await pump("delete");
    expect(await readFile(queueFile, "utf8")).toContain(recovered.jobId);
    const stranger = new HttpTranscriptionWorkerControlPlane({
      baseUrl,
      authorization: outsider,
      executionLocation: "local",
      leaseSeconds: 30,
    });
    expect(await stranger.claim()).toBeUndefined();
    expect(await control.claim()).toMatchObject({
      job: { id: recovered.jobId },
      lease: { attempt: 1 },
    });
    expect(await control.claim()).toBeUndefined();
    await stop();

    await start(334);
    await pump(); // The receipt survived its interrupted delete.
    staleJobId = recovered.jobId;
    expect(await worker.runOnce()).toBe("processed");
    await writeFile(queueFile, JSON.stringify([message, ...staleSignals]));
    for (let index = 0; index <= staleSignals.length; index++) await pump();
    expect(await control.claim()).toBeUndefined();
    const hosted = new HttpTranscriptionWorkerControlPlane({
      baseUrl,
      authorization,
      executionLocation: "hosted",
      leaseSeconds: 30,
    });
    expect(await hosted.claim()).toBeUndefined();
    const final = await reader.getActiveTranscript(
      project.id,
      recovered.catalogVideoId,
    );
    expect(final.manifest.jobId).toBe(recovered.jobId);
    await verify();
    expect(
      (
        await request(
          `/api/projects/${project.id}/videos/${paused.items[0].catalogVideoId}/transcripts/active`,
        )
      ).status,
    ).toBe(404);
    await store.deleteVersion(
      published.manifestObject.objectKey,
      published.manifestObject.objectVersionId,
    );
    await expect(
      reader.getActiveTranscript(project.id, first.catalogVideoId),
    ).rejects.toMatchObject({
      code: "transcript_integrity_failed",
      statusCode: 422,
      permitsOfflineCache: false,
      message:
        "Published transcript unavailable. Stored content could not be verified.",
    });
    expect(await control.claim()).toBeUndefined();
    await stop();

    const audit = async () => {
      const { stdout } = await promisify(execFile)(process.execPath, [
        "--import",
        "tsx",
        "scripts/audit-dev-transcript-refs.ts",
        "--scratch-catalog",
        join(root, "catalog"),
        "--retained",
        inventory,
      ]);
      return JSON.parse(stdout);
    };
    const report = await audit();
    expect(await audit()).toEqual(report);
    expect(report).toContainEqual(
      expect.objectContaining({
        transcriptVersionId: published.transcriptVersionId,
        active: true,
        retained: expect.objectContaining({ state: "verified" }),
        destinationExport: expect.objectContaining({ state: "missing" }),
      }),
    );
    expect(
      report.filter((row: { active: boolean }) => row.active),
    ).toHaveLength(3);
    expect(report).toHaveLength(3); // One version each, even after duplicate delivery and stale finalize.
  } finally {
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}, 180_000);
