import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  TranscriptionJobPayloadSchema,
  type ArtifactCompatibilityRequirements,
  type ArtifactVersionSummary,
  type AuthenticatedActor,
  type ExportRequest,
  type LoggedExportFailureResult,
  type LoggedExportSuccessResult,
  type NormalizedTranscript,
  type TranscriptManifest,
} from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  canonicalJson,
  currentExportWorkerAdvertisement,
  exportWorkerAdvertisementFingerprint,
  sha256Fingerprint,
} from "@research-video/export-settings";
import {
  MemoryTranscriptObjectStore,
  type TranscriptObjectStore,
} from "@research-video/storage";

import { CatalogConflictError, SharedProjectCatalog } from "./index.ts";

const databases = new Set<PGlite>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function sourceRightsForVideo(youtubeVideoId: string) {
  return {
    schemaVersion: 1 as const,
    source: "youtube" as const,
    youtubeVideoId,
    confirmation: "authorized_to_process" as const,
    disclosureVersion: 1,
  };
}

async function authorityCatalog(now: () => Date = () => new Date()) {
  const database = new PGlite();
  const store = new MemoryTranscriptObjectStore();
  databases.add(database);
  await runCloudMigrations(database);
  return {
    database,
    store,
    catalog: new SharedProjectCatalog(database, store, now),
  };
}

function authorityActor(name: string): AuthenticatedActor {
  return {
    userId: randomUUID(),
    externalSubject: `fixture:authority:${name}`,
  };
}

describe("identity and project authority foundation", () => {
  it("normalizes requested handles, rejects case-equivalent collisions, and preserves an omitted handle", async () => {
    const { catalog } = await authorityCatalog();
    const first = authorityActor("first");
    const second = authorityActor("second");

    await expect(
      catalog.registerUser(first, "First Researcher", " @Research_Team "),
    ).resolves.toMatchObject({
      id: first.userId,
      handle: "research_team",
      displayName: "First Researcher",
    });
    await expect(
      catalog.registerUser(first, "Renamed Researcher"),
    ).resolves.toMatchObject({
      id: first.userId,
      handle: "research_team",
      displayName: "Renamed Researcher",
    });
    await expect(
      catalog.registerUser(second, "Second Researcher", "RESEARCH_TEAM"),
    ).rejects.toBeInstanceOf(CatalogConflictError);
    await expect(catalog.getCurrentUser(first)).resolves.toMatchObject({
      handle: "research_team",
      displayName: "Renamed Researcher",
    });

    const concurrent = await Promise.allSettled([
      catalog.registerUser(
        authorityActor("concurrent-a"),
        "Concurrent A",
        "Concurrent_Handle",
      ),
      catalog.registerUser(
        authorityActor("concurrent-b"),
        "Concurrent B",
        "concurrent_handle",
      ),
    ]);
    expect(
      concurrent.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrent.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        concurrent.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ).toBeInstanceOf(CatalogConflictError);
  });

  it("creates valid personal/shared projects and returns membership-bounded summaries", async () => {
    const { catalog } = await authorityCatalog();
    const owner = authorityActor("summary-owner");
    const researcher = authorityActor("summary-researcher");
    const outsider = authorityActor("summary-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Summary Owner", "summary_owner"),
      catalog.registerUser(
        researcher,
        "Summary Researcher",
        "summary_researcher",
      ),
      catalog.registerUser(outsider, "Summary Outsider", "summary_outsider"),
    ]);

    const personal = await catalog.createProject(owner, {
      name: "Personal research",
      kind: "personal",
    });
    const shared = await catalog.createProject(owner, {
      name: "Open shared research",
      kind: "shared",
      visibility: "open_to_join",
    });
    await catalog.addMember(owner, shared.id, researcher.userId, "researcher");

    expect(personal).toMatchObject({ kind: "personal", visibility: "private" });
    expect(shared).toMatchObject({
      kind: "shared",
      visibility: "open_to_join",
    });
    expect(await catalog.listProjects(owner)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: personal.id,
          currentUserRole: "owner",
          memberCount: 1,
        }),
        expect.objectContaining({
          id: shared.id,
          currentUserRole: "owner",
          memberCount: 2,
        }),
      ]),
    );
    expect(await catalog.listProjects(researcher)).toEqual([
      expect.objectContaining({
        id: shared.id,
        currentUserRole: "researcher",
        memberCount: 2,
      }),
    ]);
    await expect(catalog.listProjects(outsider)).resolves.toEqual([]);
    await expect(catalog.getProject(outsider, shared.id)).rejects.toMatchObject(
      {
        code: "project_access_denied",
      },
    );
    await expect(
      catalog.addMember(owner, personal.id, researcher.userId, "researcher"),
    ).rejects.toBeInstanceOf(CatalogConflictError);
  });

  it("enforces target-role authority plus idempotent replay and conflicting-role denial", async () => {
    const { catalog } = await authorityCatalog();
    const actors = Object.fromEntries(
      [
        "owner",
        "administrator",
        "researcher",
        "viewer",
        "ownerResearcherTarget",
        "administratorResearcherTarget",
        "administratorTarget",
        "deniedTarget",
      ].map((name) => [name, authorityActor(name)]),
    ) as Record<string, AuthenticatedActor>;
    await Promise.all(
      Object.entries(actors).map(([name, actor]) =>
        catalog.registerUser(
          actor,
          name,
          `auth_${name.toLowerCase().slice(0, 26)}`,
        ),
      ),
    );
    const project = await catalog.createProject(actors.owner!, {
      name: "Authority matrix",
    });

    await catalog.addMember(
      actors.owner!,
      project.id,
      actors.administrator!.userId,
      "administrator",
    );
    await catalog.addMember(
      actors.owner!,
      project.id,
      actors.researcher!.userId,
      "researcher",
    );
    await catalog.addMember(
      actors.owner!,
      project.id,
      actors.viewer!.userId,
      "viewer",
    );
    await catalog.addMember(
      actors.owner!,
      project.id,
      actors.ownerResearcherTarget!.userId,
      "researcher",
    );
    await expect(
      catalog.addMember(
        actors.owner!,
        project.id,
        actors.ownerResearcherTarget!.userId,
        "researcher",
      ),
    ).resolves.toBeUndefined();
    await expect(
      catalog.addMember(
        actors.owner!,
        project.id,
        actors.ownerResearcherTarget!.userId,
        "administrator",
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);

    await expect(
      catalog.addMember(
        actors.administrator!,
        project.id,
        actors.administratorResearcherTarget!.userId,
        "researcher",
      ),
    ).resolves.toBeUndefined();
    await expect(
      catalog.addMember(
        actors.administrator!,
        project.id,
        actors.administratorTarget!.userId,
        "administrator",
      ),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    for (const actor of [actors.researcher!, actors.viewer!]) {
      await expect(
        catalog.addMember(
          actor,
          project.id,
          actors.deniedTarget!.userId,
          "researcher",
        ),
      ).rejects.toMatchObject({ code: "project_access_denied" });
    }
  });

  it("allows an Administrator to claim project transcription work", async () => {
    const { catalog } = await authorityCatalog();
    const owner = authorityActor("claim-owner");
    const administrator = authorityActor("claim-administrator");
    await Promise.all([
      catalog.registerUser(owner, "Claim Owner", "claim_owner"),
      catalog.registerUser(
        administrator,
        "Claim Administrator",
        "claim_administrator",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Administrator claim project",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    const created = await catalog.createTranscriptionBatch(owner, {
      projectId: project.id,
      name: "Administrator claim batch",
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
          input: "https://youtu.be/AdminClaim1",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "AdminClaim1",
          canonicalUrl: "https://www.youtube.com/watch?v=AdminClaim1",
          title: "Administrator claim fixture",
          sourceLanguage: "en",
        },
      ],
    });

    await expect(
      catalog.claimTranscriptionJob(administrator, "local", 120),
    ).resolves.toMatchObject({ job: { id: created.items[0]!.jobId } });
  });
});

