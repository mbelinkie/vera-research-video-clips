import { createHash, randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  ArgosLocalModelCatalog,
  type CatalogSigner,
  type EvaluatedLocalModel,
  type LocalModelCandidate,
  type LocalModelSourceSnapshot,
  type SignedCatalogRelease,
} from "@research-video/providers/local-model-argos-catalog";

import {
  CloudDatabaseLocalModelOperationStore,
  DurableLocalModelOperationRunner,
  mapLocalModelEvaluationFindings,
  type ArgosSource,
  type ArgosSourceAdapter,
  type DurableLocalModelOperation,
  type ImmutableArtifact,
  type ImmutableArtifactStore,
  type LocalModelOperationStore,
} from "./local-model-operation-runner.ts";
import { runCloudMigrations } from "@research-video/db-cloud";

const signer: CatalogSigner = {
  keyId: "test-key",
  async sign(bytes) {
    return createHash("sha256").update(bytes).digest("base64url");
  },
};

describe("DurableLocalModelOperationRunner", () => {
  it("maps engine safety and advisory evidence into the fail-closed governance contract", () => {
    expect(
      mapLocalModelEvaluationFindings([
        {
          code: "unsafe_archive_path",
          severity: "hard",
          message: "Archive traversal was detected.",
        },
        {
          code: "missing_license",
          severity: "advisory",
          message: "No license evidence was found.",
        },
      ]),
    ).toEqual([
      expect.objectContaining({ class: "hard_safety", state: "fail" }),
      expect.objectContaining({
        class: "recommendation",
        state: "not_recommended",
      }),
    ]);
  });

  it("snapshots a mutable feed once and makes duplicate/recovered delivery idempotent", async () => {
    const store = new MemoryStore();
    const artifacts = new MemoryArtifacts();
    const adapter = new FakeSource(index("first.argosmodel"));
    store.sources.set("argos-package-index", dueSource());
    store.operations.set(
      "refresh",
      operation({ id: "refresh", sourceId: "argos-package-index" }),
    );
    const runner = runnerFor(store, artifacts, adapter);

    const first = await runner.run("refresh", "worker-a");
    expect(first).toMatchObject({ state: "succeeded", progressPercent: 100 });
    adapter.feed = index("changed.argosmodel");
    await expect(runner.run("refresh", "worker-b")).resolves.toMatchObject({
      state: "succeeded",
    });
    expect(store.snapshots).toHaveLength(1);
    expect(store.candidates[0]?.artifactUrl).toContain("first.argosmodel");
    expect(artifacts.kinds.get("raw_feed")).toBe(1);

    store.operations.set("recovered", {
      ...operation({ id: "recovered", sourceId: "argos-package-index" }),
      state: "running",
      startedAt: "2026-08-25T00:00:00.000Z",
      heartbeatAt: "2026-08-25T00:00:00.000Z",
      leaseOwner: "crashed-worker",
      leaseExpiresAt: "2026-08-25T00:01:00.000Z",
    });
    await expect(runner.run("recovered", "worker-b")).resolves.toMatchObject({
      state: "succeeded",
    });
    expect(store.operations.get("recovered")?.leaseOwner).toBeUndefined();
  });

  it("discovers only enabled due sources and sanitizes terminal fetch failure", async () => {
    const store = new MemoryStore();
    const artifacts = new MemoryArtifacts();
    store.sources.set("due", dueSource({ id: "due" }));
    store.sources.set(
      "disabled",
      dueSource({ id: "disabled", state: "disabled" }),
    );
    store.operations.set(
      "failure",
      operation({ id: "failure", sourceId: "due" }),
    );
    const adapter = new FakeSource(index("unused.argosmodel"));
    adapter.feedFailure = new Error(
      "https://secret.example/very-sensitive-token",
    );
    const runner = runnerFor(store, artifacts, adapter);

    await expect(runner.discoverDueSources()).resolves.toEqual([
      store.sources.get("due"),
    ]);
    await expect(runner.run("failure", "worker-a")).resolves.toMatchObject({
      state: "failed",
      sanitizedFailureCode: "local_model_operation_failed",
    });
    expect(JSON.stringify(store.operations.get("failure"))).not.toContain(
      "secret.example",
    );
    expect(store.operations.get("failure")?.finishedAt).toBeDefined();
  });
});

