import {
  DesktopApiRequestSchema,
  DesktopApiResponseSchema,
  type DesktopApiRequest,
  type DesktopApiResponse,
  type DesktopStatus,
  type ModelDownloadProgress,
  type ReadinessReport,
  type SetupAction,
  type SetupSelectionTarget,
  type SetupSnapshot,
} from "@research-video/contracts";

export const DESKTOP_CONNECTED_SENTINEL = "desktop-connected";

export type DesktopBridge = Readonly<{
  getStatus(): Promise<DesktopStatus>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  getSetup(): Promise<SetupSnapshot>;
  getReadiness(): Promise<ReadinessReport>;
  updateSetup(action: SetupAction): Promise<SetupSnapshot>;
  chooseSetupTarget(target: SetupSelectionTarget): Promise<SetupSnapshot>;
  startModelDownload(): Promise<ModelDownloadProgress>;
  cancelModelDownload(): Promise<ModelDownloadProgress>;
  onModelDownloadProgress(
    listener: (progress: ModelDownloadProgress) => void,
  ): () => void;
  request(request: DesktopApiRequest): Promise<DesktopApiResponse>;
}>;

export function desktopBridge(): DesktopBridge | undefined {
  return window.researchVideoDesktop;
}

export function isDesktopRuntime() {
  return desktopBridge() !== undefined;
}

/**
 * The desktop bridge deliberately receives a closed request shape only. In
 * particular, renderer callers cannot add headers or pass a bearer/session
 * credential through Electron IPC. Browser development keeps its existing
 * explicit credential flow so local and Playwright work remain unchanged.
 */
export async function apiFetch(
  target: "cloud" | "local",
  path: string,
  options: Pick<RequestInit, "body" | "method" | "signal"> = {},
  developmentAuthorization?: string,
): Promise<Response> {
  const body = normalizeBody(options.body);
  const request = DesktopApiRequestSchema.parse({
    target,
    method: (options.method ?? "GET").toUpperCase(),
    path,
    ...(body === undefined ? {} : { body, contentType: "application/json" }),
  });
  const bridge = desktopBridge();
  if (bridge) {
    const response = DesktopApiResponseSchema.parse(
      await bridge.request(request),
    );
    return new Response(response.body, {
      status: response.status,
      ...(response.contentType
        ? { headers: { "content-type": response.contentType } }
        : {}),
    });
  }

  return fetch(`${target === "cloud" ? "/cloud-api" : "/local-agent"}${path}`, {
    method: request.method,
    headers: {
      accept: "application/json",
      ...(developmentAuthorization
        ? { authorization: developmentAuthorization }
        : {}),
      ...(request.contentType ? { "content-type": request.contentType } : {}),
    },
    ...(body === undefined ? {} : { body }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

function normalizeBody(body: RequestInit["body"]): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  throw new TypeError("Desktop API requests require a JSON string body.");
}