describe("hosted transcription approval", () => {
  it("gates dispatch and claims on current Administrator approval with exact replay", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("hosted-owner");
    const administrator = authorityActor("hosted-administrator");
    const researcher = authorityActor("hosted-researcher");
    await Promise.all([
      catalog.registerUser(owner, "Hosted Owner", "hosted_owner"),
      catalog.registerUser(
        administrator,
        "Hosted Administrator",
        "hosted_administrator",
      ),
      catalog.registerUser(
        researcher,
        "Hosted Researcher",
        "hosted_researcher",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Hosted approval project",
    });
    const otherProject = await catalog.createProject(owner, {
      name: "Other hosted approval project",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");

    const createBatch = (
      executionLocation: "local" | "hosted",
      youtubeVideoId: string,
    ) =>
      catalog.createTranscriptionBatch(researcher, {
        projectId: project.id,
        name: `${executionLocation} approval fixture`,
        options: {
          targetLanguage: "en",
          transcriptionProfile: "default",
          sourcePolicy: "prefer-existing",
          executionLocation,
          priority: "normal",
        },
        items: [
          {
            inputIndex: 0,
            input: `https://youtu.be/${youtubeVideoId}`,
            status: "ready",
            processingNeed: "transcription",
            youtubeVideoId,
            canonicalUrl: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
            title: `${executionLocation} approval fixture`,
            sourceLanguage: "en",
          },
        ],
      });
    const local = await createBatch("local", "HostedGateLocal1");
    const hosted = await createBatch("hosted", "HostedGatePaid1");
    const localJobId = local.items[0]!.jobId!;
    const hostedJobId = hosted.items[0]!.jobId!;
    expect(local.batch.hostedApproval).toBeUndefined();
    expect(hosted.batch.hostedApproval).toEqual({
      state: "pending",
      version: 1,
    });

    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual([
      { jobId: localJobId, executionLocation: "local" },
    ]);
    await expect(
      catalog.claimTranscriptionJob(researcher, "local", 120),
    ).resolves.toMatchObject({ job: { id: localJobId } });
    await catalog.markTranscriptionJobDispatched(hostedJobId);
    expect(
      (
        await database.query<{ dispatched_at: string | null }>(
          `SELECT payload->>'queueDispatchedAt' AS dispatched_at
           FROM jobs WHERE id = $1`,
          [hostedJobId],
        )
      ).rows[0]!.dispatched_at,
    ).toBeNull();
    await expect(
      catalog.markTranscriptionJobQueueDelivered(hostedJobId, "hosted"),
    ).resolves.toBe(false);
    await expect(
      catalog.claimTranscriptionJob(administrator, "hosted", 120),
    ).resolves.toBeUndefined();
    await expect(
      catalog.updateHostedTranscriptionApproval(
        researcher,
        project.id,
        hosted.batch.id,
        {
          action: "approve",
          idempotencyKey: "researcher-cannot-approve",
          expectedVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "project_access_denied" });

    const approve = {
      action: "approve" as const,
      idempotencyKey: "approve-hosted-v1",
      expectedVersion: 1,
    };
    const approved = await catalog.updateHostedTranscriptionApproval(
      administrator,
      project.id,
      hosted.batch.id,
      approve,
    );
    expect(approved).toMatchObject({
      projectId: project.id,
      batchId: hosted.batch.id,
      approval: {
        state: "approved",
        version: 2,
        decidedBy: {
          userId: administrator.userId,
          handle: "hosted_administrator",
        },
      },
    });
    await expect(
      catalog.updateHostedTranscriptionApproval(
        administrator,
        project.id,
        hosted.batch.id,
        approve,
      ),
    ).resolves.toEqual(approved);
    await expect(
      catalog.updateHostedTranscriptionApproval(
        administrator,
        project.id,
        hosted.batch.id,
        {
          action: "revoke",
          idempotencyKey: approve.idempotencyKey,
          expectedVersion: 2,
        },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      catalog.updateHostedTranscriptionApproval(
        owner,
        otherProject.id,
        hosted.batch.id,
        {
          action: "approve",
          idempotencyKey: "wrong-project",
          expectedVersion: 2,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual([
      { jobId: hostedJobId, executionLocation: "hosted" },
    ]);
    await catalog.markTranscriptionJobDispatched(hostedJobId);

    const revoked = await catalog.updateHostedTranscriptionApproval(
      administrator,
      project.id,
      hosted.batch.id,
      {
        action: "revoke",
        idempotencyKey: "revoke-hosted-v2",
        expectedVersion: 2,
      },
    );
    expect(revoked.approval).toMatchObject({ state: "revoked", version: 3 });
    await expect(
      catalog.markTranscriptionJobQueueDelivered(hostedJobId, "hosted"),
    ).resolves.toBe(false);
    await expect(
      catalog.claimTranscriptionJob(administrator, "hosted", 120),
    ).resolves.toBeUndefined();
    await expect(
      catalog.updateHostedTranscriptionApproval(
        administrator,
        project.id,
        hosted.batch.id,
        {
          action: "approve",
          idempotencyKey: "stale-hosted-v2",
          expectedVersion: 2,
        },
      ),
    ).rejects.toBeInstanceOf(CatalogConflictError);

    const reapproved = await catalog.updateHostedTranscriptionApproval(
      administrator,
      project.id,
      hosted.batch.id,
      {
        action: "approve",
        idempotencyKey: "reapprove-hosted-v3",
        expectedVersion: 3,
      },
    );
    expect(reapproved.approval).toMatchObject({
      state: "approved",
      version: 4,
    });
    await catalog.markTranscriptionJobDispatched(hostedJobId);
    await expect(
      catalog.markTranscriptionJobQueueDelivered(hostedJobId, "hosted"),
    ).resolves.toBe(true);
    await expect(
      catalog.claimTranscriptionJob(administrator, "hosted", 120, true),
    ).resolves.toMatchObject({ job: { id: hostedJobId } });

    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, administrator.userId],
    );
    await expect(
      catalog.updateHostedTranscriptionApproval(
        administrator,
        project.id,
        hosted.batch.id,
        {
          action: "revoke",
          idempotencyKey: "removed-administrator",
          expectedVersion: 4,
        },
      ),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(
      catalog.getTranscriptionBatch(owner, project.id, hosted.batch.id),
    ).resolves.toMatchObject({
      batch: {
        hostedApproval: {
          state: "approved",
          version: 4,
          decidedBy: {
            userId: administrator.userId,
            handle: "former_member",
            displayName: "Former project member",
          },
        },
      },
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM hosted_transcription_approval_commands
           WHERE batch_id = $1`,
          [hosted.batch.id],
        )
      ).rows[0]!.count,
    ).toBe("3");
  });
});

describe("project local processing policy", () => {
  it("automates direct ingest, gates local starts, and replays Administrator policy commands", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("local-policy-owner");
    const administrator = authorityActor("local-policy-administrator");
    const researcher = authorityActor("local-policy-researcher");
    const viewer = authorityActor("local-policy-viewer");
    const outsider = authorityActor("local-policy-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Local Policy Owner", "local_policy_owner"),
      catalog.registerUser(
        administrator,
        "Local Policy Administrator",
        "local_policy_administrator",
      ),
      catalog.registerUser(
        researcher,
        "Local Policy Researcher",
        "local_policy_researcher",
      ),
      catalog.registerUser(
        viewer,
        "Local Policy Viewer",
        "local_policy_viewer",
      ),
      catalog.registerUser(
        outsider,
        "Local Policy Outsider",
        "local_policy_outsider",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Automatic local processing",
    });
    const otherProject = await catalog.createProject(outsider, {
      name: "Other local processing",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    await catalog.addMember(owner, project.id, viewer.userId, "viewer");
    await expect(
      catalog.getProjectLocalProcessingStatus(owner, project.id),
    ).resolves.toMatchObject({
      projectId: project.id,
      policy: { state: "automatic", version: 1 },
      workload: { queuedJobs: 0, activeJobs: 0 },
    });

    const firstMetadata = {
      youtubeVideoId: "AutomaticLocal1",
      canonicalUrl: "https://www.youtube.com/watch?v=AutomaticLocal1",
      title: "Automatic local fixture",
      durationMs: 60_000,
      sourceLanguage: "en",
    };
    const [first, replayed] = await Promise.all([
      catalog.addVideo(owner, project.id, firstMetadata, {
        automaticLocalProcessing: true,
      }),
      catalog.addVideo(owner, project.id, firstMetadata, {
        automaticLocalProcessing: true,
      }),
    ]);
    expect(replayed.id).toBe(first.id);
    const automaticRows = await database.query<{
      batch_count: string;
      item_count: string;
      job_count: string;
    }>(
      `SELECT
         (SELECT count(*) FROM transcription_batches
          WHERE project_id = $1 AND processing_origin = 'project_local')::text
            AS batch_count,
         (SELECT count(*) FROM transcription_batch_items bi
          JOIN transcription_batches b ON b.id = bi.batch_id
          WHERE b.project_id = $1 AND b.processing_origin = 'project_local')::text
            AS item_count,
         (SELECT count(*) FROM jobs
          WHERE project_id = $1 AND kind = 'transcription')::text AS job_count`,
      [project.id],
    );
    expect(automaticRows.rows[0]).toEqual({
      batch_count: "1",
      item_count: "1",
      job_count: "1",
    });
    const automaticItem = (
      await database.query<{ batch_id: string; job_id: string }>(
        `SELECT bi.batch_id, bi.job_id
         FROM transcription_batch_items bi
         JOIN transcription_batches b ON b.id = bi.batch_id
         WHERE b.project_id = $1 AND b.processing_origin = 'project_local'`,
        [project.id],
      )
    ).rows[0]!;
    await expect(
      catalog.listTranscriptionBatches(owner, project.id),
    ).resolves.toEqual({ batches: [] });
    await expect(
      catalog.controlTranscriptionBatch(
        owner,
        project.id,
        automaticItem.batch_id,
        {
          action: "pause_pending",
          expectedVersion: 1,
        },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      catalog.getProjectLocalProcessingStatus(researcher, project.id),
    ).resolves.toMatchObject({
      workload: {
        queuedJobs: 1,
        activeJobs: 0,
        queuedKnownDurationMs: 60_000,
        queuedUnknownDurationCount: 0,
      },
    });
    await expect(
      catalog.updateProjectLocalProcessing(researcher, project.id, {
        state: "paused",
        expectedVersion: 1,
        idempotencyKey: "researcher-cannot-pause",
      }),
    ).rejects.toMatchObject({ code: "project_access_denied" });

    const pauseCommand = {
      state: "paused" as const,
      expectedVersion: 1,
      idempotencyKey: "pause-local-v1",
    };
    const paused = await catalog.updateProjectLocalProcessing(
      administrator,
      project.id,
      pauseCommand,
    );
    expect(paused).toMatchObject({
      policy: {
        state: "paused",
        version: 2,
        updatedBy: { userId: administrator.userId },
      },
      enqueuedCount: 0,
      remainingUnprocessedCount: 0,
    });
    await expect(
      catalog.updateProjectLocalProcessing(
        administrator,
        project.id,
        pauseCommand,
      ),
    ).resolves.toEqual(paused);
    await expect(
      catalog.updateProjectLocalProcessing(administrator, project.id, {
        state: "automatic",
        expectedVersion: 2,
        idempotencyKey: pauseCommand.idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual(
      [],
    );
    await expect(
      catalog.markTranscriptionJobDispatched(automaticItem.job_id),
    ).resolves.toBe(false);
    await expect(
      catalog.claimTranscriptionJob(researcher, "local", 120),
    ).resolves.toBeUndefined();

    const pausedVideo = await catalog.addVideo(
      researcher,
      project.id,
      {
        youtubeVideoId: "AutomaticLocalPaused2",
        canonicalUrl: "https://www.youtube.com/watch?v=AutomaticLocalPaused2",
        title: "Paused automatic local fixture",
        sourceLanguage: "en",
      },
      { automaticLocalProcessing: true },
    );
    expect(pausedVideo.id).toBeTruthy();
    await expect(
      catalog.getProjectLocalProcessingStatus(owner, project.id),
    ).resolves.toMatchObject({
      policy: { state: "paused", version: 2 },
      workload: { queuedJobs: 1, unprocessedActiveVideoCount: 1 },
    });
    const resumed = await catalog.updateProjectLocalProcessing(
      owner,
      project.id,
      {
        state: "automatic",
        expectedVersion: 2,
        idempotencyKey: "resume-local-v2",
      },
    );
    expect(resumed).toMatchObject({
      policy: { state: "automatic", version: 3 },
      enqueuedCount: 1,
      remainingUnprocessedCount: 0,
      workload: {
        queuedJobs: 2,
        queuedKnownDurationMs: 60_000,
        queuedUnknownDurationCount: 1,
      },
    });
    await expect(
      catalog.updateProjectLocalProcessing(owner, otherProject.id, {
        state: "paused",
        expectedVersion: 3,
        idempotencyKey: "wrong-project-policy",
      }),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(
      catalog.claimTranscriptionJob(researcher, "local", 120),
    ).resolves.toMatchObject({ job: { id: automaticItem.job_id } });
    await expect(
      catalog.getProjectLocalProcessingStatus(owner, project.id),
    ).resolves.toMatchObject({
      workload: { queuedJobs: 1, activeJobs: 1 },
    });
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, administrator.userId],
    );
    await expect(
      catalog.updateProjectLocalProcessing(administrator, project.id, {
        state: "paused",
        expectedVersion: 3,
        idempotencyKey: "removed-administrator",
      }),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(
      catalog.getProjectLocalProcessingStatus(owner, project.id),
    ).resolves.toMatchObject({
      policy: {
        updatedBy: {
          userId: owner.userId,
          handle: "local_policy_owner",
        },
      },
    });
    await expect(
      catalog.getProjectLocalProcessingStatus(outsider, project.id),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM project_local_processing_commands WHERE project_id = $1`,
          [project.id],
        )
      ).rows[0]!.count,
    ).toBe("2");
  });

  it("bounds resume catch-up to fifty active unprocessed videos", async () => {
    const { catalog } = await authorityCatalog();
    const owner = authorityActor("bounded-local-owner");
    await catalog.registerUser(
      owner,
      "Bounded Local Owner",
      "bounded_local_owner",
    );
    const project = await catalog.createProject(owner, {
      name: "Bounded local catch-up",
    });
    await catalog.updateProjectLocalProcessing(owner, project.id, {
      state: "paused",
      expectedVersion: 1,
      idempotencyKey: "pause-before-backlog",
    });
    for (let index = 0; index < 51; index += 1) {
      await catalog.addVideo(
        owner,
        project.id,
        {
          youtubeVideoId: `BoundedLocal${String(index).padStart(2, "0")}`,
          canonicalUrl: `https://www.youtube.com/watch?v=BoundedLocal${String(index).padStart(2, "0")}`,
          title: `Bounded local ${index}`,
          sourceLanguage: "en",
        },
        { automaticLocalProcessing: true },
      );
    }
    const firstResume = await catalog.updateProjectLocalProcessing(
      owner,
      project.id,
      {
        state: "automatic",
        expectedVersion: 2,
        idempotencyKey: "resume-first-fifty",
      },
    );
    expect(firstResume).toMatchObject({
      enqueuedCount: 50,
      remainingUnprocessedCount: 1,
      workload: { queuedJobs: 50, unprocessedActiveVideoCount: 1 },
    });
    const secondResume = await catalog.updateProjectLocalProcessing(
      owner,
      project.id,
      {
        state: "automatic",
        expectedVersion: 3,
        idempotencyKey: "resume-final-one",
      },
    );
    expect(secondResume).toMatchObject({
      enqueuedCount: 1,
      remainingUnprocessedCount: 0,
      workload: { queuedJobs: 51, unprocessedActiveVideoCount: 0 },
    });
  });

  it("governs normalized project keyword and alias suggestions with exact approval replay", async () => {
    const { catalog, database } = await authorityCatalog();
    const owner = authorityActor("keyword-owner");
    const administrator = authorityActor("keyword-administrator");
    const researcher = authorityActor("keyword-researcher");
    const viewer = authorityActor("keyword-viewer");
    const outsider = authorityActor("keyword-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Keyword Owner", "keyword_owner"),
      catalog.registerUser(
        administrator,
        "Keyword Administrator",
        "keyword_administrator",
      ),
      catalog.registerUser(
        researcher,
        "Keyword Researcher",
        "keyword_researcher",
      ),
      catalog.registerUser(viewer, "Keyword Viewer", "keyword_viewer"),
      catalog.registerUser(outsider, "Keyword Outsider", "keyword_outsider"),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Keyword governance",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    await catalog.addMember(owner, project.id, viewer.userId, "viewer");
    await expect(
      catalog.listProjectKeywords(researcher, project.id),
    ).resolves.toEqual({
      projectId: project.id,
      keywordSetVersion: 1,
      keywords: [],
      suggestions: [],
    });

    const suggested = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        proposedLabel: "Climate change",
        proposedDescription: "Positive literal research phrase",
        language: "en",
        phrase: " Climate   CHANGE ",
        rationale: "Core research vocabulary",
        idempotencyKey: "suggest-climate-v1",
      },
    );
    expect(suggested).toMatchObject({
      resolution: "created",
      suggestion: {
        normalizedPhrase: "climate change",
        state: "pending",
        proposedBy: { userId: researcher.userId },
      },
    });
    if (suggested.resolution === "already_approved") {
      throw new Error("Expected a pending suggestion.");
    }
    const suggestionId = suggested.suggestion.id;
    await expect(
      catalog.suggestProjectKeyword(researcher, project.id, {
        proposedLabel: "Climate change",
        proposedDescription: "Positive literal research phrase",
        language: "en",
        phrase: " Climate   CHANGE ",
        rationale: "Core research vocabulary",
        idempotencyKey: "suggest-climate-v1",
      }),
    ).resolves.toEqual(suggested);
    await expect(
      catalog.suggestProjectKeyword(administrator, project.id, {
        proposedLabel: "Duplicate label is ignored",
        language: "EN",
        phrase: "Ｃｌｉｍａｔｅ change",
        idempotencyKey: "equivalent-pending",
      }),
    ).resolves.toMatchObject({
      resolution: "existing_pending",
      suggestion: { id: suggestionId },
    });
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        researcher,
        project.id,
        suggestionId,
        {
          action: "approve",
          expectedSuggestionVersion: 1,
          expectedKeywordSetVersion: 1,
          idempotencyKey: "researcher-cannot-approve",
        },
      ),
    ).rejects.toMatchObject({ code: "project_access_denied" });

    const approvalCommand = {
      action: "approve" as const,
      expectedSuggestionVersion: 1,
      expectedKeywordSetVersion: 1,
      idempotencyKey: "approve-climate-v1",
    };
    const approved = await catalog.reviewProjectKeywordSuggestion(
      administrator,
      project.id,
      suggestionId,
      approvalCommand,
    );
    expect(approved).toMatchObject({
      keywordSetVersion: 2,
      suggestion: { state: "approved", version: 2 },
      keyword: { label: "Climate change" },
      alias: {
        language: "en",
        normalizedPhrase: "climate change",
      },
    });
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        administrator,
        project.id,
        suggestionId,
        approvalCommand,
      ),
    ).resolves.toEqual(approved);
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        administrator,
        project.id,
        suggestionId,
        { ...approvalCommand, action: "reject" },
      ),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });

    const keywordId = approved.keyword!.id;
    const duplicateLabel = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        proposedLabel: "Ｃｌｉｍａｔｅ   CHANGE",
        language: "en",
        phrase: "warming trend",
        idempotencyKey: "duplicate-normalized-label",
      },
    );
    if (duplicateLabel.resolution === "already_approved") {
      throw new Error("Expected a distinct pending phrase.");
    }
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        administrator,
        project.id,
        duplicateLabel.suggestion.id,
        {
          action: "approve",
          expectedSuggestionVersion: 1,
          expectedKeywordSetVersion: 2,
          idempotencyKey: "reject-duplicate-normalized-label",
        },
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("display label already exists"),
    });
    await expect(
      catalog.suggestProjectKeyword(researcher, project.id, {
        keywordId,
        language: "en-US",
        phrase: "climate change",
        idempotencyKey: "approved-regional-alias-is-distinct",
      }),
    ).resolves.toMatchObject({ resolution: "created" });
    const spanish = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        keywordId,
        language: "es",
        phrase: "Cambio climático",
        idempotencyKey: "suggest-spanish-alias",
      },
    );
    expect(spanish).toMatchObject({ resolution: "created" });
    if (spanish.resolution === "already_approved") {
      throw new Error("Expected a pending Spanish alias.");
    }
    const rejected = await catalog.reviewProjectKeywordSuggestion(
      owner,
      project.id,
      spanish.suggestion.id,
      {
        action: "reject",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 1,
        reason: "Use a more specific phrase",
        idempotencyKey: "reject-spanish-v1",
      },
    );
    expect(rejected).toMatchObject({
      keywordSetVersion: 2,
      suggestion: {
        state: "rejected",
        reviewReason: "Use a more specific phrase",
      },
    });
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        owner,
        project.id,
        spanish.suggestion.id,
        {
          action: "reject",
          expectedSuggestionVersion: 1,
          expectedKeywordSetVersion: 1,
          reason: "Use a more specific phrase",
          idempotencyKey: "reject-spanish-v1",
        },
      ),
    ).resolves.toEqual(rejected);
    const otherProject = await catalog.createProject(owner, {
      name: "Other keyword project",
    });
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        owner,
        otherProject.id,
        suggestionId,
        {
          action: "reject",
          expectedSuggestionVersion: 2,
          expectedKeywordSetVersion: 1,
          idempotencyKey: "wrong-project-suggestion",
        },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      catalog.suggestProjectKeyword(viewer, project.id, {
        keywordId,
        language: "fr",
        phrase: "changement climatique",
        idempotencyKey: "viewer-cannot-suggest",
      }),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(
      catalog.listProjectKeywords(outsider, project.id),
    ).rejects.toMatchObject({
      code: "project_access_denied",
    });
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, administrator.userId],
    );
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        administrator,
        project.id,
        spanish.suggestion.id,
        {
          action: "reject",
          expectedSuggestionVersion: 2,
          expectedKeywordSetVersion: 2,
          idempotencyKey: "removed-admin-review",
        },
      ),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_keywords WHERE project_id = $1",
          [project.id],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });

  it("serializes competing keyword approvals without duplicate aliases or version advances", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("keyword-race-owner");
    const administratorA = authorityActor("keyword-race-admin-a");
    const administratorB = authorityActor("keyword-race-admin-b");
    const researcher = authorityActor("keyword-race-researcher");
    await Promise.all([
      catalog.registerUser(owner, "Keyword Race Owner", "keyword_race_owner"),
      catalog.registerUser(
        administratorA,
        "Keyword Race Admin A",
        "keyword_race_admin_a",
      ),
      catalog.registerUser(
        administratorB,
        "Keyword Race Admin B",
        "keyword_race_admin_b",
      ),
      catalog.registerUser(
        researcher,
        "Keyword Race Researcher",
        "keyword_race_researcher",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Keyword approval race",
    });
    await catalog.addMember(
      owner,
      project.id,
      administratorA.userId,
      "administrator",
    );
    await catalog.addMember(
      owner,
      project.id,
      administratorB.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    const suggested = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        proposedLabel: "Public health",
        language: "en",
        phrase: "public health",
        idempotencyKey: "suggest-public-health",
      },
    );
    if (suggested.resolution === "already_approved") {
      throw new Error("Expected a pending suggestion.");
    }
    const commands = [
      {
        actor: administratorA,
        idempotencyKey: "approve-public-health-a",
      },
      {
        actor: administratorB,
        idempotencyKey: "approve-public-health-b",
      },
    ];
    const results = await Promise.allSettled(
      commands.map(({ actor, idempotencyKey }) =>
        catalog.reviewProjectKeywordSuggestion(
          actor,
          project.id,
          suggested.suggestion.id,
          {
            action: "approve",
            expectedSuggestionVersion: 1,
            expectedKeywordSetVersion: 1,
            idempotencyKey,
          },
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult
      ).reason,
    ).toMatchObject({ code: "conflict" });
    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    const winner = results[winnerIndex] as PromiseFulfilledResult<unknown>;
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        commands[winnerIndex]!.actor,
        project.id,
        suggested.suggestion.id,
        {
          action: "approve",
          expectedSuggestionVersion: 1,
          expectedKeywordSetVersion: 1,
          idempotencyKey: commands[winnerIndex]!.idempotencyKey,
        },
      ),
    ).resolves.toEqual(winner.value);
    expect(
      (
        await database.query<{ keyword_set_version: number }>(
          "SELECT keyword_set_version FROM projects WHERE id = $1",
          [project.id],
        )
      ).rows[0],
    ).toEqual({ keyword_set_version: 2 });
    expect(
      (
        await database.query<{
          keywords: number;
          aliases: number;
          receipts: number;
        }>(
          `SELECT
             (SELECT count(*)::integer FROM project_keywords WHERE project_id = $1) AS keywords,
             (SELECT count(*)::integer FROM project_keyword_aliases WHERE project_id = $1) AS aliases,
             (SELECT count(*)::integer FROM project_keyword_commands
              WHERE project_id = $1 AND command_kind = 'review') AS receipts`,
          [project.id],
        )
      ).rows[0],
    ).toEqual({ keywords: 1, aliases: 1, receipts: 1 });
  });

  it("rejects approval of alias 101 without partial review evidence", async () => {
    const { database, catalog } = await authorityCatalog();
    const createdAt = "2026-08-24T12:00:00.000Z";
    const owner = authorityActor("keyword-bound-owner");
    const administrator = authorityActor("keyword-bound-admin");
    const researcher = authorityActor("keyword-bound-researcher");
    await Promise.all([
      catalog.registerUser(owner, "Keyword Bound Owner", "keyword_bound_owner"),
      catalog.registerUser(
        administrator,
        "Keyword Bound Admin",
        "keyword_bound_admin",
      ),
      catalog.registerUser(
        researcher,
        "Keyword Bound Researcher",
        "keyword_bound_researcher",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Keyword alias bound",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    const initial = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        proposedLabel: "Energy",
        language: "en",
        phrase: "energy",
        idempotencyKey: "suggest-energy",
      },
    );
    if (initial.resolution === "already_approved") {
      throw new Error("Expected a pending suggestion.");
    }
    const approved = await catalog.reviewProjectKeywordSuggestion(
      administrator,
      project.id,
      initial.suggestion.id,
      {
        action: "approve",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 1,
        idempotencyKey: "approve-energy",
      },
    );
    await database.query(
      `INSERT INTO project_keyword_aliases
         (id, project_id, keyword_id, language, phrase, normalized_phrase,
          enabled, version, created_by, updated_by, created_at, updated_at)
       SELECT gen_random_uuid(), $1, $2, 'en', 'Energy alias ' || ordinal,
              'energy alias ' || ordinal, true, 1, $3, $3, $4, $4
       FROM generate_series(1, 99) AS ordinal`,
      [project.id, approved.keyword!.id, owner.userId, createdAt],
    );
    const overflow = await catalog.suggestProjectKeyword(
      researcher,
      project.id,
      {
        keywordId: approved.keyword!.id,
        language: "en",
        phrase: "Energy alias 100",
        idempotencyKey: "suggest-energy-alias-101",
      },
    );
    if (overflow.resolution === "already_approved") {
      throw new Error("Expected the overflow alias to remain pending.");
    }
    await expect(
      catalog.reviewProjectKeywordSuggestion(
        administrator,
        project.id,
        overflow.suggestion.id,
        {
          action: "approve",
          expectedSuggestionVersion: 1,
          expectedKeywordSetVersion: 2,
          idempotencyKey: "approve-energy-alias-101",
        },
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringContaining("maximum 100 aliases"),
    });
    expect(
      (
        await database.query<{
          aliases: number;
          state: string;
          version: number;
        }>(
          `SELECT
             (SELECT count(*)::integer FROM project_keyword_aliases
              WHERE project_id = $1 AND keyword_id = $2) AS aliases,
             state,
             version
           FROM project_keyword_suggestions WHERE id = $3`,
          [project.id, approved.keyword!.id, overflow.suggestion.id],
        )
      ).rows[0],
    ).toEqual({ aliases: 100, state: "pending", version: 1 });
  });

  it("runs an authorized lease-safe keyword scan lifecycle with exact finalize replay", async () => {
    const { database, catalog, store } = await authorityCatalog();
    const owner = authorityActor("keyword-scan-owner");
    const worker = authorityActor("keyword-scan-worker");
    const outsider = authorityActor("keyword-scan-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Keyword Scan Owner", "keyword_scan_owner"),
      catalog.registerUser(
        worker,
        "Keyword Scan Worker",
        "keyword_scan_worker",
      ),
      catalog.registerUser(
        outsider,
        "Keyword Scan Outsider",
        "keyword_scan_outsider",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Keyword scan lifecycle",
    });
    await catalog.addMember(owner, project.id, worker.userId, "researcher");
    const video = await catalog.addVideo(
      owner,
      project.id,
      {
        youtubeVideoId: "KeywordScan01",
        canonicalUrl: "https://www.youtube.com/watch?v=KeywordScan01",
        title: "Keyword scan fixture",
        durationMs: 60_000,
        sourceLanguage: "en",
      },
      { automaticLocalProcessing: false },
    );
    const transcriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'word',
               'fixtures/keyword-scan.json', 'fixture-version', $5, now())`,
      [transcriptVersionId, project.id, video.id, randomUUID(), "c".repeat(64)],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, project.id, video.id],
    );
    const suggestion = await catalog.suggestProjectKeyword(owner, project.id, {
      proposedLabel: "Climate",
      language: "en",
      phrase: "climate change",
      idempotencyKey: "suggest-keyword-scan-climate",
    });
    if (suggestion.resolution === "already_approved") {
      throw new Error("Expected a pending scan keyword.");
    }
    const approvedKeyword = await catalog.reviewProjectKeywordSuggestion(
      owner,
      project.id,
      suggestion.suggestion.id,
      {
        action: "approve",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 1,
        idempotencyKey: "approve-keyword-scan-climate",
      },
    );

    expect(
      await catalog.getProjectKeywordScanSummary(owner, project.id, video.id),
    ).toMatchObject({ status: "queued", keywordSetVersion: 2 });
    const queued = await catalog.scheduleProjectKeywordScan(
      worker,
      project.id,
      video.id,
    );
    expect(queued).toMatchObject({
      status: "queued",
      transcriptVersionId,
      keywordSetVersion: 2,
      approvedKeywordCount: 1,
    });
    await expect(
      catalog.scheduleProjectKeywordScan(worker, project.id, video.id),
    ).resolves.toEqual(queued);
    const claim = await catalog.claimProjectKeywordScan(worker, project.id, {
      leaseSeconds: 60,
    });
    expect(claim).toMatchObject({
      job: { state: "scanning", transcriptVersionId, attempt: 1 },
      workerId: worker.userId,
      attempt: 1,
    });
    if (!claim) throw new Error("Expected a keyword scan claim.");
    await expect(
      catalog.heartbeatProjectKeywordScan(outsider, project.id, claim.job.id, {
        attempt: 1,
        leaseSeconds: 60,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await database.query(
      `UPDATE project_keyword_scans
       SET heartbeat_at = now() - interval '2 minutes',
           expires_at = now() - interval '1 minute'
       WHERE id = $1`,
      [claim.job.id],
    );
    await expect(
      catalog.createProjectKeywordScanArtifactUpload(
        worker,
        project.id,
        claim.job.id,
        { attempt: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const activeClaim = await catalog.claimProjectKeywordScan(
      worker,
      project.id,
      { leaseSeconds: 60 },
    );
    expect(activeClaim).toMatchObject({
      job: { id: claim.job.id, attempt: 2 },
      attempt: 2,
    });
    if (!activeClaim) throw new Error("Expected an expired scan reclaim.");
    const artifactObject = {
      schemaVersion: 1 as const,
      projectId: project.id,
      projectVideoId: video.id,
      transcriptVersionId,
      keywordSetVersion: 2,
      scannerSchemaVersion: 1 as const,
      occurrences: [],
    };
    const upload = await catalog.createProjectKeywordScanArtifactUpload(
      worker,
      project.id,
      activeClaim.job.id,
      { attempt: 2 },
    );
    expect(upload).toMatchObject({
      scanId: activeClaim.job.id,
      objectKey: `keyword-scans/${project.id}/${video.id}/${activeClaim.job.id}/matches.json`,
    });
    const artifactBytes = new TextEncoder().encode(
      JSON.stringify(artifactObject),
    );
    const artifactKey = upload.objectKey;
    const storedArtifact = await store.put({
      key: artifactKey,
      bytes: artifactBytes,
      contentType: "application/json",
      sha256: digest(artifactBytes),
    });
    const artifact = {
      objectKey: artifactKey,
      objectVersionId: storedArtifact.versionId,
      sha256: digest(artifactBytes),
      sizeBytes: artifactBytes.byteLength,
      schemaVersion: 1 as const,
    };
    await expect(
      catalog.finalizeProjectKeywordScan(
        worker,
        project.id,
        activeClaim.job.id,
        {
          attempt: 2,
          artifact: {
            ...artifact,
            objectKey: `${artifact.objectKey}.alternate`,
          },
          occurrenceCount: 0,
          matchedKeywordCount: 0,
          keywordCounts: [],
          durationMs: 60_000,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      catalog.finalizeProjectKeywordScan(worker, project.id, claim.job.id, {
        attempt: 1,
        artifact,
        occurrenceCount: 0,
        matchedKeywordCount: 0,
        keywordCounts: [],
        durationMs: 60_000,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      catalog.failProjectKeywordScan(worker, project.id, claim.job.id, {
        attempt: 1,
        error: { code: "stale_attempt", message: "Stale worker failure" },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const finalizeCommand = {
      attempt: 2,
      artifact,
      occurrenceCount: 0,
      matchedKeywordCount: 0,
      keywordCounts: [],
      durationMs: 60_000,
    };
    const [finalized, concurrentReplay] = await Promise.all([
      catalog.finalizeProjectKeywordScan(
        worker,
        project.id,
        activeClaim.job.id,
        finalizeCommand,
      ),
      catalog.finalizeProjectKeywordScan(
        worker,
        project.id,
        activeClaim.job.id,
        finalizeCommand,
      ),
    ]);
    expect(concurrentReplay).toEqual(finalized);
    expect(finalized).toMatchObject({
      status: "current",
      occurrenceCount: 0,
      matchedKeywordCount: 0,
      matchesPerMinute: 0,
      artifact,
    });
    await expect(
      catalog.getProjectKeywordScanArtifactDownload(
        owner,
        project.id,
        activeClaim.job.id,
      ),
    ).resolves.toMatchObject({
      scanId: activeClaim.job.id,
      artifact,
      downloadUrl: expect.stringContaining("memory-download://"),
    });
    await expect(
      catalog.finalizeProjectKeywordScan(
        worker,
        project.id,
        activeClaim.job.id,
        {
          attempt: 2,
          artifact,
          occurrenceCount: 0,
          matchedKeywordCount: 0,
          keywordCounts: [],
          durationMs: 60_000,
        },
      ),
    ).resolves.toEqual(finalized);
    await expect(
      catalog.finalizeProjectKeywordScan(
        worker,
        project.id,
        activeClaim.job.id,
        {
          attempt: 2,
          artifact: { ...artifact, sha256: "e".repeat(64) },
          occurrenceCount: 0,
          matchedKeywordCount: 0,
          keywordCounts: [],
          durationMs: 60_000,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const ownerActivity = await catalog.listProjectVideoActivity(
      owner,
      project.id,
      { limit: 25, state: "unread" },
    );
    expect(ownerActivity).toMatchObject({ unreadCount: 1 });
    expect(ownerActivity.items[0]).toMatchObject({
      videoId: video.id,
      eventType: "keyword_scan_completed",
      state: "unread",
      actor: { userId: worker.userId },
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM project_video_activity_events
           WHERE project_id = $1 AND event_type = 'keyword_scan_completed'`,
          [project.id],
        )
      ).rows[0]!.count,
    ).toBe("1");
    const seen = await catalog.markProjectVideoActivitySeen(owner, project.id, {
      items: [
        {
          eventId: ownerActivity.items[0]!.eventId,
          expectedVersion: ownerActivity.items[0]!.version,
        },
      ],
    });
    await expect(
      catalog.markProjectVideoActivitySeen(owner, project.id, {
        items: [
          {
            eventId: ownerActivity.items[0]!.eventId,
            expectedVersion: ownerActivity.items[0]!.version,
          },
        ],
      }),
    ).resolves.toEqual(seen);
    await expect(
      catalog.getProjectKeywordScanSummary(outsider, project.id, video.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.getProjectKeywordScanArtifactDownload(
        outsider,
        project.id,
        activeClaim.job.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const aliasSuggestion = await catalog.suggestProjectKeyword(
      worker,
      project.id,
      {
        keywordId: approvedKeyword.keyword!.id,
        language: "es",
        phrase: "cambio climático",
        idempotencyKey: "suggest-scan-rescan-alias",
      },
    );
    if (aliasSuggestion.resolution === "already_approved") {
      throw new Error("Expected a pending rescan alias.");
    }
    await catalog.reviewProjectKeywordSuggestion(
      owner,
      project.id,
      aliasSuggestion.suggestion.id,
      {
        action: "approve",
        expectedSuggestionVersion: 1,
        expectedKeywordSetVersion: 2,
        idempotencyKey: "approve-scan-rescan-alias",
      },
    );
    await expect(
      catalog.getProjectKeywordScanSummary(owner, project.id, video.id),
    ).resolves.toMatchObject({
      status: "queued",
      keywordSetVersion: 3,
      priorResult: {
        scanId: activeClaim.job.id,
        keywordSetVersion: 2,
        occurrenceCount: 0,
        artifact,
      },
    });
    const replacementClaim = await catalog.claimProjectKeywordScan(
      worker,
      project.id,
      { leaseSeconds: 60 },
    );
    if (!replacementClaim)
      throw new Error("Expected a replacement scan claim.");
    await expect(
      catalog.failProjectKeywordScan(
        worker,
        project.id,
        replacementClaim.job.id,
        {
          attempt: replacementClaim.attempt,
          error: {
            code: "scan_input_unavailable",
            message: "Keyword scan input is temporarily unavailable.",
          },
        },
      ),
    ).resolves.toMatchObject({
      status: "failed",
      priorResult: { scanId: activeClaim.job.id, artifact },
    });
    await expect(
      catalog.getProjectKeywordScanArtifactDownload(
        owner,
        project.id,
        claim.job.id,
      ),
    ).resolves.toMatchObject({ artifact });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM project_keyword_scans WHERE project_id = $1",
          [project.id],
        )
      ).rows[0]!.count,
    ).toBe("2");
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, worker.userId],
    );
    await expect(
      catalog.getProjectKeywordScanSummary(worker, project.id, video.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.getProjectKeywordScanArtifactDownload(
        worker,
        project.id,
        activeClaim.job.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("canonical project-video worklist flags", () => {
  it("converges direct and batch ingest, preserves evidence, and isolates own flag changes", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("worklist-owner");
    const researcher = authorityActor("worklist-researcher");
    const outsider = authorityActor("worklist-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Worklist Owner", "worklist_owner"),
      catalog.registerUser(
        researcher,
        "Worklist Researcher",
        "worklist_researcher",
      ),
      catalog.registerUser(outsider, "Worklist Outsider", "worklist_outsider"),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Canonical worklist",
    });
    const otherProject = await catalog.createProject(outsider, {
      name: "Other canonical worklist",
    });
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    const metadata = {
      youtubeVideoId: "CanonicalWorklist1",
      canonicalUrl: "https://www.youtube.com/watch?v=CanonicalWorklist1",
      title: "Canonical worklist fixture",
      channel: "Fixture channel",
      durationMs: 60_000,
      sourceLanguage: "en",
    };
    const [direct, replay] = await Promise.all([
      catalog.addVideo(owner, project.id, metadata),
      catalog.addVideo(owner, project.id, metadata),
    ]);
    expect(replay.id).toBe(direct.id);
    const batch = await catalog.createTranscriptionBatch(researcher, {
      projectId: project.id,
      name: "Converged batch",
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
          input: metadata.canonicalUrl,
          status: "ready",
          processingNeed: "transcription",
          ...metadata,
        },
      ],
    });
    expect(batch.items[0]).toMatchObject({ catalogVideoId: direct.id });
    await catalog.addVideo(outsider, otherProject.id, metadata);

    const trackId = randomUUID();
    const clip = await catalog.createClipCandidate(owner, project.id, {
      idempotencyKey: "worklist-preserved-clip",
      video: metadata,
      selection: {
        trackId,
        transcriptVersion: 1,
        firstSegmentId: randomUUID(),
        lastSegmentId: randomUUID(),
        transcriptStartMs: 1_000,
        transcriptEndMs: 2_000,
        exportStartMs: 900,
        exportEndMs: 2_100,
        text: "Preserved worklist clip",
        timingPrecision: "cue",
      },
      languageEvidence: {
        schemaVersion: 2,
        native: {
          role: "native",
          language: "en",
          text: "Preserved worklist clip",
          trackId,
          trackVersion: 1,
          timingPrecision: "cue",
        },
        english: {
          role: "english",
          language: "en",
          text: "Preserved worklist clip",
          trackId,
          trackVersion: 1,
          timingPrecision: "cue",
        },
      },
      notes: "",
      tags: [],
    });
    const transcriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, 'fixture-v1',
               $6, now())`,
      [
        transcriptVersionId,
        project.id,
        direct.id,
        randomUUID(),
        "fixtures/worklist-manifest.json",
        "a".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, project.id, direct.id],
    );

    const listed = await catalog.listProjectVideoWorklist(owner, project.id, {
      limit: 25,
    });
    expect(listed).toMatchObject({ total: 1 });
    expect(listed.items[0]).toMatchObject({
      projectId: project.id,
      video: { id: direct.id, youtubeVideoId: metadata.youtubeVideoId },
      activeTranscriptVersionId: transcriptVersionId,
      activeFlagCount: 2,
      flaggersTruncated: false,
      ownFlag: { active: true, version: 1 },
      processing: {
        state: "queued",
        batchId: batch.batch.id,
        batchItemId: batch.items[0]!.id,
        jobId: batch.items[0]!.jobId,
        attempt: 0,
      },
      clipCount: 1,
    });
    expect(listed.items[0]!.flaggers.map((flagger) => flagger.handle)).toEqual(
      expect.arrayContaining(["worklist_owner", "worklist_researcher"]),
    );

    const deactivated = await catalog.updateOwnProjectVideoFlag(
      owner,
      project.id,
      direct.id,
      { active: false, expectedVersion: 1 },
    );
    expect(deactivated.flag).toMatchObject({ active: false, version: 2 });
    const replayedDeactivation = await catalog.updateOwnProjectVideoFlag(
      owner,
      project.id,
      direct.id,
      { active: false, expectedVersion: 2 },
    );
    expect(replayedDeactivation).toEqual(deactivated);
    const afterDeactivation = await catalog.listProjectVideoWorklist(
      owner,
      project.id,
      { limit: 25 },
    );
    expect(afterDeactivation.items[0]).toMatchObject({
      activeFlagCount: 1,
      ownFlag: { active: false, version: 2 },
      activeTranscriptVersionId: transcriptVersionId,
      clipCount: 1,
      processing: { jobId: batch.items[0]!.jobId },
    });
    expect(afterDeactivation.items[0]!.flaggers).toHaveLength(1);
    expect(afterDeactivation.items[0]!.flaggers[0]!.userId).toBe(
      researcher.userId,
    );
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM clip_candidates
           WHERE project_id = $1 AND id = $2`,
          [project.id, clip.id],
        )
      ).rows[0]?.count,
    ).toBe("1");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs WHERE id = $1`,
          [batch.items[0]!.jobId],
        )
      ).rows[0]?.count,
    ).toBe("1");

    await catalog.addVideo(owner, project.id, metadata);
    const replayedBatch = await catalog.createTranscriptionBatch(researcher, {
      projectId: project.id,
      name: "Converged batch replay",
      options: batch.batch,
      items: [
        {
          inputIndex: 0,
          input: metadata.canonicalUrl,
          status: "ready",
          processingNeed: "transcription",
          ...metadata,
        },
      ],
    });
    expect(replayedBatch.items[0]).toMatchObject({
      catalogVideoId: direct.id,
      status: "existing-transcript",
      processingNeed: "reuse-shared",
      state: "ready_for_review",
    });
    expect(replayedBatch.items[0]!.jobId).toBeUndefined();
    const restored = await catalog.listProjectVideoWorklist(owner, project.id, {
      limit: 25,
    });
    expect(restored.items[0]).toMatchObject({
      activeFlagCount: 2,
      ownFlag: { active: true, version: 3 },
      clipCount: 1,
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_videos
           WHERE video_id = $1`,
          [direct.id],
        )
      ).rows[0]?.count,
    ).toBe("2");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_video_flags
           WHERE video_id = $1`,
          [direct.id],
        )
      ).rows[0]?.count,
    ).toBe("3");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs
           WHERE project_id = $1 AND kind = 'transcription'`,
          [project.id],
        )
      ).rows[0]?.count,
    ).toBe("1");
    await expect(
      catalog.listProjectVideoWorklist(outsider, project.id, { limit: 25 }),
    ).rejects.toMatchObject({ code: "project_access_denied" });
    await expect(
      catalog.updateOwnProjectVideoFlag(outsider, project.id, direct.id, {
        active: false,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "project_access_denied" });
  });

  it("paginates stable canonical rows and rejects cross-project cursors", async () => {
    const { catalog } = await authorityCatalog();
    const actor = authorityActor("worklist-pagination");
    await catalog.registerUser(actor, "Worklist Pagination", "worklist_pages");
    const firstProject = await catalog.createProject(actor, {
      name: "First worklist pages",
    });
    const secondProject = await catalog.createProject(actor, {
      name: "Second worklist pages",
    });
    for (const suffix of ["A", "B", "C"]) {
      await catalog.addVideo(actor, firstProject.id, {
        youtubeVideoId: `WorklistPage${suffix}`,
        canonicalUrl: `https://www.youtube.com/watch?v=WorklistPage${suffix}`,
        title: `Worklist page ${suffix}`,
      });
    }
    await catalog.addVideo(actor, secondProject.id, {
      youtubeVideoId: "WorklistOtherPage",
      canonicalUrl: "https://www.youtube.com/watch?v=WorklistOtherPage",
      title: "Other project page",
    });

    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await catalog.listProjectVideoWorklist(
        actor,
        firstProject.id,
        { limit: 1, ...(cursor ? { cursor } : {}) },
      );
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
      seen.add(page.items[0]!.video.youtubeVideoId);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(
      new Set(["WorklistPageA", "WorklistPageB", "WorklistPageC"]),
    );
    const firstPage = await catalog.listProjectVideoWorklist(
      actor,
      firstProject.id,
      { limit: 1 },
    );
    await expect(
      catalog.listProjectVideoWorklist(actor, secondProject.id, {
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});

describe("project-video review coordination", () => {
  it("creates the initial review cycle when clip logging first introduces a video", async () => {
    const { catalog } = await authorityCatalog();
    const owner = authorityActor("review-clip-first-owner");
    await catalog.registerUser(
      owner,
      "Review Clip First Owner",
      "review_clip_first",
    );
    const project = await catalog.createProject(owner, {
      name: "Clip-first review coordination",
    });
    await createBatchClips(catalog, owner, project.id, 1);
    const listed = await catalog.listProjectVideoWorklist(owner, project.id, {
      limit: 25,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]!.review).toMatchObject({
      cycleNumber: 1,
      status: "open",
      version: 1,
      openedBy: { userId: owner.userId },
    });
  });

  it("renews, explicitly takes over, expires, releases, and replays soft claims", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const clock = { now: new Date("2026-08-24T12:00:00.000Z") };
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => clock.now,
    );
    const owner = authorityActor("claim-owner");
    const researcher = authorityActor("claim-researcher");
    const viewer = authorityActor("claim-viewer");
    const outsider = authorityActor("claim-outsider");
    await Promise.all([
      catalog.registerUser(owner, "Claim Owner", "claim_owner"),
      catalog.registerUser(researcher, "Claim Researcher", "claim_researcher"),
      catalog.registerUser(viewer, "Claim Viewer", "claim_viewer"),
      catalog.registerUser(outsider, "Claim Outsider", "claim_outsider"),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Claim coordination",
    });
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    await database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'viewer', now(), now())`,
      [project.id, viewer.userId],
    );
    const video = await catalog.addVideo(owner, project.id, {
      youtubeVideoId: "ClaimCoordination1",
      canonicalUrl: "https://www.youtube.com/watch?v=ClaimCoordination1",
      title: "Claim coordination fixture",
    });
    const firstCommand = {
      action: "claim" as const,
      idempotencyKey: "researcher-claim-1",
      expectedClaimVersion: 0,
      leaseSeconds: 300,
      takeoverConfirmed: false,
    };
    const first = await catalog.updateProjectVideoClaim(
      researcher,
      project.id,
      video.id,
      firstCommand,
    );
    expect(first.claim).toMatchObject({
      claimant: { userId: researcher.userId, handle: "claim_researcher" },
      generation: 1,
      version: 1,
      expiresAt: "2026-08-24T12:05:00.000Z",
    });
    await expect(
      catalog.updateProjectVideoClaim(
        researcher,
        project.id,
        video.id,
        firstCommand,
      ),
    ).resolves.toEqual(first);
    await expect(
      catalog.updateProjectVideoClaim(researcher, project.id, video.id, {
        ...firstCommand,
        leaseSeconds: 301,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
    await expect(
      catalog.updateProjectVideoClaim(owner, project.id, video.id, {
        action: "claim",
        idempotencyKey: "owner-unconfirmed-takeover",
        expectedClaimVersion: 1,
        leaseSeconds: 300,
        takeoverConfirmed: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    clock.now = new Date("2026-08-24T12:01:00.000Z");
    const renewed = await catalog.updateProjectVideoClaim(
      researcher,
      project.id,
      video.id,
      {
        action: "renew",
        idempotencyKey: "researcher-renew-1",
        expectedClaimVersion: 1,
        leaseSeconds: 600,
      },
    );
    expect(renewed.claim).toMatchObject({
      generation: 1,
      version: 2,
      expiresAt: "2026-08-24T12:11:00.000Z",
    });
    const takeover = await catalog.updateProjectVideoClaim(
      owner,
      project.id,
      video.id,
      {
        action: "claim",
        idempotencyKey: "owner-confirmed-takeover",
        expectedClaimVersion: 2,
        leaseSeconds: 120,
        takeoverConfirmed: true,
      },
    );
    expect(takeover.claim).toMatchObject({
      claimant: { userId: owner.userId },
      generation: 2,
      version: 3,
    });
    await expect(
      catalog.updateProjectVideoClaim(researcher, project.id, video.id, {
        action: "release",
        idempotencyKey: "researcher-cannot-release-owner",
        expectedClaimVersion: 3,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    clock.now = new Date("2026-08-24T12:04:00.000Z");
    expect(
      (await catalog.listProjectVideoWorklist(owner, project.id, { limit: 25 }))
        .items[0]!.claim,
    ).toMatchObject({
      claimant: { userId: owner.userId },
      version: 3,
      active: false,
    });
    await expect(
      catalog.updateProjectVideoClaim(researcher, project.id, video.id, {
        action: "claim",
        idempotencyKey: "expired-unconfirmed-takeover",
        expectedClaimVersion: 0,
        leaseSeconds: 300,
        takeoverConfirmed: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const expiredTakeover = await catalog.updateProjectVideoClaim(
      researcher,
      project.id,
      video.id,
      {
        action: "claim",
        idempotencyKey: "expired-confirmed-takeover",
        expectedClaimVersion: 0,
        leaseSeconds: 300,
        takeoverConfirmed: true,
      },
    );
    expect(expiredTakeover.claim).toMatchObject({ generation: 3, version: 4 });
    const released = await catalog.updateProjectVideoClaim(
      researcher,
      project.id,
      video.id,
      {
        action: "release",
        idempotencyKey: "researcher-release",
        expectedClaimVersion: 4,
      },
    );
    expect(released.claim).toBeUndefined();
    await expect(
      catalog.updateProjectVideoClaim(researcher, project.id, video.id, {
        action: "release",
        idempotencyKey: "researcher-release",
        expectedClaimVersion: 4,
      }),
    ).resolves.toEqual(released);
    const concurrentFirstClaims = await Promise.allSettled([
      catalog.updateProjectVideoClaim(owner, project.id, video.id, {
        action: "claim",
        idempotencyKey: "owner-claim-after-release",
        expectedClaimVersion: 0,
        leaseSeconds: 300,
        takeoverConfirmed: false,
      }),
      catalog.updateProjectVideoClaim(researcher, project.id, video.id, {
        action: "claim",
        idempotencyKey: "researcher-claim-after-release",
        expectedClaimVersion: 0,
        leaseSeconds: 300,
        takeoverConfirmed: false,
      }),
    ]);
    expect(
      concurrentFirstClaims.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrentFirstClaims.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const afterRelease = (
      concurrentFirstClaims.find(
        (result) => result.status === "fulfilled",
      ) as PromiseFulfilledResult<
        Awaited<ReturnType<typeof catalog.updateProjectVideoClaim>>
      >
    ).value;
    expect(afterRelease.claim).toMatchObject({ generation: 4, version: 5 });
    expect(
      (
        await database.query<{ event_type: string }>(
          `SELECT event_type FROM project_video_claim_events
           WHERE project_id = $1 AND video_id = $2
           ORDER BY created_at, id`,
          [project.id, video.id],
        )
      ).rows.map((row) => row.event_type),
    ).toEqual(
      expect.arrayContaining(["claimed", "renewed", "taken_over", "released"]),
    );
    await expect(
      catalog.updateProjectVideoClaim(viewer, project.id, video.id, {
        action: "claim",
        idempotencyKey: "viewer-claim",
        expectedClaimVersion: 5,
        leaseSeconds: 300,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.updateProjectVideoClaim(outsider, project.id, video.id, {
        action: "claim",
        idempotencyKey: "outsider-claim",
        expectedClaimVersion: 5,
        leaseSeconds: 300,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("keeps governance and append-only review cycles independent from processing", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("review-owner");
    const administrator = authorityActor("review-administrator");
    const researcher = authorityActor("review-researcher");
    const viewer = authorityActor("review-viewer");
    await Promise.all([
      catalog.registerUser(owner, "Review Owner", "review_owner"),
      catalog.registerUser(
        administrator,
        "Review Administrator",
        "review_administrator",
      ),
      catalog.registerUser(
        researcher,
        "Review Researcher",
        "review_researcher",
      ),
      catalog.registerUser(viewer, "Review Viewer", "review_viewer"),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Review coordination",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    await catalog.addMember(owner, project.id, viewer.userId, "viewer");
    const video = await catalog.addVideo(owner, project.id, {
      youtubeVideoId: "ReviewCoordination1",
      canonicalUrl: "https://www.youtube.com/watch?v=ReviewCoordination1",
      title: "Review coordination fixture",
    });
    const initial = (
      await catalog.listProjectVideoWorklist(owner, project.id, { limit: 25 })
    ).items[0]!;
    expect(initial).toMatchObject({
      priority: "normal",
      completionPolicy: "researcher_or_administrator",
      review: { cycleNumber: 1, status: "open", version: 1 },
      processing: { state: "not_requested" },
      activeFlagCount: 1,
    });
    const governanceCommand = {
      idempotencyKey: "administrator-only-high",
      expectedProjectVideoVersion: initial.projectVideoVersion,
      priority: "high" as const,
      completionPolicy: "administrator_only" as const,
    };
    const governed = await catalog.updateProjectVideoGovernance(
      administrator,
      project.id,
      video.id,
      governanceCommand,
    );
    expect(governed).toMatchObject({
      priority: "high",
      completionPolicy: "administrator_only",
      projectVideoVersion: initial.projectVideoVersion + 1,
    });
    await expect(
      catalog.updateProjectVideoGovernance(
        administrator,
        project.id,
        video.id,
        governanceCommand,
      ),
    ).resolves.toEqual(governed);
    await expect(
      catalog.updateProjectVideoGovernance(
        administrator,
        project.id,
        video.id,
        {
          ...governanceCommand,
          priority: "low",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
    await expect(
      catalog.updateProjectVideoGovernance(researcher, project.id, video.id, {
        idempotencyKey: "researcher-governance",
        expectedProjectVideoVersion: governed.projectVideoVersion,
        priority: "low",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.updateProjectVideoGovernance(owner, project.id, video.id, {
        idempotencyKey: "stale-governance",
        expectedProjectVideoVersion: initial.projectVideoVersion,
        priority: "normal",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    await expect(
      catalog.updateProjectVideoReview(researcher, project.id, video.id, {
        action: "complete",
        idempotencyKey: "researcher-blocked-complete",
        expectedCycleId: initial.review.id,
        expectedCycleVersion: initial.review.version,
        acknowledgeTranscriptUnavailable: true,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.updateProjectVideoReview(administrator, project.id, video.id, {
        action: "complete",
        idempotencyKey: "administrator-missing-ack",
        expectedCycleId: initial.review.id,
        expectedCycleVersion: initial.review.version,
        acknowledgeTranscriptUnavailable: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const completeWithoutTranscriptCommand = {
      action: "complete" as const,
      idempotencyKey: "administrator-complete-without-transcript",
      expectedCycleId: initial.review.id,
      expectedCycleVersion: initial.review.version,
      acknowledgeTranscriptUnavailable: true,
    };
    const completedFirst = await catalog.updateProjectVideoReview(
      administrator,
      project.id,
      video.id,
      completeWithoutTranscriptCommand,
    );
    expect(completedFirst.review).toMatchObject({
      id: initial.review.id,
      status: "completed",
      version: 2,
      completionPolicy: "administrator_only",
      completedBy: { userId: administrator.userId },
      completionBasis: "without_ready_transcript_acknowledged",
    });
    await expect(
      catalog.updateProjectVideoReview(
        administrator,
        project.id,
        video.id,
        completeWithoutTranscriptCommand,
      ),
    ).resolves.toEqual(completedFirst);
    const reopened = await catalog.updateProjectVideoReview(
      researcher,
      project.id,
      video.id,
      {
        action: "reopen",
        idempotencyKey: "reopen-for-new-evidence",
        expectedCycleId: completedFirst.review.id,
        expectedCycleVersion: completedFirst.review.version,
        reason: "A second source needs review.",
      },
    );
    expect(reopened.review).toMatchObject({
      cycleNumber: 2,
      status: "open",
      version: 1,
      openedBy: { userId: researcher.userId },
      reopenReason: "A second source needs review.",
    });
    const ordinaryPolicy = await catalog.updateProjectVideoGovernance(
      owner,
      project.id,
      video.id,
      {
        idempotencyKey: "ordinary-completion-policy",
        expectedProjectVideoVersion: governed.projectVideoVersion,
        completionPolicy: "researcher_or_administrator",
      },
    );
    const transcriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, 'review-v1',
               $6, now())`,
      [
        transcriptVersionId,
        project.id,
        video.id,
        randomUUID(),
        "fixtures/review-manifest.json",
        "b".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, project.id, video.id],
    );
    const completedSecond = await catalog.updateProjectVideoReview(
      researcher,
      project.id,
      video.id,
      {
        action: "complete",
        idempotencyKey: "researcher-complete-ready-transcript",
        expectedCycleId: reopened.review.id,
        expectedCycleVersion: reopened.review.version,
        acknowledgeTranscriptUnavailable: false,
      },
    );
    expect(completedSecond.review).toMatchObject({
      status: "completed",
      completionPolicy: "researcher_or_administrator",
      completionBasis: "ready_transcript",
      transcriptVersionId,
      completedBy: { userId: researcher.userId },
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM project_video_review_cycles
           WHERE project_id = $1 AND video_id = $2`,
          [project.id, video.id],
        )
      ).rows[0]!.count,
    ).toBe("2");
    expect(
      (
        await database.query<{
          status: string;
          completion_basis: string;
        }>(
          `SELECT status, completion_basis
           FROM project_video_review_cycles
           WHERE id = $1`,
          [initial.review.id],
        )
      ).rows[0],
    ).toEqual({
      status: "completed",
      completion_basis: "without_ready_transcript_acknowledged",
    });
    const final = (
      await catalog.listProjectVideoWorklist(owner, project.id, { limit: 25 })
    ).items[0]!;
    expect(final).toMatchObject({
      priority: "high",
      completionPolicy: "researcher_or_administrator",
      projectVideoVersion: ordinaryPolicy.projectVideoVersion,
      activeTranscriptVersionId: transcriptVersionId,
      activeFlagCount: 1,
      processing: { state: "not_requested" },
      review: {
        id: completedSecond.review.id,
        cycleNumber: 2,
        status: "completed",
      },
    });
    expect(
      await catalog.listProjectVideoActivity(owner, project.id, {
        limit: 25,
        state: "unread",
      }),
    ).toMatchObject({ unreadCount: 3 });
    expect(
      await catalog.listProjectVideoActivity(administrator, project.id, {
        limit: 25,
        state: "unread",
      }),
    ).toMatchObject({
      unreadCount: 1,
      items: [{ eventType: "review_reopened" }],
    });
    const concurrentVideo = await catalog.addVideo(owner, project.id, {
      youtubeVideoId: "ConcurrentReviewCoordination1",
      canonicalUrl:
        "https://www.youtube.com/watch?v=ConcurrentReviewCoordination1",
      title: "Concurrent review coordination fixture",
    });
    const concurrentItem = (
      await catalog.listProjectVideoWorklist(owner, project.id, { limit: 25 })
    ).items.find((item) => item.video.id === concurrentVideo.id)!;
    const concurrentCompletions = await Promise.allSettled([
      catalog.updateProjectVideoReview(owner, project.id, concurrentVideo.id, {
        action: "complete",
        idempotencyKey: "concurrent-owner-complete",
        expectedCycleId: concurrentItem.review.id,
        expectedCycleVersion: concurrentItem.review.version,
        acknowledgeTranscriptUnavailable: true,
      }),
      catalog.updateProjectVideoReview(
        administrator,
        project.id,
        concurrentVideo.id,
        {
          action: "complete",
          idempotencyKey: "concurrent-administrator-complete",
          expectedCycleId: concurrentItem.review.id,
          expectedCycleVersion: concurrentItem.review.version,
          acknowledgeTranscriptUnavailable: true,
        },
      ),
    ]);
    expect(
      concurrentCompletions.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrentCompletions.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_video_review_events
           WHERE project_id = $1 AND video_id = $2`,
          [project.id, concurrentVideo.id],
        )
      ).rows[0]!.count,
    ).toBe("1");
    await expect(
      catalog.updateProjectVideoReview(viewer, project.id, video.id, {
        action: "reopen",
        idempotencyKey: "viewer-reopen",
        expectedCycleId: completedSecond.review.id,
        expectedCycleVersion: completedSecond.review.version,
        reason: "Viewer must not reopen.",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("updates selected priorities atomically with administrator authority and exact replay", async () => {
    const { catalog } = await authorityCatalog();
    const owner = authorityActor("bulk-priority-owner");
    const administrator = authorityActor("bulk-priority-administrator");
    const researcher = authorityActor("bulk-priority-researcher");
    await Promise.all([
      catalog.registerUser(owner, "Bulk Priority Owner", "bulk_priority_owner"),
      catalog.registerUser(
        administrator,
        "Bulk Priority Administrator",
        "bulk_priority_admin",
      ),
      catalog.registerUser(
        researcher,
        "Bulk Priority Researcher",
        "bulk_priority_researcher",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Bulk priority authority",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    for (const suffix of ["A", "B"]) {
      await catalog.addVideo(owner, project.id, {
        youtubeVideoId: `BulkPriority${suffix}`,
        canonicalUrl: `https://www.youtube.com/watch?v=BulkPriority${suffix}`,
        title: `Bulk priority ${suffix}`,
      });
    }
    const initial = await catalog.listProjectVideoWorklist(owner, project.id, {
      limit: 25,
    });
    expect(initial.items).toHaveLength(2);
    const first = initial.items[0]!;
    const second = initial.items[1]!;
    const individuallyUpdated = await catalog.updateProjectVideoGovernance(
      owner,
      project.id,
      first.video.id,
      {
        idempotencyKey: "bump-one-before-bulk",
        expectedProjectVideoVersion: first.projectVideoVersion,
        priority: "low",
      },
    );
    await expect(
      catalog.bulkUpdateProjectVideoPriority(administrator, project.id, {
        priority: "high",
        idempotencyKey: "stale-bulk-priority",
        items: initial.items.map((item) => ({
          videoId: item.video.id,
          expectedProjectVideoVersion: item.projectVideoVersion,
        })),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const afterConflict = await catalog.listProjectVideoWorklist(
      owner,
      project.id,
      { limit: 25 },
    );
    expect(
      afterConflict.items.find((item) => item.video.id === first.video.id),
    ).toMatchObject({
      priority: "low",
      projectVideoVersion: individuallyUpdated.projectVideoVersion,
    });
    expect(
      afterConflict.items.find((item) => item.video.id === second.video.id),
    ).toMatchObject({
      priority: "normal",
      projectVideoVersion: second.projectVideoVersion,
    });

    await expect(
      catalog.bulkUpdateProjectVideoPriority(researcher, project.id, {
        priority: "high",
        idempotencyKey: "researcher-bulk-priority",
        items: afterConflict.items.map((item) => ({
          videoId: item.video.id,
          expectedProjectVideoVersion: item.projectVideoVersion,
        })),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const command = {
      priority: "high" as const,
      idempotencyKey: "administrator-bulk-priority",
      items: afterConflict.items.map((item) => ({
        videoId: item.video.id,
        expectedProjectVideoVersion: item.projectVideoVersion,
      })),
    };
    const updated = await catalog.bulkUpdateProjectVideoPriority(
      administrator,
      project.id,
      command,
    );
    expect(updated.items).toHaveLength(2);
    expect(updated.items.map((item) => item.priority)).toEqual([
      "high",
      "high",
    ]);
    expect(updated.items.map((item) => item.videoId)).toEqual(
      [...updated.items.map((item) => item.videoId)].sort(),
    );
    await expect(
      catalog.bulkUpdateProjectVideoPriority(
        administrator,
        project.id,
        command,
      ),
    ).resolves.toEqual(updated);
    await expect(
      catalog.bulkUpdateProjectVideoPriority(administrator, project.id, {
        ...command,
        priority: "normal",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "idempotency_conflict",
    });
  });

  it("bulk dismisses/restores with dependency-aware cancellation and durable receipts", async () => {
    const { database, catalog } = await authorityCatalog();
    const owner = authorityActor("triage-owner");
    const administrator = authorityActor("triage-administrator");
    const researcher = authorityActor("triage-researcher");
    await Promise.all([
      catalog.registerUser(owner, "Triage Owner", "triage_owner"),
      catalog.registerUser(
        administrator,
        "Triage Administrator",
        "triage_administrator",
      ),
      catalog.registerUser(
        researcher,
        "Triage Researcher",
        "triage_researcher",
      ),
    ]);
    const project = await catalog.createProject(owner, {
      name: "Bulk triage coordination",
    });
    await catalog.addMember(
      owner,
      project.id,
      administrator.userId,
      "administrator",
    );
    await catalog.addMember(owner, project.id, researcher.userId, "researcher");
    const inputs = ["A", "B"].map((suffix, inputIndex) => ({
      inputIndex,
      input: `https://youtu.be/Triage${suffix}`,
      status: "ready" as const,
      processingNeed: "transcription" as const,
      youtubeVideoId: `Triage${suffix}`,
      canonicalUrl: `https://www.youtube.com/watch?v=Triage${suffix}`,
      title: `Triage fixture ${suffix}`,
      sourceLanguage: "en",
    }));
    const batch = await catalog.createTranscriptionBatch(researcher, {
      projectId: project.id,
      name: "Bulk triage batch",
      options: {
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "prefer-existing",
        executionLocation: "local",
        priority: "normal",
      },
      items: inputs,
    });
    for (const input of inputs)
      await catalog.addVideo(owner, project.id, input);
    const claimed = await catalog.claimTranscriptionJob(owner, "local", 120);
    expect(claimed).toBeDefined();
    const claimedItem = batch.items.find(
      (item) => item.jobId === claimed!.job.id,
    )!;
    const queuedItem = batch.items.find(
      (item) => item.jobId !== claimed!.job.id,
    )!;
    const initial = await catalog.listProjectVideoWorklist(owner, project.id, {
      limit: 25,
      view: "all",
    });
    await expect(
      catalog.updateProjectVideoTriage(researcher, project.id, {
        action: "dismiss",
        idempotencyKey: "researcher-cannot-dismiss",
        items: [
          {
            videoId: claimedItem.catalogVideoId!,
            expectedProjectVideoVersion: initial.items.find(
              (item) => item.video.id === claimedItem.catalogVideoId,
            )!.projectVideoVersion,
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    const dismissCommand = {
      action: "dismiss" as const,
      idempotencyKey: "administrator-dismiss-bulk",
      items: initial.items.map((item) => ({
        videoId: item.video.id,
        expectedProjectVideoVersion: item.projectVideoVersion,
      })),
      reason: "Not relevant to the current research question.",
    };
    const dismissed = await catalog.updateProjectVideoTriage(
      administrator,
      project.id,
      dismissCommand,
    );
    expect(dismissed.cancellation).toEqual({
      queuedJobsCanceled: 1,
      activeJobsRequested: 1,
      requestsRevoked: 0,
    });
    await expect(
      catalog.updateProjectVideoTriage(
        administrator,
        project.id,
        dismissCommand,
      ),
    ).resolves.toEqual(dismissed);
    expect(
      await catalog.listProjectVideoWorklist(owner, project.id, {
        limit: 25,
        view: "queue",
      }),
    ).toMatchObject({ total: 0, items: [] });
    expect(
      await catalog.listProjectVideoWorklist(owner, project.id, {
        limit: 25,
        view: "dismissed",
      }),
    ).toMatchObject({ total: 2 });
    expect(
      (
        await database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [queuedItem.jobId],
        )
      ).rows[0]!.state,
    ).toBe("canceled");

    const ownerActivity = await catalog.listProjectVideoActivity(
      owner,
      project.id,
      { limit: 25, state: "unread" },
    );
    expect(ownerActivity).toMatchObject({ unreadCount: 2 });
    expect(ownerActivity.items).toHaveLength(2);
    const firstUnreadPage = await catalog.listProjectVideoActivity(
      owner,
      project.id,
      { limit: 1, state: "unread" },
    );
    expect(firstUnreadPage.nextCursor).toBeDefined();
    await expect(
      catalog.listProjectVideoActivity(owner, project.id, {
        limit: 1,
        state: "seen",
        cursor: firstUnreadPage.nextCursor,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      catalog.listProjectVideoActivity(owner, project.id, {
        limit: 1,
        state: "unread",
        cursor: firstUnreadPage.nextCursor,
      }),
    ).resolves.toMatchObject({ items: [expect.any(Object)] });
    const seen = await catalog.markProjectVideoActivitySeen(owner, project.id, {
      items: [
        {
          eventId: ownerActivity.items[0]!.eventId,
          expectedVersion: ownerActivity.items[0]!.version,
        },
      ],
    });
    expect(seen.items[0]).toMatchObject({ state: "seen", version: 2 });
    await expect(
      catalog.markProjectVideoActivitySeen(owner, project.id, {
        items: [
          {
            eventId: ownerActivity.items[0]!.eventId,
            expectedVersion: ownerActivity.items[0]!.version,
          },
        ],
      }),
    ).resolves.toEqual(seen);

    const claimedDismissed = dismissed.items.find(
      (item) => item.videoId === claimedItem.catalogVideoId,
    )!;
    const restored = await catalog.updateProjectVideoTriage(
      administrator,
      project.id,
      {
        action: "restore",
        idempotencyKey: "administrator-restore-active-job",
        items: [
          {
            videoId: claimedDismissed.videoId,
            expectedProjectVideoVersion: claimedDismissed.projectVideoVersion,
          },
        ],
      },
    );
    expect(restored.cancellation.requestsRevoked).toBe(1);
    await expect(
      catalog.heartbeatTranscriptionJob(
        owner,
        claimed!.job.id,
        claimed!.lease.attempt,
        120,
        "resolving",
      ),
    ).resolves.toMatchObject({ status: "active" });

    const dismissedAgain = await catalog.updateProjectVideoTriage(
      administrator,
      project.id,
      {
        action: "dismiss",
        idempotencyKey: "administrator-dismiss-active-job-again",
        items: [
          {
            videoId: claimedDismissed.videoId,
            expectedProjectVideoVersion: restored.items[0]!.projectVideoVersion,
          },
        ],
      },
    );
    expect(dismissedAgain.cancellation.activeJobsRequested).toBe(1);
    await expect(
      catalog.heartbeatTranscriptionJob(
        owner,
        claimed!.job.id,
        claimed!.lease.attempt,
        120,
        "resolving",
      ),
    ).resolves.toMatchObject({ status: "cancellation_requested" });
    expect(
      (
        await database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [claimed!.job.id],
        )
      ).rows[0]!.state,
    ).toBe("canceled");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM project_video_flags
           WHERE project_id = $1 AND video_id = ANY($2::uuid[])`,
          [project.id, batch.items.map((item) => item.catalogVideoId)],
        )
      ).rows[0]!.count,
    ).toBe("4");
    const durableActivityCount = Number(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM project_video_activity_events WHERE project_id = $1`,
          [project.id],
        )
      ).rows[0]!.count,
    );
    expect(durableActivityCount).toBeGreaterThan(0);
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project.id, administrator.userId],
    );
    const afterAdministratorRemoval = await catalog.listProjectVideoWorklist(
      owner,
      project.id,
      { limit: 25, view: "dismissed" },
    );
    expect(afterAdministratorRemoval.items).toHaveLength(2);
    expect(
      afterAdministratorRemoval.items.map(
        (item) => item.triage.dismissedBy?.handle,
      ),
    ).toEqual(["former_member", "former_member"]);
    expect(
      afterAdministratorRemoval.items.map((item) => item.unreadActivityCount),
    ).toEqual([0, 0]);
    await expect(
      catalog.listProjectVideoActivity(owner, project.id, {
        limit: 25,
        state: "all",
      }),
    ).resolves.toMatchObject({ items: [], unreadCount: 0 });
    expect(
      Number(
        (
          await database.query<{ count: string }>(
            `SELECT count(*)::text AS count
             FROM project_video_activity_events WHERE project_id = $1`,
            [project.id],
          )
        ).rows[0]!.count,
      ),
    ).toBe(durableActivityCount);
  });
});

describe("project-video language decisions", () => {
  it("finalizes a timed-import candidate without moving the active transcript pointer", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:timed-importer",
    };
    await catalog.registerUser(actor, "Timed importer");
    const project = await catalog.createProject(actor, {
      name: "Timed import",
    });
    const created = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Timed import batch",
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
          input: "https://youtu.be/TimedImport1",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "TimedImport1",
          canonicalUrl: "https://www.youtube.com/watch?v=TimedImport1",
          title: "Timed import fixture",
          durationMs: 60_000,
          sourceLanguage: "dz",
        },
      ],
    });
    const item = created.items[0]!;
    const initialGate = await catalog.getProjectVideoLanguageGate(
      actor,
      project.id,
      item.catalogVideoId!,
    );
    const decision = await catalog.confirmProjectVideoLanguageDecision(
      actor,
      project.id,
      item.catalogVideoId!,
      {
        idempotencyKey: "confirm-dz",
        expectedDecisionVersion: initialGate.decision?.decisionVersion ?? 0,
        resolvedLanguage: "dz",
        basis: "user_confirmation",
      },
    );
    await database.query(
      `UPDATE transcription_batch_items
       SET state = 'needs_language_confirmation' WHERE id = $1`,
      [item.id],
    );
    const previousTranscriptId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'dz', 'en', 'cue', $5, 'fixture-v1', $6, now())`,
      [
        previousTranscriptId,
        project.id,
        item.catalogVideoId,
        randomUUID(),
        "fixtures/previous-manifest.json",
        "c".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [previousTranscriptId, project.id, item.catalogVideoId],
    );
    const originalBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nབཀྲ་ཤིས།\n",
    );
    const englishBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
    );
    const command = {
      idempotencyKey: "timed-import-v1",
      languageDecisionId: decision.decision.id,
      expectedDecisionVersion: decision.decision.decisionVersion,
      batchItemId: item.id,
      expectedBatchItemVersion: 1,
      original: {
        format: "srt" as const,
        byteSize: originalBytes.byteLength,
        sha256: digest(originalBytes),
      },
      english: {
        format: "srt" as const,
        byteSize: englishBytes.byteLength,
        sha256: digest(englishBytes),
      },
    };
    const secondConnectionCatalog = new SharedProjectCatalog(database, store);
    const [createdByFirstConnection, createdBySecondConnection] =
      await Promise.all([
        catalog.createManualTimedTranscriptImport(
          actor,
          project.id,
          item.catalogVideoId!,
          { ...command, idempotencyKey: "timed-import-concurrent-create" },
        ),
        secondConnectionCatalog.createManualTimedTranscriptImport(
          actor,
          project.id,
          item.catalogVideoId!,
          { ...command, idempotencyKey: "timed-import-concurrent-create" },
        ),
      ]);
    expect(createdByFirstConnection.importId).toBe(
      createdBySecondConnection.importId,
    );
    const grant = await catalog.createManualTimedTranscriptImport(
      actor,
      project.id,
      item.catalogVideoId!,
      command,
    );
    expect(
      await catalog.createManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        command,
      ),
    ).toMatchObject({ importId: grant.importId });
    await expect(
      catalog.createManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        {
          ...command,
          original: { ...command.original, sha256: "d".repeat(64) },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const viewer: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:timed-import-viewer",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:timed-import-outsider",
    };
    await catalog.registerUser(viewer, "Timed viewer");
    await catalog.registerUser(outsider, "Timed outsider");
    await catalog.addMember(actor, project.id, viewer.userId, "viewer");
    await expect(
      catalog.createManualTimedTranscriptImport(
        viewer,
        project.id,
        item.catalogVideoId!,
        { ...command, idempotencyKey: "viewer-import" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.getManualTimedTranscriptImportForBatchItem(
        viewer,
        project.id,
        item.catalogVideoId!,
        item.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.getManualTimedTranscriptImportForBatchItem(
        outsider,
        project.id,
        item.catalogVideoId!,
        item.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const originalTarget = grant.targets.find(
      (target) => target.role === "original",
    )!;
    const englishTarget = grant.targets.find(
      (target) => target.role === "english",
    )!;
    const storedOriginal = await store.put({
      key: originalTarget.objectKey,
      bytes: originalBytes,
      contentType: "application/x-subrip",
      sha256: digest(originalBytes),
    });
    const storedEnglish = await store.put({
      key: englishTarget.objectKey,
      bytes: englishBytes,
      contentType: "application/x-subrip",
      sha256: digest(englishBytes),
    });
    const before = await database.query<{
      active_transcript_version_id: string | null;
    }>(
      `SELECT active_transcript_version_id FROM project_videos
       WHERE project_id = $1 AND video_id = $2`,
      [project.id, item.catalogVideoId!],
    );
    const finalizeCommand = {
      idempotencyKey: "timed-finalize-v1",
      original: {
        objectVersionId: storedOriginal.versionId,
        byteSize: storedOriginal.bytes.byteLength,
        sha256: storedOriginal.sha256,
      },
      english: {
        objectVersionId: storedEnglish.versionId,
        byteSize: storedEnglish.bytes.byteLength,
        sha256: storedEnglish.sha256,
      },
    };
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        viewer,
        project.id,
        item.catalogVideoId!,
        grant.importId,
        finalizeCommand,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const [finalized, concurrent] = await Promise.all([
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        grant.importId,
        finalizeCommand,
      ),
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        grant.importId,
        finalizeCommand,
      ),
    ]);
    expect([finalized.state, concurrent.state]).toContain("finalized");
    const winner = [finalized, concurrent].find(
      (status) => status.state === "finalized",
    )!;
    expect(winner).toMatchObject({
      state: "finalized",
      candidate: { timingPrecision: "cue" },
    });
    expect(
      (
        await database.query<{
          original_object_version_id: string;
          english_object_version_id: string;
        }>(
          `SELECT original_object_version_id, english_object_version_id
           FROM manual_timed_transcript_imports WHERE id = $1`,
          [grant.importId],
        )
      ).rows[0],
    ).toEqual({
      original_object_version_id: storedOriginal.versionId,
      english_object_version_id: storedEnglish.versionId,
    });
    expect(
      await catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        grant.importId,
        finalizeCommand,
      ),
    ).toEqual(winner);
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        grant.importId,
        {
          ...finalizeCommand,
          english: { ...finalizeCommand.english, sha256: "e".repeat(64) },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ active_transcript_version_id: string | null }>(
          `SELECT active_transcript_version_id FROM project_videos
           WHERE project_id = $1 AND video_id = $2`,
          [project.id, item.catalogVideoId!],
        )
      ).rows[0],
    ).toEqual(before.rows[0]);
    expect(before.rows[0]).toEqual({
      active_transcript_version_id: previousTranscriptId,
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM manual_timed_transcript_candidates
           WHERE import_id = $1`,
          [grant.importId],
        )
      ).rows[0]?.count,
    ).toBe("1");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE project_id = $1 AND event_type = 'transcript.activated'`,
          [project.id],
        )
      ).rows[0]?.count,
    ).toBe("0");

    await expect(
      catalog.reviewManualTimedTranscriptCandidate(
        viewer,
        project.id,
        item.catalogVideoId!,
        winner.candidate!.candidateId,
        { offset: 0, limit: 25 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.reviewManualTimedTranscriptCandidate(
        outsider,
        project.id,
        item.catalogVideoId!,
        winner.candidate!.candidateId,
        { offset: 0, limit: 25 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const review = await catalog.reviewManualTimedTranscriptCandidate(
      actor,
      project.id,
      item.catalogVideoId!,
      winner.candidate!.candidateId,
      { offset: 0, limit: 1 },
    );
    expect(review).toMatchObject({
      candidateId: winner.candidate!.candidateId,
      importId: grant.importId,
      transcriptVersionId: winner.candidate!.transcriptVersionId,
      languageDecisionId: decision.decision.id,
      languageDecisionVersion: decision.decision.decisionVersion,
      offset: 0,
      limit: 1,
      hasMore: false,
      original: {
        language: "dz",
        kind: "original",
        source: "manual-import",
        timingPrecision: "cue",
        totalCues: 1,
        cues: [{ startMs: 0, endMs: 1_000, text: "བཀྲ་ཤིས།" }],
      },
      english: {
        language: "en",
        kind: "english",
        source: "manual-import",
        timingPrecision: "cue",
        totalCues: 1,
        cues: [{ startMs: 0, endMs: 1_000, text: "Hello" }],
      },
    });
    expect(review.english.sourceTrackId).toBe(review.original.trackId);
    expect(review).not.toHaveProperty("objectKey");

    const corruptedStore: TranscriptObjectStore = {
      put: (input) => store.put(input),
      get: (key, versionId) => store.get(key, versionId),
      getBounded: async (key, versionId, maxBytes) => {
        const stored = await store.getBounded(key, versionId, maxBytes);
        return stored && key.endsWith("original.normalized.json")
          ? { ...stored, bytes: new TextEncoder().encode("corrupt") }
          : stored;
      },
      deleteVersion: (key, versionId) => store.deleteVersion(key, versionId),
      delete: (key) => store.delete(key),
      list: (prefix) => store.list(prefix),
    };
    const corruptedCatalog = new SharedProjectCatalog(database, corruptedStore);
    await expect(
      corruptedCatalog.reviewManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        winner.candidate!.candidateId,
        { offset: 0, limit: 1 },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    const activationBase = {
      importId: review.importId,
      candidateId: review.candidateId,
      transcriptVersionId: review.transcriptVersionId,
      expectedProjectVideoVersion: review.projectVideoVersion,
      languageDecisionId: review.languageDecisionId,
      expectedLanguageDecisionVersion: review.languageDecisionVersion,
    };
    await expect(
      catalog.activateManualTimedTranscriptCandidate(
        viewer,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: "viewer-activation" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      corruptedCatalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: "corrupt-activation" },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
    const concurrentActivationCatalog = new SharedProjectCatalog(
      database,
      store,
    );
    const activationResults = await Promise.allSettled([
      catalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: "activate-corrected-first" },
      ),
      concurrentActivationCatalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: "activate-corrected-second" },
      ),
    ]);
    const activationWinner = activationResults.find(
      (result) => result.status === "fulfilled",
    );
    expect(
      activationResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      activationResults.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(activationWinner).toBeDefined();
    if (!activationWinner || activationWinner.status !== "fulfilled") {
      throw new Error("Activation race did not produce a winner.");
    }
    const winningKey =
      activationWinner.value.activationId ===
      (activationResults[0].status === "fulfilled"
        ? activationResults[0].value.activationId
        : undefined)
        ? "activate-corrected-first"
        : "activate-corrected-second";
    expect(activationWinner.value).toMatchObject({
      state: "activated",
      candidateId: review.candidateId,
      transcriptVersionId: review.transcriptVersionId,
      projectVideoVersion: review.projectVideoVersion + 1,
    });
    expect(
      await catalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: winningKey },
      ),
    ).toEqual(activationWinner.value);
    await expect(
      catalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        {
          ...activationBase,
          transcriptVersionId: randomUUID(),
          idempotencyKey: winningKey,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: "idempotency_conflict" });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM manual_timed_transcript_activations WHERE candidate_id = $1`,
          [review.candidateId],
        )
      ).rows[0]?.count,
    ).toBe("1");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE project_id = $1 AND event_type = 'transcript.activated'
             AND entity_id = $2`,
          [project.id, review.transcriptVersionId],
        )
      ).rows[0]?.count,
    ).toBe("1");
    expect(
      await catalog.getActiveTranscript(
        actor,
        project.id,
        item.catalogVideoId!,
      ),
    ).toMatchObject({ transcriptVersionId: review.transcriptVersionId });
    await database.query(
      `UPDATE project_videos
       SET active_transcript_version_id = $1, version = version + 1
       WHERE project_id = $2 AND video_id = $3`,
      [previousTranscriptId, project.id, item.catalogVideoId!],
    );
    expect(
      await catalog.activateManualTimedTranscriptCandidate(
        actor,
        project.id,
        item.catalogVideoId!,
        { ...activationBase, idempotencyKey: winningKey },
      ),
    ).toMatchObject({ state: "superseded" });
    expect(
      (
        await database.query<{ active_transcript_version_id: string }>(
          `SELECT active_transcript_version_id FROM project_videos
           WHERE project_id = $1 AND video_id = $2`,
          [project.id, item.catalogVideoId!],
        )
      ).rows[0]?.active_transcript_version_id,
    ).toBe(previousTranscriptId);
    const preparePendingImport = async (idempotencyKey: string) => {
      const itemSnapshot = await database.query<{ version: number }>(
        `UPDATE transcription_batch_items
         SET state = 'needs_language_confirmation',
             manual_timed_transcript_candidate_id = NULL,
             version = version + 1
         WHERE id = $1
         RETURNING version`,
        [item.id],
      );
      const decisionSnapshot = await database.query<{
        id: string;
        decision_version: number;
      }>(
        `SELECT d.id, d.decision_version
         FROM project_videos pv
         JOIN project_video_language_decisions d
           ON d.id = pv.current_language_decision_id
         WHERE pv.project_id = $1 AND pv.video_id = $2`,
        [project.id, item.catalogVideoId!],
      );
      const pendingGrant = await catalog.createManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        {
          ...command,
          idempotencyKey,
          languageDecisionId: decisionSnapshot.rows[0]!.id,
          expectedDecisionVersion: decisionSnapshot.rows[0]!.decision_version,
          expectedBatchItemVersion: itemSnapshot.rows[0]!.version,
        },
      );
      const pendingOriginal = pendingGrant.targets.find(
        (target) => target.role === "original",
      )!;
      const pendingEnglish = pendingGrant.targets.find(
        (target) => target.role === "english",
      )!;
      const pendingStoredOriginal = await store.put({
        key: pendingOriginal.objectKey,
        bytes: originalBytes,
        contentType: "application/x-subrip",
        sha256: digest(originalBytes),
      });
      const pendingStoredEnglish = await store.put({
        key: pendingEnglish.objectKey,
        bytes: englishBytes,
        contentType: "application/x-subrip",
        sha256: digest(englishBytes),
      });
      return {
        grant: pendingGrant,
        originalTarget: pendingOriginal,
        englishTarget: pendingEnglish,
        storedOriginal: pendingStoredOriginal,
        storedEnglish: pendingStoredEnglish,
        finalize: {
          idempotencyKey: `${idempotencyKey}-finalize`,
          original: {
            objectVersionId: pendingStoredOriginal.versionId,
            byteSize: pendingStoredOriginal.bytes.byteLength,
            sha256: pendingStoredOriginal.sha256,
          },
          english: {
            objectVersionId: pendingStoredEnglish.versionId,
            byteSize: pendingStoredEnglish.bytes.byteLength,
            sha256: pendingStoredEnglish.sha256,
          },
        },
      };
    };
    const invalid = await preparePendingImport("timed-import-invalid-object");
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        invalid.grant.importId,
        {
          ...invalid.finalize,
          original: {
            ...invalid.finalize.original,
            objectVersionId: randomUUID(),
          },
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "manual_import_object_invalid",
    });
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        invalid.grant.importId,
        {
          ...invalid.finalize,
          english: { ...invalid.finalize.english, sha256: "f".repeat(64) },
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "manual_import_object_invalid",
    });
    const oversized = await store.put({
      key: invalid.originalTarget.objectKey,
      bytes: new Uint8Array(21 * 1024 * 1024),
      contentType: "application/x-subrip",
      // Simulates a compromised staged object whose metadata claims the
      // original declared digest; bounded retrieval must reject it first.
      sha256: invalid.finalize.original.sha256,
    });
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        invalid.grant.importId,
        {
          ...invalid.finalize,
          original: {
            ...invalid.finalize.original,
            objectVersionId: oversized.versionId,
          },
        },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "manual_import_object_invalid",
    });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM manual_timed_transcript_candidates
           WHERE import_id = $1`,
          [invalid.grant.importId],
        )
      ).rows[0]?.count,
    ).toBe("0");

    const staleDecision = await preparePendingImport(
      "timed-import-stale-decision",
    );
    const currentGate = await catalog.getProjectVideoLanguageGate(
      actor,
      project.id,
      item.catalogVideoId!,
    );
    await catalog.confirmProjectVideoLanguageDecision(
      actor,
      project.id,
      item.catalogVideoId!,
      {
        idempotencyKey: "confirm-dz-v2",
        expectedDecisionVersion: currentGate.decision!.decisionVersion,
        resolvedLanguage: "dz",
        basis: "user_confirmation",
      },
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        staleDecision.grant.importId,
        staleDecision.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const staleItem = await preparePendingImport("timed-import-stale-item");
    await database.query(
      `UPDATE transcription_batch_items SET version = version + 1 WHERE id = $1`,
      [item.id],
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        staleItem.grant.importId,
        staleItem.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const staleDuration = await preparePendingImport(
      "timed-import-stale-duration",
    );
    await database.query(
      `UPDATE videos SET duration_ms = duration_ms + 1, updated_at = now()
       WHERE id = $1`,
      [item.catalogVideoId!],
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        staleDuration.grant.importId,
        staleDuration.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM manual_timed_transcript_candidates
           WHERE import_id IN ($1, $2, $3)`,
          [
            staleDecision.grant.importId,
            staleItem.grant.importId,
            staleDuration.grant.importId,
          ],
        )
      ).rows[0]?.count,
    ).toBe("0");

    const partialArtifactFailure = await preparePendingImport(
      "timed-import-partial-artifact-failure",
    );
    let candidatePutCount = 0;
    const partialFailureStore: TranscriptObjectStore = {
      put: async (input) => {
        if (
          input.key.includes(
            `/${partialArtifactFailure.grant.importId}/candidate/`,
          )
        ) {
          candidatePutCount += 1;
          if (candidatePutCount === 2) {
            throw new Error("fixture candidate artifact failure");
          }
        }
        return store.put(input);
      },
      get: (key, versionId) => store.get(key, versionId),
      getBounded: (key, versionId, maxBytes) =>
        store.getBounded(key, versionId, maxBytes),
      deleteVersion: (key, versionId) => store.deleteVersion(key, versionId),
      delete: (key) => store.delete(key),
      list: (prefix) => store.list(prefix),
    };
    const partialFailureCatalog = new SharedProjectCatalog(
      database,
      partialFailureStore,
    );
    await expect(
      partialFailureCatalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        partialArtifactFailure.grant.importId,
        partialArtifactFailure.finalize,
      ),
    ).rejects.toThrow("fixture candidate artifact failure");
    expect(
      await store.list(
        `projects/${project.id}/videos/${item.catalogVideoId}/manual-imports/${partialArtifactFailure.grant.importId}/candidate`,
      ),
    ).toEqual([]);
    expect(
      (
        await database.query<{ state: string }>(
          `SELECT state FROM manual_timed_transcript_imports WHERE id = $1`,
          [partialArtifactFailure.grant.importId],
        )
      ).rows[0],
    ).toEqual({ state: "staged" });
    expect(
      await catalog.getManualTimedTranscriptImportForBatchItem(
        actor,
        project.id,
        item.catalogVideoId!,
        item.id,
      ),
    ).toEqual(winner);
    const resumed = await preparePendingImport("timed-import-resume");
    const resumeRequestSha256 = digest(
      new TextEncoder().encode(canonicalJson(resumed.finalize)),
    );
    await database.query(
      `UPDATE manual_timed_transcript_imports
       SET state = 'finalizing', finalize_idempotency_key = $1,
           finalize_request_sha256 = $2, finalization_token = $3,
           finalization_started_at = '2000-01-01T00:00:00.000Z',
           original_object_version_id = $4, english_object_version_id = $5
       WHERE id = $6`,
      [
        resumed.finalize.idempotencyKey,
        resumeRequestSha256,
        randomUUID(),
        resumed.storedOriginal.versionId,
        resumed.storedEnglish.versionId,
        resumed.grant.importId,
      ],
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        resumed.grant.importId,
        resumed.finalize,
      ),
    ).resolves.toMatchObject({
      importId: resumed.grant.importId,
      state: "finalized",
    });

    const expiring = await preparePendingImport("timed-import-expiring");
    await database.query(
      `UPDATE manual_timed_transcript_imports
       SET original_object_version_id = $1, english_object_version_id = $2,
           expires_at = '2000-01-01T00:00:00.000Z'
       WHERE id = $3`,
      [
        expiring.storedOriginal.versionId,
        expiring.storedEnglish.versionId,
        expiring.grant.importId,
      ],
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        expiring.grant.importId,
        expiring.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ state: string }>(
          `SELECT state FROM manual_timed_transcript_imports WHERE id = $1`,
          [expiring.grant.importId],
        )
      ).rows[0],
    ).toEqual({ state: "expired" });
    expect(
      await store.get(
        expiring.originalTarget.objectKey,
        expiring.storedOriginal.versionId,
      ),
    ).toBeUndefined();
    expect(
      await store.get(
        expiring.englishTarget.objectKey,
        expiring.storedEnglish.versionId,
      ),
    ).toBeUndefined();

    const expiringFinalization = await preparePendingImport(
      "timed-import-expiring-finalization",
    );
    await database.query(
      `UPDATE manual_timed_transcript_imports
       SET state = 'finalizing', finalize_idempotency_key = $1,
           finalize_request_sha256 = $2, finalization_token = $3,
           finalization_started_at = '2000-01-01T00:00:00.000Z',
           original_object_version_id = $4, english_object_version_id = $5,
           expires_at = '2000-01-01T00:00:01.000Z'
       WHERE id = $6`,
      [
        expiringFinalization.finalize.idempotencyKey,
        digest(
          new TextEncoder().encode(
            canonicalJson(expiringFinalization.finalize),
          ),
        ),
        randomUUID(),
        expiringFinalization.storedOriginal.versionId,
        expiringFinalization.storedEnglish.versionId,
        expiringFinalization.grant.importId,
      ],
    );
    await expect(
      catalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        expiringFinalization.grant.importId,
        expiringFinalization.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ state: string }>(
          `SELECT state FROM manual_timed_transcript_imports WHERE id = $1`,
          [expiringFinalization.grant.importId],
        )
      ).rows[0],
    ).toEqual({ state: "expired" });
    expect(
      await store.get(
        expiringFinalization.originalTarget.objectKey,
        expiringFinalization.storedOriginal.versionId,
      ),
    ).toBeUndefined();
    expect(
      await store.get(
        expiringFinalization.englishTarget.objectKey,
        expiringFinalization.storedEnglish.versionId,
      ),
    ).toBeUndefined();

    const reservationRace = await preparePendingImport(
      "timed-import-expiry-reservation-race",
    );
    let boundedReads = 0;
    const reservationRaceStore: TranscriptObjectStore = {
      put: (input) => store.put(input),
      get: (key, versionId) => store.get(key, versionId),
      getBounded: async (key, versionId, maxBytes) => {
        const value = await store.getBounded(key, versionId, maxBytes);
        boundedReads += 1;
        if (boundedReads === 2) {
          await database.query(
            `UPDATE manual_timed_transcript_imports
             SET state = 'expired', version = version + 1
             WHERE id = $1`,
            [reservationRace.grant.importId],
          );
        }
        return value;
      },
      deleteVersion: (key, versionId) => store.deleteVersion(key, versionId),
      delete: (key) => store.delete(key),
      list: (prefix) => store.list(prefix),
    };
    const reservationRaceCatalog = new SharedProjectCatalog(
      database,
      reservationRaceStore,
    );
    await expect(
      reservationRaceCatalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        reservationRace.grant.importId,
        reservationRace.finalize,
      ),
    ).resolves.toMatchObject({ state: "expired" });
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM manual_timed_transcript_candidates WHERE import_id = $1`,
          [reservationRace.grant.importId],
        )
      ).rows[0]?.count,
    ).toBe("0");

    const publishRace = await preparePendingImport(
      "timed-import-expiry-publish-race",
    );
    let expiredDuringPublish = false;
    const publishRaceStore: TranscriptObjectStore = {
      put: async (input) => {
        const value = await store.put(input);
        if (
          !expiredDuringPublish &&
          input.key.includes(`/${publishRace.grant.importId}/candidate/`)
        ) {
          expiredDuringPublish = true;
          await database.query(
            `UPDATE manual_timed_transcript_imports
             SET expires_at = '2000-01-01T00:00:00.000Z'
             WHERE id = $1`,
            [publishRace.grant.importId],
          );
        }
        return value;
      },
      get: (key, versionId) => store.get(key, versionId),
      getBounded: (key, versionId, maxBytes) =>
        store.getBounded(key, versionId, maxBytes),
      deleteVersion: (key, versionId) => store.deleteVersion(key, versionId),
      delete: (key) => store.delete(key),
      list: (prefix) => store.list(prefix),
    };
    const publishRaceCatalog = new SharedProjectCatalog(
      database,
      publishRaceStore,
    );
    await expect(
      publishRaceCatalog.finalizeManualTimedTranscriptImport(
        actor,
        project.id,
        item.catalogVideoId!,
        publishRace.grant.importId,
        publishRace.finalize,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ state: string }>(
          `SELECT state FROM manual_timed_transcript_imports WHERE id = $1`,
          [publishRace.grant.importId],
        )
      ).rows[0],
    ).toEqual({ state: "expired" });
    expect(
      await store.list(
        `projects/${project.id}/videos/${item.catalogVideoId}/manual-imports/${publishRace.grant.importId}/candidate`,
      ),
    ).toEqual([]);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM manual_timed_transcript_candidates WHERE import_id = $1`,
          [publishRace.grant.importId],
        )
      ).rows[0]?.count,
    ).toBe("0");
    expect(
      await catalog.getManualTimedTranscriptImportForBatchItem(
        actor,
        project.id,
        item.catalogVideoId!,
        item.id,
      ),
    ).toMatchObject({
      importId: resumed.grant.importId,
      state: "finalized",
    });
  });

  it("blocks unknown language, preserves exact confirmation replays, and exposes the current gate", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:language-owner",
    };
    await catalog.registerUser(actor, "Language owner");
    const project = await catalog.createProject(actor, {
      name: "Language project",
    });
    const unknown = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Unknown-language batch",
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
          title: "Unknown fixture video",
        },
      ],
    });
    expect(unknown.items[0]).toMatchObject({
      state: "needs_language_confirmation",
    });
    expect(unknown.items[0]?.jobId).toBeUndefined();
    const videoId = unknown.items[0]!.catalogVideoId!;
    expect(
      await catalog.getProjectVideoLanguageGate(actor, project.id, videoId),
    ).toMatchObject({
      state: "needs_language_confirmation",
      status: "unverified",
      remediationReason: "confirm_language",
    });

    const command = {
      idempotencyKey: "confirm-dz-v1",
      expectedDecisionVersion: 0,
      resolvedLanguage: "dz",
      basis: "user_confirmation" as const,
    };
    const viewer: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:language-viewer",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:language-outsider",
    };
    await catalog.registerUser(viewer, "Language viewer");
    await catalog.registerUser(outsider, "Language outsider");
    await database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'viewer', now(), now())`,
      [project.id, viewer.userId],
    );
    await expect(
      catalog.getProjectVideoLanguageGate(viewer, project.id, videoId),
    ).resolves.toMatchObject({ state: "needs_language_confirmation" });
    await expect(
      catalog.confirmProjectVideoLanguageDecision(
        viewer,
        project.id,
        videoId,
        command,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.confirmProjectVideoLanguageDecision(
        outsider,
        project.id,
        videoId,
        command,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const confirmed = await catalog.confirmProjectVideoLanguageDecision(
      actor,
      project.id,
      videoId,
      command,
    );
    const replay = await catalog.confirmProjectVideoLanguageDecision(
      actor,
      project.id,
      videoId,
      command,
    );
    expect(replay).toEqual(confirmed);
    expect(confirmed).toMatchObject({
      decision: {
        decisionVersion: 1,
        status: "confirmed",
        resolvedLanguage: "dz",
      },
      gate: { state: "ready", status: "confirmed" },
    });
    await expect(
      catalog.confirmProjectVideoLanguageDecision(actor, project.id, videoId, {
        ...command,
        resolvedLanguage: "ko",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      catalog.confirmProjectVideoLanguageDecision(actor, project.id, videoId, {
        ...command,
        idempotencyKey: "stale-decision-version",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("blocks unknown worker evidence and lets a confirmed decision supersede stale creator metadata", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:language-worker",
    };
    await catalog.registerUser(actor, "Language worker");
    const project = await catalog.createProject(actor, {
      name: "Worker language project",
    });
    const unconfirmed = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Unconfirmed worker evidence",
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
          title: "Creator Korean fixture",
          sourceLanguage: "ko",
        },
      ],
    });
    await catalog.markTranscriptionJobQueueDelivered(
      unconfirmed.items[0]!.jobId!,
      "local",
    );
    const unconfirmedJob = (await catalog.claimTranscriptionJob(
      actor,
      "local",
      120,
      true,
    ))!;
    expect(unconfirmedJob.job.payload.languageDecision).toMatchObject({
      status: "unverified",
      basis: "creator_metadata",
      resolvedLanguage: "ko",
    });
    expect(unconfirmed.items[0]?.jobId).toBeDefined();
    const noLanguage = await catalog.observeWorkerLanguageEvidence(
      actor,
      unconfirmedJob.job.id,
      {
        attempt: unconfirmedJob.lease.attempt,
        evidence: {
          id: randomUUID(),
          projectId: project.id,
          videoId: unconfirmed.items[0]!.catalogVideoId!,
          source: "speech_detection",
          provider: "fixture",
          jobId: unconfirmedJob.job.id,
          attempt: unconfirmedJob.lease.attempt,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    );
    expect(noLanguage.gate).toMatchObject({
      state: "needs_language_confirmation",
      remediationReason: "confirm_language",
    });
    expect(
      await catalog.getTranscriptionBatch(
        actor,
        project.id,
        unconfirmed.batch.id,
      ),
    ).toMatchObject({
      items: [{ state: "needs_language_confirmation" }],
    });
    await expect(
      catalog.heartbeatTranscriptionJob(
        actor,
        unconfirmedJob.job.id,
        unconfirmedJob.lease.attempt,
        120,
        "acquiring",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await catalog.getTranscriptionBatch(
        actor,
        project.id,
        unconfirmed.batch.id,
      ),
    ).toMatchObject({
      items: [{ state: "needs_language_confirmation" }],
    });

    const confirmedProject = await catalog.createProject(actor, {
      name: "Confirmed language project",
    });
    const seeded = await catalog.createTranscriptionBatch(actor, {
      projectId: confirmedProject.id,
      name: "Seed language decision",
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
          input: "https://youtu.be/dQw4w9WgXcQ",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Decision fixture",
        },
      ],
    });
    const videoId = seeded.items[0]!.catalogVideoId!;
    await catalog.confirmProjectVideoLanguageDecision(
      actor,
      confirmedProject.id,
      videoId,
      {
        idempotencyKey: "confirm-dz-v1",
        expectedDecisionVersion: 0,
        resolvedLanguage: "dz",
        basis: "user_confirmation",
      },
    );
    const staleCreator = await catalog.createTranscriptionBatch(actor, {
      projectId: confirmedProject.id,
      name: "Stale creator metadata",
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
          input: "https://youtu.be/dQw4w9WgXcQ",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Stale Korean creator metadata",
          sourceLanguage: "ko",
        },
      ],
    });
    await catalog.markTranscriptionJobQueueDelivered(
      staleCreator.items[0]!.jobId!,
      "local",
    );
    const confirmedJob = (await catalog.claimTranscriptionJob(
      actor,
      "local",
      120,
      true,
    ))!;
    await catalog.confirmProjectVideoLanguageDecision(
      actor,
      confirmedProject.id,
      videoId,
      {
        idempotencyKey: "confirm-ko-v2",
        expectedDecisionVersion: 1,
        resolvedLanguage: "ko",
        basis: "user_confirmation",
      },
    );
    const confirmedEvidence = await catalog.observeWorkerLanguageEvidence(
      actor,
      confirmedJob.job.id,
      {
        attempt: confirmedJob.lease.attempt,
        evidence: {
          id: randomUUID(),
          projectId: confirmedProject.id,
          videoId,
          source: "caption",
          provider: "fixture",
          reportedLanguage: "dz",
          captionKind: "automatic",
          jobId: confirmedJob.job.id,
          attempt: confirmedJob.lease.attempt,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      },
    );
    expect(staleCreator.items[0]?.jobId).toBe(confirmedJob.job.id);
    expect(confirmedEvidence.gate).toMatchObject({
      state: "ready",
      status: "confirmed",
      remediationReason: "none",
    });
    expect(
      await catalog.getProjectVideoLanguageGate(
        actor,
        confirmedProject.id,
        videoId,
      ),
    ).toMatchObject({
      state: "ready",
      status: "confirmed",
      decision: { decisionVersion: 2, resolvedLanguage: "ko" },
    });
    expect(
      (
        await catalog.getProjectVideoLanguageGate(
          actor,
          confirmedProject.id,
          videoId,
        )
      ).providerEvidence,
    ).toBeUndefined();
    const unknownCapability = await catalog.observeWorkerLanguageEvidence(
      actor,
      confirmedJob.job.id,
      {
        attempt: confirmedJob.lease.attempt,
        evidence: {
          id: randomUUID(),
          projectId: confirmedProject.id,
          videoId,
          source: "speech_detection",
          provider: "fixture",
          reportedLanguage: "dz",
          jobId: confirmedJob.job.id,
          attempt: confirmedJob.lease.attempt,
          createdAt: "2024-01-01T00:00:01.000Z",
        },
        speechCapability: {
          state: "unknown",
          provider: "fixture",
          operation: "speech_to_text",
          sourceLanguage: "dz",
          reason: "configuration_unknown",
        },
      },
    );
    expect(unknownCapability.gate).toMatchObject({
      state: "needs_transcript",
      remediationReason: "select_supported_provider",
    });
    await expect(
      database.query("SELECT state FROM jobs WHERE id = $1", [
        confirmedJob.job.id,
      ]),
    ).resolves.toMatchObject({ rows: [{ state: "needs_user_action" }] });
    await expect(
      catalog.heartbeatTranscriptionJob(
        actor,
        confirmedJob.job.id,
        confirmedJob.lease.attempt,
        120,
        "transcribing",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

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
          sourceLanguage: "en",
        },
      ],
    });
    const item = created.items[0]!;
    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual([
      { jobId: item.jobId, executionLocation: "local" },
    ]);
    await catalog.markTranscriptionJobDispatched(item.jobId!);
    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual(
      [],
    );
    await database.query(
      `UPDATE jobs
       SET payload = payload || jsonb_build_object(
             'queueDispatchedAt', '2000-01-01T00:00:00.000Z'
           )
       WHERE id = $1`,
      [item.jobId],
    );
    await expect(catalog.listUndispatchedTranscriptionJobs()).resolves.toEqual([
      { jobId: item.jobId, executionLocation: "local" },
    ]);
    await catalog.markTranscriptionJobDispatched(item.jobId!);
    await expect(
      catalog.claimTranscriptionJob(actor, "local", 120, true),
    ).resolves.toBeUndefined();
    await expect(
      catalog.markTranscriptionJobQueueDelivered(item.jobId!, "local"),
    ).resolves.toBe(true);
    const claimed = await catalog.claimTranscriptionJob(
      actor,
      "local",
      120,
      true,
    );
    expect(claimed?.job.id).toBe(item.jobId);
    const claimedPayload = TranscriptionJobPayloadSchema.parse(
      claimed!.job.payload,
    );

    const lineageId = randomUUID();
    const [grant, replayedGrant] = await Promise.all([
      catalog.createClaimedTranscriptUpload(
        actor,
        claimed!.job.id,
        claimed!.lease.attempt,
        {
          lineageId,
          version: 1,
          artifactTypes: ["english-normalized", "english-srt"],
        },
      ),
      catalog.createClaimedTranscriptUpload(
        actor,
        claimed!.job.id,
        claimed!.lease.attempt,
        {
          lineageId,
          version: 1,
          artifactTypes: ["english-normalized", "english-srt"],
        },
      ),
    ]);
    expect(replayedGrant.uploadId).toBe(grant.uploadId);
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
      ...(claimedPayload.languageDecision
        ? { languageDecision: claimedPayload.languageDecision }
        : {}),
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

describe("claimed cloud translation source", () => {
  it("persists consent and reloads only the exact versioned upload bytes", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:translation-owner",
    };
    await catalog.registerUser(actor, "Translation owner");
    const project = await catalog.createProject(actor, {
      name: "Translation project",
    });
    const projectVideo = await catalog.addVideo(actor, project.id, {
      youtubeVideoId: "Romanian001",
      canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
      title: "Romanian fixture",
      sourceLanguage: "ro",
    });
    await catalog.confirmProjectVideoLanguageDecision(
      actor,
      project.id,
      projectVideo.id,
      {
        idempotencyKey: "confirm-ro-v1",
        expectedDecisionVersion: 0,
        resolvedLanguage: "ro",
        basis: "user_confirmation",
      },
    );
    const consent = {
      provider: "amazon-translate" as const,
      disclosureVersion: 1 as const,
      transcriptTextTransferAccepted: true as const,
    };
    const created = await catalog.createTranscriptionBatch(actor, {
      projectId: project.id,
      name: "Consented batch",
      options: {
        targetLanguage: "en",
        transcriptionProfile: "default",
        sourcePolicy: "prefer-existing",
        executionLocation: "local",
        priority: "normal",
        translationConsent: consent,
      },
      items: [
        {
          inputIndex: 0,
          input: "https://youtu.be/Romanian001",
          status: "ready",
          processingNeed: "transcription",
          youtubeVideoId: "Romanian001",
          canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
          title: "Romanian fixture",
          sourceLanguage: "ro",
        },
      ],
    });
    expect(created.batch.translationConsent).toEqual(consent);
    const claimed = (await catalog.claimTranscriptionJob(actor, "local", 120))!;
    const claimedPayload = TranscriptionJobPayloadSchema.parse(
      claimed.job.payload,
    );
    expect(claimed.job.payload).toMatchObject({ translationConsent: consent });
    const grant = await catalog.createClaimedTranscriptUpload(
      actor,
      claimed.job.id,
      claimed.lease.attempt,
      {
        lineageId: randomUUID(),
        version: 1,
        artifactTypes: [
          "original-normalized",
          "original-srt",
          "english-normalized",
          "english-srt",
        ],
      },
    );
    const source: NormalizedTranscript = {
      track: {
        id: randomUUID(),
        videoId: "Romanian001",
        language: "ro",
        kind: "original",
        source: "generated",
        provider: "fixture",
        timingPrecision: "cue",
        schemaVersion: 1,
        contentSha256: "a".repeat(64),
        version: 1,
      },
      segments: [
        {
          id: randomUUID(),
          trackId: "placeholder",
          ordinal: 0,
          startMs: 0,
          endMs: 1_000,
          text: "Bună ziua",
        },
      ],
      tokens: [],
    };
    source.segments[0]!.trackId = source.track.id;
    const bytes = new TextEncoder().encode(JSON.stringify(source));
    const target = grant.targets.find(
      (candidate) => candidate.type === "original-normalized",
    )!;
    const stored = await store.put({
      key: target.objectKey,
      bytes,
      contentType: "application/json",
      sha256: digest(bytes),
    });
    const descriptor = {
      type: "original-normalized" as const,
      objectKey: stored.key,
      objectVersionId: stored.versionId,
      byteSize: bytes.byteLength,
      sha256: stored.sha256,
    };

    await expect(
      catalog.loadClaimedTranscriptTranslationSource(actor, claimed.job.id, {
        attempt: claimed.lease.attempt,
        consent,
        uploadId: grant.uploadId,
        sourceArtifact: { ...descriptor, sha256: "b".repeat(64) },
        targetLanguage: "en",
      }),
    ).rejects.toMatchObject({ code: "transcript_integrity_failed" });
    await expect(
      catalog.loadClaimedTranscriptTranslationSource(actor, claimed.job.id, {
        attempt: claimed.lease.attempt,
        consent,
        uploadId: grant.uploadId,
        sourceArtifact: descriptor,
        targetLanguage: "en",
      }),
    ).resolves.toEqual(source);

    const translated: NormalizedTranscript = {
      track: {
        ...source.track,
        id: randomUUID(),
        language: "en",
        kind: "english",
        source: "translated",
        provider: "amazon-translate",
        sourceTrackId: source.track.id,
        contentSha256: "d".repeat(64),
      },
      segments: source.segments.map((segment) => ({
        ...segment,
        id: randomUUID(),
        trackId: "placeholder",
        text: "Hello",
      })),
      tokens: [],
    };
    translated.segments[0]!.trackId = translated.track.id;
    const subtitleBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nHello\n",
    );
    const published = await catalog.publishClaimedTranscriptTranslation(
      actor,
      claimed.job.id,
      {
        attempt: claimed.lease.attempt,
        consent,
        uploadId: grant.uploadId,
        sourceArtifact: descriptor,
        targetLanguage: "en",
        transcript: translated,
        subtitleBytes,
      },
    );
    expect(published.transcript).toEqual(translated);
    await expect(
      catalog.getClaimedTranscriptTranslationPublication(
        actor,
        claimed.job.id,
        {
          attempt: claimed.lease.attempt,
          uploadId: grant.uploadId,
          sourceArtifact: descriptor,
          targetLanguage: "en",
        },
      ),
    ).resolves.toEqual(published);

    const originalSrtBytes = new TextEncoder().encode(
      "1\n00:00:00,000 --> 00:00:01,000\nBună ziua\n",
    );
    const originalSrtTarget = grant.targets.find(
      (candidate) => candidate.type === "original-srt",
    )!;
    const originalSrtStored = await store.put({
      key: originalSrtTarget.objectKey,
      bytes: originalSrtBytes,
      contentType: "application/x-subrip",
      sha256: digest(originalSrtBytes),
    });
    const originalSrtArtifact = {
      type: "original-srt" as const,
      objectKey: originalSrtStored.key,
      objectVersionId: originalSrtStored.versionId,
      byteSize: originalSrtBytes.byteLength,
      sha256: originalSrtStored.sha256,
    };
    const manifestBase: TranscriptManifest = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: project.id,
      catalogVideoId: created.items[0]!.catalogVideoId!,
      videoId: "Romanian001",
      lineageId: grant.lineageId,
      version: 1,
      sourceLanguage: "ro",
      targetLanguage: "en",
      timingPrecision: "cue",
      provider: "fixture",
      normalizationSchemaVersion: 1,
      jobId: claimed.job.id,
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
      ...(claimedPayload.languageDecision
        ? { languageDecision: claimedPayload.languageDecision }
        : {}),
      artifacts: [
        descriptor,
        originalSrtArtifact,
        published.normalizedArtifact,
        published.subtitleArtifact,
      ],
    };
    const putManifest = async (manifest: TranscriptManifest) => {
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
      const manifestTarget = grant.targets.find(
        (candidate) => candidate.type === "manifest",
      )!;
      const storedManifest = await store.put({
        key: manifestTarget.objectKey,
        bytes: manifestBytes,
        contentType: "application/json",
        sha256: digest(manifestBytes),
      });
      return {
        type: "manifest" as const,
        objectKey: storedManifest.key,
        objectVersionId: storedManifest.versionId,
        byteSize: manifestBytes.byteLength,
        sha256: storedManifest.sha256,
      };
    };
    const tamperedManifest = {
      ...manifestBase,
      artifacts: manifestBase.artifacts.map((artifact) =>
        artifact.type === "english-normalized"
          ? { ...artifact, sha256: "f".repeat(64) }
          : artifact,
      ),
    } satisfies TranscriptManifest;
    await expect(
      catalog.finalizeTranscript(
        actor,
        {
          uploadId: grant.uploadId,
          idempotencyKey: `finalize:${manifestBase.id}`,
          manifest: await putManifest({
            ...manifestBase,
            sourceLanguage: "ko",
          }),
        },
        { jobId: claimed.job.id, attempt: claimed.lease.attempt },
      ),
    ).rejects.toThrow("confirmed job decision");
    await expect(
      catalog.finalizeTranscript(
        actor,
        {
          uploadId: grant.uploadId,
          idempotencyKey: `finalize:${manifestBase.id}`,
          manifest: await putManifest(tamperedManifest),
        },
        { jobId: claimed.job.id, attempt: claimed.lease.attempt },
      ),
    ).rejects.toThrow("server-produced result");
    await expect(
      catalog.finalizeTranscript(
        actor,
        {
          uploadId: grant.uploadId,
          idempotencyKey: `finalize:${manifestBase.id}`,
          manifest: await putManifest({
            ...manifestBase,
            provider: "forged-provider",
          }),
        },
        { jobId: claimed.job.id, attempt: claimed.lease.attempt },
      ),
    ).rejects.toThrow("manifest metadata");
    await expect(
      catalog.finalizeTranscript(
        actor,
        {
          uploadId: grant.uploadId,
          idempotencyKey: `finalize:${manifestBase.id}`,
          manifest: await putManifest(manifestBase),
        },
        { jobId: claimed.job.id, attempt: claimed.lease.attempt },
      ),
    ).resolves.toMatchObject({ transcriptVersionId: manifestBase.id });
  });
});

