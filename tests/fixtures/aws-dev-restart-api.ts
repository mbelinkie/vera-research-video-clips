import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { SharedProjectCatalog } from "@research-video/catalog";
import { runCloudMigrations } from "@research-video/db-cloud";
import {
  LocalStagedUploadUrlIssuer,
  LocalTranscriptObjectStore,
} from "@research-video/storage";

import {
  authenticateDevBearer,
  createCloudApi,
} from "../../apps/cloud-api/src/app.ts";
import {
  pumpJobQueueOnce,
  type JobQueueDelivery,
  type JobQueueMessage,
} from "../../apps/cloud-api/src/job-queue.ts";

const [root, port, timestamp, mode] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
];
const objectRoot = join(root, "objects");
const catalogPath = join(root, "catalog");
let initialData: Blob | undefined;
if (!existsSync(join(catalogPath, "PG_VERSION"))) {
  const seed = new PGlite();
  try {
    await runCloudMigrations(seed);
    initialData = await seed.dumpDataDir("none");
  } finally {
    await seed.close();
  }
}
const db = new PGlite(
  catalogPath,
  initialData ? { loadDataDir: initialData } : {},
);
await runCloudMigrations(db);
const store = new LocalTranscriptObjectStore(objectRoot);
const issuer = new LocalStagedUploadUrlIssuer(
  `http://127.0.0.1:${port}/`,
  "disposable-test-fixture-signing-key",
);
const catalog = new SharedProjectCatalog(
  db,
  store,
  () => new Date(timestamp),
  issuer,
);
const app = createCloudApi({
  catalog,
  authenticate: authenticateDevBearer,
  queueDeliveryRequired: mode !== "memory",
  localArtifacts: { store, issuer, objectRoot },
  videoMetadataProvider: {
    resolve: async (videoId) => ({
      videoId,
      title: "Synthetic",
      sourceLanguage: "en",
    }),
  },
});
const queueFile = join(root, "queue.json");
const readQueue = async (): Promise<JobQueueMessage[]> =>
  JSON.parse(await readFile(queueFile, "utf8"));
const saveQueue = async (messages: JobQueueMessage[]) =>
  writeFile(queueFile, JSON.stringify(messages));

// Fail immediately on either side of the persisted catalog / queue boundaries.
app.post<{ Body: { fault?: "publish" | "receive" | "delete" } }>(
  "/fixture/pump",
  async ({ body }) => {
    await pumpJobQueueOnce(
      {
        publish: async (message) => {
          if (body.fault === "publish")
            throw new Error("Synthetic send interruption");
          await saveQueue([...(await readQueue()), message]);
        },
        receive: async (): Promise<JobQueueDelivery | undefined> => {
          if (body.fault === "receive")
            throw new Error("Synthetic receive interruption");
          const message = (await readQueue())[0];
          return message
            ? { ...message, messageId: "test", receiptHandle: "first" }
            : undefined;
        },
        changeVisibility: async () => {},
        delete: async () => {
          if (body.fault === "delete")
            throw new Error("Synthetic delete interruption");
          await saveQueue((await readQueue()).slice(1));
        },
      },
      catalog,
    );
    return { ok: true };
  },
);

app.post<{ Body: { jobId: string } }>(
  "/fixture/reserve-twice",
  async ({ body }) =>
    Promise.all([
      catalog.markTranscriptionJobDispatched(body.jobId),
      catalog.markTranscriptionJobDispatched(body.jobId),
    ]),
);
await app.listen({ host: "127.0.0.1", port: Number(port) });
process.send?.("ready");
