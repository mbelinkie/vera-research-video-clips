import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("platform-neutral populated migrations", () => {
  it("backfills cloud source, batch, and clip identity without changing legacy fields", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE videos (
          id uuid PRIMARY KEY,
          youtube_video_id text NOT NULL UNIQUE,
          canonical_url text NOT NULL
        );
        CREATE TABLE transcription_batch_items (
          id uuid PRIMARY KEY,
          youtube_video_id text
        );
        CREATE TABLE clip_candidates (
          id uuid PRIMARY KEY,
          youtube_video_id text NOT NULL
        );
        INSERT INTO videos VALUES (
          '11111111-1111-4111-8111-111111111111',
          'M7lc1UVf-VE',
          'https://www.youtube.com/watch?v=M7lc1UVf-VE'
        );
        INSERT INTO transcription_batch_items VALUES (
          '22222222-2222-4222-8222-222222222222', 'M7lc1UVf-VE'
        );
        INSERT INTO clip_candidates VALUES (
          '33333333-3333-4333-8333-333333333333', 'M7lc1UVf-VE'
        );
      `);
      await database.exec(
        await readFile(
          join(
            process.cwd(),
            "packages/db-cloud/migrations/0038_platform_neutral_source_identity.sql",
          ),
          "utf8",
        ),
      );
      const video = await database.query<{
        youtube_video_id: string;
        source_provider: string;
        provider_media_id: string;
        canonical_url: string;
      }>(
        "SELECT youtube_video_id, source_provider, provider_media_id, canonical_url FROM videos",
      );
      expect(video.rows).toEqual([
        {
          youtube_video_id: "M7lc1UVf-VE",
          source_provider: "youtube",
          provider_media_id: "M7lc1UVf-VE",
          canonical_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        },
      ]);
      await expect(
        database.query(
          "INSERT INTO videos (id, youtube_video_id, canonical_url, source_provider, provider_media_id) VALUES ($1, $2, $3, $4, $5)",
          [
            "44444444-4444-4444-8444-444444444444",
            "Different01",
            "https://www.youtube.com/watch?v=Different01",
            "youtube",
            "M7lc1UVf-VE",
          ],
        ),
      ).rejects.toThrow();
      await expect(
        database.query(
          "INSERT INTO videos (id, youtube_video_id, canonical_url, source_provider, provider_media_id) VALUES ($1, $2, $3, $4, $5)",
          [
            "55555555-5555-4555-8555-555555555555",
            "legacy-facebook-identity",
            "https://www.facebook.com/watch/?v=M7lc1UVf-VE",
            "facebook",
            "M7lc1UVf-VE",
          ],
        ),
      ).resolves.toBeDefined();
      const dependent = await database.query<{
        source_provider: string;
        provider_media_id: string;
      }>(`
        SELECT source_provider, provider_media_id FROM transcription_batch_items
        UNION ALL
        SELECT source_provider, provider_media_id FROM clip_candidates
      `);
      expect(dependent.rows).toEqual([
        { source_provider: "youtube", provider_media_id: "M7lc1UVf-VE" },
        { source_provider: "youtube", provider_media_id: "M7lc1UVf-VE" },
      ]);
    } finally {
      await database.close();
    }
  });

  it("backfills local source groups while retaining historical compatibility identity", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE logged_export_source_groups (
          id TEXT PRIMARY KEY,
          compatibility_key TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          batch_id TEXT NOT NULL,
          youtube_video_id TEXT NOT NULL,
          acquisition_profile_fingerprint TEXT NOT NULL
        );
        INSERT INTO logged_export_source_groups VALUES (
          '11111111-1111-4111-8111-111111111111',
          '${"a".repeat(64)}',
          'project-fixture',
          'batch-fixture',
          'M7lc1UVf-VE',
          '${"b".repeat(64)}'
        );
      `);
      database.exec(
        await readFile(
          join(
            process.cwd(),
            "packages/db-local/migrations/0032_platform_neutral_source_identity.sql",
          ),
          "utf8",
        ),
      );
      expect(
        database
          .prepare(
            `SELECT youtube_video_id, source_provider, provider_media_id,
                    canonical_url, compatibility_key
             FROM logged_export_source_groups`,
          )
          .get(),
      ).toEqual({
        youtube_video_id: "M7lc1UVf-VE",
        source_provider: "youtube",
        provider_media_id: "M7lc1UVf-VE",
        canonical_url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        compatibility_key: "a".repeat(64),
      });
    } finally {
      database.close();
    }
  });
});
