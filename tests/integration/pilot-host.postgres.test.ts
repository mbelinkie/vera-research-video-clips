/**
 * #53 end-to-end backup/restore rehearsal against REAL PostgreSQL.
 *
 * Opt-in only. Requires a disposable loopback cluster and a NON-superuser role
 * with CREATEDB, plus PostgreSQL client tools (pg_dump/pg_restore) on disk:
 *
 *   VERA53_TEST_PG_ADMIN_URL=postgresql://<role>:<secret>@127.0.0.1:<port>/postgres
 *   VERA53_TEST_PG_BIN=/Applications/Postgres.app/Contents/Versions/18/bin
 *
 * Only synthetic data is created, in databases named vera50_test_*, all of
 * which are dropped afterwards. Never point this at the Producer's pilot data.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import type { TranscriptManifest } from "@research-video/contracts";
import {
  createPostgresDatabase,
  runCloudMigrations,
} from "@research-video/db-cloud";
import {
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
} from "@research-video/storage";
import { normalizeTranscriptFixture } from "@research-video/transcript";

import {
  authenticateDevBearer,
  createCloudApi,
} from "../../apps/cloud-api/src/app.ts";
import {
  createOperatorApi,
  OperatorCounters,
  PilotWriteGate,
} from "../../apps/cloud-api/src/pilot-operations.ts";
import { createKeyFile } from "../../scripts/pilot-host/backup-crypto.ts";
import {
  collectStatus,
  hostSettings,
  runBackup,
  runRestoreDrill,
} from "../../scripts/pilot-host/operations.ts";
import wordFixture from "../fixtures/transcripts/english-word.json" with { type: "json" };

const adminUrl = process.env.VERA53_TEST_PG_ADMIN_URL;
const pgBin = process.env.VERA53_TEST_PG_BIN;
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  await new Promise<void>((closed) => server.close(() => closed()));
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}

describe.skipIf(!adminUrl || !pgBin)(
  "Mac pilot encrypted backup and restore drill (real PostgreSQL)",
  () => {
    it("backs up online, stores an encrypted verified copy off-device, restores it fresh, and reports tampering", async () => {
      process.env.PATH = `${pgBin}:${process.env.PATH ?? ""}`;
      const root = await mkdtemp(join(tmpdir(), "vera53-pg-"));
      const sourceName = `vera50_test_src_${randomBytes(4).toString("hex")}`;
      const admin = new Pool({ connectionString: adminUrl, max: 1 });
      await admin.query(`CREATE DATABASE "${sourceName}"`);
      const sourceUrl = new URL(adminUrl!);
      sourceUrl.pathname = `/${sourceName}`;
      const database = createPostgresDatabase(sourceUrl.toString());
      const objectRoot = join(root, "objects");
      const operatorPort = await freePort();
      const gate = new PilotWriteGate(objectRoot);
      const operator = createOperatorApi({
        port: operatorPort,
        gate,
        counters: new OperatorCounters(),
      });
      try {
        // --- Seed one real published transcript through the signed HTTP path.
        await runCloudMigrations(database);
        const store = new LocalTranscriptObjectStore(objectRoot);
        const signer = new LocalStagedUploadUrlIssuer(
          "http://127.0.0.1:43111/",
          "synthetic-fixture-signing-key-32-bytes-minimum",
        );
        const catalog = new SharedProjectCatalog(
          database,
          store,
          () => new Date(),
          signer,
        );
        const actor = {
          userId: randomUUID(),
          externalSubject: "synthetic:vera53",
        };
        await catalog.registerUser(actor, "Fixture author");
        const project = await catalog.createProject(actor, {
          name: "Synthetic #53 project",
        });
        const video = await catalog.addVideo(actor, project.id, {
          youtubeVideoId: "fixture-english",
          canonicalUrl: "https://www.youtube.com/watch?v=fixture-english",
          title: "Fixture video",
          durationMs: 4_000,
          sourceLanguage: "en",
        });
        const grant = await catalog.createTranscriptUpload(actor, {
          projectId: project.id,
          catalogVideoId: video.id,
          lineageId: randomUUID(),
          version: 1,
          artifactTypes: ["english-normalized", "english-srt"],
        });
        const app = createCloudApi({
          catalog,
          authenticate: authenticateDevBearer,
          localArtifacts: { store, issuer: signer, objectRoot, gate },
        });
        const marker = `SYNTHETIC-MARKER-${randomUUID()}`;
        try {
          const upload = async (
            type: "english-normalized" | "english-srt" | "manifest",
            bytes: Uint8Array,
          ) => {
            const target = grant.targets.find((item) => item.type === type)!;
            const response = await app.inject({
              method: "PUT",
              url: new URL(target.uploadUrl).pathname,
              payload: Buffer.from(bytes),
              headers: {
                "content-type":
                  type === "english-srt"
                    ? "application/x-subrip"
                    : "application/json",
              },
            });
            expect(response.statusCode).toBe(200);
            return {
              type,
              objectKey: target.objectKey,
              objectVersionId: String(response.headers["x-amz-version-id"]),
              byteSize: bytes.length,
              sha256: digest(bytes),
            };
          };
          const transcript = normalizeTranscriptFixture({
            ...wordFixture,
            track: { ...wordFixture.track, videoId: video.youtubeVideoId },
          });
          const normalized = await upload(
            "english-normalized",
            new TextEncoder().encode(JSON.stringify(transcript)),
          );
          const srt = await upload(
            "english-srt",
            new TextEncoder().encode(
              `1\n00:00:00,000 --> 00:00:04,000\n${marker}\n`,
            ),
          );
          const transcriptId = randomUUID();
          const manifest: TranscriptManifest = {
            schemaVersion: 1,
            id: transcriptId,
            projectId: project.id,
            catalogVideoId: video.id,
            videoId: video.youtubeVideoId,
            lineageId: grant.lineageId,
            version: 1,
            sourceLanguage: "en",
            targetLanguage: "en",
            timingPrecision: "word",
            provider: "fixture",
            normalizationSchemaVersion: 1,
            jobId: grant.jobId,
            createdBy: actor.userId,
            createdAt: new Date().toISOString(),
            artifacts: [normalized, srt],
          };
          const manifestRef = await upload(
            "manifest",
            new TextEncoder().encode(JSON.stringify(manifest)),
          );
          const finalized = await app.inject({
            method: "POST",
            url: "/api/transcripts/finalize",
            headers: {
              authorization: `Bearer ${actor.userId}|${actor.externalSubject}`,
            },
            payload: {
              uploadId: grant.uploadId,
              idempotencyKey: `synthetic:${transcriptId}`,
              manifest: manifestRef,
            },
          });
          expect(finalized.statusCode).toBe(200);
        } finally {
          await app.close();
        }

        // --- Backup ONLINE: the API process (here, its gate + operator port) keeps running.
        await operator.listen({ host: "127.0.0.1", port: operatorPort });
        const home = join(root, "home");
        const offsite = join(root, "offsite");
        await mkdir(offsite, { recursive: true });
        const settings = hostSettings({
          PILOT_HOME: home,
          PILOT_PG_URL: sourceUrl.toString(),
          PILOT_OBJECT_ROOT: objectRoot,
          PILOT_BACKUP_DESTINATION: offsite,
          PILOT_BACKUP_KEY_FILE: join(root, "keys", "backup.key"),
          PILOT_DRILL_PG_URL: adminUrl!,
          OPERATOR_PORT: String(operatorPort),
        });
        await mkdir(join(root, "keys"), { mode: 0o700 });
        await createKeyFile(settings.keyFile);
        const backup = await runBackup(settings);
        expect(await readdir(offsite)).toEqual([backup.name]);
        // The write gate was released after the backup.
        expect(await gate.status()).toMatchObject({
          writesBlocked: false,
          inFlightWrites: 0,
        });
        // Nothing readable leaves the laptop.
        const encrypted = await readFile(join(offsite, backup.name));
        expect(encrypted.includes(Buffer.from(marker))).toBe(false);
        expect(encrypted.includes(Buffer.from("Synthetic #53 project"))).toBe(
          false,
        );
        expect(await readdir(join(home, "staging"))).toEqual([]);

        // --- Restore drill into a brand-new database and object folder.
        const drill = await runRestoreDrill(settings);
        expect(drill.backup).toBe(backup.name);
        const leftover = await admin.query<{ datname: string }>(
          "SELECT datname FROM pg_database WHERE datname LIKE 'vera50_test_drill_%'",
        );
        expect(leftover.rows).toEqual([]);
        let status = await collectStatus(settings, new Date(), async () => ({
          loaded: false,
          running: false,
        }));
        expect(status.backup.lastSuccess?.name).toBe(backup.name);
        expect(status.drill.lastSuccess?.backup).toBe(backup.name);
        expect(status.problems.join("\n")).not.toMatch(/backup|drill/iu);

        // --- A tampered off-device copy fails the drill visibly; live data untouched.
        const flipped = Buffer.from(encrypted);
        flipped[200] = (flipped[200] ?? 0) ^ 0xff;
        await writeFile(join(offsite, backup.name), flipped);
        await expect(runRestoreDrill(settings)).rejects.toThrow("integrity");
        status = await collectStatus(settings, new Date(), async () => ({
          loaded: false,
          running: false,
        }));
        expect(status.problems.join("\n")).toContain(
          "Latest restore drill FAILED",
        );
        const live = await catalog.listProjects(actor);
        expect(live.map((p) => p.name)).toContain("Synthetic #53 project");
      } finally {
        await operator.close();
        await database.close();
        await admin.query(
          `DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`,
        );
        await admin.end();
        await rm(root, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
