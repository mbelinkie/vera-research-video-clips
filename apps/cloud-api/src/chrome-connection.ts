import { createHash, randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ExtensionDraftSchema,
  StillUploadSchema,
  type AuthenticatedActor,
} from "@research-video/contracts";
import { normalizeYouTubeUrl } from "@research-video/providers";
import {
  preflightTranscriptionBatch,
  type CloudApiDependencies,
} from "./app.ts";
import { publishKeptStill } from "./still-import.ts";
import { ingestChromeCapture } from "./extension-capture.ts";

const originPattern = /^chrome-extension:\/\/[a-p]{32}$/u;
const hexKey = z.string().regex(/^[0-9a-f]{64}$/u);
const minute = 60_000;
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), {
    statusCode,
    code: "chrome_capture_refused",
  });
}

export function registerChromeConnection(
  app: FastifyInstance,
  deps: CloudApiDependencies,
) {
  const { catalog } = deps;
  const pending = new Map<
    string,
    {
      digest: string;
      origin: string;
      code: string;
      expires: number;
      attempts: number;
    }
  >();
  const prune = () => {
    for (const [id, entry] of pending)
      if (entry.expires <= Date.now()) pending.delete(id);
  };

  app.post("/api/extension-connections", async (request) => {
    const actor = await deps.authenticate(request);
    const { requestId, code } = z
      .strictObject({ requestId: z.uuid(), code: z.string().regex(/^\d{8}$/u) })
      .parse(request.body);
    prune();
    const pairing = pending.get(requestId);
    if (!pairing) fail(403, "Start a new connection from the extension.");
    if (pairing.code !== code) {
      pairing.attempts++;
      if (pairing.attempts >= 5) pending.delete(requestId);
      fail(403, "Check the code or start a new connection.");
    }
    // Consume before the first await so two approvals cannot bind different accounts.
    pending.delete(requestId);
    await catalog.connectChrome(actor, {
      id: requestId,
      digest: pairing.digest,
      origin: pairing.origin,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * minute),
    });
    return { connected: true };
  });
  app.delete("/api/extension-connections", async (request) => {
    await catalog.disconnectChrome(await deps.authenticate(request));
    return { disconnected: true };
  });

  app.register(
    async (gateway) => {
      gateway.addHook("onRequest", async (request, reply) => {
        reply.header("cache-control", "no-store");
        const origin = request.headers.origin;
        if (
          typeof origin !== "string" ||
          !originPattern.test(origin) ||
          request.headers.cookie !== undefined ||
          request.headers.authorization !== undefined
        )
          fail(
            403,
            "Only the paired Chrome extension can use this connection.",
          );
      });
      gateway.post("/pair", { bodyLimit: 512 }, async (request) => {
        const { digest } = z
          .strictObject({ digest: hexKey })
          .parse(request.body);
        prune();
        if (pending.size >= 128)
          fail(
            429,
            "Too many connections are pending. Try again in five minutes.",
          );
        const requestId = randomUUID();
        const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
        pending.set(requestId, {
          digest,
          origin: String(request.headers.origin),
          code,
          expires: Date.now() + 5 * minute,
          attempts: 0,
        });
        return { requestId, code };
      });
      async function authenticate(request: FastifyRequest) {
        const key = hexKey.safeParse(request.headers["x-vera-capture-key"]);
        if (!key.success) fail(401, "Connect the extension to VERA.");
        const digest = createHash("sha256")
          .update(key.data, "hex")
          .digest("hex");
        const actor = await catalog.chromeActor(
          String(request.headers.origin),
          digest,
        );
        if (!actor)
          fail(401, "This connection has expired or was disconnected.");
        return { actor, digest };
      }
      gateway.post("/projects", async (request) => {
        const { actor } = await authenticate(request);
        return (await catalog.listProjects(actor, true)).map(
          ({ id, name }) => ({ id, name }),
        );
      });
      gateway.post("/disconnect", async (request) => {
        const { actor, digest } = await authenticate(request);
        await catalog.disconnectChrome(actor, digest);
        return { disconnected: true };
      });
      const admitted = new Map<
        FastifyRequest,
        { actor: AuthenticatedActor; projectId: string }
      >();
      gateway.addHook("onResponse", async (request) => {
        admitted.delete(request);
      });
      gateway.addHook("onRequestAbort", async (request) => {
        admitted.delete(request);
      });
      gateway.post(
        "/projects/:projectId/captures",
        {
          bodyLimit: 29 * 1024 * 1024,
          onRequest: async (request) => {
            const { actor } = await authenticate(request);
            const { projectId } = z
              .object({ projectId: z.uuid() })
              .parse(request.params);
            await catalog.authorizeSourceWrite(actor, projectId);
            if (admitted.size >= 2)
              fail(429, "Other captures are saving. Try again shortly.");
            admitted.set(request, { actor, projectId });
          },
        },
        async (request, reply) => {
          const { actor, projectId } = admitted.get(request)!;
          const parsed = ExtensionDraftSchema.safeParse(request.body);
          if (!parsed.success)
            fail(
              400,
              "This capture exceeds a limit or contains invalid fields.",
            );
          const draft = parsed.data;
          if (draft.kind === "still") {
            const saved = await publishKeptStill(
              catalog,
              actor,
              projectId,
              StillUploadSchema.parse({
                title: draft.title,
                idempotencyKey: draft.requestId,
                altText: draft.altText,
                credit: draft.credit,
                originalUrl: draft.url,
                pageUrl: draft.pageUrl,
              }),
              Buffer.from(draft.data, "base64"),
              { kind: "file", sourceUrl: draft.url, pageUrl: draft.pageUrl },
            );
            return reply
              .code(201)
              .send({ itemId: saved.id, sourceId: saved.sourceId });
          }
          if (draft.kind === "youtube") {
            const provider = deps.videoMetadataProvider;
            if (!provider) fail(503, "Video lookup is unavailable.");
            let canonicalUrl: string;
            try {
              canonicalUrl = normalizeYouTubeUrl(draft.url).canonicalUrl;
            } catch {
              fail(400, "Select a YouTube video to queue.");
            }
            const options = {
              targetLanguage: "en",
              transcriptionProfile: "default",
              sourcePolicy: "prefer-existing",
              executionLocation: "local",
              priority: "high",
            } as const;
            const preflight = await preflightTranscriptionBatch(
              catalog,
              provider,
              actor,
              projectId,
              [canonicalUrl],
              options,
            );

            const result = await catalog.createTranscriptionBatch(actor, {
              projectId,
              name: "Immediate review",
              options: preflight.options,
              items: preflight.items,
              chromeRequestId: draft.requestId,
              ...(draft.timecodeMs !== undefined && {
                timecodeMs: draft.timecodeMs,
              }),
              ...(draft.comment && { submissionComment: draft.comment }),
            });
            return reply.code(201).send({
              batchId: result.batch.id,
              status: result.items.find(
                (item) =>
                  item.youtubeVideoId === preflight.items[0]?.youtubeVideoId,
              )?.state,
            });
          }
          return reply
            .code(201)
            .send(await ingestChromeCapture(catalog, actor, projectId, draft));
        },
      );
    },
    { prefix: "/extension/v1" },
  );
}