const editingSettings = {
  container: "mp4" as const,
  videoCodec: "h264" as const,
  videoRateControl: { mode: "crf" as const, value: 20 },
  maxWidth: 1_920,
  frameRate: "source" as const,
  audioCodec: "aac" as const,
  audioKilobitsPerSecond: 192,
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};

describe("versioned export preset catalogs", () => {
  it("keeps personal revisions/defaults fixed and replays durable receipts after CAS advances", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const actor: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:preset-owner",
    };
    await catalog.registerUser(actor, "Preset owner");
    const createInput = {
      idempotencyKey: "personal-create-1",
      name: "Editing Personal",
      description: "My standard export",
      settings: editingSettings,
    };
    const created = await catalog.createPersonalExportPreset(
      actor,
      createInput,
    );
    expect(
      await catalog.createPersonalExportPreset(actor, createInput),
    ).toEqual(created);
    const revised = await catalog.revisePersonalExportPreset(actor, {
      idempotencyKey: "personal-revise-1",
      presetId: created.id,
      expectedEntityVersion: 1,
      name: "Editing Personal",
      description: "A newer immutable revision",
      settings: { ...editingSettings, maxWidth: 1_280 },
    });
    expect(revised).toMatchObject({ currentVersion: 2, entityVersion: 2 });
    expect(
      await catalog.createPersonalExportPreset(actor, createInput),
    ).toEqual(created);
    const fixedDefault = await catalog.setPersonalExportPresetDefault(actor, {
      idempotencyKey: "personal-default-1",
      expectedEntityVersion: 0,
      presetId: created.id,
      presetVersion: 1,
    });
    await catalog.revisePersonalExportPreset(actor, {
      idempotencyKey: "personal-revise-2",
      presetId: created.id,
      expectedEntityVersion: 2,
      name: "Editing Personal",
      description: "Third revision",
      settings: { ...editingSettings, maxWidth: 960 },
    });
    expect(
      await catalog.revisePersonalExportPreset(actor, {
        idempotencyKey: "personal-revise-1",
        presetId: created.id,
        expectedEntityVersion: 1,
        name: "Editing Personal",
        description: "A newer immutable revision",
        settings: { ...editingSettings, maxWidth: 1_280 },
      }),
    ).toEqual(revised);
    expect(
      await catalog.setPersonalExportPresetDefault(actor, {
        idempotencyKey: "personal-default-1",
        expectedEntityVersion: 0,
        presetId: created.id,
        presetVersion: 1,
      }),
    ).toEqual(fixedDefault);
    const discovered = await catalog.listPersonalExportPresets(actor);
    expect(discovered.presets[0]).toMatchObject({
      currentVersion: 3,
      current: { settings: { maxWidth: 960 } },
    });
    expect(discovered.default).toMatchObject({
      presetVersion: 1,
      snapshot: { settings: { maxWidth: 1_920 } },
    });
    await expect(
      catalog.createPersonalExportPreset(actor, {
        ...createInput,
        name: "Different command",
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(
      Number(
        (
          await database.query<{ count: string }>(
            "SELECT count(*) FROM sync_events",
          )
        ).rows[0]!.count,
      ),
    ).toBe(0);
  });

  it("keeps a queued export's resolved settings stable after its project default advances", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner = fixtureActor("queued-export-settings-owner");
    await catalog.registerUser(owner, "Queued export settings owner");
    const project = await catalog.createProject(owner, {
      name: "Queued export settings project",
    });
    const [clip] = await createBatchClips(catalog, owner, project.id, 1);
    const preset = await catalog.createProjectExportPreset(owner, project.id, {
      idempotencyKey: "queued-export-preset-v1",
      name: "Queued export default",
      description: "Initial default",
      settings: editingSettings,
    });
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "queued-export-default-v1",
      expectedEntityVersion: 0,
      presetId: preset.id,
      presetVersion: 1,
    });
    const selection = { base: "context_default" as const, overrides: {} };
    const previewV1 = await catalog.previewProjectExportSettings(
      owner,
      project.id,
      { sourceLanguageClass: "confirmed_english", selection },
    );
    const command = {
      idempotencyKey: "queued-export-request-v1",
      sourceLanguageClass: "confirmed_english" as const,
      settingsSelection: selection,
      expectedResolutionFingerprint: previewV1.snapshot.resolutionFingerprint!,
      sourceRights: sourceRightsForVideo(clip!.video.youtubeVideoId),
    };
    const queued = await catalog.createClipExport(
      owner,
      project.id,
      clip!.id,
      command,
    );
    const originalSnapshot = queued.resolvedSettingsSnapshot!;
    expect(queued).toMatchObject({ state: "queued" });
    expect(originalSnapshot).toMatchObject({
      context: "logged",
      base: "context_default",
      contextDefault: {
        presetId: preset.id,
        presetVersion: 1,
        settings: editingSettings,
      },
      resolutionFingerprint: previewV1.snapshot.resolutionFingerprint,
    });

    const revised = await catalog.reviseProjectExportPreset(owner, project.id, {
      idempotencyKey: "queued-export-preset-v2",
      presetId: preset.id,
      expectedEntityVersion: 1,
      name: "Queued export default",
      description: "Revised default",
      settings: { ...editingSettings, maxWidth: 1_280 },
    });
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "queued-export-default-v2",
      expectedEntityVersion: 1,
      presetId: preset.id,
      presetVersion: revised.currentVersion,
    });
    const previewV2 = await catalog.previewProjectExportSettings(
      owner,
      project.id,
      { sourceLanguageClass: "confirmed_english", selection },
    );
    expect(previewV2.snapshot).toMatchObject({
      contextDefault: {
        presetId: preset.id,
        presetVersion: 2,
        settings: { maxWidth: 1_280 },
      },
    });
    expect(previewV2.snapshot.resolutionFingerprint).not.toBe(
      originalSnapshot.resolutionFingerprint,
    );

    const replayed = await catalog.createClipExport(
      owner,
      project.id,
      clip!.id,
      { ...command, requestOrigin: "authoring_build" },
    );
    expect(replayed).toEqual(queued);
    expect(replayed.requestOrigin).toBe("selection_action");
    expect(replayed.resolvedSettingsSnapshot).toEqual(originalSnapshot);
    expect(replayed.resolvedSettingsSnapshot!.resolutionFingerprint).toBe(
      originalSnapshot.resolutionFingerprint,
    );
    await expect(
      catalog.createClipExport(owner, project.id, clip!.id, {
        ...command,
        idempotencyKey: "queued-export-wrong-source",
        sourceRights: sourceRightsForVideo("different-youtube-video"),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const persisted = await database.query<{
      request_snapshot: ExportRequest["resolvedSettingsSnapshot"];
      job_snapshot: ExportRequest["resolvedSettingsSnapshot"];
    }>(
      `SELECT er.resolved_settings_snapshot AS request_snapshot,
              j.payload->'resolvedSettingsSnapshot' AS job_snapshot
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [queued.id],
    );
    expect(persisted.rows[0]!.request_snapshot).toEqual(originalSnapshot);
    expect(persisted.rows[0]!.job_snapshot).toEqual(originalSnapshot);
    expect(persisted.rows[0]!.job_snapshot!.resolutionFingerprint).toBe(
      originalSnapshot.resolutionFingerprint,
    );
  });

  it("authorizes project discovery/writes and never exposes another member's personal presets", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-owner",
    };
    const viewer: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-viewer",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:project-preset-outsider",
    };
    await catalog.registerUser(owner, "Owner");
    await catalog.registerUser(viewer, "Viewer");
    await catalog.registerUser(outsider, "Outsider");
    const project = await catalog.createProject(owner, {
      name: "Preset project",
    });
    await catalog.addMember(owner, project.id, viewer.userId, "viewer");
    await catalog.createPersonalExportPreset(owner, {
      idempotencyKey: "owner-personal",
      name: "Owner private",
      description: "Must not leak",
      settings: editingSettings,
    });
    const projectPreset = await catalog.createProjectExportPreset(
      owner,
      project.id,
      {
        idempotencyKey: "project-create",
        name: "Project Editing",
        description: "Shared",
        settings: editingSettings,
      },
    );
    await catalog.setProjectExportPresetDefault(owner, project.id, {
      idempotencyKey: "project-default",
      expectedEntityVersion: 0,
      presetId: projectPreset.id,
      presetVersion: 1,
    });
    const viewerDiscovery = await catalog.listProjectExportPresets(
      viewer,
      project.id,
    );
    expect(viewerDiscovery.projectPresets).toHaveLength(1);
    expect(viewerDiscovery.personalPresets).toEqual([]);
    expect(viewerDiscovery.projectDefault?.snapshot.name).toBe(
      "Project Editing",
    );
    await expect(
      catalog.createProjectExportPreset(viewer, project.id, {
        idempotencyKey: "viewer-write",
        name: "Forbidden",
        description: "",
        settings: editingSettings,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.listProjectExportPresets(outsider, project.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    const events = await database.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload FROM sync_events
       WHERE project_id = $1 AND event_type LIKE 'export_preset.%'
       ORDER BY sequence`,
      [project.id],
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "export_preset.created",
      "export_preset.default_set",
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("Owner private");
  });
});

