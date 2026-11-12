import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import type {
  AuthenticatedActor,
  TranscriptManifest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { MemoryTranscriptObjectStore } from "@research-video/storage";

import { SharedProjectCatalog } from "./index.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("claimed transcript finalization", () => {
  it("atomically activates the version, completes the claimed job, and readies linked items", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:worker-owner",
    };
    await catalog.registerUser(actor, "Worker owner");
    const project = await catalog.createProject(actor, {
      name: "Worker project",
    });
    const created = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Worker batch",
      options: {
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "prefer-existing",
        executionLocation: "local",
        priority: "normal",
      },
      items: [
        {
          inputIndex: 0,
          input: "https://youtu.be/M7lc1UVf-VE",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          title: "Fixture video",
        },
      ],
    });
    const item = created.items[0]!;
    const claimed = await catalog.claimTranscriptionJob(actor, "local", 120);
    expect(claimed?.job.id).toBe(item.jobId);

    const lineageId = randomUUID();
    const grant = await catalog.createClaimedTranscriptUpload(
      actor,
      claimed!.job.id,
      claimed!.lease.attempt,
      {
        lineageId,
        version: 1,
        artifactTypes: ["english-normalized", "english-srt"],
      },
    );
    const storedArtifacts = [];
    for (const type of ["english-normalized", "english-srt"] as const) {
      const target = grant.targets.find(
        (candidate) => candidate.type === type,
      )!;
      const bytes = new TextEncoder().encode(
        type === "english-srt"
          ? "1\n00:00:00,000 --> 00:00:01,000\nFixture\n"
          : JSON.stringify({ fixture: true }),
      );
      const stored = await store.put({
        key: target.objectKey,
        bytes,
        contentType:
          type === "english-srt" ? "application/x-subrip" : "application/json",
        sha256: digest(bytes),
      });
      storedArtifacts.push({
        type,
        objectKey: stored.key,
        objectVersionId: stored.versionId,
        byteSize: bytes.byteLength,
        sha256: stored.sha256,
      });
    }
    const transcriptVersionId = randomUUID();
    const manifest: TranscriptManifest = {
      schemaVersion: 1,
      id: transcriptVersionId,
      projectId: project.id,
      catalogVideoId: item.catalogVideoId!,
      videoId: "M7lc1UVf-VE",
      lineageId,
      version: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      timingPrecision: "cue",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: claimed!.job.id,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
      artifacts: storedArtifacts,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const manifestTarget = grant.targets.find(
      (candidate) => candidate.type === "manifest",
    )!;
    const manifestStored = await store.put({
      key: manifestTarget.objectKey,
      bytes: manifestBytes,
      contentType: "application/json",
      sha256: digest(manifestBytes),
    });
    const finalized = await catalog.finalizeTranscript(
      actor,
      {
        uploadId: grant.uploadId,
        idempotencyKey: `finalize:${transcriptVersionId}`,
        manifest: {
          type: "manifest",
          objectKey: manifestStored.key,
          objectVersionId: manifestStored.versionId,
          byteSize: manifestBytes.byteLength,
          sha256: manifestStored.sha256,
        },
      },
      { jobId: claimed!.job.id, attempt: claimed!.lease.attempt },
    );

    expect(finalized.transcriptVersionId).toBe(transcriptVersionId);
    const batch = await catalog.getTranscriptionBatch(
      actor,
      project.id,
      created.batch.id,
    );
    expect(batch.items[0]).toMatchObject({
      state: "ready_for_review",
      activeTranscriptVersionId: transcriptVersionId,
      reviewStatus: "unreviewed",
    });
    expect(
      await catalog.claimTranscriptionJob(actor, "local", 120),
    ).toBeUndefined();
    await expect(
      catalog.heartbeatTranscriptionJob(
        actor,
        claimed!.job.id,
        claimed!.lease.attempt,
        120,
        "uploading",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

async function membershipFixture() {
  const database = new PGlite();
  databases.add(database);
  await runCloudMigrations(database);
  const catalog = new SharedProjectCatalog(
    database,
    new MemoryTranscriptObjectStore(),
  );
  const register = async (name: string): Promise<AuthenticatedActor> => {
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:" + randomUUID(),
    };
    await catalog.registerUser(actor, name);
    return actor;
  };
  const owner = await register("Owner");
  const project = await catalog.createProject(owner, {
    name: "Membership fixture",
  });
  const member = async (userId: string) => {
    const rows = await database.query<{ role: string; version: number }>(
      "SELECT role, version FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, userId],
    );
    return rows.rows[0];
  };
  const ownerCount = async () => {
    const rows = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM project_members WHERE project_id = $1 AND role = 'owner'",
      [project.id],
    );
    return Number(rows.rows[0]?.count);
  };
  return { database, catalog, register, owner, project, member, ownerCount };
}

describe("project membership grant safety", () => {
  it("rejects sole Owner self-demotion and preserves role/version/count", async () => {
    const f = await membershipFixture();
    await expect(
      f.catalog.addMember(f.owner, f.project.id, f.owner.userId, "viewer"),
    ).rejects.toMatchObject({ statusCode: 409, code: "conflict" });
    expect(await f.member(f.owner.userId)).toMatchObject({
      role: "owner",
      version: 1,
    });
    expect(await f.ownerCount()).toBe(1);
  });

  it("idempotently retries identical grant without incrementing version", async () => {
    const f = await membershipFixture();
    const editor = await f.register("Editor");
    await f.catalog.addMember(f.owner, f.project.id, editor.userId, "editor");
    expect(await f.member(editor.userId)).toMatchObject({
      role: "editor",
      version: 1,
    });
    await f.catalog.addMember(f.owner, f.project.id, editor.userId, "editor");
    expect(await f.member(editor.userId)).toMatchObject({
      role: "editor",
      version: 1,
    });
  });

  it("rejects conflicting grant rather than overwriting role/version", async () => {
    const f = await membershipFixture();
    const editor = await f.register("Editor");
    await f.catalog.addMember(f.owner, f.project.id, editor.userId, "editor");
    await expect(
      f.catalog.addMember(f.owner, f.project.id, editor.userId, "viewer"),
    ).rejects.toMatchObject({ statusCode: 409, code: "conflict" });
    expect(await f.member(editor.userId)).toMatchObject({
      role: "editor",
      version: 1,
    });
  });
});

const makeOwner = async (
  database: PGlite,
  projectId: string,
  userId: string,
) => {
  const now = new Date().toISOString();
  await database.query(
    `INSERT INTO project_members
       (project_id, user_id, role, version, created_at, updated_at)
     VALUES ($1, $2, 'owner', 1, $3, $3)`,
    [projectId, userId, now],
  );
};

describe("safe project membership", () => {
  it("never reuses a revoked membership version after a new grant", async () => {
    const f = await membershipFixture();
    const member = await f.register("Reinvited member");
    await f.catalog.addMember(f.owner, f.project.id, member.userId, "viewer");
    await f.catalog.removeMember(f.owner, f.project.id, member.userId, 1);
    await f.catalog.addMember(f.owner, f.project.id, member.userId, "editor");
    const current = await f.member(member.userId);
    expect(current).toMatchObject({ role: "editor", version: 2 });
    await expect(
      f.catalog.changeMemberRole(
        f.owner,
        f.project.id,
        member.userId,
        "viewer",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.catalog.removeMember(f.owner, f.project.id, member.userId, 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.member(member.userId)).toMatchObject({
      role: "editor",
      version: 2,
    });
    await f.catalog.removeMember(f.owner, f.project.id, member.userId, 2);
    await f.catalog.addMember(f.owner, f.project.id, member.userId, "viewer");
    expect(await f.member(member.userId)).toMatchObject({
      role: "viewer",
      version: 3,
    });
  });

  it("version-checks explicit changes, no-op retries and revocations", async () => {
    const f = await membershipFixture();
    const editor = await f.register("Editor");
    await f.catalog.addMember(f.owner, f.project.id, editor.userId, "editor");
    await f.catalog.changeMemberRole(
      f.owner,
      f.project.id,
      editor.userId,
      "viewer",
      1,
    );
    expect(await f.member(editor.userId)).toMatchObject({
      role: "viewer",
      version: 2,
    });
    await f.catalog.changeMemberRole(
      f.owner,
      f.project.id,
      editor.userId,
      "viewer",
      2,
    );
    expect(await f.member(editor.userId)).toMatchObject({
      role: "viewer",
      version: 2,
    });
    await expect(
      f.catalog.changeMemberRole(
        f.owner,
        f.project.id,
        editor.userId,
        "editor",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.catalog.removeMember(f.owner, f.project.id, editor.userId, 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.member(editor.userId)).toMatchObject({
      role: "viewer",
      version: 2,
    });
    await f.catalog.removeMember(f.owner, f.project.id, editor.userId, 2);
    expect(await f.member(editor.userId)).toBeUndefined();
    await expect(
      f.catalog.removeMember(f.owner, f.project.id, editor.userId, 2),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.catalog.getProject(editor, f.project.id),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects revoking or demoting the last Owner", async () => {
    const f = await membershipFixture();
    await expect(
      f.catalog.removeMember(f.owner, f.project.id, f.owner.userId, 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.catalog.changeMemberRole(
        f.owner,
        f.project.id,
        f.owner.userId,
        "viewer",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.ownerCount()).toBe(1);
    expect(await f.member(f.owner.userId)).toMatchObject({
      role: "owner",
      version: 1,
    });
  });

  it("allows demoting an Owner when another Owner survives", async () => {
    const f = await membershipFixture();
    const secondOwner = await f.register("Second owner");
    await makeOwner(f.database, f.project.id, secondOwner.userId);
    await f.catalog.changeMemberRole(
      f.owner,
      f.project.id,
      secondOwner.userId,
      "editor",
      1,
    );
    expect(await f.member(secondOwner.userId)).toMatchObject({
      role: "editor",
      version: 2,
    });
    expect(await f.ownerCount()).toBe(1);
  });

  it("serializes concurrent last-Owner demotions without an ownerless project", async () => {
    const f = await membershipFixture();
    const secondOwner = await f.register("Second owner");
    await makeOwner(f.database, f.project.id, secondOwner.userId);
    const results = await Promise.allSettled([
      f.catalog.changeMemberRole(
        f.owner,
        f.project.id,
        secondOwner.userId,
        "editor",
        1,
      ),
      f.catalog.changeMemberRole(
        secondOwner,
        f.project.id,
        f.owner.userId,
        "editor",
        1,
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await f.ownerCount()).toBe(1);
    const roles = [
      (await f.member(f.owner.userId))?.role,
      (await f.member(secondOwner.userId))?.role,
    ];
    expect(roles).toContain("owner");
  });

  it("transfers atomically, rejects stale versions and preserves researcher", async () => {
    const f = await membershipFixture();
    const target = await f.register("Target");
    const researcher = await f.register("Legacy researcher");
    await f.catalog.addMember(f.owner, f.project.id, target.userId, "viewer");
    await f.catalog.addMember(
      f.owner,
      f.project.id,
      researcher.userId,
      "researcher",
    );
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, target.userId, 2, 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, target.userId, 1, 2),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.member(f.owner.userId)).toMatchObject({
      role: "owner",
      version: 1,
    });
    expect(await f.member(target.userId)).toMatchObject({
      role: "viewer",
      version: 1,
    });
    await f.catalog.transferOwnership(
      f.owner,
      f.project.id,
      target.userId,
      1,
      1,
    );
    expect(await f.ownerCount()).toBe(1);
    expect(await f.member(target.userId)).toMatchObject({
      role: "owner",
      version: 2,
    });
    expect(await f.member(f.owner.userId)).toMatchObject({
      role: "editor",
      version: 2,
    });
    expect(await f.member(researcher.userId)).toMatchObject({
      role: "researcher",
      version: 1,
    });
    await expect(
      f.catalog.listMembers(f.owner, f.project.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await f.catalog.listMembers(target, f.project.id)).toHaveLength(3);
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, target.userId, 1, 1),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      f.catalog.listMembers(researcher, f.project.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      f.catalog.getProject(researcher, f.project.id),
    ).resolves.toMatchObject({ id: f.project.id });
  });

  it("keeps a target that is already an Owner unchanged during transfer", async () => {
    const f = await membershipFixture();
    const secondOwner = await f.register("Second owner");
    await makeOwner(f.database, f.project.id, secondOwner.userId);
    await f.catalog.transferOwnership(
      f.owner,
      f.project.id,
      secondOwner.userId,
      1,
      1,
    );
    expect(await f.member(secondOwner.userId)).toMatchObject({
      role: "owner",
      version: 1,
    });
    expect(await f.member(f.owner.userId)).toMatchObject({
      role: "editor",
      version: 2,
    });
    expect(await f.ownerCount()).toBe(1);
  });

  it("rejects self-transfer and transfers to non-members or unknown users", async () => {
    const f = await membershipFixture();
    const outsider = await f.register("Outsider");
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, f.owner.userId, 1, 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, outsider.userId, 1, 1),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.catalog.transferOwnership(f.owner, f.project.id, randomUUID(), 1, 1),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.catalog.addMember(f.owner, f.project.id, randomUUID(), "viewer"),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await f.ownerCount()).toBe(1);
  });

  it("serializes conflicting ownership transfers to a single Owner", async () => {
    const f = await membershipFixture();
    const first = await f.register("First target");
    const second = await f.register("Second target");
    await f.catalog.addMember(f.owner, f.project.id, first.userId, "viewer");
    await f.catalog.addMember(f.owner, f.project.id, second.userId, "viewer");
    const results = await Promise.allSettled([
      f.catalog.transferOwnership(f.owner, f.project.id, first.userId, 1, 1),
      f.catalog.transferOwnership(f.owner, f.project.id, second.userId, 1, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await f.ownerCount()).toBe(1);
    expect(
      [
        (await f.member(first.userId))?.role,
        (await f.member(second.userId))?.role,
      ].filter((role) => role === "owner"),
    ).toHaveLength(1);
  });

  it("serializes concurrent transfer/revoke in PGlite without becoming ownerless", async () => {
    const f = await membershipFixture();
    const target = await f.register("Target");
    await f.catalog.addMember(f.owner, f.project.id, target.userId, "viewer");
    const results = await Promise.allSettled([
      f.catalog.transferOwnership(f.owner, f.project.id, target.userId, 1, 1),
      f.catalog.removeMember(f.owner, f.project.id, target.userId, 1),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await f.ownerCount()).toBe(1);
    const ownerState = await f.member(f.owner.userId);
    const targetState = await f.member(target.userId);
    expect([ownerState?.role, targetState?.role]).toContain("owner");
  });

  it("denies Editor/Viewer/researcher/nonmember management and cross-project enumeration", async () => {
    const f = await membershipFixture();
    const editor = await f.register("Editor");
    const viewer = await f.register("Viewer");
    const researcher = await f.register("Researcher");
    const outsider = await f.register("Outsider");
    await f.catalog.addMember(f.owner, f.project.id, editor.userId, "editor");
    await f.catalog.addMember(f.owner, f.project.id, viewer.userId, "viewer");
    await f.catalog.addMember(
      f.owner,
      f.project.id,
      researcher.userId,
      "researcher",
    );
    for (const actor of [editor, viewer, researcher, outsider]) {
      await expect(
        f.catalog.listMembers(actor, f.project.id),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        f.catalog.removeMember(actor, f.project.id, f.owner.userId, 1),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        f.catalog.addMember(actor, f.project.id, outsider.userId, "viewer"),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        f.catalog.changeMemberRole(
          actor,
          f.project.id,
          viewer.userId,
          "editor",
          1,
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      await expect(
        f.catalog.transferOwnership(actor, f.project.id, outsider.userId, 1, 1),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    const other = await f.catalog.createProject(outsider, { name: "Other" });
    await expect(
      f.catalog.listMembers(f.owner, other.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      f.catalog.addMember(f.owner, other.id, editor.userId, "viewer"),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(await f.member(editor.userId)).toMatchObject({
      role: "editor",
      version: 1,
    });
  });

  it("rejects a forged actor identity and keeps researcher write access", async () => {
    const f = await membershipFixture();
    const researcher = await f.register("Researcher");
    await f.catalog.addMember(
      f.owner,
      f.project.id,
      researcher.userId,
      "researcher",
    );
    const forged: AuthenticatedActor = {
      userId: f.owner.userId,
      externalSubject: "fixture:forged",
    };
    await expect(
      f.catalog.addMember(forged, f.project.id, researcher.userId, "editor"),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      f.catalog.transferOwnership(
        forged,
        f.project.id,
        researcher.userId,
        1,
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const video = await f.catalog.addVideo(researcher, f.project.id, {
      youtubeVideoId: "membershipFixture1",
      canonicalUrl: "https://www.youtube.com/watch?v=membershipFixture1",
      title: "Researcher video",
    });
    expect(video.youtubeVideoId).toBe("membershipFixture1");
    expect(await f.ownerCount()).toBe(1);
    expect(await f.member(researcher.userId)).toMatchObject({
      role: "researcher",
      version: 1,
    });
  });
});