describe("CloudDatabaseLocalModelOperationStore", () => {
  it("makes duplicate enqueue idempotent and recovers an expired lease before another worker can finish", async () => {
    const database = new PGlite();
    try {
      await runCloudMigrations(database);
      const actorId = await insertActor(database, "operation-store");
      await database.query(
        `INSERT INTO local_model_sources
           (id, adapter, source_url, state, refresh_interval_hours)
         VALUES ('argos-package-index', 'argos-package-index',
                 'https://example.test/index.json', 'enabled', 24)`,
      );
      const store = new CloudDatabaseLocalModelOperationStore(
        database,
        actorId,
      );
      const input = {
        id: randomUUID(),
        kind: "refresh_source" as const,
        sourceId: "argos-package-index",
        idempotencyKey: "refresh-source-1",
        createdBy: actorId,
        createdAt: "2026-08-26T12:00:00.000Z",
      };

      const created = await store.enqueue(input);
      await expect(
        store.enqueue({ ...input, id: randomUUID() }),
      ).resolves.toMatchObject({
        id: created.id,
        state: "queued",
      });
      await expect(
        store.enqueue({
          id: randomUUID(),
          kind: "evaluate_candidate",
          candidateId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          createdBy: input.createdBy,
          createdAt: input.createdAt,
        }),
      ).rejects.toThrow("idempotency_key_reused_with_different_operation");

      const firstClaim = await store.claim(
        created.id,
        "worker-a",
        "2026-08-26T12:00:00.000Z",
        "2026-08-26T12:01:00.000Z",
      );
      expect(firstClaim).toMatchObject({
        state: "running",
        leaseOwner: "worker-a",
      });
      await expect(
        store.claim(
          created.id,
          "worker-b",
          "2026-08-26T12:00:30.000Z",
          "2026-08-26T12:02:00.000Z",
        ),
      ).resolves.toBeUndefined();
      await expect(
        store.heartbeat(
          created.id,
          "worker-a",
          "2026-08-26T12:01:01.000Z",
          "2026-08-26T12:02:01.000Z",
        ),
      ).resolves.toBeUndefined();
      await expect(
        store.recoverExpiredLeases("2026-08-26T12:01:01.000Z"),
      ).resolves.toEqual([
        expect.objectContaining({ id: created.id, state: "queued" }),
      ]);
      const secondClaim = await store.claim(
        created.id,
        "worker-b",
        "2026-08-26T12:01:02.000Z",
        "2026-08-26T12:02:02.000Z",
      );
      expect(secondClaim).toMatchObject({
        state: "running",
        leaseOwner: "worker-b",
      });
      await expect(
        store.complete(created.id, "worker-a", "2026-08-26T12:01:03.000Z", 100),
      ).rejects.toThrow("lease_lost");
      await expect(
        store.complete(created.id, "worker-b", "2026-08-26T12:01:03.000Z", 100),
      ).resolves.toMatchObject({ state: "succeeded", progressPercent: 100 });
    } finally {
      await database.close();
    }
  });

  it("requeues a failed operation only at its expected version and clears safe terminal state", async () => {
    const database = new PGlite();
    try {
      await runCloudMigrations(database);
      const actorId = await insertActor(database, "operation-retry");
      await database.query(
        `INSERT INTO local_model_sources
           (id, adapter, source_url, state, refresh_interval_hours)
         VALUES ('argos-package-index', 'argos-package-index',
                 'https://example.test/index.json', 'enabled', 24)`,
      );
      const store = new CloudDatabaseLocalModelOperationStore(
        database,
        actorId,
      );
      const created = await store.enqueue({
        id: randomUUID(),
        kind: "refresh_source",
        sourceId: "argos-package-index",
        idempotencyKey: "retry-source-1",
        createdBy: actorId,
        createdAt: "2026-08-26T12:00:00.000Z",
      });
      await store.claim(
        created.id,
        "worker-a",
        "2026-08-26T12:00:00.000Z",
        "2026-08-26T12:10:00.000Z",
      );
      const failed = await store.fail(
        created.id,
        "worker-a",
        "2026-08-26T12:00:01.000Z",
        "sensitive provider URL? no",
      );
      expect(failed.sanitizedFailureCode).toBe("sensitive_provider_URL__no");
      await expect(
        store.retry(created.id, failed.version - 1, "2026-08-26T12:01:00.000Z"),
      ).resolves.toBeUndefined();
      await expect(
        store.retry(created.id, failed.version, "2026-08-26T12:01:00.000Z"),
      ).resolves.toMatchObject({
        state: "queued",
        progressPercent: 0,
      });
      const persisted = await database.query<{
        attempt: number;
        sanitized_failure_code: string | null;
      }>(
        "SELECT attempt, sanitized_failure_code FROM local_model_operations WHERE id = $1",
        [created.id],
      );
      expect(persisted.rows[0]).toEqual({
        attempt: 2,
        sanitized_failure_code: null,
      });
    } finally {
      await database.close();
    }
  });
});

async function insertActor(database: PGlite, name: string): Promise<string> {
  const id = randomUUID();
  const handle = name.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  await database.query(
    `INSERT INTO users
       (id, external_subject, handle, normalized_handle, display_name,
        created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, now(), now())`,
    [id, `fixture:${name}`, handle, `Fixture ${name}`],
  );
  return id;
}

function runnerFor(
  store: MemoryStore,
  artifacts: MemoryArtifacts,
  source: FakeSource,
) {
  return new DurableLocalModelOperationRunner(
    store,
    artifacts,
    source,
    new ArgosLocalModelCatalog({
      sourceUrl: "https://example.test/index.json",
      runtimeFamily: "argos",
      signer,
    }),
    () => new Date("2026-08-26T12:00:00.000Z"),
  );
}