describe("registered local export workers", () => {
  it("keeps immutable epochs, bounded owner heartbeats, revocation, and project-authorized availability", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-owner",
    };
    const collaborator: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-collaborator",
    };
    const outsider: AuthenticatedActor = {
      userId: randomUUID(),
      externalSubject: "fixture:registered-worker-outsider",
    };
    for (const [actor, name] of [
      [owner, "Owner"],
      [collaborator, "Collaborator"],
      [outsider, "Outsider"],
    ] as const) {
      await catalog.registerUser(actor, name);
    }
    const project = await catalog.createProject(owner, {
      name: "Worker project",
    });
    await catalog.addMember(owner, project.id, collaborator.userId, "viewer");
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt"],
      muxers: ["mp4", "matroska", "mov"],
      filters: ["scale", "fps"],
    });
    const workerId = randomUUID();
    const registration = { workerId, epoch: 1, ...advertisement };
    const registered = await catalog.registerExportWorker(owner, registration);
    expect(registered).toMatchObject({ id: workerId, epoch: 1 });
    expect(registered).not.toHaveProperty("ownerUserId");
    expect(await catalog.registerExportWorker(owner, registration)).toEqual(
      registered,
    );
    const unsupportedCapability = {
      ...advertisement.capability,
      profileVersion: advertisement.capability.profileVersion + 1,
    };
    await expect(
      catalog.registerExportWorker(owner, {
        ...registration,
        capability: unsupportedCapability,
        advertisementFingerprint: exportWorkerAdvertisementFingerprint({
          capability: unsupportedCapability,
          installedCapabilities: advertisement.installedCapabilities,
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      catalog.registerExportWorker(outsider, registration),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.registerExportWorker(owner, {
        ...registration,
        installedCapabilities: {
          ...advertisement.installedCapabilities,
          availableRendererIds: ["h264_mp4"],
          unavailableRendererIds: ["hevc_mkv", "prores_mov"],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const changedSummary = {
      ...advertisement.installedCapabilities,
      availableRendererIds: ["h264_mp4"],
      unavailableRendererIds: ["hevc_mkv", "prores_mov"],
    } satisfies typeof advertisement.installedCapabilities;
    const changed = {
      ...registration,
      installedCapabilities: changedSummary,
      advertisementFingerprint: exportWorkerAdvertisementFingerprint({
        capability: advertisement.capability,
        installedCapabilities: changedSummary,
      }),
    };
    await expect(
      catalog.registerExportWorker(owner, changed),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      catalog.heartbeatExportWorker(outsider, { workerId, epoch: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    now = new Date("2026-08-20T12:00:30.000Z");
    const heartbeat = await catalog.heartbeatExportWorker(owner, {
      workerId,
      epoch: 1,
    });
    expect(heartbeat.heartbeatAt).toBe(now.toISOString());
    expect(heartbeat.installedCapabilities).toEqual(
      advertisement.installedCapabilities,
    );
    const availabilityRequest = {
      capability: advertisement.capability,
      rendererId: "h264_mp4" as const,
    };
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          capability: {
            ...advertisement.capability,
            profileVersion: advertisement.capability.profileVersion + 1,
          },
        },
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    await catalog.registerExportWorker(outsider, {
      ...registration,
      workerId: randomUUID(),
    });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    await expect(
      catalog.compatibleExportWorkerAvailability(
        outsider,
        project.id,
        availabilityRequest,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          rendererId: "hevc_mkv",
        },
      ),
    ).toEqual({ compatible: true, availableWorkerCount: 1 });
    await catalog.revokeExportWorker(owner, { workerId, epoch: 1 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    await expect(
      catalog.registerExportWorker(owner, registration),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(
      await catalog.registerExportWorker(owner, { ...changed, epoch: 2 }),
    ).toMatchObject({ id: workerId, epoch: 2 });
    await expect(
      catalog.registerExportWorker(outsider, { ...changed, epoch: 3 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        {
          ...availabilityRequest,
          rendererId: "hevc_mkv",
        },
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
    now = new Date("2026-08-20T12:02:00.000Z");
    await expect(
      catalog.heartbeatExportWorker(owner, { workerId, epoch: 2 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      await catalog.compatibleExportWorkerAvailability(
        collaborator,
        project.id,
        availabilityRequest,
      ),
    ).toEqual({ compatible: false, availableWorkerCount: 0 });
  });
});

describe("logged export delivery", () => {
  it("does not reserve or replay legacy queued work without exact source rights", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-20T12:00:00.000Z"),
    );
    const owner = fixtureActor("legacy-delivery-owner");
    await catalog.registerUser(owner, "Legacy delivery owner");
    const { request } = await createLoggedExportFixture(
      catalog,
      owner,
      "legacy-no-rights",
    );
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, worker);
    const reserved = await catalog.claimLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: worker.epoch,
    });
    expect(reserved.delivery?.request.id).toBe(request.id);

    // Simulate the nullable row shape retained for pre-M7-05 history after a
    // reservation was already written. The test database is disposable.
    await database.exec(
      "DROP TRIGGER export_requests_identity_snapshots_immutable ON export_requests",
    );
    await database.query(
      "UPDATE export_requests SET source_rights_snapshot = NULL WHERE id = $1",
      [request.id],
    );
    expect(
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: worker.epoch,
      }),
    ).toEqual({});
  });

  it("atomically reserves once, accepts idempotently, and does not replay accepted work as a new claim", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner = fixtureActor("delivery-owner");
    const collaborator = fixtureActor("delivery-collaborator");
    await catalog.registerUser(owner, "Delivery owner");
    await catalog.registerUser(collaborator, "Delivery collaborator");
    const { projectId, request } = await createLoggedExportFixture(
      catalog,
      owner,
      "single",
    );
    await catalog.addMember(
      owner,
      projectId,
      collaborator.userId,
      "researcher",
    );
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const ownerWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    const collaboratorWorker = {
      workerId: randomUUID(),
      epoch: 1,
      ...advertisement,
    };
    await catalog.registerExportWorker(owner, ownerWorker);
    await catalog.registerExportWorker(collaborator, collaboratorWorker);
    await expect(
      catalog.claimLoggedExportDelivery(collaborator, {
        workerId: ownerWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.claimLoggedExportDelivery(owner, {
        workerId: ownerWorker.workerId,
        workerEpoch: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const revokedWorker = {
      workerId: randomUUID(),
      epoch: 1,
      ...advertisement,
    };
    await catalog.registerExportWorker(owner, revokedWorker);
    await catalog.revokeExportWorker(owner, {
      workerId: revokedWorker.workerId,
      epoch: 1,
    });
    await expect(
      catalog.claimLoggedExportDelivery(owner, {
        workerId: revokedWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const claims = await Promise.all([
      catalog.claimLoggedExportDelivery(owner, {
        workerId: ownerWorker.workerId,
        workerEpoch: 1,
      }),
      catalog.claimLoggedExportDelivery(collaborator, {
        workerId: collaboratorWorker.workerId,
        workerEpoch: 1,
      }),
    ]);
    const winning = claims.find((claim) => claim.delivery)?.delivery!;
    expect(claims.filter((claim) => claim.delivery)).toHaveLength(1);
    expect(winning.request).toEqual(request);
    expect(winning).not.toHaveProperty("ownerUserId");
    expect(JSON.stringify(winning)).not.toMatch(
      /\/private\/|presigned|credential/i,
    );
    const winningActor =
      winning.workerId === ownerWorker.workerId ? owner : collaborator;
    const otherActor = winningActor === owner ? collaborator : owner;
    await expect(
      catalog.acceptLoggedExportDelivery(otherActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch + 1,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const accepted = await catalog.acceptLoggedExportDelivery(winningActor, {
      workerId: winning.workerId,
      workerEpoch: winning.workerEpoch,
      deliveryId: winning.deliveryId,
      generation: winning.generation,
      reservationToken: winning.reservationToken,
    });
    expect(accepted.status).toBe("accepted");
    expect(
      await catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).toEqual(accepted);
    now = new Date("2026-08-20T12:00:10.000Z");
    expect(
      await catalog.claimLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
      }),
    ).toEqual({});
    expect(
      Number(
        (
          await database.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM logged_export_deliveries",
          )
        ).rows[0]!.count,
      ),
    ).toBe(1);
    await catalog.revokeExportWorker(winningActor, {
      workerId: winning.workerId,
      epoch: winning.workerEpoch,
    });
    await expect(
      catalog.acceptLoggedExportDelivery(winningActor, {
        workerId: winning.workerId,
        workerEpoch: winning.workerEpoch,
        deliveryId: winning.deliveryId,
        generation: winning.generation,
        reservationToken: winning.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("uses one stable delivery ID with a new generation/token after expiry and rejects stale acceptance", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    let now = new Date("2026-08-20T12:00:00.000Z");
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => now,
    );
    const owner = fixtureActor("redelivery-owner");
    const other = fixtureActor("redelivery-other");
    await catalog.registerUser(owner, "Redelivery owner");
    await catalog.registerUser(other, "Redelivery other");
    const { projectId } = await createLoggedExportFixture(
      catalog,
      owner,
      "redelivery",
    );
    await catalog.addMember(owner, projectId, other.userId, "researcher");
    const advertisement = currentExportWorkerAdvertisement({
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const firstWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    const secondWorker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, firstWorker);
    await catalog.registerExportWorker(other, secondWorker);
    const first = (
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: firstWorker.workerId,
        workerEpoch: 1,
      })
    ).delivery!;
    now = new Date("2026-08-20T12:00:31.000Z");
    const second = (
      await catalog.claimLoggedExportDelivery(other, {
        workerId: secondWorker.workerId,
        workerEpoch: 1,
      })
    ).delivery!;
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.reservationToken).not.toBe(first.reservationToken);
    await expect(
      catalog.acceptLoggedExportDelivery(owner, {
        workerId: first.workerId,
        workerEpoch: first.workerEpoch,
        deliveryId: first.deliveryId,
        generation: first.generation,
        reservationToken: first.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, other.userId],
    );
    await expect(
      catalog.acceptLoggedExportDelivery(other, {
        workerId: second.workerId,
        workerEpoch: second.workerEpoch,
        deliveryId: second.deliveryId,
        generation: second.generation,
        reservationToken: second.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      await catalog.claimLoggedExportDelivery(other, {
        workerId: second.workerId,
        workerEpoch: second.workerEpoch,
      }),
    ).toEqual({});
    await catalog.addMember(owner, projectId, other.userId, "researcher");
    expect(
      (
        await catalog.acceptLoggedExportDelivery(other, {
          workerId: second.workerId,
          workerEpoch: second.workerEpoch,
          deliveryId: second.deliveryId,
          generation: second.generation,
          reservationToken: second.reservationToken,
        })
      ).status,
    ).toBe("accepted");
    now = new Date("2026-08-20T12:01:01.000Z");
    await expect(
      catalog.claimLoggedExportDelivery(other, {
        workerId: secondWorker.workerId,
        workerEpoch: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("finds a compatible request after more than one hundred older incompatible requests", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const owner = fixtureActor("fair-claim-owner");
    await catalog.registerUser(owner, "Fair claim owner");
    const fixture = await createLoggedExportFixture(
      catalog,
      owner,
      "incompatible-0",
      "hevc",
    );
    for (let index = 1; index <= 100; index += 1) {
      await createLoggedExportFromClip(
        catalog,
        owner,
        fixture.projectId,
        fixture.clipId,
        `incompatible-${index}`,
        "hevc",
      );
    }
    const advertisement = currentExportWorkerAdvertisement({
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, worker);
    expect(
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: 1,
      }),
    ).toEqual({});
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_deliveries",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs
           WHERE kind = 'export' AND state = 'queued'`,
        )
      ).rows[0]!.count,
    ).toBe("101");
    const compatible = await createLoggedExportFromClip(
      catalog,
      owner,
      fixture.projectId,
      fixture.clipId,
      "compatible-last",
      "h264",
    );
    const claim = await catalog.claimLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: 1,
    });
    expect(claim.delivery?.request.id).toBe(compatible.id);
  });

  it("atomically reconciles one immutable success and replays it without another event or clip version", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const command = reconcileSuccessCommand(fixture);
    const first = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      command,
    );
    expect(first.result).toEqual(fixture.result);
    expect(first.resultFingerprint).toBe(sha256Fingerprint(fixture.result));
    const forbiddenCloudResultFields =
      /reservation_?token|owner_?user_?id|authorization|\/private\/|ffmpeg_?args|source_?identity/i;
    expect(JSON.stringify(first)).not.toMatch(forbiddenCloudResultFields);
    const persistedResultAndEvent = await fixture.database.query<
      Record<string, unknown>
    >(
      `SELECT result.*, event.payload AS event_payload
       FROM logged_export_success_results result
       JOIN sync_events event
         ON event.entity_id = $1
        AND event.event_type = 'clip_candidate.export_completed'
       WHERE result.export_request_id = $2`,
      [fixture.accepted.request.clipId, fixture.accepted.request.id],
    );
    expect(JSON.stringify(persistedResultAndEvent.rows[0])).not.toMatch(
      forbiddenCloudResultFields,
    );
    const afterFirst = await fixture.database.query<{
      state: string;
      export_status: string;
      version: number;
    }>(
      `SELECT j.state, c.export_status, c.version
       FROM jobs j
       JOIN export_requests er ON er.job_id = j.id
       JOIN clip_candidates c ON c.id = er.clip_id
       WHERE er.id = $1`,
      [fixture.accepted.request.id],
    );
    expect(afterFirst.rows[0]).toMatchObject({
      state: "complete",
      export_status: "complete",
    });
    const completedVersion = Number(afterFirst.rows[0]!.version);
    expect(
      await fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        command,
      ),
    ).toEqual(first);
    const divergentResult: LoggedExportSuccessResult = {
      ...fixture.result,
      artifacts: fixture.result.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, contentSha256: "9".repeat(64) } : artifact,
      ),
    };
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        result: divergentResult,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'
             AND entity_id = $1`,
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [fixture.accepted.request.clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(completedVersion);
    expect(
      await fixture.catalog.getLoggedExportRequest(
        fixture.owner,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).toMatchObject({
      state: "complete",
      resolvedExportBounds: fixture.result.resolvedExportBounds,
      finalArtifacts: fixture.result.artifacts,
    });
    await expect(
      fixture.database.query(
        `UPDATE logged_export_success_results
         SET result_fingerprint = $1 WHERE id = $2`,
        ["0".repeat(64), first.id],
      ),
    ).rejects.toThrow(/immutable/u);
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        reconcileFailureCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const failureResult = loggedExportFailureFixture(fixture.accepted.request);
    await expect(
      fixture.database.query(
        `INSERT INTO logged_export_failure_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
        [
          randomUUID(),
          fixture.accepted.request.id,
          fixture.accepted.deliveryId,
          fixture.accepted.generation,
          fixture.accepted.workerId,
          fixture.accepted.workerEpoch,
          JSON.stringify(failureResult),
          sha256Fingerprint(failureResult),
          "2026-08-20T12:00:20.000Z",
        ],
      ),
    ).rejects.toThrow(/mutually exclusive/u);
  });

  it("derives bounded authorized artifact history from immutable M5 success IDs", async () => {
    const clock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const first = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    clock.now = new Date("2026-08-20T12:00:01.000Z");
    const secondRequest = await createLoggedExportFromClip(
      fixture.catalog,
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.clipId!,
      "selection-action-reexport",
      "h264",
      "confirmed_english",
      "selection_action",
    );
    const reserved = (
      await fixture.catalog.claimLoggedExportDelivery(fixture.owner, {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
      })
    ).delivery!;
    const accepted = await fixture.catalog.acceptLoggedExportDelivery(
      fixture.owner,
      {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
        deliveryId: reserved.deliveryId,
        generation: reserved.generation,
        reservationToken: reserved.reservationToken,
      },
    );
    const second = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      {
        workerId: accepted.workerId,
        workerEpoch: accepted.workerEpoch,
        deliveryId: accepted.deliveryId,
        generation: accepted.generation,
        reservationToken: accepted.reservationToken,
        result: loggedExportSuccessFixture(
          secondRequest,
          clock.now.toISOString(),
        ),
      },
    );

    const firstPage = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      secondRequest.projectId!,
      secondRequest.clipId!,
      { limit: 1 },
    );
    expect(firstPage).toMatchObject({
      nextCursor: second.id,
      versions: [
        {
          artifactVersionId: second.id,
          requestId: secondRequest.id,
          requestOrigin: "selection_action",
          manifest: { schemaVersion: "unknown" },
        },
      ],
    });
    const secondPage = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      secondRequest.projectId!,
      secondRequest.clipId!,
      { limit: 1, cursor: firstPage.nextCursor },
    );
    expect(secondPage).toMatchObject({
      versions: [
        {
          artifactVersionId: first.id,
          requestId: fixture.accepted.request.id,
          requestOrigin: "selection_action",
        },
      ],
    });
    expect(secondPage.nextCursor).toBeUndefined();
    const exactVersion = await fixture.catalog.getArtifactVersion(
      fixture.owner,
      secondRequest.projectId!,
      secondRequest.clipId!,
      second.id,
    );
    expect(exactVersion).toMatchObject({
      artifactVersionId: second.id,
      preset: secondRequest.preset,
      resolvedExportBounds: second.result.resolvedExportBounds,
      renderedMediaProvenance: second.result.renderedMediaProvenance,
      thumbnailProvenance: second.result.thumbnailProvenance,
    });
    const requirements = compatibilityRequirementsForVersion(exactVersion);
    await expect(
      fixture.catalog.resolveArtifactVersionCompatibility(
        fixture.owner,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
        requirements,
      ),
    ).resolves.toMatchObject({
      state: "candidate",
      version: { artifactVersionId: second.id },
    });
    await expect(
      fixture.catalog.resolveArtifactVersionCompatibility(
        fixture.owner,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
        {
          ...requirements,
          resolvedBounds: {
            ...requirements.resolvedBounds,
            endMs: requirements.resolvedBounds.endMs + 1,
          },
        },
      ),
    ).resolves.toEqual({
      state: "incompatible",
      artifactVersionId: second.id,
    });
    expect(
      JSON.stringify([...firstPage.versions, ...secondPage.versions]),
    ).not.toMatch(/localPath|filename|reservationToken|notes|tags/u);

    const outsider = fixtureActor("artifact-history-outsider");
    await fixture.catalog.registerUser(outsider, "History outsider");
    await expect(
      fixture.catalog.listArtifactVersionHistory(
        outsider,
        secondRequest.projectId!,
        secondRequest.clipId!,
        { limit: 25 },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fixture.catalog.getArtifactVersion(
        outsider,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      fixture.catalog.resolveArtifactVersionCompatibility(
        outsider,
        secondRequest.projectId!,
        secondRequest.clipId!,
        second.id,
        requirements,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("creates one explicit re-export request without changing the source version", async () => {
    const clock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const completed = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    const projectId = fixture.accepted.request.projectId!;
    const clipId = fixture.accepted.request.clipId!;
    const settingsSelection = {
      base: "application_default" as const,
      overrides: {},
    };
    const preview = await fixture.catalog.previewProjectExportSettings(
      fixture.owner,
      projectId,
      {
        sourceLanguageClass: "confirmed_english",
        selection: settingsSelection,
      },
    );
    const command = {
      idempotencyKey: "explicit-reexport-v1",
      requestOrigin: "clip_library" as const,
      sourceLanguageClass: "confirmed_english" as const,
      settingsSelection,
      expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
      sourceRights: sourceRightsForVideo(
        (
          await fixture.catalog.getClipCandidate(
            fixture.owner,
            projectId,
            clipId,
          )
        ).video.youtubeVideoId,
      ),
    };
    clock.now = new Date("2026-08-20T12:00:01.000Z");
    const [reexported, concurrentReplay] = await Promise.all([
      fixture.catalog.reexportArtifactVersion(
        fixture.owner,
        projectId,
        clipId,
        completed.id,
        command,
      ),
      fixture.catalog.reexportArtifactVersion(
        fixture.owner,
        projectId,
        clipId,
        completed.id,
        command,
      ),
    ]);
    expect(concurrentReplay).toEqual(reexported);
    expect(reexported).toMatchObject({
      clipId,
      requestOrigin: "clip_library",
      state: "queued",
    });
    expect(reexported.id).not.toBe(fixture.accepted.request.id);
    await expect(
      fixture.catalog.reexportArtifactVersion(
        fixture.owner,
        projectId,
        clipId,
        completed.id,
        command,
      ),
    ).resolves.toEqual(reexported);
    await expect(
      fixture.catalog.reexportArtifactVersion(
        fixture.owner,
        projectId,
        clipId,
        completed.id,
        { ...command, requestOrigin: "authoring_build" },
      ),
    ).resolves.toEqual(reexported);
    expect(
      await fixture.catalog.listArtifactVersionHistory(
        fixture.owner,
        projectId,
        clipId,
        { limit: 25 },
      ),
    ).toMatchObject({
      versions: [{ artifactVersionId: completed.id }],
    });
    const stored = await fixture.database.query<{
      count: string;
      reexport_of: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM logged_export_success_results) AS count,
         payload->>'reexportOfArtifactVersionId' AS reexport_of
       FROM jobs WHERE id = $1`,
      [reexported.jobId],
    );
    expect(stored.rows[0]).toEqual({
      count: "1",
      reexport_of: completed.id,
    });
    const reserved = (
      await fixture.catalog.claimLoggedExportDelivery(fixture.owner, {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
      })
    ).delivery!;
    const accepted = await fixture.catalog.acceptLoggedExportDelivery(
      fixture.owner,
      {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
        deliveryId: reserved.deliveryId,
        generation: reserved.generation,
        reservationToken: reserved.reservationToken,
      },
    );
    const secondVersion = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      {
        workerId: accepted.workerId,
        workerEpoch: accepted.workerEpoch,
        deliveryId: accepted.deliveryId,
        generation: accepted.generation,
        reservationToken: accepted.reservationToken,
        result: loggedExportSuccessFixture(reexported, clock.now.toISOString()),
      },
    );
    expect(
      await fixture.catalog.listArtifactVersionHistory(
        fixture.owner,
        projectId,
        clipId,
        { limit: 25 },
      ),
    ).toMatchObject({
      versions: [
        {
          artifactVersionId: secondVersion.id,
          requestId: reexported.id,
          requestOrigin: "clip_library",
        },
        { artifactVersionId: completed.id },
      ],
    });
    await expect(
      fixture.catalog.reexportArtifactVersion(
        fixture.owner,
        projectId,
        clipId,
        completed.id,
        {
          ...command,
          sourceLanguageClass: "foreign",
          subtitleTracks: {
            original: { trackId: randomUUID(), trackVersion: 1 },
            english: { trackId: randomUUID(), trackVersion: 1 },
          },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const outsider = fixtureActor("reexport-outsider");
    await fixture.catalog.registerUser(outsider, "Re-export outsider");
    await expect(
      fixture.catalog.reexportArtifactVersion(
        outsider,
        projectId,
        clipId,
        completed.id,
        { ...command, idempotencyKey: "outsider" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lists an authorized bounded Clip Library with stable cursors and separate history", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const projectId = fixture.accepted.request.projectId!;
    const clipId = fixture.accepted.request.clipId!;
    const clip = await fixture.catalog.getClipCandidate(
      fixture.owner,
      projectId,
      clipId,
    );
    await fixture.catalog.updateClipCandidate(
      fixture.owner,
      projectId,
      clipId,
      {
        expectedVersion: clip.version,
        notes: "Needle quotation for the library at Cafe\u0301",
        tags: ["Featured Quote"],
      },
    );
    const searched = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 25, query: "needle quotation", completed: "no" },
    );
    expect(searched.entries).toHaveLength(1);
    expect(searched.entries[0]).toMatchObject({
      clip: { id: clipId, tags: ["Featured Quote"] },
      currentLeaves: [
        {
          requestId: fixture.accepted.request.id,
          requestOrigin: "selection_action",
        },
      ],
      completedVersionCount: 0,
      recentArtifactVersions: [],
    });
    expect(
      (
        await fixture.catalog.listClipLibrary(fixture.owner, projectId, {
          limit: 25,
          query: "Café",
          completed: "any",
        })
      ).entries.map((entry) => entry.clip.id),
    ).toEqual([clipId]);
    expect(
      (
        await fixture.catalog.listClipLibrary(fixture.owner, projectId, {
          limit: 25,
          tag: "featured quote",
          completed: "any",
        })
      ).entries.map((entry) => entry.clip.id),
    ).toEqual([clipId]);

    const success = await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    const completed = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 25, completed: "yes" },
    );
    expect(completed.entries[0]).toMatchObject({
      completedVersionCount: 1,
      recentArtifactVersions: [
        {
          artifactVersionId: success.id,
          requestId: fixture.accepted.request.id,
        },
      ],
    });
    expect(JSON.stringify(completed)).not.toMatch(
      /localPath|filename|absolutePath|reservationToken/u,
    );
    const beforeConcurrentUpdate = completed.entries[0]!.clip;
    const [coherentRead, afterConcurrentUpdate] = await Promise.all([
      fixture.catalog.listClipLibrary(fixture.owner, projectId, {
        limit: 25,
        completed: "yes",
      }),
      fixture.catalog.updateClipCandidate(fixture.owner, projectId, clipId, {
        expectedVersion: beforeConcurrentUpdate.version,
        notes: "Concurrent updated note",
        tags: ["Concurrent Tag"],
      }),
    ]);
    const coherentClip = coherentRead.entries[0]!.clip;
    if (coherentClip.version === beforeConcurrentUpdate.version) {
      expect(coherentClip).toMatchObject({
        notes: beforeConcurrentUpdate.notes,
        tags: beforeConcurrentUpdate.tags,
      });
      expect(coherentRead.syncCursor).toBe(completed.syncCursor);
    } else {
      expect(coherentClip).toMatchObject({
        version: afterConcurrentUpdate.version,
        notes: afterConcurrentUpdate.notes,
        tags: afterConcurrentUpdate.tags,
      });
      expect(BigInt(coherentRead.syncCursor)).toBeGreaterThan(
        BigInt(completed.syncCursor),
      );
    }

    await createBatchClips(fixture.catalog, fixture.owner, projectId, 2);
    const firstPage = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 2, completed: "any" },
    );
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await fixture.catalog.listClipLibrary(
      fixture.owner,
      projectId,
      { limit: 2, cursor: firstPage.nextCursor, completed: "any" },
    );
    expect(secondPage.entries).toHaveLength(1);
    expect(
      secondPage.entries.some((entry) =>
        firstPage.entries.some(
          (firstEntry) => firstEntry.clip.id === entry.clip.id,
        ),
      ),
    ).toBe(false);
    await expect(
      fixture.catalog.listClipLibrary(fixture.owner, projectId, {
        limit: 2,
        cursor: firstPage.nextCursor,
        query: "different-filter",
        completed: "any",
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    const outsider = fixtureActor("clip-library-outsider");
    await fixture.catalog.registerUser(outsider, "Clip Library outsider");
    await expect(
      fixture.catalog.listClipLibrary(outsider, projectId, {
        limit: 25,
        completed: "any",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("reads a parseable legacy success with unknown origin and manifest schema", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportSuccess(
      fixture.owner,
      reconcileSuccessCommand(fixture),
    );
    const legacyJobId = randomUUID();
    const legacyRequestId = randomUUID();
    const legacyDeliveryId = randomUUID();
    const legacySuccessId = randomUUID();
    const completedAt = "2026-08-20T12:00:01.000Z";
    await fixture.database.query(
      `INSERT INTO jobs
         (id, project_id, kind, state, idempotency_key, attempt, payload,
          created_at, updated_at)
       SELECT $1, project_id, kind, 'complete', $2, attempt, payload, $3, $3
       FROM jobs WHERE id = $4`,
      [
        legacyJobId,
        `legacy-history:${legacyRequestId}`,
        completedAt,
        fixture.accepted.request.jobId,
      ],
    );
    await fixture.database.query(
      `INSERT INTO export_requests
         (id, job_id, clip_id, project_id, mode, video_snapshot,
          selection_snapshot, source_language_class, subtitle_tracks_snapshot,
          preset_snapshot, resolved_settings_snapshot, requested_by,
          retry_of_request_id, retry_ordinal, retry_idempotency_key,
          batch_item_id, request_origin, created_at, updated_at)
       SELECT $1, $2, clip_id, project_id, mode, video_snapshot,
              selection_snapshot, source_language_class,
              subtitle_tracks_snapshot, preset_snapshot,
              resolved_settings_snapshot, requested_by,
              NULL, 0, NULL, NULL, NULL, $3, $3
       FROM export_requests WHERE id = $4`,
      [legacyRequestId, legacyJobId, completedAt, fixture.accepted.request.id],
    );
    await fixture.database.query(
      `INSERT INTO logged_export_deliveries
         (id, export_request_id, generation, reservation_token, worker_id,
          worker_epoch, reserved_at, reservation_expires_at, accepted_at,
          created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $6, $6, $6)`,
      [
        legacyDeliveryId,
        legacyRequestId,
        randomUUID(),
        fixture.worker.workerId,
        fixture.worker.epoch,
        completedAt,
        "2026-08-20T12:00:31.000Z",
      ],
    );
    const legacyRequest: ExportRequest = {
      ...fixture.accepted.request,
      id: legacyRequestId,
      jobId: legacyJobId,
      requestOrigin: undefined,
      createdAt: completedAt,
      updatedAt: completedAt,
    };
    const legacyResult = loggedExportSuccessFixture(legacyRequest, completedAt);
    await fixture.database.query(
      `INSERT INTO logged_export_success_results
         (id, export_request_id, delivery_id, delivery_generation, worker_id,
          worker_epoch, result_schema_version, result_json,
          result_fingerprint, reconciled_at)
       VALUES ($1, $2, $3, 1, $4, $5, 1, $6, $7, $8)`,
      [
        legacySuccessId,
        legacyRequestId,
        legacyDeliveryId,
        fixture.worker.workerId,
        fixture.worker.epoch,
        JSON.stringify(legacyResult),
        sha256Fingerprint(legacyResult),
        completedAt,
      ],
    );

    const history = await fixture.catalog.listArtifactVersionHistory(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.clipId!,
      { limit: 25 },
    );
    expect(history.versions[0]).toMatchObject({
      artifactVersionId: legacySuccessId,
      requestId: legacyRequestId,
      requestOrigin: null,
      manifest: { schemaVersion: "unknown" },
    });
    expect(JSON.stringify(history.versions[0])).not.toMatch(
      /localPath|filename|reservationToken|workerId|workerEpoch/u,
    );
  });

  it("atomically reconciles one sanitized immutable failure and replays it without another event or version", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const unsafeResult: LoggedExportFailureResult = {
      ...loggedExportFailureFixture(fixture.accepted.request),
      error: {
        code: "Renderer Failed!",
        message: `failed /private/source.mp4 C:\\Users\\name\\source.mov \\\\server\\share\\source.mov file:///private/source.mov token=${fixture.accepted.reservationToken} Bearer private.jwt-token https://private.invalid/source`,
      },
    };
    const command = {
      ...reconcileFailureCommand(fixture),
      result: unsafeResult,
    };
    const first = await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      command,
    );
    expect(first.result.error).toEqual({
      code: "renderer_failed",
      message:
        "failed <path> <path> <path> <path> token=<redacted> Bearer <redacted> <url>",
    });
    expect(first.resultFingerprint).toBe(sha256Fingerprint(first.result));
    const forbidden =
      /reservation_?token|owner_?user_?id|authorization|\/private\/|private\.invalid|source_?identity|C:\\Users|\\\\server|file:\/\/|private\.jwt/i;
    expect(JSON.stringify(first)).not.toMatch(forbidden);
    const persisted = await fixture.database.query<Record<string, unknown>>(
      `SELECT result.*, event.payload AS event_payload
       FROM logged_export_failure_results result
       JOIN sync_events event
         ON event.entity_id = $1
        AND event.event_type = 'clip_candidate.export_failed'
       WHERE result.export_request_id = $2`,
      [fixture.accepted.request.clipId, fixture.accepted.request.id],
    );
    expect(JSON.stringify(persisted.rows[0])).not.toMatch(forbidden);
    const afterFirst = await fixture.database.query<{
      state: string;
      export_status: string;
      version: number;
    }>(
      `SELECT j.state, c.export_status, c.version
       FROM jobs j
       JOIN export_requests er ON er.job_id = j.id
       JOIN clip_candidates c ON c.id = er.clip_id
       WHERE er.id = $1`,
      [fixture.accepted.request.id],
    );
    expect(afterFirst.rows[0]).toMatchObject({
      state: "failed",
      export_status: "failed",
    });
    const failedVersion = Number(afterFirst.rows[0]!.version);
    expect(
      await fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        command,
      ),
    ).toEqual(first);
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
        ...command,
        result: {
          ...unsafeResult,
          error: { code: "different_failure", message: "Different failure." },
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_failure_results",
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_failed'
             AND entity_id = $1`,
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [fixture.accepted.request.clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(failedVersion);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.database.query(
        `INSERT INTO logged_export_success_results
           (id, export_request_id, delivery_id, delivery_generation,
            worker_id, worker_epoch, result_schema_version, result_json,
            result_fingerprint, reconciled_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
        [
          randomUUID(),
          fixture.accepted.request.id,
          fixture.accepted.deliveryId,
          fixture.accepted.generation,
          fixture.accepted.workerId,
          fixture.accepted.workerEpoch,
          JSON.stringify(fixture.result),
          sha256Fingerprint(fixture.result),
          "2026-08-20T12:00:20.000Z",
        ],
      ),
    ).rejects.toThrow(/mutually exclusive/u);
    await expect(
      fixture.database.query(
        `UPDATE logged_export_failure_results
         SET result_fingerprint = $1 WHERE id = $2`,
        ["0".repeat(64), first.id],
      ),
    ).rejects.toThrow(/immutable/u);
  });

  it("permits the original owner to close pinned failures after expiry, revocation, or a newer registration epoch", async () => {
    const expiredClock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const expired = await createAcceptedLoggedExportResultFixture(expiredClock);
    expiredClock.now = new Date("2026-08-20T12:01:01.000Z");
    expect(
      (
        await expired.catalog.reconcileLoggedExportFailure(
          expired.owner,
          reconcileFailureCommand(expired),
        )
      ).result.requestId,
    ).toBe(expired.accepted.request.id);

    const revoked = await createAcceptedLoggedExportResultFixture();
    await revoked.catalog.revokeExportWorker(revoked.owner, {
      workerId: revoked.worker.workerId,
      epoch: revoked.worker.epoch,
    });
    const revokedCommand = reconcileFailureCommand(revoked);
    const revokedResult = await revoked.catalog.reconcileLoggedExportFailure(
      revoked.owner,
      revokedCommand,
    );
    expect(
      await revoked.catalog.reconcileLoggedExportFailure(
        revoked.owner,
        revokedCommand,
      ),
    ).toEqual(revokedResult);

    const advanced = await createAcceptedLoggedExportResultFixture();
    await advanced.catalog.registerExportWorker(advanced.owner, {
      ...advanced.worker,
      epoch: advanced.worker.epoch + 1,
    });
    expect(
      (
        await advanced.catalog.reconcileLoggedExportFailure(
          advanced.owner,
          reconcileFailureCommand(advanced),
        )
      ).workerEpoch,
    ).toBe(advanced.accepted.workerEpoch);
  });

  it("rejects forged pinned failure credentials and membership loss without mutation", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const command = reconcileFailureCommand(fixture);
    for (const mutation of [
      { workerEpoch: command.workerEpoch + 1 },
      { generation: command.generation + 1 },
      { reservationToken: randomUUID() },
      { workerId: randomUUID() },
    ]) {
      await expect(
        fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
          ...command,
          ...mutation,
        }),
      ).rejects.toMatchObject({ statusCode: expect.any(Number) });
    }
    for (const resultMutation of [
      { requestId: randomUUID() },
      { jobId: randomUUID() },
      { projectId: randomUUID() },
      { clipId: randomUUID() },
    ]) {
      await expect(
        fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
          ...command,
          result: { ...command.result, ...resultMutation },
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    const other = fixtureActor("failure-other");
    await fixture.catalog.registerUser(other, "Failure other");
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'researcher', $3)`,
      [
        fixture.accepted.request.projectId,
        other.userId,
        new Date().toISOString(),
      ],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(other, command),
    ).rejects.toMatchObject({ statusCode: 403 });
    await fixture.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [fixture.accepted.request.projectId, fixture.owner.userId],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_failure_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
  });

  it("rejects shaped but request-inconsistent result provenance without any partial authoritative mutation", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const differentRequestId = randomUUID();
    const differentPackageIdentity = `clip-${differentRequestId}`;
    const mutations: LoggedExportSuccessResult[] = [
      {
        ...fixture.result,
        requestId: differentRequestId,
        artifacts: fixture.result.artifacts.map((artifact) => ({
          ...artifact,
          packageIdentity: differentPackageIdentity,
        })),
      },
      {
        ...fixture.result,
        renderedMediaProvenance: {
          ...fixture.result.renderedMediaProvenance,
          settingsSha256: "f".repeat(64),
        },
      },
      {
        ...fixture.result,
        renderedMediaProvenance: {
          ...fixture.result.renderedMediaProvenance,
          observedProperties: {
            ...fixture.result.renderedMediaProvenance.observedProperties!,
            video: {
              ...fixture.result.renderedMediaProvenance.observedProperties!
                .video,
              codec: "hevc",
            },
          },
        },
      },
      {
        ...fixture.result,
        resolvedExportBounds: {
          ...fixture.result.resolvedExportBounds,
          startMs: fixture.result.resolvedExportBounds.startMs + 1,
        },
      },
      {
        ...fixture.result,
        englishSubtitleProvenance: {
          ...fixture.result.englishSubtitleProvenance!,
          trackId: randomUUID(),
        },
      },
    ];
    for (const result of mutations) {
      await expect(
        fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
          ...reconcileSuccessCommand(fixture),
          result,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ export_status: string }>(
          "SELECT export_status FROM clip_candidates WHERE id = $1",
          [fixture.accepted.request.clipId],
        )
      ).rows[0]!.export_status,
    ).toBe("queued");
  });

  it("binds bilingual sidecar identities, versions, and English language to the immutable snapshots", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture(
      undefined,
      "foreign",
    );
    const command = reconcileSuccessCommand(fixture);
    const englishIndex = fixture.result.subtitleSidecars!.findIndex(
      (sidecar) => sidecar.role === "english",
    );
    const inconsistentResults: LoggedExportSuccessResult[] = [
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex
              ? { ...sidecar, trackId: randomUUID() }
              : sidecar,
        ),
      },
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex
              ? { ...sidecar, trackVersion: sidecar.trackVersion + 1 }
              : sidecar,
        ),
      },
      {
        ...fixture.result,
        subtitleSidecars: fixture.result.subtitleSidecars!.map(
          (sidecar, index) =>
            index === englishIndex ? { ...sidecar, language: "fr" } : sidecar,
        ),
      },
    ];
    for (const result of inconsistentResults) {
      await expect(
        fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
          ...command,
          result,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.database.query<{ state: string; export_status: string }>(
          `SELECT j.state, c.export_status
           FROM jobs j
           JOIN export_requests er ON er.job_id = j.id
           JOIN clip_candidates c ON c.id = er.clip_id
           WHERE er.id = $1`,
          [fixture.accepted.request.id],
        )
      ).rows[0],
    ).toMatchObject({ state: "queued", export_status: "queued" });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE event_type = 'clip_candidate.export_completed'`,
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(
      (
        await fixture.catalog.reconcileLoggedExportSuccess(
          fixture.owner,
          command,
        )
      ).result,
    ).toEqual(fixture.result);
  });

  it("requires the current owner epoch, live registration, and project membership at reconciliation", async () => {
    const clock = { now: new Date("2026-08-20T12:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const command = reconcileSuccessCommand(fixture);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        workerEpoch: command.workerEpoch + 1,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const differentWorker = {
      ...fixture.worker,
      workerId: randomUUID(),
    };
    await fixture.catalog.registerExportWorker(fixture.owner, differentWorker);
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, {
        ...command,
        workerId: differentWorker.workerId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const nonOwner = fixtureActor("result-non-owner");
    await fixture.catalog.registerUser(nonOwner, "Result non-owner");
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'researcher', $3)`,
      [
        fixture.accepted.request.projectId,
        nonOwner.userId,
        clock.now.toISOString(),
      ],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(nonOwner, command),
    ).rejects.toMatchObject({ statusCode: 403 });
    await fixture.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [fixture.accepted.request.projectId, fixture.owner.userId],
    );
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    await fixture.database.query(
      `INSERT INTO project_members (project_id, user_id, role, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [
        fixture.accepted.request.projectId,
        fixture.owner.userId,
        clock.now.toISOString(),
      ],
    );
    clock.now = new Date("2026-08-20T12:01:01.000Z");
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(fixture.owner, command),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
    await fixture.catalog.registerExportWorker(fixture.owner, fixture.worker);
    expect(
      (
        await fixture.catalog.reconcileLoggedExportSuccess(
          fixture.owner,
          command,
        )
      ).result.requestId,
    ).toBe(fixture.accepted.request.id);
  });

  it("rejects a revoked pinned worker without changing the accepted export", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.revokeExportWorker(fixture.owner, {
      workerId: fixture.worker.workerId,
      epoch: fixture.worker.epoch,
    });
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ state: string }>(
          "SELECT state FROM jobs WHERE id = $1",
          [fixture.accepted.request.jobId],
        )
      ).rows[0]!.state,
    ).toBe("queued");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_success_results",
        )
      ).rows[0]!.count,
    ).toBe("0");
  });

  it("creates one immutable retry lineage, replays concurrently, and advances only through the newest failed child", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      reconcileFailureCommand(fixture),
    );
    const parentId = fixture.accepted.request.id;
    const projectId = fixture.accepted.request.projectId!;
    const clipId = fixture.accepted.request.clipId!;
    const before = await fixture.database.query<Record<string, unknown>>(
      `SELECT er.*, j.state AS job_state, j.payload AS job_payload,
              failure.result_json AS failure_result,
              delivery.reservation_token, delivery.worker_id,
              delivery.worker_epoch, delivery.accepted_at
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       JOIN logged_export_failure_results failure
         ON failure.export_request_id = er.id
       JOIN logged_export_deliveries delivery
         ON delivery.id = failure.delivery_id
       WHERE er.id = $1`,
      [parentId],
    );
    const versionBefore = Number(
      (
        await fixture.database.query<{ version: number }>(
          "SELECT version FROM clip_candidates WHERE id = $1",
          [clipId],
        )
      ).rows[0]!.version,
    );
    const command = { idempotencyKey: "retry-terminal-failure-1" };
    const concurrent = await Promise.all([
      fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
      fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
    ]);
    expect(concurrent[1]).toEqual(concurrent[0]);
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
    const child = concurrent[0]!.request;
    expect(child).toMatchObject({
      state: "queued",
      retryOfRequestId: parentId,
      retryOrdinal: 1,
      requestOrigin: fixture.accepted.request.requestOrigin,
      projectId,
      clipId,
    });
    expect(child.id).not.toBe(parentId);
    expect(child.jobId).not.toBe(fixture.accepted.request.jobId);
    expect(retrySnapshot(child)).toEqual(
      retrySnapshot(fixture.accepted.request),
    );
    expect(
      await fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        parentId,
        command,
      ),
    ).toEqual(concurrent[0]);
    await expect(
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "branching-retry-forbidden",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    const after = await fixture.database.query<Record<string, unknown>>(
      `SELECT er.*, j.state AS job_state, j.payload AS job_payload,
              failure.result_json AS failure_result,
              delivery.reservation_token, delivery.worker_id,
              delivery.worker_epoch, delivery.accepted_at
       FROM export_requests er
       JOIN jobs j ON j.id = er.job_id
       JOIN logged_export_failure_results failure
         ON failure.export_request_id = er.id
       JOIN logged_export_deliveries delivery
         ON delivery.id = failure.delivery_id
       WHERE er.id = $1`,
      [parentId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM export_requests
           WHERE retry_of_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE entity_id = $1
             AND event_type = 'clip_candidate.export_retried'`,
          [clipId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(
      Number(
        (
          await fixture.database.query<{ version: number }>(
            "SELECT version FROM clip_candidates WHERE id = $1",
            [clipId],
          )
        ).rows[0]!.version,
      ),
    ).toBe(versionBefore + 1);
    const event = (
      await fixture.database.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM sync_events
         WHERE entity_id = $1
           AND event_type = 'clip_candidate.export_retried'`,
        [clipId],
      )
    ).rows[0]!.payload;
    expect(event).toEqual({
      clipId,
      parentExportRequestId: parentId,
      exportRequestId: child.id,
      jobId: child.jobId,
      retryOrdinal: 1,
    });
    expect(JSON.stringify(event)).not.toMatch(
      /reservation|worker|failure|error|token|path|url/i,
    );
    expect(
      (
        await fixture.database.query<{ snapshots_match: boolean }>(
          `SELECT child.project_id = parent.project_id
                    AND child.clip_id = parent.clip_id
                    AND child.mode = parent.mode
                    AND child.video_snapshot = parent.video_snapshot
                    AND child.selection_snapshot = parent.selection_snapshot
                    AND child.source_language_class = parent.source_language_class
                    AND child.subtitle_tracks_snapshot IS NOT DISTINCT FROM parent.subtitle_tracks_snapshot
                    AND child.preset_snapshot = parent.preset_snapshot
                    AND child.resolved_settings_snapshot = parent.resolved_settings_snapshot
                    AS snapshots_match
           FROM export_requests child
           JOIN export_requests parent ON parent.id = child.retry_of_request_id
           WHERE child.id = $1`,
          [child.id],
        )
      ).rows[0]!.snapshots_match,
    ).toBe(true);
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM logged_export_failure_results
           WHERE export_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");

    const reservedChild = (
      await fixture.catalog.claimLoggedExportDelivery(fixture.owner, {
        workerId: fixture.worker.workerId,
        workerEpoch: fixture.worker.epoch,
      })
    ).delivery!;
    expect(reservedChild.request).toEqual(child);
    expect(JSON.stringify(reservedChild)).not.toContain(
      fixture.accepted.reservationToken,
    );
    const acceptedChild = await fixture.catalog.acceptLoggedExportDelivery(
      fixture.owner,
      {
        workerId: reservedChild.workerId,
        workerEpoch: reservedChild.workerEpoch,
        deliveryId: reservedChild.deliveryId,
        generation: reservedChild.generation,
        reservationToken: reservedChild.reservationToken,
      },
    );
    await fixture.catalog.reconcileLoggedExportFailure(fixture.owner, {
      workerId: acceptedChild.workerId,
      workerEpoch: acceptedChild.workerEpoch,
      deliveryId: acceptedChild.deliveryId,
      generation: acceptedChild.generation,
      reservationToken: acceptedChild.reservationToken,
      result: loggedExportFailureFixture(acceptedChild.request),
    });
    const grandchild = (
      await fixture.catalog.retryLoggedExport(
        fixture.owner,
        projectId,
        child.id,
        { idempotencyKey: "retry-terminal-failure-2" },
      )
    ).request;
    expect(grandchild).toMatchObject({
      retryOfRequestId: child.id,
      retryOrdinal: 2,
      state: "queued",
    });
    expect(retrySnapshot(grandchild)).toEqual(retrySnapshot(child));
    const childPayload = (
      await fixture.database.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM jobs WHERE id = $1",
        [child.jobId],
      )
    ).rows[0]!.payload;
    expect(childPayload).toMatchObject({
      exportRequestId: child.id,
      retryOfRequestId: parentId,
      retryOrdinal: 1,
    });
    expect(childPayload).not.toHaveProperty("projectId");
    expect(JSON.stringify(childPayload)).not.toContain(
      reconcileFailureCommand(fixture).result.error.message,
    );
    expect(JSON.stringify(childPayload)).not.toContain(
      fixture.accepted.reservationToken,
    );
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
  });

  it("serializes divergent concurrent retries without leaving an orphan export job", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    await fixture.catalog.reconcileLoggedExportFailure(
      fixture.owner,
      reconcileFailureCommand(fixture),
    );
    const parentId = fixture.accepted.request.id;
    const projectId = fixture.accepted.request.projectId!;

    const results = await Promise.allSettled([
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "divergent-concurrent-a",
      }),
      fixture.catalog.retryLoggedExport(fixture.owner, projectId, parentId, {
        idempotencyKey: "divergent-concurrent-b",
      }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 409 });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM export_requests
           WHERE retry_of_request_id = $1`,
          [parentId],
        )
      ).rows[0]!.count,
    ).toBe("1");
    expect(await countOrphanExportJobs(fixture.database, projectId)).toBe(0);
  });

  it("authorizes retry writers and rejects ineligible or inconsistent parents without mutation", async () => {
    const terminal = await createAcceptedLoggedExportResultFixture();
    await terminal.catalog.reconcileLoggedExportFailure(
      terminal.owner,
      reconcileFailureCommand(terminal),
    );
    const projectId = terminal.accepted.request.projectId!;
    const viewer = fixtureActor("retry-viewer");
    const outsider = fixtureActor("retry-outsider");
    await terminal.catalog.registerUser(viewer, "Retry viewer");
    await terminal.catalog.registerUser(outsider, "Retry outsider");
    await terminal.catalog.addMember(
      terminal.owner,
      projectId,
      viewer.userId,
      "viewer",
    );
    for (const actor of [viewer, outsider]) {
      await expect(
        terminal.catalog.retryLoggedExport(
          actor,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `forbidden-${actor.userId}` },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    await terminal.database.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [projectId, terminal.owner.userId],
    );
    await expect(
      terminal.catalog.retryLoggedExport(
        terminal.owner,
        projectId,
        terminal.accepted.request.id,
        { idempotencyKey: "lost-membership" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await terminal.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM export_requests WHERE retry_of_request_id IS NOT NULL",
        )
      ).rows[0]!.count,
    ).toBe("0");
    await terminal.database.query(
      `INSERT INTO project_members
         (project_id, user_id, role, version, created_at, updated_at)
       VALUES ($1, $2, 'owner', 1, now(), now())`,
      [projectId, terminal.owner.userId],
    );
    for (const state of [
      "queued",
      "claimed",
      "processing",
      "needs_user_action",
      "complete",
      "canceled",
    ]) {
      await terminal.database.query(
        "UPDATE jobs SET state = $1 WHERE id = $2",
        [state, terminal.accepted.request.jobId],
      );
      await expect(
        terminal.catalog.retryLoggedExport(
          terminal.owner,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `ineligible-job-${state}` },
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    await terminal.database.query(
      "UPDATE jobs SET state = 'failed' WHERE id = $1",
      [terminal.accepted.request.jobId],
    );
    for (const state of ["not_requested", "queued", "processing", "complete"]) {
      await terminal.database.query(
        "UPDATE clip_candidates SET export_status = $1 WHERE id = $2",
        [state, terminal.accepted.request.clipId],
      );
      await expect(
        terminal.catalog.retryLoggedExport(
          terminal.owner,
          projectId,
          terminal.accepted.request.id,
          { idempotencyKey: `ineligible-clip-${state}` },
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await countOrphanExportJobs(terminal.database, projectId)).toBe(0);

    const inconsistent = await createAcceptedLoggedExportResultFixture();
    await inconsistent.catalog.reconcileLoggedExportFailure(
      inconsistent.owner,
      reconcileFailureCommand(inconsistent),
    );
    await inconsistent.database.query(
      `UPDATE jobs SET payload = payload || '{"unexpected":"mutation"}'::jsonb
       WHERE id = $1`,
      [inconsistent.accepted.request.jobId],
    );
    await expect(
      inconsistent.catalog.retryLoggedExport(
        inconsistent.owner,
        inconsistent.accepted.request.projectId!,
        inconsistent.accepted.request.id,
        { idempotencyKey: "inconsistent-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const queued = await createAcceptedLoggedExportResultFixture();
    await expect(
      queued.catalog.retryLoggedExport(
        queued.owner,
        queued.accepted.request.projectId!,
        queued.accepted.request.id,
        { idempotencyKey: "queued-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const successful = await createAcceptedLoggedExportResultFixture();
    await successful.catalog.reconcileLoggedExportSuccess(
      successful.owner,
      reconcileSuccessCommand(successful),
    );
    await expect(
      successful.catalog.retryLoggedExport(
        successful.owner,
        successful.accepted.request.projectId!,
        successful.accepted.request.id,
        { idempotencyKey: "successful-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    const missingFailure = await createAcceptedLoggedExportResultFixture();
    await missingFailure.database.query(
      "UPDATE jobs SET state = 'canceled' WHERE id = $1",
      [missingFailure.accepted.request.jobId],
    );
    await missingFailure.database.query(
      "UPDATE clip_candidates SET export_status = 'failed' WHERE id = $1",
      [missingFailure.accepted.request.clipId],
    );
    await expect(
      missingFailure.catalog.retryLoggedExport(
        missingFailure.owner,
        missingFailure.accepted.request.projectId!,
        missingFailure.accepted.request.id,
        { idempotencyKey: "canceled-parent" },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  }, 60_000);

  it("cancels queued unaccepted work atomically and excludes it from delivery", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-21T16:00:00.000Z"),
    );
    const owner = fixtureActor("queued-cancel-owner");
    await catalog.registerUser(owner, "Queued cancel owner");
    const fixture = await createLoggedExportFixture(
      catalog,
      owner,
      "queued-cancel",
    );
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, worker);
    const reserved = (
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: worker.epoch,
      })
    ).delivery!;
    const viewer = fixtureActor("queued-cancel-viewer");
    const outsider = fixtureActor("queued-cancel-outsider");
    await catalog.registerUser(viewer, "Queued cancel viewer");
    await catalog.registerUser(outsider, "Queued cancel outsider");
    await catalog.addMember(owner, fixture.projectId, viewer.userId, "viewer");
    for (const actor of [viewer, outsider]) {
      await expect(
        catalog.cancelLoggedExport(
          actor,
          fixture.projectId,
          fixture.request.id,
          { idempotencyKey: `forbidden-${actor.userId}` },
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    const canceled = await catalog.cancelLoggedExport(
      owner,
      fixture.projectId,
      fixture.request.id,
      { idempotencyKey: "cancel-queued-1" },
    );
    expect(canceled).toMatchObject({
      outcome: "canceled",
      request: { state: "canceled" },
    });
    expect(
      await catalog.cancelLoggedExport(
        owner,
        fixture.projectId,
        fixture.request.id,
        { idempotencyKey: "cancel-queued-1" },
      ),
    ).toEqual(canceled);
    const row = await database.query<Record<string, unknown>>(
      "SELECT * FROM logged_export_canceled_results WHERE export_request_id = $1",
      [fixture.request.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.delivery_id).toBeNull();
    await expect(
      catalog.acceptLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: worker.epoch,
        deliveryId: reserved.deliveryId,
        generation: reserved.generation,
        reservationToken: reserved.reservationToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(JSON.stringify(row.rows[0])).not.toMatch(
      /reservation_token|lease_token|owner_user_id|source_identity|path|url/i,
    );
  });

  it("starts one exact execution, observes cancel intent, and reconciles cancellation exclusively", async () => {
    const clock = { now: new Date("2026-08-21T17:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const started = await fixture.catalog.startLoggedExportExecution(
      fixture.owner,
      credential,
    );
    expect(started).toMatchObject({
      status: "started",
      execution: { attempt: 1, requestId: fixture.accepted.request.id },
    });
    if (started.status !== "started") throw new Error("execution not started");
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      execution: {
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
      },
    });
    const cancel = await fixture.catalog.cancelLoggedExport(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.id,
      { idempotencyKey: "cancel-executing-1" },
    );
    expect(cancel.outcome).toBe("cancel_requested");
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      execution: {
        executionId: started.execution.executionId,
        cancelRequestedAt: cancel.cancelRequestedAt,
      },
    });
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: randomUUID(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const heartbeat = await fixture.catalog.heartbeatLoggedExportExecution(
      fixture.owner,
      {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
        progress: {
          schemaVersion: 1,
          executionId: started.execution.executionId,
          requestId: fixture.accepted.request.id,
          attempt: started.execution.attempt,
          sequence: 1,
          stage: "rendering",
          basisPoints: 3_500,
          updatedAt: clock.now.toISOString(),
        },
      },
    );
    expect(heartbeat.execution.cancelRequestedAt).toBe(
      cancel.cancelRequestedAt,
    );
    expect(heartbeat.progress).toMatchObject({
      sequence: 1,
      stage: "rendering",
      basisPoints: 3_500,
    });
    expect(
      await fixture.catalog.getLoggedExportProgress(
        fixture.owner,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).toMatchObject({
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      state: "processing",
      progress: { executionId: started.execution.executionId, sequence: 1 },
    });
    expect(
      await fixture.catalog.startLoggedExportExecution(
        fixture.owner,
        credential,
      ),
    ).toMatchObject({
      status: "started",
      progress: { executionId: started.execution.executionId, sequence: 1 },
    });
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
        progress: {
          ...heartbeat.progress!,
          sequence: 2,
          stage: "acquiring_source",
          basisPoints: 3_600,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const outsider = fixtureActor("progress-outsider");
    await fixture.catalog.registerUser(outsider, "Progress outsider");
    await expect(
      fixture.catalog.getLoggedExportProgress(
        outsider,
        fixture.accepted.request.projectId!,
        fixture.accepted.request.id,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "user_requested" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
      executionId: started.execution.executionId,
      executionAttempt: started.execution.attempt,
    };
    const reconciled = await fixture.catalog.reconcileLoggedExportCanceled(
      fixture.owner,
      {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      },
    );
    expect(reconciled.result).toEqual(result);
    expect(
      await fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      }),
    ).toEqual(reconciled);
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result: { ...result, reason: "execution_lease_lost" },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.catalog.reconcileLoggedExportSuccess(
        fixture.owner,
        reconcileSuccessCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      fixture.catalog.reconcileLoggedExportFailure(
        fixture.owner,
        reconcileFailureCommand(fixture),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await fixture.catalog.registerExportWorker(fixture.owner, {
      ...fixture.worker,
      epoch: fixture.worker.epoch + 1,
    });
    await expect(
      fixture.catalog.startLoggedExportExecution(fixture.owner, credential),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("closes accepted but never-started work with attempt-zero evidence", async () => {
    const fixture = await createAcceptedLoggedExportResultFixture();
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const cancel = await fixture.catalog.cancelLoggedExport(
      fixture.owner,
      fixture.accepted.request.projectId!,
      fixture.accepted.request.id,
      { idempotencyKey: "cancel-accepted-not-started" },
    );
    expect(cancel.outcome).toBe("cancel_requested");
    await expect(
      fixture.catalog.startLoggedExportExecution(fixture.owner, credential),
    ).resolves.toEqual({
      status: "cancel_requested",
      cancelRequestedAt: cancel.cancelRequestedAt,
    });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "user_requested" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
    };
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        result,
      }),
    ).resolves.toMatchObject({ result });
    expect(
      (
        await fixture.database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_executions WHERE export_request_id = $1",
          [fixture.accepted.request.id],
        )
      ).rows[0]!.count,
    ).toBe("0");
  });

  it("expires stale execution ownership without allowing another attempt", async () => {
    const clock = { now: new Date("2026-08-21T18:00:00.000Z") };
    const fixture = await createAcceptedLoggedExportResultFixture(clock);
    const credential = {
      workerId: fixture.accepted.workerId,
      workerEpoch: fixture.accepted.workerEpoch,
      deliveryId: fixture.accepted.deliveryId,
      generation: fixture.accepted.generation,
      reservationToken: fixture.accepted.reservationToken,
    };
    const started = await fixture.catalog.startLoggedExportExecution(
      fixture.owner,
      credential,
    );
    if (started.status !== "started") throw new Error("execution not started");
    clock.now = new Date("2026-08-21T18:00:31.000Z");
    await expect(
      fixture.catalog.heartbeatLoggedExportExecution(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        attempt: started.execution.attempt,
        leaseToken: started.execution.leaseToken,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const result = {
      schemaVersion: 1 as const,
      requestId: fixture.accepted.request.id,
      jobId: fixture.accepted.request.jobId,
      projectId: fixture.accepted.request.projectId!,
      clipId: fixture.accepted.request.clipId!,
      reason: "execution_lease_lost" as const,
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" as const },
      executionId: started.execution.executionId,
      executionAttempt: started.execution.attempt,
    };
    await expect(
      fixture.catalog.reconcileLoggedExportCanceled(fixture.owner, {
        ...credential,
        executionId: started.execution.executionId,
        leaseToken: started.execution.leaseToken,
        result,
      }),
    ).resolves.toMatchObject({ result });
    const executions = await fixture.database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM logged_export_executions WHERE export_request_id = $1",
      [fixture.accepted.request.id],
    );
    expect(executions.rows[0]!.count).toBe("1");
  });
});

describe("Clip Library export creation", () => {
  it("adopts an exact lost-response replay but rejects a second independent request", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    const owner = fixtureActor("clip-library-export-owner");
    await catalog.registerUser(owner, "Clip Library export owner");
    const project = await catalog.createProject(owner, {
      name: "Clip Library export project",
    });
    const [clip] = await createBatchClips(catalog, owner, project.id, 1);
    const create = () =>
      createLoggedExportFromClip(
        catalog,
        owner,
        project.id,
        clip!.id,
        "clip-library-lost-response",
        "h264",
        "confirmed_english",
        "clip_library",
      );
    const [first, concurrentReplay] = await Promise.all([create(), create()]);
    expect(concurrentReplay).toEqual(first);

    expect(await create()).toEqual(first);
    await expect(
      createLoggedExportFromClip(
        catalog,
        owner,
        project.id,
        clip!.id,
        "clip-library-second-request",
        "h264",
        "confirmed_english",
        "clip_library",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM export_requests WHERE clip_id = $1",
          [clip!.id],
        )
      ).rows[0]!.count,
    ).toBe("1");
  });
});

describe("logged export batches", () => {
  it("creates and replays one atomic sanitized batch with isolated derived status", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-22T12:00:00.000Z"),
    );
    const owner = fixtureActor("batch-owner");
    await catalog.registerUser(owner, "Batch owner");
    const project = await catalog.createProject(owner, {
      name: "Batch project",
    });
    const clips = await createBatchClips(catalog, owner, project.id, 3);
    const command = await createBatchCommand(catalog, owner, project.id, clips);
    const [batch, concurrentReplay] = await Promise.all([
      catalog.createLoggedExportBatch(owner, project.id, command),
      catalog.createLoggedExportBatch(owner, project.id, command),
    ]);
    expect(concurrentReplay).toEqual(batch);
    expect(batch).toMatchObject({
      projectId: project.id,
      summary: {
        total: 3,
        queued: 3,
        complete: 0,
        failed: 0,
        canceled: 0,
        status: "active",
      },
    });
    expect(batch.items.map((item) => item.ordinal)).toEqual([0, 1, 2]);
    expect(new Set(batch.items.map((item) => item.id)).size).toBe(3);
    const membership = await database.query<{
      id: string;
      batch_item_id: string;
    }>("SELECT id, batch_item_id FROM export_requests ORDER BY id");
    expect(
      membership.rows.every((request) => Boolean(request.batch_item_id)),
    ).toBe(true);
    const rightsSnapshots = await database.query<{
      source_rights_snapshot: { youtubeVideoId: string };
      job_source_rights: { youtubeVideoId: string };
    }>(
      `SELECT request.source_rights_snapshot,
              job.payload->'sourceRights' AS job_source_rights
       FROM export_requests request
       JOIN jobs job ON job.id = request.job_id
       ORDER BY request.id`,
    );
    expect(
      rightsSnapshots.rows.map(
        (row) => row.source_rights_snapshot.youtubeVideoId,
      ),
    ).toEqual(
      expect.arrayContaining(clips.map((clip) => clip.video.youtubeVideoId)),
    );
    expect(rightsSnapshots.rows.map((row) => row.job_source_rights)).toEqual(
      rightsSnapshots.rows.map((row) => row.source_rights_snapshot),
    );
    expect(
      await catalog.createLoggedExportBatch(owner, project.id, command),
    ).toEqual(batch);
    expect(
      await catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        items: command.items.map((item) => ({
          ...item,
          export: { ...item.export, requestOrigin: "authoring_build" },
        })),
      }),
    ).toEqual(batch);
    expect(
      (
        await database.query<{ request_origin: string }>(
          "SELECT request_origin FROM export_requests ORDER BY id",
        )
      ).rows.every(
        ({ request_origin }) => request_origin === "selection_action",
      ),
    ).toBe(true);
    await expect(
      catalog.createClipExport(owner, project.id, clips[0]!.id, {
        ...command.items[0]!.export,
        idempotencyKey: "second-export-for-batch-clip",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        items: [...command.items].reverse(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await catalog.listLoggedExportBatches(owner, project.id)).toEqual({
      batches: [batch],
    });
    const outsider = fixtureActor("batch-outsider");
    await catalog.registerUser(outsider, "Batch outsider");
    await expect(
      catalog.getLoggedExportBatch(outsider, project.id, batch.id),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(JSON.stringify(batch)).not.toMatch(
      /reservation|leaseToken|workerId|sourceIdentity|artifactLocator|path|url|createdBy/i,
    );

    for (const [index, state] of ["complete", "failed", "canceled"].entries()) {
      await database.query("UPDATE jobs SET state = $1 WHERE id = $2", [
        state,
        batch.items[index]!.currentRequest.jobId,
      ]);
    }
    const mixed = await catalog.getLoggedExportBatch(
      owner,
      project.id,
      batch.id,
    );
    expect(mixed.summary).toMatchObject({
      complete: 1,
      failed: 1,
      canceled: 1,
      status: "mixed_terminal",
    });
    expect(mixed.items.map((item) => item.currentRequest.id)).toEqual(
      batch.items.map((item) => item.currentRequest.id),
    );
  });

  it("rolls back invalid siblings and keeps retry lineage on its batch item", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-22T13:00:00.000Z"),
    );
    const owner = fixtureActor("batch-retry-owner");
    await catalog.registerUser(owner, "Batch retry owner");
    const project = await catalog.createProject(owner, {
      name: "Batch retry project",
    });
    const clips = await createBatchClips(catalog, owner, project.id, 2);
    const command = await createBatchCommand(catalog, owner, project.id, clips);
    await expect(
      catalog.createLoggedExportBatch(owner, project.id, {
        ...command,
        idempotencyKey: "invalid-batch",
        items: [
          command.items[0]!,
          { ...command.items[1]!, clipId: randomUUID() },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM logged_export_batches",
        )
      ).rows[0]!.count,
    ).toBe("0");
    expect(await countOrphanExportJobs(database, project.id)).toBe(0);
    const batch = await catalog.createLoggedExportBatch(
      owner,
      project.id,
      command,
    );

    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "mov_text"],
      muxers: ["mp4"],
      filters: ["scale", "fps"],
    });
    const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
    await catalog.registerExportWorker(owner, worker);
    const reserved = (
      await catalog.claimLoggedExportDelivery(owner, {
        workerId: worker.workerId,
        workerEpoch: worker.epoch,
      })
    ).delivery!;
    expect(reserved.sourceGroup).toEqual({
      batchId: batch.id,
      batchItemId: reserved.request.batchItemId,
    });
    const accepted = await catalog.acceptLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: worker.epoch,
      deliveryId: reserved.deliveryId,
      generation: reserved.generation,
      reservationToken: reserved.reservationToken,
    });
    await catalog.reconcileLoggedExportFailure(owner, {
      workerId: accepted.workerId,
      workerEpoch: accepted.workerEpoch,
      deliveryId: accepted.deliveryId,
      generation: accepted.generation,
      reservationToken: accepted.reservationToken,
      result: loggedExportFailureFixture(accepted.request),
    });
    const retried = await catalog.retryLoggedExport(
      owner,
      project.id,
      accepted.request.id,
      { idempotencyKey: "batch-item-retry" },
    );
    const failedItem = batch.items.find(
      (item) => item.currentRequest.id === accepted.request.id,
    )!;
    expect(retried.request).toMatchObject({
      batchItemId: failedItem.id,
      retryOfRequestId: accepted.request.id,
      retryOrdinal: 1,
      sourceRights: accepted.request.sourceRights,
    });
    const afterRetry = await catalog.getLoggedExportBatch(
      owner,
      project.id,
      batch.id,
    );
    expect(
      afterRetry.items.find((item) => item.id === failedItem.id)!
        .currentRequest,
    ).toMatchObject({ id: retried.request.id, state: "queued" });
    expect(afterRetry.summary).toMatchObject({ queued: 2, status: "active" });
  });
});

function fixtureActor(name: string): AuthenticatedActor {
  return { userId: randomUUID(), externalSubject: `fixture:${name}` };
}

async function createBatchClips(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  count: number,
) {
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const trackId = randomUUID();
      return catalog.createClipCandidate(actor, projectId, {
        idempotencyKey: `batch-clip-${index}`,
        video: {
          youtubeVideoId: "M7lc1UVf-VE",
          canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          title: `Batch fixture ${index}`,
        },
        selection: {
          trackId,
          transcriptVersion: 1,
          firstSegmentId: randomUUID(),
          lastSegmentId: randomUUID(),
          firstTokenId: randomUUID(),
          lastTokenId: randomUUID(),
          transcriptStartMs: 300 + index * 100,
          transcriptEndMs: 2_900 + index * 100,
          exportStartMs: index * 100,
          exportEndMs: 3_400 + index * 100,
          text: `Batch fixture selection ${index}`,
          timingPrecision: "word",
        },
        languageEvidence: {
          schemaVersion: 2,
          native: {
            role: "native",
            language: "en",
            text: `Batch fixture selection ${index}`,
            trackId,
            trackVersion: 1,
            timingPrecision: "word",
          },
          english: {
            role: "english",
            language: "en",
            text: `Batch fixture selection ${index}`,
            trackId,
            trackVersion: 1,
            timingPrecision: "word",
          },
        },
        notes: "",
        tags: [],
      });
    }),
  );
}

async function createBatchCommand(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  clips: Awaited<ReturnType<typeof createBatchClips>>,
) {
  const selection = {
    base: "application_default" as const,
    overrides: {},
  };
  const preview = await catalog.previewProjectExportSettings(actor, projectId, {
    sourceLanguageClass: "confirmed_english",
    selection,
  });
  return {
    idempotencyKey: "batch-create-1",
    items: clips.map((clip, index) => ({
      clipId: clip.id,
      export: {
        idempotencyKey: `batch-item-${index}`,
        sourceLanguageClass: "confirmed_english" as const,
        settingsSelection: selection,
        expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
        sourceRights: sourceRightsForVideo(clip.video.youtubeVideoId),
      },
    })),
  };
}

async function createLoggedExportFixture(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  idempotencyKey: string,
  family: "h264" | "hevc" = "h264",
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
) {
  const project = await catalog.createProject(actor, {
    name: `Delivery ${idempotencyKey}`,
  });
  const trackId = randomUUID();
  const clip = await catalog.createClipCandidate(actor, project.id, {
    idempotencyKey: `clip:${idempotencyKey}`,
    video: {
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "Delivery fixture",
    },
    selection: {
      trackId,
      transcriptVersion: 1,
      firstSegmentId: randomUUID(),
      lastSegmentId: randomUUID(),
      firstTokenId: randomUUID(),
      lastTokenId: randomUUID(),
      transcriptStartMs: 300,
      transcriptEndMs: 2_900,
      exportStartMs: 0,
      exportEndMs: 3_400,
      text: "Delivery fixture selection",
      timingPrecision: "word",
    },
    languageEvidence: {
      schemaVersion: 2,
      native: {
        role: "native",
        language: "en",
        text: "Delivery fixture selection",
        trackId,
        trackVersion: 1,
        timingPrecision: "word",
      },
      english: {
        role: "english",
        language: "en",
        text: "Delivery fixture selection",
        trackId,
        trackVersion: 1,
        timingPrecision: "word",
      },
    },
    notes: "",
    tags: [],
  });
  const request = await createLoggedExportFromClip(
    catalog,
    actor,
    project.id,
    clip.id,
    idempotencyKey,
    family,
    sourceLanguageClass,
  );
  return { projectId: project.id, clipId: clip.id, request };
}

async function createLoggedExportFromClip(
  catalog: SharedProjectCatalog,
  actor: AuthenticatedActor,
  projectId: string,
  clipId: string,
  idempotencyKey: string,
  family: "h264" | "hevc",
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
  requestOrigin:
    | "selection_action"
    | "clip_library"
    | "authoring_build" = "selection_action",
) {
  const overrides =
    family === "hevc"
      ? {
          container: "mkv" as const,
          videoCodec: "hevc" as const,
          audioCodec: "aac" as const,
        }
      : {};
  const selection = { base: "application_default" as const, overrides };
  const preview = await catalog.previewProjectExportSettings(actor, projectId, {
    sourceLanguageClass,
    selection,
  });
  const subtitleTracks =
    sourceLanguageClass === "foreign"
      ? {
          original: { trackId: randomUUID(), trackVersion: 3 },
          english: { trackId: randomUUID(), trackVersion: 4 },
        }
      : undefined;
  const clip = await catalog.getClipCandidate(actor, projectId, clipId);
  return catalog.createClipExport(actor, projectId, clipId, {
    idempotencyKey,
    requestOrigin,
    sourceLanguageClass,
    ...(subtitleTracks ? { subtitleTracks } : {}),
    sourceRights: sourceRightsForVideo(clip.video.youtubeVideoId),
    settingsSelection: selection,
    expectedResolutionFingerprint: preview.snapshot.resolutionFingerprint!,
  });
}

async function createAcceptedLoggedExportResultFixture(
  clock: { now: Date } = { now: new Date("2026-08-20T12:00:00.000Z") },
  sourceLanguageClass: "confirmed_english" | "foreign" = "confirmed_english",
) {
  const database = new PGlite();
  databases.add(database);
  await runCloudMigrations(database);
  const catalog = new SharedProjectCatalog(
    database,
    new MemoryTranscriptObjectStore(),
    () => clock.now,
  );
  const owner = fixtureActor("result-owner");
  await catalog.registerUser(owner, "Result owner");
  const { request } = await createLoggedExportFixture(
    catalog,
    owner,
    randomUUID(),
    "h264",
    sourceLanguageClass,
  );
  const advertisement = currentExportWorkerAdvertisement({
    ffmpegVersion: "8.1.2",
    encoders: ["libx264", "mov_text"],
    muxers: ["mp4"],
    filters: ["scale", "fps"],
  });
  const worker = { workerId: randomUUID(), epoch: 1, ...advertisement };
  await catalog.registerExportWorker(owner, worker);
  const reserved = (
    await catalog.claimLoggedExportDelivery(owner, {
      workerId: worker.workerId,
      workerEpoch: worker.epoch,
    })
  ).delivery!;
  const accepted = await catalog.acceptLoggedExportDelivery(owner, {
    workerId: worker.workerId,
    workerEpoch: worker.epoch,
    deliveryId: reserved.deliveryId,
    generation: reserved.generation,
    reservationToken: reserved.reservationToken,
  });
  return {
    database,
    catalog,
    owner,
    worker,
    accepted,
    result: loggedExportSuccessFixture(request, clock.now.toISOString()),
  };
}

function reconcileSuccessCommand(
  fixture: Awaited<ReturnType<typeof createAcceptedLoggedExportResultFixture>>,
) {
  return {
    workerId: fixture.accepted.workerId,
    workerEpoch: fixture.accepted.workerEpoch,
    deliveryId: fixture.accepted.deliveryId,
    generation: fixture.accepted.generation,
    reservationToken: fixture.accepted.reservationToken,
    result: fixture.result,
  };
}

function reconcileFailureCommand(
  fixture: Awaited<ReturnType<typeof createAcceptedLoggedExportResultFixture>>,
) {
  return {
    workerId: fixture.accepted.workerId,
    workerEpoch: fixture.accepted.workerEpoch,
    deliveryId: fixture.accepted.deliveryId,
    generation: fixture.accepted.generation,
    reservationToken: fixture.accepted.reservationToken,
    result: loggedExportFailureFixture(fixture.accepted.request),
  };
}

function loggedExportFailureFixture(
  request: ExportRequest,
): LoggedExportFailureResult {
  return {
    schemaVersion: 1,
    requestId: request.id,
    jobId: request.jobId,
    projectId: request.projectId!,
    clipId: request.clipId!,
    error: {
      code: "export_source_provider_unconfigured",
      message: "Configure an authorized source provider before retrying.",
    },
    attempt: 0,
    sourceCleanup: { lifecycle: "not_started" },
  };
}

function retrySnapshot(request: ExportRequest) {
  return {
    projectId: request.projectId,
    clipId: request.clipId,
    video: request.video,
    selection: request.selection,
    sourceLanguageClass: request.sourceLanguageClass,
    sourceRights: request.sourceRights,
    subtitleTracks: request.subtitleTracks,
    preset: request.preset,
    resolvedSettingsSnapshot: request.resolvedSettingsSnapshot,
  };
}

async function countOrphanExportJobs(
  database: PGlite,
  projectId: string,
): Promise<number> {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM jobs job
     LEFT JOIN export_requests request ON request.job_id = job.id
     WHERE job.project_id = $1 AND job.kind = 'export' AND request.id IS NULL`,
    [projectId],
  );
  return Number(result.rows[0]!.count);
}

function loggedExportSuccessFixture(
  request: ExportRequest,
  validatedAt: string,
): LoggedExportSuccessResult {
  const packageIdentity = `clip-${request.id}`;
  const sourceAttempt = 1;
  const artifact = (
    role:
      | "clip_metadata_json"
      | "english_srt"
      | "manifest_json"
      | "original_srt"
      | "thumbnail_jpg"
      | "video_mp4",
    digit: string,
  ) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt,
    validatedAt,
  });
  return {
    schemaVersion: 1,
    requestId: request.id,
    jobId: request.jobId,
    projectId: request.projectId!,
    clipId: request.clipId!,
    sourceLanguageClass: request.sourceLanguageClass,
    resolvedExportBounds: {
      startMs: request.selection.exportStartMs,
      endMs: request.selection.exportEndMs,
      sourceAttempt,
      resolvedAt: validatedAt,
    },
    renderedMediaProvenance: {
      durationMs:
        request.selection.exportEndMs - request.selection.exportStartMs,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: sha256Fingerprint(
        request.resolvedSettingsSnapshot!.settings,
      ),
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
          width: 1_920,
          height: 1_080,
          sampleAspectRatio: { numerator: 1, denominator: 1 },
          displayAspectRatio: { numerator: 16, denominator: 9 },
          averageFrameRate: { numerator: 30, denominator: 1 },
        },
        audio: {
          codec: "aac",
          sampleRate: 48_000,
          channels: 2,
          channelLayout: "stereo",
        },
        durationMs:
          request.selection.exportEndMs - request.selection.exportStartMs,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt,
      validatedAt,
    },
    thumbnailProvenance: {
      extractionTimeMs: Math.floor(
        (request.selection.exportEndMs - request.selection.exportStartMs) / 2,
      ),
      width: 640,
      height: 360,
      sourceAttempt,
      validatedAt,
    },
    ...(request.sourceLanguageClass === "confirmed_english"
      ? {
          englishSubtitleProvenance: {
            trackId:
              request.subtitleTracks?.english.trackId ??
              request.selection.trackId,
            trackVersion:
              request.subtitleTracks?.english.trackVersion ??
              request.selection.transcriptVersion,
            cueCount: 1,
            byteSize: 64,
            contentSha256: "e".repeat(64),
            startMs: 0,
            endMs: request.selection.transcriptEndMs,
            sourceAttempt,
            validatedAt,
          },
          artifacts: [
            artifact("clip_metadata_json", "1"),
            artifact("english_srt", "2"),
            artifact("manifest_json", "3"),
            artifact("thumbnail_jpg", "4"),
            artifact("video_mp4", "5"),
          ],
        }
      : {
          subtitleSidecars: [
            {
              role: "english" as const,
              language: "en",
              trackId: request.subtitleTracks!.english.trackId,
              trackVersion: request.subtitleTracks!.english.trackVersion,
              cueCount: 1,
              byteSize: 64,
              contentSha256: "e".repeat(64),
              startMs: 0,
              endMs: request.selection.transcriptEndMs,
              sourceAttempt,
              validatedAt,
            },
            {
              role: "original" as const,
              language: "es",
              trackId: request.subtitleTracks!.original.trackId,
              trackVersion: request.subtitleTracks!.original.trackVersion,
              cueCount: 1,
              byteSize: 64,
              contentSha256: "d".repeat(64),
              startMs: 0,
              endMs: request.selection.transcriptEndMs,
              sourceAttempt,
              validatedAt,
            },
          ],
          artifacts: [
            artifact("clip_metadata_json", "1"),
            artifact("english_srt", "2"),
            artifact("manifest_json", "3"),
            artifact("original_srt", "4"),
            artifact("thumbnail_jpg", "5"),
            artifact("video_mp4", "6"),
          ],
        }),
  };
}

function compatibilityRequirementsForVersion(
  summary: ArtifactVersionSummary,
): ArtifactCompatibilityRequirements {
  const { text: _text, ...selection } = summary.selection;
  return {
    clipId: summary.clipId,
    selection,
    resolvedBounds: {
      startMs: summary.resolvedExportBounds.startMs,
      endMs: summary.resolvedExportBounds.endMs,
    },
    sourceLanguageClass: summary.sourceLanguageClass,
    ...(summary.subtitleTracks
      ? { subtitleTracks: summary.subtitleTracks }
      : {}),
    subtitlePolicy: summary.subtitleOmissionProvenance
      ? {
          requiredSidecars: [],
          omittedReason: summary.subtitleOmissionProvenance.policy,
        }
      : summary.sourceLanguageClass === "confirmed_english"
        ? { requiredSidecars: ["english"] }
        : { requiredSidecars: ["original", "english"] },
    requiredArtifactRoles: summary.artifacts.map((artifact) => artifact.role),
    acceptedManifestSchemas: [1, 2],
    settings: {
      mode: "exact_fingerprint",
      resolutionFingerprint:
        summary.resolvedSettingsSnapshot.resolutionFingerprint!,
    },
  };
}
