import { z } from "zod";
import {
  ApiErrorSchema,
  LibraryItemSchema,
  LibrarySourceSchema,
  type LibraryItem,
  type LibrarySource,
} from "@research-video/contracts";
import { apiFetch, isDesktopRuntime } from "./api-client.ts";
import { cloudFetch } from "./browser-api.ts";

export type ResearchAuth = Parameters<typeof cloudFetch>[2];
export type ResearchRequest = (
  path: string,
  init?: RequestInit,
  target?: "cloud" | "local",
) => Promise<Response>;

export function researchRequest(auth: ResearchAuth): ResearchRequest {
  return (path, init = {}, target = "cloud") => {
    if (isDesktopRuntime()) return apiFetch(target, path, init);
    const prefix = target === "cloud" ? "/cloud-api" : "/local-agent";
    return cloudFetch(prefix + path, init, auth);
  };
}

export function researchCloudFetch(
  path: string,
  init: RequestInit,
  auth: ResearchAuth,
) {
  if (!isDesktopRuntime()) return cloudFetch(path, init, auth);
  return apiFetch("cloud", path.replace(/^\/cloud-api(?=\/api\/)/u, ""), init);
}

export function jsonWrite(
  method: "POST" | "PATCH",
  body: unknown,
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export class ResearchRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readResearch<T>(
  request: ResearchRequest,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
  target?: "cloud" | "local",
): Promise<T> {
  const response = await request(path, init, target);
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(payload);
    throw new ResearchRequestError(
      response.status,
      error.success
        ? error.data.error.message
        : "Research could not complete this request.",
    );
  }
  return schema.parse(payload);
}

export const researchPageSize = 30;

export function projectPath(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export function verifySource(
  source: LibrarySource,
  projectId: string,
  id?: string,
) {
  if (source.projectId !== projectId || (id && source.id !== id))
    throw new Error(
      "Source does not belong to the selected project or workspace.",
    );
  return source;
}

export function verifyItem(
  item: LibraryItem,
  projectId: string,
  sourceId?: string,
) {
  if (item.projectId !== projectId || (sourceId && item.sourceId !== sourceId))
    throw new Error("Item does not belong to the selected project or source.");
  return item;
}

export async function listSources(
  request: ResearchRequest,
  projectId: string,
  query: URLSearchParams,
  signal: AbortSignal,
) {
  const rows = await readResearch(
    request,
    `${projectPath(projectId)}/sources?${query}`,
    LibrarySourceSchema.array(),
    { signal },
  );
  return rows.map((row) => verifySource(row, projectId));
}

export async function listItems(
  request: ResearchRequest,
  projectId: string,
  query: URLSearchParams,
  signal: AbortSignal,
) {
  const rows = await readResearch(
    request,
    `${projectPath(projectId)}/items?${query}`,
    LibraryItemSchema.array(),
    { signal },
  );
  return rows.map((row) =>
    verifyItem(row, projectId, query.get("sourceId") ?? undefined),
  );
}

export async function getResearchSource(
  request: ResearchRequest,
  projectId: string,
  sourceId: string,
  signal: AbortSignal,
) {
  const source = await readResearch(
    request,
    `${projectPath(projectId)}/sources/${sourceId}`,
    LibrarySourceSchema,
    { signal },
  );
  return verifySource(source, projectId, sourceId);
}

export const CaptureReceiptSchema = z.object({
  captureId: z.uuid(),
  itemId: z.uuid().optional(),
  sourceId: z.uuid(),
  assets: z.array(
    z.object({
      role: z.enum(["top", "passage"]),
      revisionId: z.uuid(),
      width: z.number().positive(),
      height: z.number().positive(),
      normalizedRectangles: z.array(
        z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0).max(1),
          height: z.number().min(0).max(1),
        }),
      ),
    }),
  ),
});
