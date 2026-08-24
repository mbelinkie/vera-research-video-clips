import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedProjectCatalog } from "@research-video/catalog";
import { HealthResponseSchema } from "@research-video/contracts";
import { runCloudMigrations } from "@research-video/db-cloud";
import { currentExportWorkerAdvertisement } from "@research-video/export-settings";
import type {
  SourceSearchProvider,
  VideoMetadataProvider,
} from "@research-video/providers";
import { MemoryTranscriptObjectStore } from "@research-video/storage";
import {
  buildClipLanguageEvidence,
  normalizeTranscriptFixture,
} from "@research-video/transcript";
import multilingualFixture from "../../../tests/fixtures/transcripts/romanian-multilingual.json" with { type: "json" };

import { authenticateDevBearer, createCloudApi } from "./app.ts";

const apps = new Set<ReturnType<typeof createCloudApi>>();
const databases = new Set<PGlite>();
const presetSettings = {
  container: "mp4",
  videoCodec: "h264",
  videoRateControl: { mode: "crf", value: 20 },
  maxWidth: 1_920,
  frameRate: "source",
  audioCodec: "aac",
  audioKilobitsPerSecond: 192,
  omitSubtitleFilesForConfirmedEnglish: false,
  embedEnglishSubtitleTrack: false,
};
const sourceRightsForVideo = (youtubeVideoId: string) => ({
  schemaVersion: 1 as const,
  source: "youtube" as const,
  youtubeVideoId,
  confirmation: "authorized_to_process" as const,
  disclosureVersion: 1,
});

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
  await Promise.all([...databases].map((database) => database.close()));
  databases.clear();
});