function index(name: string) {
  return JSON.stringify([
    {
      from_code: "es",
      to_code: "en",
      package_version: "1",
      package_url: `https://example.test/${name}`,
    },
  ]);
}

function dueSource(overrides: Partial<ArgosSource> = {}): ArgosSource {
  return {
    id: "argos-package-index",
    sourceUrl: "https://example.test/index.json",
    state: "enabled",
    refreshIntervalHours: 24,
    ...overrides,
  };
}

function operation(
  overrides: Partial<DurableLocalModelOperation>,
): DurableLocalModelOperation {
  return {
    id: "operation",
    kind: "refresh_source",
    idempotencyKey: "key",
    state: "queued",
    version: 1,
    progressPercent: 0,
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

class FakeSource implements ArgosSourceAdapter {
  feedFailure?: Error;
  feed: string;
  constructor(initial: string) {
    this.feed = initial;
  }
  async fetchFeed() {
    if (this.feedFailure) throw this.feedFailure;
    return this.feed;
  }
  async fetchArtifact() {
    return new Uint8Array([1]);
  }
}

class MemoryArtifacts implements ImmutableArtifactStore {
  readonly bytes = new Map<string, Uint8Array>();
  readonly kinds = new Map<string, number>();
  async putImmutable(
    kind: "raw_feed" | "raw_candidate" | "artifact" | "evaluation",
    bytes: Uint8Array,
  ): Promise<ImmutableArtifact> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    this.bytes.set(sha256, bytes);
    this.kinds.set(kind, (this.kinds.get(kind) ?? 0) + 1);
    return { id: sha256, sha256, byteSize: bytes.byteLength };
  }
  async read(id: string) {
    const bytes = this.bytes.get(id);
    if (!bytes) throw new Error("missing");
    return bytes;
  }
}

class MemoryStore implements LocalModelOperationStore {
  readonly operations = new Map<string, DurableLocalModelOperation>();
  readonly sources = new Map<string, ArgosSource>();
  readonly snapshots: LocalModelSourceSnapshot[] = [];
  readonly candidates: LocalModelCandidate[] = [];
  async getOperation(id: string) {
    return this.operations.get(id);
  }
  async claim(
    id: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ) {
    const current = this.operations.get(id);
    if (!current) return undefined;
    if (
      current.state === "running" &&
      current.leaseExpiresAt &&
      current.leaseExpiresAt > now &&
      current.leaseOwner !== workerId
    )
      return undefined;
    if (current.state !== "queued" && current.state !== "running")
      return undefined;
    const next = {
      ...current,
      state: "running" as const,
      version: current.version + 1,
      startedAt: current.startedAt ?? now,
      heartbeatAt: now,
      leaseOwner: workerId,
      leaseExpiresAt,
    };
    this.operations.set(id, next);
    return next;
  }
  async heartbeat(
    id: string,
    workerId: string,
    now: string,
    leaseExpiresAt: string,
  ) {
    const current = this.operations.get(id);
    if (
      !current ||
      current.leaseOwner !== workerId ||
      current.state !== "running"
    )
      return undefined;
    const next = {
      ...current,
      heartbeatAt: now,
      leaseExpiresAt,
      version: current.version + 1,
    };
    this.operations.set(id, next);
    return next;
  }
  async complete(
    id: string,
    workerId: string,
    now: string,
    progressPercent: number,
  ) {
    return this.terminal(id, workerId, now, {
      state: "succeeded",
      progressPercent,
    });
  }
  async fail(id: string, workerId: string, now: string, code: string) {
    return this.terminal(id, workerId, now, {
      state: "failed",
      sanitizedFailureCode: code,
    });
  }
  async terminal(
    id: string,
    workerId: string,
    now: string,
    patch: Partial<DurableLocalModelOperation>,
  ) {
    const current = this.operations.get(id)!;
    if (current.leaseOwner !== workerId) throw new Error("lease_lost");
    const {
      leaseOwner: _owner,
      leaseExpiresAt: _expires,
      ...next
    } = { ...current, ...patch, version: current.version + 1, finishedAt: now };
    this.operations.set(id, next);
    return next;
  }
  async listDueSources(now: string) {
    return [...this.sources.values()].filter(
      (source) =>
        source.state === "enabled" &&
        (!source.lastFetchedAt ||
          Date.parse(now) - Date.parse(source.lastFetchedAt) >=
            source.refreshIntervalHours * 3_600_000),
    );
  }
  async getSource(id: string) {
    return this.sources.get(id);
  }
  async putSnapshot(snapshot: LocalModelSourceSnapshot) {
    if (!this.snapshots.some((item) => item.id === snapshot.id))
      this.snapshots.push(snapshot);
  }
  async putCandidate(candidate: LocalModelCandidate) {
    if (!this.candidates.some((item) => item.id === candidate.id))
      this.candidates.push(candidate);
  }
  async getCandidate(id: string) {
    return this.candidates.find((candidate) => candidate.id === id);
  }
  async putEvaluation() {}
  async finishCandidateEvaluation() {}
  async getEvaluation() {
    return undefined;
  }
  async putMirror() {}
  async putRelease(_release: SignedCatalogRelease) {}
}