describe("cloud API", () => {
  it("routes the authenticated bounded notification feed", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:notification-feed-route",
    };
    const listNotificationFeed = vi.fn(async () => ({
      events: [
        {
          id: randomUUID(),
          kind: "local_export_terminal" as const,
          status: "completed" as const,
          sourceLabel: "Safe source",
          navigation: {
            kind: "local_export" as const,
            requestId: randomUUID(),
          },
          createdAt: "2026-08-24T12:00:00.000Z",
        },
      ],
      fetchedAt: "2026-08-24T12:01:00.000Z",
    }));
    const app = createCloudApi({
      catalog: { listNotificationFeed } as unknown as SharedProjectCatalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const authorization = `Bearer ${actor.userId}|${actor.externalSubject}`;

    expect(
      (await app.inject({ method: "GET", url: "/api/notifications" }))
        .statusCode,
    ).toBe(401);
    const response = await app.inject({
      method: "GET",
      url: "/api/notifications?limit=10&cursor=abcdefghij&since=2026-08-24T12%3A00%3A00.000Z",
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        {
          kind: "local_export_terminal",
          sourceLabel: "Safe source",
        },
      ],
    });
    expect(listNotificationFeed).toHaveBeenCalledWith(actor, {
      limit: 10,
      cursor: "abcdefghij",
      since: "2026-08-24T12:00:00.000Z",
    });

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/notifications?limit=51",
          headers: { authorization },
        })
      ).statusCode,
    ).toBe(400);
    expect(listNotificationFeed).toHaveBeenCalledTimes(1);
  });

  it("routes an exact authorized notification comment anchor", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:notification-comment-route",
    };
    const projectId = randomUUID();
    const clipId = randomUUID();
    const commentId = randomUUID();
    const readClipComment = vi.fn(async () => ({ id: commentId }));
    const app = createCloudApi({
      catalog: { readClipComment } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${clipId}/comments/${commentId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: commentId });
    expect(readClipComment).toHaveBeenCalledWith(
      actor,
      projectId,
      clipId,
      commentId,
    );
  });

  it("routes strict project governance lifecycle commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:governance-routes",
    };
    const projectId = randomUUID();
    const invitationId = randomUUID();
    const targetUserId = randomUUID();
    const invitationRequest = {
      idempotencyKey: "route-create-invitation",
      handle: "route_researcher",
      role: "researcher" as const,
      expiresInDays: 7,
    };
    const decisionRequest = {
      idempotencyKey: "route-accept-invitation",
      expectedVersion: 1,
      decision: "accept" as const,
    };
    const revokeRequest = {
      idempotencyKey: "route-revoke-invitation",
      expectedVersion: 1,
    };
    const joinRequest = { idempotencyKey: "route-open-join" };
    const governanceRequest = {
      idempotencyKey: "route-member-role",
      expectedVersion: 2,
      action: {
        type: "set_member_role" as const,
        userId: targetUserId,
        role: "administrator" as const,
        expectedMemberVersion: 1,
      },
    };
    const discoverOpenProjects = vi.fn(async () => [{ id: projectId }]);
    const listMyProjectInvitations = vi.fn(async () => [{ id: invitationId }]);
    const decideProjectInvitation = vi.fn(async () => ({
      id: invitationId,
      state: "accepted",
    }));
    const joinOpenProject = vi.fn(async () => ({ id: projectId }));
    const listProjectMembers = vi.fn(async () => [{ userId: targetUserId }]);
    const listGovernanceEvents = vi.fn(async () => [{ projectId }]);
    const createProjectInvitation = vi.fn(async () => ({ id: invitationId }));
    const listProjectInvitations = vi.fn(async () => [{ id: invitationId }]);
    const revokeProjectInvitation = vi.fn(async () => ({
      id: invitationId,
      state: "revoked",
    }));
    const updateProjectGovernance = vi.fn(async () => ({ id: projectId }));
    const app = createCloudApi({
      catalog: {
        discoverOpenProjects,
        listMyProjectInvitations,
        decideProjectInvitation,
        joinOpenProject,
        listProjectMembers,
        listGovernanceEvents,
        createProjectInvitation,
        listProjectInvitations,
        revokeProjectInvitation,
        updateProjectGovernance,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    expect(
      (
        await app.inject({ method: "GET", url: "/api/projects/discover" })
      ).json(),
    ).toEqual([{ id: projectId }]);
    expect(
      (
        await app.inject({ method: "GET", url: "/api/project-invitations" })
      ).json(),
    ).toEqual([{ id: invitationId }]);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/project-invitations/${invitationId}`,
          payload: decisionRequest,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/join`,
          payload: joinRequest,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/members`,
        })
      ).json(),
    ).toEqual([{ userId: targetUserId }]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/governance-events`,
        })
      ).json(),
    ).toEqual([{ projectId }]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/invitations`,
          payload: invitationRequest,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/invitations`,
        })
      ).json(),
    ).toEqual([{ id: invitationId }]);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/projects/${projectId}/invitations/${invitationId}`,
          payload: revokeRequest,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/governance`,
          payload: governanceRequest,
        })
      ).statusCode,
    ).toBe(200);

    expect(discoverOpenProjects).toHaveBeenCalledWith(actor);
    expect(listMyProjectInvitations).toHaveBeenCalledWith(actor);
    expect(decideProjectInvitation).toHaveBeenCalledWith(
      actor,
      invitationId,
      decisionRequest,
    );
    expect(joinOpenProject).toHaveBeenCalledWith(actor, projectId, joinRequest);
    expect(listProjectMembers).toHaveBeenCalledWith(actor, projectId);
    expect(listGovernanceEvents).toHaveBeenCalledWith(actor, projectId);
    expect(createProjectInvitation).toHaveBeenCalledWith(
      actor,
      projectId,
      invitationRequest,
    );
    expect(listProjectInvitations).toHaveBeenCalledWith(actor, projectId);
    expect(revokeProjectInvitation).toHaveBeenCalledWith(
      actor,
      projectId,
      invitationId,
      revokeRequest,
    );
    expect(updateProjectGovernance).toHaveBeenCalledWith(
      actor,
      projectId,
      governanceRequest,
    );

    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/governance`,
      payload: { ...governanceRequest, unexpected: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(updateProjectGovernance).toHaveBeenCalledTimes(1);
  });

  it("reports provider capabilities and searches without mutating project state", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:source-search",
    };
    const projectId = randomUUID();
    const getProject = vi.fn(async () => ({ id: projectId }));
    const search = vi.fn<SourceSearchProvider["search"]>(async () => ({
      candidates: [
        {
          sourceIdentity: {
            schemaVersion: 1,
            provider: "youtube",
            providerMediaId: "M7lc1UVf-VE",
            canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
          },
          title: "Fixture result",
          availability: "available",
          provenance: { provider: "youtube", resultPosition: 0 },
        },
      ],
      nextCursor: "next-page",
    }));
    const app = createCloudApi({
      catalog: { getProject } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
      sourceSearchProviders: {
        youtube: { provider: "youtube", search },
      },
    });
    apps.add(app);

    const capabilityResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/source-capabilities`,
    });
    expect(capabilityResponse.statusCode).toBe(200);
    expect(capabilityResponse.json()).toMatchObject({
      providers: [
        {
          provider: "youtube",
          operations: expect.arrayContaining([
            expect.objectContaining({
              operation: "search",
              state: "available",
            }),
          ]),
        },
        {
          provider: "tiktok",
          operations: expect.arrayContaining([
            expect.objectContaining({
              operation: "search",
              state: "unsupported",
            }),
          ]),
        },
        { provider: "instagram" },
        {
          provider: "facebook",
          operations: expect.arrayContaining([
            expect.objectContaining({
              operation: "search",
              state: "unsupported",
            }),
          ]),
        },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/source-search`,
      payload: {
        query: "fixture query",
        providers: ["youtube", "tiktok"],
        pageSize: 12,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcomes: [
        {
          provider: "youtube",
          state: "success",
          candidates: [
            expect.objectContaining({
              sourceIdentity: expect.objectContaining({
                providerMediaId: "M7lc1UVf-VE",
              }),
            }),
          ],
          nextCursor: "next-page",
        },
        { provider: "tiktok", state: "unsupported", candidates: [] },
      ],
    });
    expect(search).toHaveBeenCalledWith({
      query: "fixture query",
      pageSize: 12,
    });
    expect(getProject).toHaveBeenCalledTimes(2);

    const unsupportedIngest = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos`,
      payload: {
        youtubeVideoId: "legacy-facebook-id",
        canonicalUrl: "https://www.facebook.com/watch/?v=123456789012345",
        sourceIdentity: {
          schemaVersion: 1,
          provider: "facebook",
          providerMediaId: "123456789012345",
          canonicalUrl: "https://www.facebook.com/watch/?v=123456789012345",
        },
        title: "Not product-qualified",
      },
    });
    expect(unsupportedIngest.statusCode).toBe(400);
    expect(unsupportedIngest.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
  });
  it("routes strict project keyword catalog, suggestion, and review commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:keyword-routes",
    };
    const projectId = randomUUID();
    const suggestionId = randomUUID();
    const catalogResponse = {
      projectId,
      keywordSetVersion: 1,
      keywords: [],
      suggestions: [],
    };
    const suggestion = {
      keywordId: randomUUID(),
      language: "es",
      phrase: "Cambio climático",
      idempotencyKey: "suggest-spanish-route",
    };
    const review = {
      action: "reject" as const,
      expectedSuggestionVersion: 1,
      expectedKeywordSetVersion: 1,
      reason: "Needs a more specific phrase",
      idempotencyKey: "reject-spanish-route",
    };
    const withdrawal = {
      expectedSuggestionVersion: 1,
      reason: "No longer needed",
      idempotencyKey: "withdraw-spanish-route",
    };
    const keywordId = randomUUID();
    const aliasId = randomUUID();
    const keywordUpdate = {
      description: "Updated description",
      expectedKeywordVersion: 1,
      expectedKeywordSetVersion: 1,
      idempotencyKey: "update-keyword-route",
    };
    const aliasUpdate = {
      language: "en-US",
      phrase: "Updated phrase",
      expectedAliasVersion: 1,
      expectedKeywordSetVersion: 2,
      idempotencyKey: "update-alias-route",
    };
    const listProjectKeywords = vi.fn(async () => catalogResponse);
    const suggestProjectKeyword = vi.fn(async () => ({
      resolution: "created" as const,
      suggestion: { id: suggestionId },
    }));
    const reviewProjectKeywordSuggestion = vi.fn(async () => ({
      projectId,
      keywordSetVersion: 1,
      suggestion: { id: suggestionId, state: "rejected" },
    }));
    const withdrawProjectKeywordSuggestion = vi.fn(async () => ({
      projectId,
      keywordSetVersion: 1,
      suggestion: { id: suggestionId, state: "withdrawn" },
    }));
    const updateProjectKeyword = vi.fn(async () => ({
      projectId,
      keywordSetVersion: 2,
      keyword: { id: keywordId },
    }));
    const updateProjectKeywordAlias = vi.fn(async () => ({
      projectId,
      keywordSetVersion: 3,
      keyword: { id: keywordId },
      alias: { id: aliasId },
    }));
    const app = createCloudApi({
      catalog: {
        listProjectKeywords,
        suggestProjectKeyword,
        reviewProjectKeywordSuggestion,
        withdrawProjectKeywordSuggestion,
        updateProjectKeyword,
        updateProjectKeywordAlias,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/keywords`,
        })
      ).json(),
    ).toEqual(catalogResponse);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-suggestions`,
          payload: suggestion,
        })
      ).statusCode,
    ).toBe(200);
    expect(suggestProjectKeyword).toHaveBeenCalledWith(
      actor,
      projectId,
      suggestion,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-suggestions/${suggestionId}/review`,
          payload: review,
        })
      ).statusCode,
    ).toBe(200);
    expect(reviewProjectKeywordSuggestion).toHaveBeenCalledWith(
      actor,
      projectId,
      suggestionId,
      review,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-suggestions/${suggestionId}/withdraw`,
          payload: withdrawal,
        })
      ).statusCode,
    ).toBe(200);
    expect(withdrawProjectKeywordSuggestion).toHaveBeenCalledWith(
      actor,
      projectId,
      suggestionId,
      withdrawal,
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/keywords/${keywordId}`,
          payload: keywordUpdate,
        })
      ).statusCode,
    ).toBe(200);
    expect(updateProjectKeyword).toHaveBeenCalledWith(
      actor,
      projectId,
      keywordId,
      keywordUpdate,
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/keywords/${keywordId}/aliases/${aliasId}`,
          payload: aliasUpdate,
        })
      ).statusCode,
    ).toBe(200);
    expect(updateProjectKeywordAlias).toHaveBeenCalledWith(
      actor,
      projectId,
      keywordId,
      aliasId,
      aliasUpdate,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-suggestions`,
          payload: { ...suggestion, proposedLabel: "Not allowed with keyword" },
        })
      ).statusCode,
    ).toBe(400);
    expect(suggestProjectKeyword).toHaveBeenCalledTimes(1);
  });

  it("routes strict project bookmark reads and mutation commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:bookmark-routes",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const bookmarkId = randomUUID();
    const listProjectBookmarks = vi.fn(async () => ({
      projectId,
      items: [],
    }));
    const createProjectBookmark = vi.fn(async () => ({
      bookmark: { id: bookmarkId },
    }));
    const updateProjectBookmark = vi.fn(async () => ({
      bookmark: { id: bookmarkId, version: 2 },
    }));
    const archiveProjectBookmark = vi.fn(async () => ({
      bookmark: { id: bookmarkId, state: "archived" },
    }));
    const restoreProjectBookmark = vi.fn(async () => ({
      bookmark: { id: bookmarkId, state: "active" },
    }));
    const app = createCloudApi({
      catalog: {
        listProjectBookmarks,
        createProjectBookmark,
        updateProjectBookmark,
        archiveProjectBookmark,
        restoreProjectBookmark,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/bookmarks?scope=video&videoId=${videoId}&state=all&limit=25&search=%EF%BC%A3%EF%BD%8C%EF%BD%89%EF%BD%8D%EF%BD%81%EF%BD%94%EF%BD%85`,
        })
      ).statusCode,
    ).toBe(200);
    const createRequest = {
      videoId,
      sourceTimeMs: 0,
      idempotencyKey: "route-create-bookmark",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/bookmarks`,
          payload: createRequest,
        })
      ).statusCode,
    ).toBe(200);
    const updateRequest = {
      title: "Opening claim",
      note: "Searchable evidence",
      expectedVersion: 1,
      idempotencyKey: "route-update-bookmark",
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/bookmarks/${bookmarkId}`,
          payload: updateRequest,
        })
      ).statusCode,
    ).toBe(200);
    for (const action of ["archive", "restore"] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/bookmarks/${bookmarkId}/${action}`,
            payload: {
              expectedVersion: action === "archive" ? 2 : 3,
              idempotencyKey: `route-${action}-bookmark`,
            },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(listProjectBookmarks).toHaveBeenCalledWith(
      actor,
      projectId,
      expect.objectContaining({
        scope: "video",
        videoId,
        state: "all",
        limit: 25,
      }),
    );
    expect(createProjectBookmark).toHaveBeenCalledWith(
      actor,
      projectId,
      createRequest,
    );
    expect(updateProjectBookmark).toHaveBeenCalledWith(
      actor,
      projectId,
      bookmarkId,
      updateRequest,
    );
    expect(archiveProjectBookmark).toHaveBeenCalledTimes(1);
    expect(restoreProjectBookmark).toHaveBeenCalledTimes(1);
  });

  it("routes strict project keyword scan lifecycle and artifact commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:keyword-scan-routes",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const scanId = randomUUID();
    const summary = { projectId, projectVideoId: videoId, status: "queued" };
    const methods = {
      getProjectKeywordScanSummary: vi.fn(async () => summary),
      scheduleProjectKeywordScan: vi.fn(async () => summary),
      claimProjectKeywordScan: vi.fn(async () => ({ scanId })),
      getProjectKeywordScanInput: vi.fn(async () => ({ scanId })),
      heartbeatProjectKeywordScan: vi.fn(async () => ({ scanId })),
      createProjectKeywordScanArtifactUpload: vi.fn(async () => ({ scanId })),
      finalizeProjectKeywordScan: vi.fn(async () => ({
        ...summary,
        status: "current",
      })),
      failProjectKeywordScan: vi.fn(async () => ({
        ...summary,
        status: "failed",
      })),
      getProjectKeywordScanArtifactDownload: vi.fn(async () => ({ scanId })),
    };
    const app = createCloudApi({
      catalog: methods as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/worklist/${videoId}/keyword-scan`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/worklist/${videoId}/keyword-scan`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-scans/claim`,
          payload: { leaseSeconds: 60 },
        })
      ).statusCode,
    ).toBe(200);
    expect(methods.claimProjectKeywordScan).toHaveBeenCalledWith(
      actor,
      projectId,
      {
        leaseSeconds: 60,
      },
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/keyword-scans/claim",
          payload: { leaseSeconds: 60 },
        })
      ).statusCode,
    ).toBe(200);
    expect(methods.claimProjectKeywordScan).toHaveBeenCalledWith(
      actor,
      undefined,
      { leaseSeconds: 60 },
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-scans/${scanId}/input`,
          payload: { attempt: 1 },
        })
      ).statusCode,
    ).toBe(200);
    expect(methods.getProjectKeywordScanInput).toHaveBeenCalledWith(
      actor,
      projectId,
      scanId,
      { attempt: 1 },
    );
    for (const [suffix, payload] of [
      ["heartbeat", { attempt: 1, leaseSeconds: 60 }],
      ["artifact-upload", { attempt: 1 }],
      [
        "finalize",
        {
          attempt: 1,
          artifact: {
            objectKey: `keyword-scans/${projectId}/${videoId}/${scanId}/matches.json`,
            objectVersionId: "version-1",
            sha256: "a".repeat(64),
            sizeBytes: 100,
            schemaVersion: 1,
          },
          occurrenceCount: 0,
          matchedKeywordCount: 0,
          keywordCounts: [],
        },
      ],
      [
        "fail",
        {
          attempt: 1,
          error: { code: "scan_failed", message: "Fixture failure" },
        },
      ],
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/projects/${projectId}/keyword-scans/${scanId}/${suffix}`,
            payload,
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/keyword-scans/${scanId}/artifact-download`,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/keyword-scans/claim`,
          payload: { leaseSeconds: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(methods.claimProjectKeywordScan).toHaveBeenCalledTimes(2);
  });

  it("routes strict project local-processing status and policy commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:local-processing-route",
    };
    const projectId = randomUUID();
    const status = {
      projectId,
      policy: { state: "automatic" as const, version: 1 },
      workload: {
        queuedJobs: 1,
        activeJobs: 0,
        queuedKnownDurationMs: 60_000,
        activeKnownDurationMs: 0,
        queuedUnknownDurationCount: 0,
        activeUnknownDurationCount: 0,
        unprocessedActiveVideoCount: 1,
      },
    };
    const command = {
      state: "paused" as const,
      expectedVersion: 1,
      idempotencyKey: "pause-local-route-v1",
    };
    const updated = {
      ...status,
      policy: { state: "paused" as const, version: 2 },
      enqueuedCount: 0,
      remainingUnprocessedCount: 1,
    };
    const getProjectLocalProcessingStatus = vi.fn(async () => status);
    const updateProjectLocalProcessing = vi.fn(async () => updated);
    const app = createCloudApi({
      catalog: {
        getProjectLocalProcessingStatus,
        updateProjectLocalProcessing,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const read = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/local-processing`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(status);
    expect(getProjectLocalProcessingStatus).toHaveBeenCalledWith(
      actor,
      projectId,
    );
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/local-processing`,
      payload: command,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual(updated);
    expect(updateProjectLocalProcessing).toHaveBeenCalledWith(
      actor,
      projectId,
      command,
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/local-processing`,
          payload: { ...command, state: "overnight" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/projects/not-a-uuid/local-processing",
          payload: command,
        })
      ).statusCode,
    ).toBe(400);
    expect(updateProjectLocalProcessing).toHaveBeenCalledTimes(1);
  });

  it("routes strict hosted transcription approval commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:hosted-approval-route",
    };
    const projectId = randomUUID();
    const batchId = randomUUID();
    const now = "2026-08-24T12:00:00.000Z";
    const command = {
      action: "approve" as const,
      idempotencyKey: "hosted-route-v1",
      expectedVersion: 1,
    };
    const response = {
      projectId,
      batchId,
      approval: {
        state: "approved" as const,
        version: 2,
        decidedBy: {
          userId: actor.userId,
          handle: "hosted_route_admin",
          displayName: "Hosted Route Admin",
        },
        decidedAt: now,
      },
    };
    const updateHostedTranscriptionApproval = vi.fn(async () => response);
    const app = createCloudApi({
      catalog: {
        updateHostedTranscriptionApproval,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const approved = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches/${batchId}/hosted-approval`,
      payload: command,
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual(response);
    expect(updateHostedTranscriptionApproval).toHaveBeenCalledWith(
      actor,
      projectId,
      batchId,
      command,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/transcription-batches/${batchId}/hosted-approval`,
          payload: { ...command, unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/transcription-batches/not-a-uuid/hosted-approval`,
          payload: command,
        })
      ).statusCode,
    ).toBe(400);
    expect(updateHostedTranscriptionApproval).toHaveBeenCalledTimes(1);
  });

  it("routes bounded canonical worklist reads and optimistic own-flag changes", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:worklist-routes",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const now = "2026-08-24T12:00:00.000Z";
    const page = { items: [], total: 0 };
    const priorityResponse = {
      projectId,
      priority: "high" as const,
      items: [
        {
          projectId,
          videoId,
          priority: "high" as const,
          completionPolicy: "researcher_or_administrator" as const,
          projectVideoVersion: 2,
          updatedAt: now,
        },
      ],
    };
    const flagResponse = {
      projectId,
      videoId,
      flag: {
        active: false,
        version: 2,
        createdAt: now,
        updatedAt: now,
        deactivatedAt: now,
      },
    };
    const listProjectVideoWorklist = vi.fn(async () => page);
    const updateOwnProjectVideoFlag = vi.fn(async () => flagResponse);
    const bulkUpdateProjectVideoPriority = vi.fn(async () => priorityResponse);
    const app = createCloudApi({
      catalog: {
        listProjectVideoWorklist,
        updateOwnProjectVideoFlag,
        bulkUpdateProjectVideoPriority,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/worklist?limit=10&view=queue`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual(page);
    expect(listProjectVideoWorklist).toHaveBeenCalledWith(actor, projectId, {
      limit: 10,
      view: "queue",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/worklist?limit=51`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/worklist?unexpected=true`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/worklist?view=archived`,
        })
      ).statusCode,
    ).toBe(400);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/worklist/${videoId}/flag`,
      payload: { active: false, expectedVersion: 1 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual(flagResponse);
    expect(updateOwnProjectVideoFlag).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      { active: false, expectedVersion: 1 },
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/worklist/${videoId}/flag`,
          payload: { active: true, expectedVersion: 2, unexpected: true },
        })
      ).statusCode,
    ).toBe(400);

    const priorityCommand = {
      priority: "high",
      items: [{ videoId, expectedProjectVideoVersion: 1 }],
      idempotencyKey: "bulk-priority-v1",
    };
    const prioritized = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/worklist/priority`,
      payload: priorityCommand,
    });
    expect(prioritized.statusCode).toBe(200);
    expect(prioritized.json()).toEqual(priorityResponse);
    expect(bulkUpdateProjectVideoPriority).toHaveBeenCalledWith(
      actor,
      projectId,
      priorityCommand,
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/worklist/priority`,
          payload: { ...priorityCommand, unexpected: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/worklist/priority`,
          payload: {
            ...priorityCommand,
            items: [priorityCommand.items[0], priorityCommand.items[0]],
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(bulkUpdateProjectVideoPriority).toHaveBeenCalledTimes(1);
  });

  it("routes strict bulk triage and per-user activity commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:triage-activity-routes",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const eventId = randomUUID();
    const now = "2026-08-24T12:00:00.000Z";
    const triageCommand = {
      action: "dismiss" as const,
      idempotencyKey: "dismiss-route-v1",
      items: [{ videoId, expectedProjectVideoVersion: 3 }],
      reason: "Not relevant to this cut.",
    };
    const actorSummary = {
      userId: actor.userId,
      handle: "triage_admin",
      displayName: "Triage Admin",
    };
    const triageResponse = {
      projectId,
      items: [
        {
          videoId,
          projectVideoVersion: 4,
          triage: {
            state: "dismissed" as const,
            version: 2,
            dismissedAt: now,
            dismissedBy: actorSummary,
            reason: triageCommand.reason,
          },
        },
      ],
      cancellation: {
        queuedJobsCanceled: 1,
        activeJobsRequested: 0,
        requestsRevoked: 0,
      },
    };
    const receipt = {
      eventId,
      projectId,
      videoId,
      videoTitle: "Activity fixture",
      eventType: "video_dismissed" as const,
      actor: actorSummary,
      reason: triageCommand.reason,
      state: "unread" as const,
      version: 1,
      createdAt: now,
    };
    const activityPage = { items: [receipt], unreadCount: 1 };
    const seenResponse = {
      projectId,
      items: [{ ...receipt, state: "seen" as const, version: 2, seenAt: now }],
    };
    const updateProjectVideoTriage = vi.fn(async () => triageResponse);
    const listProjectVideoActivity = vi.fn(async () => activityPage);
    const markProjectVideoActivitySeen = vi.fn(async () => seenResponse);
    const app = createCloudApi({
      catalog: {
        updateProjectVideoTriage,
        listProjectVideoActivity,
        markProjectVideoActivitySeen,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const dismissed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/worklist/triage`,
      payload: triageCommand,
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toEqual(triageResponse);
    expect(updateProjectVideoTriage).toHaveBeenCalledWith(
      actor,
      projectId,
      triageCommand,
    );

    const activity = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/activity?state=unread&limit=10&cursor=next`,
    });
    expect(activity.statusCode).toBe(200);
    expect(activity.json()).toEqual(activityPage);
    expect(listProjectVideoActivity).toHaveBeenCalledWith(actor, projectId, {
      state: "unread",
      limit: 10,
      cursor: "next",
    });

    const seenCommand = { items: [{ eventId, expectedVersion: 1 }] };
    const seen = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/activity/seen`,
      payload: seenCommand,
    });
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toEqual(seenResponse);
    expect(markProjectVideoActivitySeen).toHaveBeenCalledWith(
      actor,
      projectId,
      seenCommand,
    );

    for (const request of [
      {
        method: "PATCH" as const,
        url: `/api/projects/${projectId}/worklist/triage`,
        payload: { ...triageCommand, unexpected: true },
      },
      {
        method: "GET" as const,
        url: `/api/projects/${projectId}/activity?state=pending`,
      },
      {
        method: "PATCH" as const,
        url: `/api/projects/${projectId}/activity/seen`,
        payload: { ...seenCommand, unexpected: true },
      },
    ]) {
      expect((await app.inject(request)).statusCode).toBe(400);
    }
  });

  it("returns the worker cancellation heartbeat outcome without renewing a lease", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:canceled-heartbeat-route",
    };
    const jobId = randomUUID();
    const requestedAt = "2026-08-24T12:00:00.000Z";
    const heartbeatTranscriptionJob = vi.fn(async () => ({
      status: "cancellation_requested" as const,
      requestedAt,
    }));
    const app = createCloudApi({
      catalog: {
        heartbeatTranscriptionJob,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/heartbeat`,
      payload: { attempt: 2, leaseSeconds: 120, stage: "transcribing" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "cancellation_requested",
      requestedAt,
    });
    expect(heartbeatTranscriptionJob).toHaveBeenCalledWith(
      actor,
      jobId,
      2,
      120,
      "transcribing",
    );
  });

  it("routes strict claim, governance, and review-cycle commands", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:review-coordination-routes",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const cycleId = randomUUID();
    const now = "2026-08-24T12:00:00.000Z";
    const claimResponse = {
      projectId,
      videoId,
      claim: {
        claimant: {
          userId: actor.userId,
          handle: "review_coordinator",
          displayName: "Review Coordinator",
        },
        isCurrentUser: true,
        active: true,
        generation: 1,
        version: 1,
        claimedAt: now,
        heartbeatAt: now,
        expiresAt: "2026-08-24T12:05:00.000Z",
      },
    };
    const governanceResponse = {
      projectId,
      videoId,
      priority: "high",
      completionPolicy: "administrator_only",
      projectVideoVersion: 2,
      updatedAt: now,
    };
    const reviewResponse = {
      projectId,
      videoId,
      review: {
        id: cycleId,
        cycleNumber: 1,
        status: "completed",
        version: 2,
        openedAt: now,
        completionPolicy: "administrator_only",
        completedAt: now,
        completedBy: {
          userId: actor.userId,
          handle: "review_coordinator",
          displayName: "Review Coordinator",
        },
        completionBasis: "without_ready_transcript_acknowledged",
      },
    };
    const updateProjectVideoClaim = vi.fn(async () => claimResponse);
    const updateProjectVideoGovernance = vi.fn(async () => governanceResponse);
    const updateProjectVideoReview = vi.fn(async () => reviewResponse);
    const app = createCloudApi({
      catalog: {
        updateProjectVideoClaim,
        updateProjectVideoGovernance,
        updateProjectVideoReview,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    const claim = {
      action: "claim",
      idempotencyKey: "route-claim",
      expectedClaimVersion: 0,
      leaseSeconds: 300,
      takeoverConfirmed: false,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/worklist/${videoId}/claim`,
          payload: claim,
        })
      ).json(),
    ).toEqual(claimResponse);
    expect(updateProjectVideoClaim).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      claim,
    );

    const governance = {
      idempotencyKey: "route-governance",
      expectedProjectVideoVersion: 1,
      priority: "high",
      completionPolicy: "administrator_only",
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/worklist/${videoId}/governance`,
          payload: governance,
        })
      ).json(),
    ).toEqual(governanceResponse);
    expect(updateProjectVideoGovernance).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      governance,
    );

    const review = {
      action: "complete",
      idempotencyKey: "route-review",
      expectedCycleId: cycleId,
      expectedCycleVersion: 1,
      acknowledgeTranscriptUnavailable: true,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/worklist/${videoId}/review`,
          payload: review,
        })
      ).json(),
    ).toEqual(reviewResponse);
    expect(updateProjectVideoReview).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      review,
    );

    for (const [path, payload] of [
      ["claim", { ...claim, unexpected: true }],
      ["governance", { ...governance, unexpected: true }],
      ["review", { ...review, unexpected: true }],
    ] as const) {
      expect(
        (
          await app.inject({
            method: path === "governance" ? "PATCH" : "POST",
            url: `/api/projects/${projectId}/worklist/${videoId}/${path}`,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
  });

  it("routes strict timed transcript import commands through the project-video boundary", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:manual-importer",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const importId = randomUUID();
    const batchItemId = randomUUID();
    const decisionId = randomUUID();
    const candidateId = randomUUID();
    const transcriptVersionId = randomUUID();
    const originalKey = "private-original";
    const englishKey = "private-english";
    const grant = {
      importId,
      projectId,
      catalogVideoId: videoId,
      batchItemId,
      sourceLanguage: "dz",
      languageDecisionId: decisionId,
      languageDecisionVersion: 1,
      expiresAt: "2026-08-24T00:15:00.000Z",
      targets: [
        {
          role: "original" as const,
          format: "srt" as const,
          objectKey: originalKey,
          uploadUrl: "memory://original",
        },
        {
          role: "english" as const,
          format: "vtt" as const,
          objectKey: englishKey,
          uploadUrl: "memory://english",
        },
      ],
    };
    const status = {
      importId,
      projectId,
      catalogVideoId: videoId,
      batchItemId,
      state: "staged" as const,
      version: 1,
      sourceLanguage: "dz",
      targetLanguage: "en" as const,
      languageDecisionId: decisionId,
      languageDecisionVersion: 1,
      createdAt: "2026-08-24T00:00:00.000Z",
      expiresAt: "2026-08-24T00:15:00.000Z",
    };
    const createManualTimedTranscriptImport = vi.fn(async () => grant);
    const finalizeManualTimedTranscriptImport = vi.fn(async () => status);
    const getManualTimedTranscriptImportForBatchItem = vi.fn(
      async () => status,
    );
    const reviewManualTimedTranscriptCandidate = vi.fn(async () => ({
      candidateId,
    }));
    const activateManualTimedTranscriptCandidate = vi.fn(async () => ({
      candidateId,
      state: "activated",
    }));
    const app = createCloudApi({
      catalog: {
        createManualTimedTranscriptImport,
        finalizeManualTimedTranscriptImport,
        getManualTimedTranscriptImportForBatchItem,
        reviewManualTimedTranscriptCandidate,
        activateManualTimedTranscriptCandidate,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);
    const create = {
      idempotencyKey: "manual-import-v1",
      languageDecisionId: decisionId,
      expectedDecisionVersion: 1,
      batchItemId,
      expectedBatchItemVersion: 1,
      original: { format: "srt", byteSize: 12, sha256: "a".repeat(64) },
      english: { format: "vtt", byteSize: 18, sha256: "b".repeat(64) },
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-imports`,
          payload: create,
        })
      ).statusCode,
    ).toBe(201);
    expect(createManualTimedTranscriptImport).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      create,
    );
    const finalize = {
      idempotencyKey: "manual-finalize-v1",
      original: { objectVersionId: "v1", byteSize: 12, sha256: "a".repeat(64) },
      english: { objectVersionId: "v2", byteSize: 18, sha256: "b".repeat(64) },
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-imports/${importId}/finalize`,
          payload: finalize,
        })
      ).statusCode,
    ).toBe(200);
    expect(finalizeManualTimedTranscriptImport).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      importId,
      finalize,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-imports?batchItemId=${batchItemId}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(getManualTimedTranscriptImportForBatchItem).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      batchItemId,
    );
    const reviewUrl = `/api/projects/${projectId}/videos/${videoId}/timed-transcript-candidates/${candidateId}/review`;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${reviewUrl}?offset=25&limit=50`,
        })
      ).statusCode,
    ).toBe(200);
    expect(reviewManualTimedTranscriptCandidate).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      candidateId,
      { offset: 25, limit: 50 },
    );
    expect(
      (await app.inject({ method: "GET", url: `${reviewUrl}?limit=101` }))
        .statusCode,
    ).toBe(400);
    const activation = {
      idempotencyKey: "activate-manual-v1",
      importId,
      candidateId,
      transcriptVersionId,
      expectedProjectVideoVersion: 3,
      languageDecisionId: decisionId,
      expectedLanguageDecisionVersion: 1,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-candidates/${candidateId}/activate`,
          payload: activation,
        })
      ).statusCode,
    ).toBe(200);
    expect(activateManualTimedTranscriptCandidate).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      activation,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-candidates/${randomUUID()}/activate`,
          payload: activation,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/timed-transcript-imports`,
          payload: {
            ...create,
            original: { ...create.original, localPath: "/private" },
          },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("routes bounded project-video language commands without accepting raw evidence", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:language-owner",
    };
    const projectId = randomUUID();
    const videoId = randomUUID();
    const jobId = randomUUID();
    const decisionId = randomUUID();
    const evidenceId = randomUUID();
    const gate = {
      state: "ready" as const,
      status: "confirmed" as const,
      decision: {
        id: decisionId,
        projectId,
        videoId,
        decisionVersion: 1,
        status: "confirmed" as const,
        basis: "user_confirmation" as const,
        resolvedLanguage: "dz",
        actorId: actor.userId,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      remediationReason: "none" as const,
    };
    const getProjectVideoLanguageGate = vi.fn(async () => gate);
    const confirmProjectVideoLanguageDecision = vi.fn(async () => ({
      decision: gate.decision,
      gate,
    }));
    const observeWorkerLanguageEvidence = vi.fn(async () => ({
      evidence: {
        id: evidenceId,
        projectId,
        videoId,
        source: "caption" as const,
        provider: "youtube",
        reportedLanguage: "ko",
        captionKind: "automatic" as const,
        jobId,
        attempt: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
      gate,
    }));
    const app = createCloudApi({
      catalog: {
        getProjectVideoLanguageGate,
        confirmProjectVideoLanguageDecision,
        observeWorkerLanguageEvidence,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/videos/${videoId}/language-gate`,
        })
      ).statusCode,
    ).toBe(200);
    const command = {
      idempotencyKey: "confirm-dz-v1",
      expectedDecisionVersion: 0,
      resolvedLanguage: "dz",
      basis: "user_confirmation",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${videoId}/language-decisions`,
          payload: command,
        })
      ).statusCode,
    ).toBe(200);
    expect(confirmProjectVideoLanguageDecision).toHaveBeenCalledWith(
      actor,
      projectId,
      videoId,
      command,
    );

    const observation = {
      attempt: 1,
      evidence: {
        id: evidenceId,
        projectId,
        videoId,
        source: "caption",
        provider: "youtube",
        reportedLanguage: "ko",
        captionKind: "automatic",
        jobId,
        attempt: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
      },
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/language-evidence`,
          payload: observation,
        })
      ).statusCode,
    ).toBe(200);
    expect(observeWorkerLanguageEvidence).toHaveBeenCalledWith(
      actor,
      jobId,
      observation,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/language-evidence`,
          payload: {
            ...observation,
            evidence: { ...observation.evidence, rawTrackUrl: "private://x" },
          },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("reports a contract-valid health response", async () => {
    const app = createCloudApi();
    apps.add(app);
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(response.json()).service).toBe(
      "cloud-api",
    );
  });

  it("validates a runtime caller without exposing session identity", async () => {
    const authenticate = vi.fn(async () => ({
      userId: randomUUID(),
      externalSubject: "fixture:runtime",
    }));
    const app = createCloudApi({
      catalog: {} as SharedProjectCatalog,
      authenticate,
    });
    apps.add(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { authorization: "Bearer validated" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("routes strict Clip Library re-export commands to the exact artifact version", async () => {
    const projectId = randomUUID();
    const clipId = randomUUID();
    const artifactVersionId = randomUUID();
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:artifact-researcher",
    };
    const reexportArtifactVersion = vi.fn(async () => ({ id: randomUUID() }));
    const resolveArtifactVersionCompatibility = vi.fn(async () => ({
      state: "incompatible" as const,
      artifactVersionId,
    }));
    const app = createCloudApi({
      catalog: {
        reexportArtifactVersion,
        resolveArtifactVersionCompatibility,
      } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });
    apps.add(app);
    const command = {
      idempotencyKey: "reexport-v1",
      sourceLanguageClass: "confirmed_english",
      settingsSelection: { base: "application_default", overrides: {} },
      expectedResolutionFingerprint: "a".repeat(64),
      sourceRights: sourceRightsForVideo("M7lc1UVf-VE"),
    };
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}/reexport`,
      payload: command,
    });
    expect(response.statusCode).toBe(201);
    expect(reexportArtifactVersion).toHaveBeenCalledWith(
      actor,
      projectId,
      clipId,
      artifactVersionId,
      { ...command, requestOrigin: "clip_library" },
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}/reexport`,
          payload: { ...command, requestOrigin: "authoring_build" },
        })
      ).statusCode,
    ).toBe(201);
    expect(reexportArtifactVersion).toHaveBeenLastCalledWith(
      actor,
      projectId,
      clipId,
      artifactVersionId,
      { ...command, requestOrigin: "authoring_build" },
    );

    const requirements = {
      clipId,
      selection: {
        trackId: randomUUID(),
        transcriptVersion: 1,
        firstSegmentId: randomUUID(),
        lastSegmentId: randomUUID(),
        transcriptStartMs: 1_000,
        transcriptEndMs: 2_000,
        exportStartMs: 1_000,
        exportEndMs: 2_000,
        timingPrecision: "word",
      },
      resolvedBounds: { startMs: 1_000, endMs: 2_000 },
      sourceLanguageClass: "confirmed_english",
      subtitlePolicy: { requiredSidecars: ["english"] },
      requiredArtifactRoles: [
        "video_mp4",
        "clip_metadata_json",
        "thumbnail_jpg",
        "manifest_json",
      ],
      acceptedManifestSchemas: [2],
      settings: {
        mode: "exact_fingerprint",
        resolutionFingerprint: "a".repeat(64),
      },
    };
    const compatibility = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${clipId}/artifact-versions/${artifactVersionId}/compatibility`,
      payload: { requirements },
    });
    expect(compatibility.statusCode).toBe(200);
    expect(compatibility.json()).toEqual({
      state: "incompatible",
      artifactVersionId,
    });
    expect(resolveArtifactVersionCompatibility).toHaveBeenCalledWith(
      actor,
      projectId,
      clipId,
      artifactVersionId,
      requirements,
    );
  });

  it("authenticates a user and exposes only their project catalog", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:api-user`;

    expect(
      (await app.inject({ method: "GET", url: "/api/projects" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/register",
          headers: { authorization },
          payload: { displayName: "API User" },
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Shared research" },
    });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([{ name: "Shared research" }]);
  });

  it("enforces strict handle, project-authority, summary, and member routes", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const identities = Object.fromEntries(
      ["owner", "administrator", "researcher", "second-administrator"].map(
        (name) => {
          const id = randomUUID();
          return [
            name,
            {
              id,
              authorization: `Bearer ${id}|fixture:authority-api:${name}`,
            },
          ];
        },
      ),
    ) as Record<string, { id: string; authorization: string }>;
    const owner = identities.owner!;

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/register",
          headers: { authorization: owner.authorization },
          payload: { displayName: "Owner", handle: "@Authority_Owner" },
        })
      ).json(),
    ).toMatchObject({ handle: "authority_owner", displayName: "Owner" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/register",
          headers: {
            authorization: identities.administrator!.authorization,
          },
          payload: {
            displayName: "Collision",
            handle: "AUTHORITY_OWNER",
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session/register",
          headers: { authorization: identities.researcher!.authorization },
          payload: { displayName: "Invalid", handle: "not-valid-handle" },
        })
      ).statusCode,
    ).toBe(400);
    for (const [name, identity] of Object.entries(identities).filter(
      ([name]) => name !== "owner",
    )) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/register",
            headers: { authorization: identity.authorization },
            payload: {
              displayName: name,
              handle: `api_${name.replaceAll("-", "_")}`,
            },
          })
        ).statusCode,
      ).toBe(200);
    }

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: { authorization: owner.authorization },
          payload: {
            name: "Invalid personal",
            kind: "personal",
            visibility: "open_to_join",
          },
        })
      ).statusCode,
    ).toBe(400);
    const personalResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization: owner.authorization },
      payload: { name: "Personal authority", kind: "personal" },
    });
    expect(personalResponse.statusCode).toBe(201);
    expect(personalResponse.json()).toMatchObject({
      kind: "personal",
      visibility: "private",
    });
    const sharedResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization: owner.authorization },
      payload: {
        name: "Shared authority",
        kind: "shared",
        visibility: "invitation_only",
      },
    });
    expect(sharedResponse.statusCode).toBe(201);
    const sharedProjectId = sharedResponse.json<{ id: string }>().id;

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${sharedProjectId}/members`,
          headers: { authorization: owner.authorization },
          payload: { userId: identities.researcher!.id, role: "viewer" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${personalResponse.json<{ id: string }>().id}/members`,
          headers: { authorization: owner.authorization },
          payload: {
            userId: identities.researcher!.id,
            role: "researcher",
          },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${sharedProjectId}/members`,
          headers: { authorization: owner.authorization },
          payload: {
            userId: identities.administrator!.id,
            role: "administrator",
          },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${sharedProjectId}/members`,
          headers: { authorization: identities.administrator!.authorization },
          payload: {
            userId: identities.researcher!.id,
            role: "researcher",
          },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${sharedProjectId}/members`,
          headers: { authorization: identities.administrator!.authorization },
          payload: {
            userId: identities["second-administrator"]!.id,
            role: "administrator",
          },
        })
      ).statusCode,
    ).toBe(403);

    const ownerProjects = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: { authorization: owner.authorization },
    });
    expect(ownerProjects.statusCode).toBe(200);
    expect(ownerProjects.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sharedProjectId,
          kind: "shared",
          visibility: "invitation_only",
          currentUserRole: "owner",
          memberCount: 3,
        }),
      ]),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/projects",
          headers: { authorization: identities.researcher!.authorization },
        })
      ).json(),
    ).toEqual([
      expect.objectContaining({
        id: sharedProjectId,
        currentUserRole: "researcher",
        memberCount: 3,
      }),
    ]);
  });

  it("serves self-only personal and authorized project preset catalogs through strict routes", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const outsiderId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:preset-api`;
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:preset-outsider`;
    for (const [header, displayName] of [
      [authorization, "Preset API User"],
      [outsiderAuthorization, "Preset Outsider"],
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/register",
            headers: { authorization: header },
            payload: { displayName },
          })
        ).statusCode,
      ).toBe(200);
    }
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Preset API Project" },
    });
    const projectId = project.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-presets",
          headers: { authorization },
          payload: {
            idempotencyKey: "personal-create",
            name: "Personal Editing",
            description: "Personal catalog entry",
            settings: presetSettings,
            userId: outsiderId,
          },
        })
      ).statusCode,
    ).toBe(400);
    const personal = await app.inject({
      method: "POST",
      url: "/api/export-presets",
      headers: { authorization },
      payload: {
        idempotencyKey: "personal-create",
        name: "Personal Editing",
        description: "Personal catalog entry",
        settings: presetSettings,
      },
    });
    expect(personal.statusCode).toBe(201);
    const personalId = personal.json<{ id: string }>().id;
    const revised = await app.inject({
      method: "PATCH",
      url: "/api/export-presets",
      headers: { authorization },
      payload: {
        idempotencyKey: "personal-revise",
        presetId: personalId,
        expectedEntityVersion: 1,
        name: "Personal Editing",
        description: "Revision two",
        settings: { ...presetSettings, maxWidth: 1_280 },
      },
    });
    expect(revised.json()).toMatchObject({
      currentVersion: 2,
      entityVersion: 2,
    });
    const personalDefault = await app.inject({
      method: "PUT",
      url: "/api/export-presets/default",
      headers: { authorization },
      payload: {
        idempotencyKey: "personal-default",
        expectedEntityVersion: 0,
        presetId: personalId,
        presetVersion: 1,
      },
    });
    expect(personalDefault.json()).toMatchObject({
      default: { presetVersion: 1, snapshot: { name: "Personal Editing" } },
    });
    const projectPreset = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-presets`,
      headers: { authorization },
      payload: {
        idempotencyKey: "project-create",
        name: "Project Editing",
        description: "Shared catalog entry",
        settings: presetSettings,
      },
    });
    expect(projectPreset.statusCode).toBe(201);
    const projectPresetId = projectPreset.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/projects/${projectId}/export-presets/default`,
          headers: { authorization },
          payload: {
            idempotencyKey: "project-default",
            expectedEntityVersion: 0,
            presetId: projectPresetId,
            presetVersion: 1,
          },
        })
      ).statusCode,
    ).toBe(200);
    const discovered = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/export-presets`,
      headers: { authorization },
    });
    expect(discovered.json()).toMatchObject({
      projectPresets: [{ current: { name: "Project Editing" } }],
      projectDefault: { snapshot: { name: "Project Editing" } },
      personalPresets: [{ currentVersion: 2 }],
      personalDefault: { presetVersion: 1 },
    });
    const preview = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-settings/preview`,
      headers: { authorization },
      payload: {
        sourceLanguageClass: "foreign",
        selection: {
          base: "context_default",
          selectedPreset: {
            scope: "personal",
            presetId: personalId,
            presetVersion: 1,
          },
          overrides: {
            maxWidth: null,
            audioKilobitsPerSecond: null,
            omitSubtitleFilesForConfirmedEnglish: true,
          },
        },
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      snapshot: {
        contextDefault: { presetId: projectPresetId, presetVersion: 1 },
        selectedPreset: { presetId: personalId, presetVersion: 1 },
        selectedPresetScope: "personal",
        settings: { omitSubtitleFilesForConfirmedEnglish: true },
      },
      issues: [],
      effectiveSubtitlePolicy: {
        requiredSidecars: ["original", "english"],
      },
    });
    expect(preview.json().snapshot.settings).not.toHaveProperty("maxWidth");
    expect(preview.json().snapshot.resolutionFingerprint).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/export-presets`,
          headers: { authorization: outsiderAuthorization },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("atomically logs an idempotent tagged clip without creating an export job", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:clip-owner`;
    const collaboratorId = randomUUID();
    const collaboratorAuthorization = `Bearer ${collaboratorId}|fixture:clip-collaborator`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Clip Owner" },
    });
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: collaboratorAuthorization },
      payload: { displayName: "Clip Collaborator" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Clip research" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;
    await catalog.addMember(
      { userId, externalSubject: "fixture:clip-owner" },
      projectId,
      collaboratorId,
      "researcher",
    );
    const selectionTrackId = randomUUID();
    const payload = {
      idempotencyKey: "queue:fixture-selection-1",
      video: {
        youtubeVideoId: "M7lc1UVf-VE",
        canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        title: "IFrame API demo",
      },
      selection: {
        trackId: selectionTrackId,
        transcriptVersion: 1,
        firstSegmentId: randomUUID(),
        lastSegmentId: randomUUID(),
        firstTokenId: randomUUID(),
        lastTokenId: randomUUID(),
        transcriptStartMs: 300,
        transcriptEndMs: 2_900,
        exportStartMs: 0,
        exportEndMs: 3_400,
        text: "A useful selected passage",
        timingPrecision: "word",
      },
      languageEvidence: {
        schemaVersion: 2,
        native: {
          role: "native",
          language: "en",
          text: "A useful selected passage",
          trackId: selectionTrackId,
          trackVersion: 1,
          timingPrecision: "word",
        },
        english: {
          role: "english",
          language: "en",
          text: "A useful selected passage",
          trackId: selectionTrackId,
          trackVersion: 1,
          timingPrecision: "word",
        },
      },
      notes: "Use this to establish the central argument.",
      tags: ["Person: Ada", "person: ada", "Opening"],
      firstComment: {
        body: "Confirm the attribution before handoff.",
        sourceTimeMs: 1_200,
      },
    };

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      projectId,
      notes: "Use this to establish the central argument.",
      tags: ["Opening", "Person: Ada"],
      researchStatus: "candidate",
      exportStatus: "not_requested",
      firstComment: {
        status: "active",
        body: "Confirm the attribution before handoff.",
        sourceTimeMs: 1_200,
        version: 1,
      },
    });

    const retried = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload,
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json<{ id: string }>().id).toBe(
      created.json<{ id: string }>().id,
    );
    expect(retried.json()).toMatchObject({
      video: { title: payload.video.title },
      notes: payload.notes,
      firstComment: { body: payload.firstComment.body },
    });

    const divergentRetry = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        ...payload,
        notes: "A divergent retry must conflict.",
      },
    });
    expect(divergentRetry.statusCode).toBe(409);
    expect(divergentRetry.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });

    const commentClipId = created.json<{ id: string }>().id;
    const firstCommentId = created.json<{ firstComment: { id: string } }>()
      .firstComment.id;
    const clipVersion = created.json<{ version: number }>().version;

    const unfollowed = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/clips/${commentClipId}/follow`,
      headers: { authorization },
      payload: {
        idempotencyKey: "clip-owner-unfollow",
        following: false,
      },
    });
    expect(unfollowed.statusCode).toBe(200);
    expect(unfollowed.json()).toMatchObject({ following: false });
    const refollowed = await app.inject({
      method: "PUT",
      url: `/api/projects/${projectId}/clips/${commentClipId}/follow`,
      headers: { authorization },
      payload: {
        idempotencyKey: "clip-owner-refollow",
        following: true,
      },
    });
    expect(refollowed.json()).toMatchObject({ following: true });

    const collaboratorComment = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments`,
      headers: { authorization: collaboratorAuthorization },
      payload: {
        idempotencyKey: "comment:collaborator:1",
        body: "A collaborator adds route-level notice evidence.",
        sourceTimeMs: 1_500,
      },
    });
    expect(collaboratorComment.statusCode).toBe(201);
    const collaboratorCommentId = collaboratorComment.json<{ id: string }>().id;

    const notices = await app.inject({
      method: "GET",
      url: "/api/activity/clip-comments",
      headers: { authorization },
    });
    expect(notices.statusCode).toBe(200);
    expect(notices.json()).toMatchObject({
      unreadCount: 1,
      notices: [
        {
          commentId: collaboratorCommentId,
          reason: "followed_comment",
          state: "unread",
        },
      ],
    });
    const notice = notices.json<{
      notices: Array<{ id: string; version: number }>;
    }>().notices[0]!;
    const seenNotice = await app.inject({
      method: "PATCH",
      url: `/api/activity/clip-comments/${notice.id}/seen`,
      headers: { authorization },
      payload: { expectedVersion: notice.version },
    });
    expect(seenNotice.statusCode).toBe(200);
    expect(seenNotice.json()).toMatchObject({ state: "seen", version: 2 });

    const authoringClips = await app.inject({
      method: "GET",
      url: `/api/authoring/projects/${projectId}/clips?topics=Opening&topicMatch=all&limit=25&completed=any`,
      headers: { authorization },
    });
    expect(authoringClips.statusCode).toBe(200);
    expect(authoringClips.json()).toMatchObject({
      entries: [
        {
          clip: { id: commentClipId, tags: ["Opening", "Person: Ada"] },
        },
      ],
    });
    const authoringComments = await app.inject({
      method: "GET",
      url: `/api/authoring/projects/${projectId}/clips/${commentClipId}/comments?limit=50`,
      headers: { authorization },
    });
    expect(authoringComments.statusCode).toBe(200);
    expect(authoringComments.json()).toMatchObject({
      comments: expect.arrayContaining([
        expect.objectContaining({ id: firstCommentId }),
        expect.objectContaining({ id: collaboratorCommentId }),
      ]),
    });
    const snapshot = await app.inject({
      method: "POST",
      url: `/api/authoring/projects/${projectId}/build-snapshots`,
      headers: { authorization },
      payload: {
        idempotencyKey: "route-authoring-snapshot",
        clips: [
          {
            clipId: commentClipId,
            expectedClipVersion: clipVersion,
            promotedComments: [
              { commentId: firstCommentId, expectedVersion: 1 },
            ],
          },
        ],
      },
    });
    expect(snapshot.statusCode).toBe(201);
    expect(snapshot.json()).toMatchObject({
      projectId,
      clips: [
        {
          clipId: commentClipId,
          clipVersion,
          topics: ["Opening", "Person: Ada"],
          promotedComments: [{ commentId: firstCommentId, version: 1 }],
        },
      ],
    });
    const commentsCsv = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clip-comments.csv`,
      headers: { authorization },
    });
    expect(commentsCsv.statusCode).toBe(200);
    expect(commentsCsv.headers["content-type"]).toContain("text/csv");
    expect(commentsCsv.body).toContain(collaboratorCommentId);

    const createdComment = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments`,
      headers: { authorization },
      payload: {
        idempotencyKey: "comment:create:1",
        body: "Second chronological contribution",
        sourceTimeMs: 2_000,
      },
    });
    expect(createdComment.statusCode).toBe(201);
    expect(createdComment.json()).toMatchObject({
      projectId,
      clipId: commentClipId,
      status: "active",
      body: "Second chronological contribution",
      sourceTimeMs: 2_000,
      version: 1,
    });
    const commentId = createdComment.json<{ id: string }>().id;

    const firstPage = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments?limit=1`,
      headers: { authorization },
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      projectId,
      clipId: commentClipId,
      comments: [{ body: payload.firstComment.body }],
    });
    const cursor = firstPage.json<{ nextCursor: string }>().nextCursor;
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments?limit=1&cursor=${cursor}`,
      headers: { authorization },
    });
    expect(secondPage.json()).toMatchObject({
      comments: [
        {
          id: collaboratorCommentId,
          body: "A collaborator adds route-level notice evidence.",
        },
      ],
    });
    const thirdPage = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments?limit=1&cursor=${secondPage.json<{ nextCursor: string }>().nextCursor}`,
      headers: { authorization },
    });
    expect(thirdPage.json()).toMatchObject({
      comments: [{ id: commentId, body: "Second chronological contribution" }],
    });

    const updatedComment = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments/${commentId}`,
      headers: { authorization },
      payload: {
        idempotencyKey: "comment:update:1",
        expectedVersion: 1,
        body: "Revised contribution",
        sourceTimeMs: null,
      },
    });
    expect(updatedComment.json()).toMatchObject({
      body: "Revised contribution",
      version: 2,
    });
    expect(updatedComment.json()).not.toHaveProperty("sourceTimeMs");

    const deletedComment = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments/${commentId}`,
      headers: { authorization },
      payload: {
        idempotencyKey: "comment:delete:1",
        expectedVersion: 2,
      },
    });
    expect(deletedComment.json()).toMatchObject({
      id: commentId,
      status: "deleted",
      deletionKind: "author",
      version: 3,
    });
    expect(deletedComment.json()).not.toHaveProperty("body");
    const csvAfterDeletion = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clip-comments.csv`,
      headers: { authorization },
    });
    expect(csvAfterDeletion.body).toContain(commentId);
    expect(csvAfterDeletion.body).not.toContain("Revised contribution");

    const moderationTarget = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments`,
      headers: { authorization },
      payload: {
        idempotencyKey: "comment:create:moderation-target",
        body: "Moderation target",
      },
    });
    const moderationTargetId = moderationTarget.json<{ id: string }>().id;
    const moderatedComment = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${commentClipId}/comments/${moderationTargetId}/moderate`,
      headers: { authorization },
      payload: {
        idempotencyKey: "comment:moderate:1",
        expectedVersion: 1,
      },
    });
    expect(moderatedComment.statusCode).toBe(200);
    expect(moderatedComment.json()).toMatchObject({
      id: moderationTargetId,
      status: "deleted",
      deletionKind: "moderation",
      version: 2,
    });
    expect(moderatedComment.json()).not.toHaveProperty("body");

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
    });
    expect(listed.json()).toHaveLength(1);
    const jobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE project_id = $1",
      [projectId],
    );
    const events = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sync_events WHERE project_id = $1 AND event_type = 'clip_candidate.created'",
      [projectId],
    );
    expect(jobs.rows[0]?.count).toBe("0");
    expect(events.rows[0]?.count).toBe("1");

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}`,
      headers: { authorization },
      payload: {
        expectedVersion: 1,
        notes: "Use this as the revised opening.",
        tags: ["Opening", "Theme: Institutions"],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      notes: "Use this as the revised opening.",
      tags: ["Opening", "Theme: Institutions"],
      version: 2,
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clip-tags`,
          headers: { authorization },
        })
      ).json(),
    ).toEqual(["Opening", "Person: Ada", "Theme: Institutions"]);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}`,
          headers: { authorization },
          payload: {
            expectedVersion: 1,
            notes: "Stale edit",
            tags: [],
          },
        })
      ).statusCode,
    ).toBe(409);
    const csv = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips.csv`,
      headers: { authorization },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain(
      `project-clips-${projectId}.csv`,
    );
    expect(csv.body).toContain(
      '"project_id","project_name","clip_id","research_status"',
    );
    expect(csv.body).toContain(`"${projectId}","Clip research"`);
    expect(csv.body).toContain('"Opening | Theme: Institutions"');

    const exportPayload = {
      idempotencyKey: "fixture-logged-export",
      sourceLanguageClass: "confirmed_english",
      sourceRights: sourceRightsForVideo(payload.video.youtubeVideoId),
      preset: {
        presetVersion: 1,
        name: "Editing MP4",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          videoRateControl: { mode: "crf", value: 20 },
          maxWidth: 1_920,
          frameRate: "source",
          audioCodec: "aac",
          audioKilobitsPerSecond: 192,
          omitSubtitleFilesForConfirmedEnglish: false,
          embedEnglishSubtitleTrack: false,
        },
      },
    };
    const exported = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: exportPayload,
    });
    expect(exported.statusCode).toBe(201);
    expect(exported.json()).toMatchObject({
      mode: "logged",
      projectId,
      clipId: created.json<{ id: string }>().id,
      state: "queued",
      preset: { name: "Editing MP4", presetVersion: 1 },
    });
    const exportRetry = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: {
        ...exportPayload,
        preset: { ...exportPayload.preset, name: "Changed retry" },
      },
    });
    expect(exportRetry.statusCode).toBe(409);
    expect(exportRetry.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    const queuedJobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE project_id = $1 AND kind = 'export' AND state = 'queued'",
      [projectId],
    );
    expect(queuedJobs.rows[0]?.count).toBe("1");
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clips`,
          headers: { authorization },
        })
      ).json(),
    ).toMatchObject([{ exportStatus: "queued", version: 3 }]);

    const clipId = created.json<{ id: string }>().id;
    const settingsPreview = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-settings/preview`,
      headers: { authorization },
      payload: {
        sourceLanguageClass: "confirmed_english",
        selection: { base: "application_default", overrides: {} },
      },
    });
    expect(settingsPreview.statusCode).toBe(200);
    const expectedResolutionFingerprint = settingsPreview.json<{
      snapshot: { resolutionFingerprint: string };
    }>().snapshot.resolutionFingerprint;
    const catalogExport = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${clipId}/exports`,
      headers: { authorization },
      payload: {
        idempotencyKey: "catalog-resolved-export",
        sourceLanguageClass: "confirmed_english",
        sourceRights: sourceRightsForVideo(payload.video.youtubeVideoId),
        settingsSelection: { base: "application_default", overrides: {} },
        expectedResolutionFingerprint,
      },
    });
    expect(catalogExport.statusCode).toBe(201);
    expect(catalogExport.json()).toMatchObject({
      resolvedSettingsSnapshot: {
        resolutionKind: "catalog",
        settings: {
          container: "mp4",
          videoCodec: "h264",
          frameRate: "source",
          omitSubtitleFilesForConfirmedEnglish: false,
        },
        resolutionFingerprint: expectedResolutionFingerprint,
      },
    });
    const stored = await database.query<{
      request_snapshot: Record<string, unknown>;
      job_snapshot: Record<string, unknown>;
    }>(
      `SELECT er.resolved_settings_snapshot AS request_snapshot,
              j.payload->'resolvedSettingsSnapshot' AS job_snapshot
       FROM export_requests er JOIN jobs j ON j.id = er.job_id
       WHERE er.id = $1`,
      [catalogExport.json<{ id: string }>().id],
    );
    expect(stored.rows[0]!.job_snapshot).toEqual(
      stored.rows[0]!.request_snapshot,
    );
    const catalogReplay = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${clipId}/exports`,
      headers: { authorization },
      payload: {
        idempotencyKey: "catalog-resolved-export",
        sourceLanguageClass: "confirmed_english",
        sourceRights: sourceRightsForVideo(payload.video.youtubeVideoId),
        settingsSelection: {
          base: "context_default",
          selectedPreset: {
            scope: "project",
            presetId: randomUUID(),
            presetVersion: 99,
          },
          overrides: {},
        },
        expectedResolutionFingerprint: "f".repeat(64),
      },
    });
    expect(catalogReplay.statusCode).toBe(409);
    expect(catalogReplay.json()).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/clips/${clipId}/exports`,
          headers: { authorization },
          payload: {
            idempotencyKey: "stale-catalog-export",
            sourceLanguageClass: "confirmed_english",
            sourceRights: sourceRightsForVideo(payload.video.youtubeVideoId),
            settingsSelection: {
              base: "application_default",
              overrides: {},
            },
            expectedResolutionFingerprint: "0".repeat(64),
          },
        })
      ).statusCode,
    ).toBe(409);
    await database.query(
      "DELETE FROM clip_language_evidence WHERE clip_id = $1",
      [clipId],
    );
    await database.query(
      `UPDATE clip_candidates
       SET language_evidence_schema_version = 1, selection_text = NULL
       WHERE id = $1`,
      [clipId],
    );
    const legacyRead = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${clipId}`,
      headers: { authorization },
    });
    expect(legacyRead.statusCode).toBe(200);
    expect(legacyRead.json()).toMatchObject({
      languageEvidence: {
        schemaVersion: 1,
        englishText: "A useful selected passage",
      },
    });
    expect(legacyRead.json().languageEvidence).not.toHaveProperty("preferred");

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:clip-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/clips`,
          headers: { authorization: outsiderAuthorization },
          payload: { ...payload, idempotencyKey: "queue:outsider" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/clips.csv`,
          headers: { authorization: outsiderAuthorization },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("logs and exports attested no-speech player ranges while blocking transcript-free speech exports", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date("2026-08-24T12:00:00.000Z"),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:player-range-owner`;
    const registration = await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: {
        displayName: "Player Range Owner",
        handle: "player_range_owner",
      },
    });
    const actor = registration.json<{
      id: string;
      handle: string;
      displayName: string;
    }>();
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Player range API" },
    });
    const projectId = project.json<{ id: string }>().id;
    const noSpeechAttestation = {
      schemaVersion: 1,
      actor: {
        id: actor.id,
        handle: actor.handle,
        displayName: actor.displayName,
      },
      attestedAt: "2026-08-24T12:00:00.000Z",
    };
    const video = {
      youtubeVideoId: "PlayerRangeApi1",
      canonicalUrl: "https://www.youtube.com/watch?v=PlayerRangeApi1",
      title: "Player range API fixture",
      sourceLanguage: "en",
    };
    const selection = {
      selectionType: "player_time_range",
      sourceStartMs: 1_000,
      sourceEndMs: 2_000,
      exportStartMs: 500,
      exportEndMs: 2_500,
      origin: "manual_player",
      speechStatus: "no_speech",
      noSpeechAttestation,
    };
    const noContext = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        idempotencyKey: "player-no-context",
        video,
        selection,
        notes: "",
        tags: [],
      },
    });
    expect(noContext.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        idempotencyKey: "player-no-speech",
        video,
        selection,
        notes: "Silent visual bridge.",
        tags: ["Opening montage"],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      selection,
      languageEvidence: {
        schemaVersion: 3,
        state: "unavailable",
        reason: "no_speech",
      },
    });
    const preset = {
      presetVersion: 1,
      name: "Editing MP4",
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: true,
        embedEnglishSubtitleTrack: false,
      },
    };
    const exported = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${created.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: {
        idempotencyKey: "player-no-speech-export",
        sourceLanguageClass: "confirmed_english",
        noSpeechAttestation,
        sourceRights: sourceRightsForVideo(video.youtubeVideoId),
        preset,
      },
    });
    expect(exported.statusCode).toBe(201);
    expect(exported.json()).toMatchObject({
      selection,
      noSpeechAttestation,
      state: "queued",
    });

    const speech = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        idempotencyKey: "player-unattached-speech",
        video: {
          ...video,
          youtubeVideoId: "PlayerRangeApi2",
          canonicalUrl: "https://www.youtube.com/watch?v=PlayerRangeApi2",
        },
        selection: {
          ...selection,
          speechStatus: "speech",
          noSpeechAttestation: undefined,
        },
        notes: "Speech heard without exact transcript overlap.",
        tags: [],
      },
    });
    expect(speech.statusCode).toBe(201);
    const blockedExport = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips/${speech.json<{ id: string }>().id}/exports`,
      headers: { authorization },
      payload: {
        idempotencyKey: "player-unattached-speech-export",
        sourceLanguageClass: "confirmed_english",
        sourceRights: sourceRightsForVideo("PlayerRangeApi2"),
        preset,
      },
    });
    expect(blockedExport.statusCode).toBe(422);
    expect(blockedExport.json()).toMatchObject({
      error: { code: "invalid_language_evidence" },
    });
  });

  it("reuses a project-authorized Spanish derivative and freezes Romanian, English, and Spanish clip evidence", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const store = new MemoryTranscriptObjectStore();
    const catalog = new SharedProjectCatalog(database, store);
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:multilingual-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Multilingual Owner" },
    });
    const preference = await app.inject({
      method: "PATCH",
      url: "/api/session/profile",
      headers: { authorization },
      payload: { preferredLanguage: "es-MX" },
    });
    expect(preference.json()).toMatchObject({ preferredLanguage: "es-MX" });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/session/profile",
          headers: { authorization },
          payload: { preferredLanguage: "not a language" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/session/profile",
          headers: { authorization },
        })
      ).json(),
    ).toMatchObject({ preferredLanguage: "es-MX" });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Multilingual proof" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;
    const actor = { userId, externalSubject: "fixture:multilingual-owner" };
    const video = await catalog.addVideo(actor, projectId, {
      youtubeVideoId: "Romanian001",
      canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
      title: "Romanian fixture",
      sourceLanguage: "ro",
    });
    const original = normalizeTranscriptFixture(multilingualFixture.original);
    const english = normalizeTranscriptFixture(multilingualFixture.english);
    const spanish = normalizeTranscriptFixture(multilingualFixture.spanish);
    const baseVersionId = randomUUID();
    const lineageId = randomUUID();
    const originalBytes = new TextEncoder().encode(JSON.stringify(original));
    const originalStored = await store.put({
      key: `fixtures/${baseVersionId}/original.normalized.json`,
      bytes: originalBytes,
      contentType: "application/json",
      sha256: createHash("sha256").update(originalBytes).digest("hex"),
    });
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_object_version_id, manifest_sha256,
          finalized_at, created_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'ro', 'en', 'cue', $5, $6, $7, now(), now())`,
      [
        baseVersionId,
        projectId,
        video.id,
        lineageId,
        `fixtures/${baseVersionId}/manifest.json`,
        "fixture-version",
        "a".repeat(64),
      ],
    );
    await database.query(
      `INSERT INTO transcript_artifacts
         (transcript_version_id, artifact_type, object_key, object_version_id,
          byte_size, sha256)
       VALUES ($1, 'original-normalized', $2, $3, $4, $5)`,
      [
        baseVersionId,
        originalStored.key,
        originalStored.versionId,
        originalStored.bytes.byteLength,
        originalStored.sha256,
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [baseVersionId, projectId, video.id],
    );
    const identity = {
      projectId,
      catalogVideoId: video.id,
      baseTranscriptVersionId: baseVersionId,
      originalTrackId: original.track.id,
      originalContentSha256: original.track.contentSha256,
      targetLanguage: "es-MX",
      provider: spanish.track.provider,
      normalizationSchemaVersion: spanish.track.schemaVersion,
    };
    const published = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/publish`,
      headers: { authorization },
      payload: {
        identity,
        idempotencyKey: `translation:${baseVersionId}:es`,
        transcript: spanish,
      },
    });
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({
      transcript: {
        track: {
          kind: "translation",
          language: "es",
          sourceTrackId: original.track.id,
        },
      },
    });
    const lookedUp = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/lookup`,
      headers: { authorization },
      payload: { identity },
    });
    expect(lookedUp.statusCode).toBe(200);
    expect(lookedUp.json()).toMatchObject({
      manifest: { identity: { baseTranscriptVersionId: baseVersionId } },
    });
    const resolved = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/resolve`,
      headers: { authorization },
      payload: {
        identity,
        idempotencyKey: `translation:${baseVersionId}:es:retry`,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({
      manifest: { identity: { baseTranscriptVersionId: baseVersionId } },
    });
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM transcript_translation_jobs",
        )
      ).rows[0]?.count,
    ).toBe("1");

    const missingIdentity = {
      ...identity,
      targetLanguage: "fr-CA",
    };
    const missingLookup = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/lookup`,
      headers: { authorization },
      payload: { identity: missingIdentity },
    });
    expect(missingLookup.statusCode).toBe(204);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM transcript_translation_jobs",
        )
      ).rows[0]?.count,
    ).toBe("1");
    expect(
      (
        await database.query<{ active_transcript_version_id: string }>(
          `SELECT active_transcript_version_id FROM project_videos
           WHERE project_id = $1 AND video_id = $2`,
          [projectId, video.id],
        )
      ).rows[0]?.active_transcript_version_id,
    ).toBe(baseVersionId);

    const languageEvidence = buildClipLanguageEvidence({
      original,
      english,
      preferred: spanish,
      startMs: 0,
      endMs: 4_000,
    });
    const clipPayload = {
      idempotencyKey: "queue:romanian-spanish",
      video: {
        youtubeVideoId: "Romanian001",
        canonicalUrl: "https://www.youtube.com/watch?v=Romanian001",
        title: "Romanian fixture",
        sourceLanguage: "ro",
      },
      selection: {
        trackId: spanish.track.id,
        transcriptVersion: spanish.track.version,
        firstSegmentId: spanish.segments[0]!.id,
        lastSegmentId: spanish.segments[1]!.id,
        transcriptStartMs: 0,
        transcriptEndMs: 4_000,
        exportStartMs: 0,
        exportEndMs: 4_000,
        text: spanish.segments.map((segment) => segment.text).join(" "),
        timingPrecision: "cue",
      },
      languageEvidence,
      notes: "Preserve all three languages.",
      tags: ["Multilingual"],
    };
    const rejected = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        ...clipPayload,
        idempotencyKey: "queue:missing-spanish",
        languageEvidence: {
          schemaVersion: 2,
          native: languageEvidence.native,
          english: languageEvidence.english,
        },
      },
    });
    expect(rejected.statusCode).toBe(422);
    const wrongTarget = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: {
        ...clipPayload,
        idempotencyKey: "queue:wrong-spanish-target",
        languageEvidence: {
          ...languageEvidence,
          preferred: {
            ...languageEvidence.preferred,
            language: "fr",
          },
        },
      },
    });
    expect(wrongTarget.statusCode).toBe(422);
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM clip_candidates
           WHERE project_id = $1`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe("0");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM sync_events
           WHERE project_id = $1 AND event_type = 'clip_candidate.created'`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe("0");
    expect(
      (
        await database.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM jobs
           WHERE project_id = $1 AND kind = 'export'`,
          [projectId],
        )
      ).rows[0]?.count,
    ).toBe("0");
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/clips`,
      headers: { authorization },
      payload: clipPayload,
    });
    expect(created.statusCode).toBe(201);
    const frozen = created.json<{
      id: string;
      languageEvidence: { preferred: { text: string } };
    }>();
    expect(frozen.languageEvidence).toEqual(languageEvidence);
    expect(
      (
        await database.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM clip_language_evidence WHERE clip_id = $1",
          [frozen.id],
        )
      ).rows[0]?.count,
    ).toBe("3");
    await app.inject({
      method: "PATCH",
      url: "/api/session/profile",
      headers: { authorization },
      payload: { preferredLanguage: "en" },
    });
    const reloaded = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips/${frozen.id}`,
      headers: { authorization },
    });
    expect(reloaded.json().languageEvidence).toEqual(languageEvidence);
    const csv = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/clips.csv`,
      headers: { authorization },
    });
    expect(csv.body).toContain('"preferred_language","preferred_text"');
    expect(csv.body).toContain('"es","Este es un ejemplo rumano.');

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/resolve`,
          headers: { authorization: outsiderAuthorization },
          payload: {
            identity,
            idempotencyKey: "outsider-discovery",
          },
        })
      ).statusCode,
    ).toBe(403);
    const outsiderLookup = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/${video.id}/derived-translations/lookup`,
      headers: { authorization: outsiderAuthorization },
      payload: { identity },
    });
    expect(outsiderLookup.statusCode).toBe(403);
  });

  it("normalizes a YouTube URL, resolves metadata, and persists the project video", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const metadataProvider: VideoMetadataProvider = {
      resolve: async (videoId) => ({
        videoId,
        title: "IFrame API demo",
        channel: "Google Developers",
        durationMs: 60_000,
        sourceLanguage: "en",
      }),
    };
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: metadataProvider,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:video-resolver`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Resolver User" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Resolved videos" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;

    const resolved = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/resolve`,
      headers: { authorization },
      payload: { url: "https://youtu.be/M7lc1UVf-VE?t=12" },
    });
    expect(resolved.statusCode).toBe(201);
    expect(resolved.json()).toMatchObject({
      youtubeVideoId: "M7lc1UVf-VE",
      canonicalUrl: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
      title: "IFrame API demo",
      channel: "Google Developers",
      durationMs: 60_000,
      sourceLanguage: "en",
    });

    const localProcessing = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/local-processing`,
      headers: { authorization },
    });
    expect(localProcessing.statusCode).toBe(200);
    expect(localProcessing.json()).toMatchObject({
      policy: { state: "automatic", version: 1 },
      workload: {
        queuedJobs: 1,
        queuedKnownDurationMs: 60_000,
        unprocessedActiveVideoCount: 0,
      },
    });
    expect(
      (
        await database.query<{
          source_policy: string;
          processing_origin: string;
        }>(
          `SELECT b.source_policy, b.processing_origin
           FROM transcription_batch_items bi
           JOIN transcription_batches b ON b.id = bi.batch_id
           WHERE b.project_id = $1`,
          [projectId],
        )
      ).rows,
    ).toEqual([
      {
        source_policy: "captions-then-generate",
        processing_origin: "project_local",
      },
    ]);

    const listed = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/videos`,
      headers: { authorization },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([
      { youtubeVideoId: "M7lc1UVf-VE", title: "IFrame API demo" },
    ]);
  });

  it("preflights and persists a deduplicated required-project batch while reusing a shared transcript", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const metadataProvider: VideoMetadataProvider = {
      resolve: async (videoId) => {
        if (videoId === "FailedVid01") throw new Error("fixture failure");
        return {
          videoId,
          title: `Fixture ${videoId}`,
          channel: "Fixture channel",
          durationMs: 90_000,
          sourceLanguage: "en",
        };
      },
    };
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: metadataProvider,
    });
    apps.add(app);
    const userId = randomUUID();
    const authorization = `Bearer ${userId}|fixture:batch-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Batch Owner" },
    });
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Batch project" },
    });
    const projectId = projectResponse.json<{ id: string }>().id;
    const existingVideo = await catalog.addVideo(
      { userId, externalSubject: "fixture:batch-owner" },
      projectId,
      {
        youtubeVideoId: "Existing001",
        canonicalUrl: "https://www.youtube.com/watch?v=Existing001",
        title: "Existing fixture",
      },
    );
    const transcriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_sha256, finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, $6, now())`,
      [
        transcriptVersionId,
        projectId,
        existingVideo.id,
        randomUUID(),
        "fixture/manifest.json",
        "a".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [transcriptVersionId, projectId, existingVideo.id],
    );
    const inputs = [
      "https://youtu.be/Existing001",
      "ReadyVideo1",
      "RaceVideo01",
      "https://www.youtube.com/watch?v=ReadyVideo1&t=5",
      "https://example.com/not-youtube",
      "FailedVid01",
    ];

    const preflight = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/videos/preflight`,
      headers: { authorization },
      payload: { inputs },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflight.json()).toMatchObject({
      summary: {
        total: 6,
        ready: 2,
        existingTranscripts: 1,
        duplicates: 1,
        unsupported: 1,
        metadataFailed: 1,
      },
      items: [
        {
          status: "existing-transcript",
          activeTranscriptVersionId: transcriptVersionId,
        },
        { status: "ready", processingNeed: "transcription" },
        { status: "ready", processingNeed: "transcription" },
        { status: "duplicate", duplicateOfInputIndex: 1 },
        { status: "unsupported" },
        { status: "metadata-failed" },
      ],
    });

    const racedVideo = await catalog.addVideo(
      { userId, externalSubject: "fixture:batch-owner" },
      projectId,
      {
        youtubeVideoId: "RaceVideo01",
        canonicalUrl: "https://www.youtube.com/watch?v=RaceVideo01",
        title: "Raced shared transcript",
      },
    );
    const racedTranscriptVersionId = randomUUID();
    await database.query(
      `INSERT INTO transcript_versions
         (id, project_id, video_id, lineage_id, version, schema_version,
          source_language, target_language, timing_precision,
          manifest_object_key, manifest_sha256, finalized_at)
       VALUES ($1, $2, $3, $4, 1, 1, 'en', 'en', 'cue', $5, $6, now())`,
      [
        racedTranscriptVersionId,
        projectId,
        racedVideo.id,
        randomUUID(),
        "fixture/raced-manifest.json",
        "b".repeat(64),
      ],
    );
    await database.query(
      `UPDATE project_videos SET active_transcript_version_id = $1
       WHERE project_id = $2 AND video_id = $3`,
      [racedTranscriptVersionId, projectId, racedVideo.id],
    );

    const createPayload = {
      name: "Mixed fixture batch",
      inputs,
      transcriptionProfile: "balanced",
    };
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      batch: {
        projectId,
        name: "Mixed fixture batch",
        transcriptionProfile: "balanced",
      },
      items: [
        { state: "ready_for_review", reviewStatus: "unreviewed" },
        { state: "queued", reviewStatus: "unreviewed" },
        {
          status: "existing-transcript",
          state: "ready_for_review",
          activeTranscriptVersionId: racedTranscriptVersionId,
        },
        { state: "canceled" },
        { state: "blocked" },
        { state: "blocked" },
      ],
    });
    const batchId = created.json<{ batch: { id: string } }>().batch.id;
    const loaded = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${batchId}`,
      headers: { authorization },
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.json());

    const listedBatches = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
    });
    expect(listedBatches.json()).toMatchObject({
      batches: [
        {
          batch: { id: batchId, name: "Mixed fixture batch" },
          progress: {
            total: 6,
            queued: 1,
            active: 0,
            readyForReview: 2,
            blocked: 2,
            canceled: 1,
          },
        },
      ],
    });
    const reviewInbox = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/review-inbox`,
      headers: { authorization },
    });
    const reviewBody = reviewInbox.json<{
      items: { id: string; version: number; reviewStatus: string }[];
    }>();
    expect(reviewInbox.statusCode).toBe(200);
    expect(reviewBody.items).toHaveLength(2);
    expect(reviewBody.items[0]).toMatchObject({
      version: 1,
      reviewStatus: "unreviewed",
    });
    const reviewItem = reviewBody.items[0]!;
    const reviewing = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/review-inbox/${reviewItem.id}`,
      headers: { authorization },
      payload: { reviewStatus: "reviewing", expectedVersion: 1 },
    });
    expect(reviewing.json()).toMatchObject({
      id: reviewItem.id,
      version: 2,
      reviewStatus: "reviewing",
      batchName: "Mixed fixture batch",
    });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/projects/${projectId}/review-inbox/${reviewItem.id}`,
          headers: { authorization },
          payload: { reviewStatus: "reviewed", expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(409);

    const repeated = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: createPayload,
    });
    expect(repeated.statusCode).toBe(201);
    const jobs = await database.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE kind = 'transcription'",
    );
    expect(jobs.rows[0]?.count).toBe("1");

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:batch-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/videos/preflight`,
          headers: { authorization: outsiderAuthorization },
          payload: { inputs: ["ReadyVideo1"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${projectId}/review-inbox`,
          headers: { authorization: outsiderAuthorization },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("claims with an expiring lease, rejects stale workers, and persists the selected source plan", async () => {
    let currentTime = new Date("2026-08-01T12:00:00.000Z");
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
      () => new Date(currentTime),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: {
        resolve: async (videoId) => ({
          videoId,
          title: "Lease fixture",
          sourceLanguage: "es",
        }),
      },
    });
    apps.add(app);
    const ownerId = randomUUID();
    const authorization = `Bearer ${ownerId}|fixture:lease-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Lease Owner" },
    });
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Lease project" },
    });
    const projectId = project.json<{ id: string }>().id;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: { name: "Lease batch", inputs: ["ReadyVideo1"] },
    });
    const createdBody = created.json<{
      batch: { id: string };
      items: { jobId: string }[];
    }>();
    const jobId = createdBody.items[0]!.jobId;

    const firstClaim = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 15 },
    });
    expect(firstClaim.statusCode).toBe(200);
    expect(firstClaim.json()).toMatchObject({
      job: { id: jobId, state: "claimed", attempt: 1 },
      lease: { workerId: ownerId, attempt: 1 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 15 },
        })
      ).statusCode,
    ).toBe(204);

    const heartbeat = await app.inject({
      method: "POST",
      url: `/api/transcription-jobs/${jobId}/heartbeat`,
      headers: { authorization },
      payload: { attempt: 1, leaseSeconds: 15, stage: "resolving" },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json()).toMatchObject({
      status: "active",
      lease: { jobId, workerId: ownerId, attempt: 1 },
    });
    const pausedAfterStart = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}/control`,
      headers: { authorization },
      payload: { action: "pause_pending", expectedVersion: 1 },
    });
    expect(pausedAfterStart.json()).toMatchObject({
      batch: { dispatchStatus: "paused", version: 2 },
      progress: { active: 1 },
    });
    currentTime = new Date(currentTime.getTime() + 16_000);
    const recovered = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 30 },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json()).toMatchObject({
      job: { id: jobId, attempt: 2 },
      lease: { attempt: 2 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 1, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(409);

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:lease-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Lease Outsider" },
    });
    const plan = {
      strategy: "caption",
      track: {
        id: "spanish-manual",
        language: "es",
        kind: "manual",
        translatable: true,
        downloadAccess: "available",
      },
      sourceLanguage: "es",
      targetLanguage: "en",
      requiresTranslation: true,
      reason: "manual-original-language",
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/source-plan`,
          headers: { authorization: outsiderAuthorization },
          payload: { attempt: 2, plan },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/source-plan`,
          headers: { authorization },
          payload: { attempt: 2, plan },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 2, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(200);

    const batch = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}`,
      headers: { authorization },
    });
    expect(batch.json()).toMatchObject({
      items: [
        {
          attempt: 2,
          state: "acquiring",
          sourcePlan: plan,
          sourceResolvedAt: currentTime.toISOString(),
        },
      ],
    });

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/fail`,
          headers: { authorization },
          payload: {
            attempt: 2,
            code: "caption_provider_unavailable",
            message: "The configured caption provider is unavailable.",
            retryable: true,
          },
        })
      ).statusCode,
    ).toBe(204);
    const failedBatch = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}`,
      headers: { authorization },
    });
    expect(failedBatch.json()).toMatchObject({
      items: [
        {
          state: "failed",
          error: {
            code: "caption_provider_unavailable",
            message: "The configured caption provider is unavailable.",
          },
        },
      ],
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/transcription-jobs/${jobId}/heartbeat`,
          headers: { authorization },
          payload: { attempt: 2, leaseSeconds: 30, stage: "acquiring" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("authorizes durable pause, resume, retry, and cancel-unstarted controls", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
      videoMetadataProvider: {
        resolve: async (videoId) => ({
          videoId,
          title: `Control fixture ${videoId}`,
          sourceLanguage: "en",
        }),
      },
    });
    apps.add(app);
    const ownerId = randomUUID();
    const authorization = `Bearer ${ownerId}|fixture:control-owner`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization },
      payload: { displayName: "Control Owner" },
    });
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization },
      payload: { name: "Controlled batch project" },
    });
    const projectId = project.json<{ id: string }>().id;
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/transcription-batches`,
      headers: { authorization },
      payload: {
        name: "Controlled batch",
        inputs: ["ControlVid1", "ControlVid2", "ControlVid3"],
      },
    });
    const createdBody = created.json<{
      batch: { id: string; version: number };
    }>();
    const controlUrl = `/api/projects/${projectId}/transcription-batches/${createdBody.batch.id}/control`;
    expect(created.json()).toMatchObject({
      batch: { dispatchStatus: "active", version: 1 },
      progress: { total: 3, queued: 3, active: 0 },
    });

    const paused = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "pause_pending", expectedVersion: 1 },
    });
    expect(paused.json()).toMatchObject({
      batch: { dispatchStatus: "paused", version: 2 },
      progress: { queued: 3 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 30 },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: controlUrl,
          headers: { authorization },
          payload: { action: "resume", expectedVersion: 1 },
        })
      ).statusCode,
    ).toBe(409);

    const outsiderId = randomUUID();
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:control-outsider`;
    await app.inject({
      method: "POST",
      url: "/api/session/register",
      headers: { authorization: outsiderAuthorization },
      payload: { displayName: "Control Outsider" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: controlUrl,
          headers: { authorization: outsiderAuthorization },
          payload: { action: "resume", expectedVersion: 2 },
        })
      ).statusCode,
    ).toBe(403);

    const resumed = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "resume", expectedVersion: 2 },
    });
    expect(resumed.json()).toMatchObject({
      batch: { dispatchStatus: "active", version: 3 },
    });

    for (const retryable of [true, false]) {
      const claim = await app.inject({
        method: "POST",
        url: "/api/transcription-jobs/claim",
        headers: { authorization },
        payload: { executionLocation: "local", leaseSeconds: 30 },
      });
      const claimed = claim.json<{
        job: { id: string };
        lease: { attempt: number };
      }>();
      expect(claim.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/transcription-jobs/${claimed.job.id}/fail`,
            headers: { authorization },
            payload: {
              attempt: claimed.lease.attempt,
              code: retryable ? "temporary_failure" : "unsupported_source",
              message: retryable
                ? "The provider is temporarily unavailable."
                : "This source cannot be processed.",
              retryable,
            },
          })
        ).statusCode,
      ).toBe(204);
    }

    const retried = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "retry_failed", expectedVersion: 3 },
    });
    const retriedBody = retried.json<{
      items: { state: string; error?: { retryable?: boolean } }[];
    }>();
    expect(retriedBody).toMatchObject({
      batch: { dispatchStatus: "active", version: 4 },
      progress: { queued: 2, failed: 1 },
    });
    expect(
      retriedBody.items.filter((item) => item.state === "queued"),
    ).toHaveLength(2);
    expect(
      retriedBody.items.find((item) => item.state === "failed")?.error,
    ).toMatchObject({ retryable: false });

    const retryClaim = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      headers: { authorization },
      payload: { executionLocation: "local", leaseSeconds: 30 },
    });
    expect(retryClaim.statusCode).toBe(200);
    const canceled = await app.inject({
      method: "POST",
      url: controlUrl,
      headers: { authorization },
      payload: { action: "cancel_unstarted", expectedVersion: 4 },
    });
    expect(canceled.json()).toMatchObject({
      batch: { dispatchStatus: "canceled", version: 5 },
      progress: { active: 1, failed: 1, canceled: 1, queued: 0 },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/transcription-jobs/claim",
          headers: { authorization },
          payload: { executionLocation: "local", leaseSeconds: 30 },
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe("registered export-worker API", () => {
  it("enforces strict advertisements, owner-only heartbeat, and project membership availability", async () => {
    const database = new PGlite();
    databases.add(database);
    await runCloudMigrations(database);
    const catalog = new SharedProjectCatalog(
      database,
      new MemoryTranscriptObjectStore(),
    );
    const app = createCloudApi({
      catalog,
      authenticate: authenticateDevBearer,
    });
    apps.add(app);
    const ownerId = randomUUID();
    const outsiderId = randomUUID();
    const ownerAuthorization = `Bearer ${ownerId}|fixture:worker-api-owner`;
    const outsiderAuthorization = `Bearer ${outsiderId}|fixture:worker-api-outsider`;
    for (const [authorization, displayName] of [
      [ownerAuthorization, "Worker owner"],
      [outsiderAuthorization, "Worker outsider"],
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/session/register",
            headers: { authorization },
            payload: { displayName },
          })
        ).statusCode,
      ).toBe(200);
    }
    const project = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization: ownerAuthorization },
      payload: { name: "Worker availability" },
    });
    const projectId = project.json<{ id: string }>().id;
    const advertisement = currentExportWorkerAdvertisement({
      ffmpegVersion: "8.1.2",
      encoders: ["libx264", "libx265", "prores_ks", "mov_text", "srt"],
      muxers: ["mp4", "matroska", "mov"],
      filters: ["scale", "fps"],
    });
    const workerId = randomUUID();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/export-workers/self",
          payload: {
            workerId,
            epoch: 1,
            capability: advertisement.capability,
            availability: {
              discovery: "canonical_only",
              availableRendererIds: ["h264_mp4"],
              unavailableRendererIds: ["hevc_mkv", "prores_mov"],
            },
          },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/export-workers/self",
          headers: { authorization: ownerAuthorization },
          payload: {
            workerId,
            epoch: 1,
            capability: advertisement.capability,
            availability: {
              discovery: "canonical_only",
              availableRendererIds: ["h264_mp4"],
              unavailableRendererIds: ["hevc_mkv", "prores_mov"],
            },
          },
        })
      ).statusCode,
    ).toBe(400);
    const registered = await app.inject({
      method: "PUT",
      url: "/api/export-workers/self",
      headers: { authorization: ownerAuthorization },
      payload: { workerId, epoch: 1, ...advertisement },
    });
    expect(registered.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-workers/self/heartbeat",
          headers: { authorization: outsiderAuthorization },
          payload: { workerId, epoch: 1 },
        })
      ).statusCode,
    ).toBe(403);
    const availability = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-workers/availability`,
      headers: { authorization: ownerAuthorization },
      payload: { capability: advertisement.capability, rendererId: "h264_mp4" },
    });
    expect(availability.json()).toEqual({
      compatible: true,
      availableWorkerCount: 1,
    });
    expect(availability.json()).not.toHaveProperty("workers");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/export-workers/availability`,
          headers: { authorization: outsiderAuthorization },
          payload: {
            capability: advertisement.capability,
            rendererId: "h264_mp4",
          },
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe("logged export delivery API", () => {
  it("forwards the authenticated worker epoch and exact reservation generation/token", async () => {
    const actor = {
      userId: randomUUID(),
      externalSubject: "fixture:delivery-api-owner",
    };
    const claimLoggedExportDelivery = vi.fn(async () => ({}));
    const acceptLoggedExportDelivery = vi.fn(async () => ({ accepted: true }));
    const reconcileLoggedExportSuccess = vi.fn(async () => ({ ok: true }));
    const reconcileLoggedExportFailure = vi.fn(async () => ({ failed: true }));
    const startLoggedExportExecution = vi.fn(async () => ({ started: true }));
    const heartbeatLoggedExportExecution = vi.fn(async () => ({ alive: true }));
    const getLoggedExportProgress = vi.fn(async () => ({ progress: true }));
    const createLoggedExportBatch = vi.fn(async () => ({ created: true }));
    const listLoggedExportBatches = vi.fn(async () => ({ batches: [] }));
    const getLoggedExportBatch = vi.fn(async () => ({ batch: true }));
    const reconcileLoggedExportCanceled = vi.fn(async () => ({
      canceled: true,
    }));
    const cancelLoggedExport = vi.fn(async () => ({ requested: true }));
    const retryLoggedExport = vi.fn(async () => ({ retried: true }));
    const listClipLibrary = vi.fn(async () => ({
      projectId: randomUUID(),
      entries: [],
      syncCursor: "0",
      fetchedAt: "2026-08-22T12:00:00.000Z",
    }));
    const listArtifactVersionHistory = vi.fn(async () => ({ versions: [] }));
    const getArtifactVersion = vi.fn(async () => ({ exact: true }));
    const catalog = {
      claimLoggedExportDelivery,
      acceptLoggedExportDelivery,
      reconcileLoggedExportSuccess,
      reconcileLoggedExportFailure,
      startLoggedExportExecution,
      heartbeatLoggedExportExecution,
      getLoggedExportProgress,
      createLoggedExportBatch,
      listLoggedExportBatches,
      getLoggedExportBatch,
      reconcileLoggedExportCanceled,
      cancelLoggedExport,
      retryLoggedExport,
      listClipLibrary,
      listArtifactVersionHistory,
      getArtifactVersion,
    } as unknown as SharedProjectCatalog;
    const app = createCloudApi({ catalog, authenticate: async () => actor });
    apps.add(app);
    const workerId = randomUUID();
    const deliveryId = randomUUID();
    const reservationToken = randomUUID();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/claim",
          payload: { workerId, workerEpoch: 4 },
        })
      ).json(),
    ).toEqual({});
    expect(claimLoggedExportDelivery).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/accept",
          payload: {
            workerId,
            workerEpoch: 4,
            deliveryId,
            generation: 2,
          },
        })
      ).statusCode,
    ).toBe(400);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/accept",
      payload: {
        workerId,
        workerEpoch: 4,
        deliveryId,
        generation: 2,
        reservationToken,
      },
    });
    expect(accepted.json()).toEqual({ accepted: true });
    expect(acceptLoggedExportDelivery).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
    });
    const result = apiSuccessResultFixture();
    const reconciled = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/reconcile-success",
      payload: {
        workerId,
        workerEpoch: 4,
        deliveryId,
        generation: 2,
        reservationToken,
        result,
      },
    });
    expect(reconciled.json()).toEqual({ ok: true });
    expect(reconcileLoggedExportSuccess).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
      result,
    });
    const failureResult = {
      schemaVersion: 1,
      requestId: result.requestId,
      jobId: result.jobId,
      projectId: result.projectId,
      clipId: result.clipId,
      error: { code: "provider_failed", message: "Provider failed." },
      attempt: 0,
      sourceCleanup: { lifecycle: "not_started" },
    };
    const failed = await app.inject({
      method: "POST",
      url: "/api/export-deliveries/reconcile-failure",
      payload: {
        workerId,
        workerEpoch: 4,
        deliveryId,
        generation: 2,
        reservationToken,
        result: failureResult,
      },
    });
    expect(failed.json()).toEqual({ failed: true });
    expect(reconcileLoggedExportFailure).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
      result: failureResult,
    });
    const executionId = randomUUID();
    const leaseToken = randomUUID();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/export-deliveries/execution/start",
          payload: {
            workerId,
            workerEpoch: 4,
            deliveryId,
            generation: 2,
            reservationToken,
          },
        })
      ).json(),
    ).toEqual({ started: true });
    expect(startLoggedExportExecution).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
    });
    await app.inject({
      method: "POST",
      url: "/api/export-deliveries/execution/heartbeat",
      payload: {
        workerId,
        workerEpoch: 4,
        deliveryId,
        generation: 2,
        reservationToken,
        executionId,
        attempt: 1,
        leaseToken,
      },
    });
    expect(heartbeatLoggedExportExecution).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
      executionId,
      attempt: 1,
      leaseToken,
    });
    const progressProjectId = randomUUID();
    const progressRequestId = randomUUID();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${progressProjectId}/export-requests/${progressRequestId}/progress`,
        })
      ).json(),
    ).toEqual({ progress: true });
    expect(getLoggedExportProgress).toHaveBeenCalledWith(
      actor,
      progressProjectId,
      progressRequestId,
    );
    const batchProjectId = randomUUID();
    const batchId = randomUUID();
    const preset = {
      presetVersion: 1,
      name: "Editing MP4",
      settings: {
        container: "mp4",
        videoCodec: "h264",
        videoRateControl: { mode: "crf", value: 20 },
        frameRate: "source",
        audioCodec: "aac",
        omitSubtitleFilesForConfirmedEnglish: false,
        embedEnglishSubtitleTrack: false,
      },
    };
    const batchCommand = {
      idempotencyKey: "api-batch-1",
      items: [0, 1].map((index) => ({
        clipId: randomUUID(),
        export: {
          idempotencyKey: `api-batch-item-${index}`,
          sourceLanguageClass: "confirmed_english",
          preset,
          sourceRights: sourceRightsForVideo(`M7-batch-${index}`),
        },
      })),
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${batchProjectId}/export-batches`,
          payload: batchCommand,
        })
      ).json(),
    ).toEqual({ created: true });
    expect(createLoggedExportBatch).toHaveBeenCalledWith(
      actor,
      batchProjectId,
      batchCommand,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${batchProjectId}/export-batches`,
        })
      ).json(),
    ).toEqual({ batches: [] });
    expect(listLoggedExportBatches).toHaveBeenCalledWith(actor, batchProjectId);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${batchProjectId}/export-batches/${batchId}`,
        })
      ).json(),
    ).toEqual({ batch: true });
    expect(getLoggedExportBatch).toHaveBeenCalledWith(
      actor,
      batchProjectId,
      batchId,
    );
    const historyClipId = randomUUID();
    const clipLibraryResponse = await app.inject({
      method: "GET",
      url: `/api/projects/${batchProjectId}/clip-library?limit=10&query=quote&completed=yes`,
    });
    expect(clipLibraryResponse.statusCode).toBe(200);
    expect(listClipLibrary).toHaveBeenCalledWith(actor, batchProjectId, {
      limit: 10,
      query: "quote",
      completed: "yes",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${batchProjectId}/clips/${historyClipId}/artifact-versions?limit=10`,
        })
      ).json(),
    ).toEqual({ versions: [] });
    expect(listArtifactVersionHistory).toHaveBeenCalledWith(
      actor,
      batchProjectId,
      historyClipId,
      { limit: 10 },
    );
    const artifactVersionId = randomUUID();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${batchProjectId}/clips/${historyClipId}/artifact-versions/${artifactVersionId}`,
        })
      ).json(),
    ).toEqual({ exact: true });
    expect(getArtifactVersion).toHaveBeenCalledWith(
      actor,
      batchProjectId,
      historyClipId,
      artifactVersionId,
    );
    const canceledResult = {
      schemaVersion: 1,
      requestId: result.requestId,
      jobId: result.jobId,
      projectId: result.projectId,
      clipId: result.clipId,
      reason: "user_requested",
      attempt: 1,
      sourceCleanup: {
        lifecycle: "deleted",
        deletedAt: "2026-08-20T12:00:00.000Z",
      },
      executionId,
      executionAttempt: 1,
    };
    await app.inject({
      method: "POST",
      url: "/api/export-deliveries/reconcile-canceled",
      payload: {
        workerId,
        workerEpoch: 4,
        deliveryId,
        generation: 2,
        reservationToken,
        executionId,
        leaseToken,
        result: canceledResult,
      },
    });
    expect(reconcileLoggedExportCanceled).toHaveBeenCalledWith(actor, {
      workerId,
      workerEpoch: 4,
      deliveryId,
      generation: 2,
      reservationToken,
      executionId,
      leaseToken,
      result: canceledResult,
    });
    const projectId = randomUUID();
    const requestId = randomUUID();
    await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-requests/${requestId}/cancel`,
      payload: { idempotencyKey: "cancel-command-1" },
    });
    expect(cancelLoggedExport).toHaveBeenCalledWith(
      actor,
      projectId,
      requestId,
      {
        idempotencyKey: "cancel-command-1",
      },
    );
    const retried = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/export-requests/${requestId}/retry`,
      payload: { idempotencyKey: "retry-command-1" },
    });
    expect(retried.json()).toEqual({ retried: true });
    expect(retryLoggedExport).toHaveBeenCalledWith(
      actor,
      projectId,
      requestId,
      { idempotencyKey: "retry-command-1" },
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${projectId}/export-requests/${requestId}/retry`,
          payload: {
            idempotencyKey: "retry-command-2",
            preset: "caller replacement forbidden",
          },
        })
      ).statusCode,
    ).toBe(400);
  });
});

function apiSuccessResultFixture() {
  const at = "2026-08-20T12:00:00.000Z";
  const requestId = randomUUID();
  const packageIdentity = `clip-${requestId}`;
  const artifact = (role: string, digit: string) => ({
    role,
    packageIdentity,
    byteSize: 128,
    contentSha256: digit.repeat(64),
    sourceAttempt: 1,
    validatedAt: at,
  });
  return {
    schemaVersion: 1,
    requestId,
    jobId: randomUUID(),
    projectId: randomUUID(),
    clipId: randomUUID(),
    sourceLanguageClass: "confirmed_english",
    resolvedExportBounds: {
      startMs: 0,
      endMs: 1_000,
      sourceAttempt: 1,
      resolvedAt: at,
    },
    renderedMediaProvenance: {
      durationMs: 1_000,
      containerFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      ffprobeVersion: "8.1.2",
      ffmpegVersion: "8.1.2",
      verificationSchemaVersion: 1,
      settingsSha256: "a".repeat(64),
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
        durationMs: 1_000,
        ffprobeVersion: "8.1.2",
      },
      sourceAttempt: 1,
      validatedAt: at,
    },
    thumbnailProvenance: {
      extractionTimeMs: 500,
      width: 640,
      height: 360,
      sourceAttempt: 1,
      validatedAt: at,
    },
    subtitleOmissionProvenance: {
      policy: "confirmed_english_user_setting",
      sourceAttempt: 1,
      validatedAt: at,
    },
    artifacts: [
      artifact("clip_metadata_json", "1"),
      artifact("manifest_json", "2"),
      artifact("thumbnail_jpg", "3"),
      artifact("video_mp4", "4"),
    ],
  };
}
