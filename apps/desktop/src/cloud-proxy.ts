import { timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PERMITTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const DEFAULT_MAX_REQUEST_BODY_BYTES = 1_048_576;
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 4_194_304;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface LoopbackCloudCredentialProxyOptions {
  /** The HTTPS cloud API origin; paths, credentials, query, and fragments are rejected. */
  cloudOrigin: string;
  /** The unpredictable per-launch secret used only on the loopback hop. */
  launchSecret: string;
  /** Called for every accepted request; its result never crosses the loopback boundary. */
  tokenProvider(): Promise<string>;
  fetch?: typeof globalThis.fetch;
  maxRequestBodyBytes?: number;
  maxResponseBodyBytes?: number;
  requestTimeoutMs?: number;
}

export interface LoopbackCloudCredentialProxy {
  /** The local HTTP origin, always bound to 127.0.0.1 on an ephemeral port. */
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * Starts the trusted utility-process cloud transport. It deliberately accepts
 * a closed request shape, replaces all caller headers, and obtains a new cloud
 * bearer for each request so neither renderer nor loopback clients can reuse
 * it elsewhere.
 */
export async function startLoopbackCloudCredentialProxy(
  options: LoopbackCloudCredentialProxyOptions,
): Promise<LoopbackCloudCredentialProxy> {
  const cloudOrigin = parseCloudOrigin(options.cloudOrigin);
  const launchAuthorization = `Bearer ${requireOpaqueSecret(options.launchSecret)}`;
  const requestLimit = requireBodyLimit(
    options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES,
  );
  const responseLimit = requireBodyLimit(
    options.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES,
  );
  const requestTimeoutMs = requireTimeout(
    options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const activeRequests = new Set<AbortController>();

  const server = createServer((request, response) => {
    const abort = new AbortController();
    activeRequests.add(abort);
    const timeout = setTimeout(() => abort.abort(), requestTimeoutMs);
    void handleRequest({
      request,
      response,
      cloudOrigin,
      launchAuthorization,
      tokenProvider: options.tokenProvider,
      fetch,
      requestLimit,
      responseLimit,
      signal: abort.signal,
    }).finally(() => {
      clearTimeout(timeout);
      activeRequests.delete(abort);
    });
  });

  const port = await listenLoopback(server);
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const request of activeRequests) request.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
            ? reject(error)
            : resolve(),
        );
      });
    },
  };
}

interface RequestHandlerOptions {
  request: IncomingMessage;
  response: ServerResponse;
  cloudOrigin: URL;
  launchAuthorization: string;
  tokenProvider(): Promise<string>;
  fetch: typeof globalThis.fetch;
  requestLimit: number;
  responseLimit: number;
  signal: AbortSignal;
}

async function handleRequest(options: RequestHandlerOptions): Promise<void> {
  const { request, response } = options;
  try {
    if (!hasExactAuthorization(request, options.launchAuthorization)) {
      replyError(response, 401, "local_authentication_required");
      return;
    }
    const target = parseApiTarget(request);
    if (!target) {
      replyError(response, 404, "not_found");
      return;
    }

    const requestBody = await readRequestBody(request, options.requestLimit);
    const token = await options.tokenProvider();
    if (!isBearerToken(token)) {
      throw new LocalAuthenticationUnavailableError();
    }

    const upstream = await options.fetch(
      new URL(`${target.pathname}${target.search}`, options.cloudOrigin),
      {
        method: target.method,
        // Do not carry any renderer/loopback headers upstream. The local
        // secret is never sent to the cloud, and the cloud bearer never goes
        // back to the loopback caller.
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(requestBody.byteLength > 0
            ? { "content-type": "application/json" }
            : {}),
        },
        ...(requestBody.byteLength > 0
          ? { body: blobFromBytes(requestBody) }
          : {}),
        redirect: "error",
        signal: options.signal,
      },
    );
    if (upstream.redirected) {
      throw new UpstreamUnavailableError();
    }
    const body = await readResponseBody(upstream, options.responseLimit);
    response.writeHead(normalizeStatus(upstream.status), {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
    });
    response.end(body);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      replyError(response, 413, "request_too_large");
      return;
    }
    if (error instanceof InvalidRequestBodyError) {
      replyError(response, 400, "invalid_request");
      return;
    }
    if (error instanceof LocalAuthenticationUnavailableError) {
      replyError(response, 401, "authentication_required");
      return;
    }
    replyError(response, 502, "cloud_unavailable");
  }
}

function parseCloudOrigin(value: string): URL {
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new RangeError("Cloud proxy requires an HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new RangeError("Cloud proxy requires an HTTPS origin.");
  }
  return origin;
}

function requireOpaqueSecret(value: string): string {
  if (
    value.length < 32 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new RangeError("Loopback launch secret is invalid.");
  }
  return value;
}

function requireBodyLimit(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1_024 ||
    value > 64 * 1_024 * 1_024
  ) {
    throw new RangeError("Cloud proxy body limit is invalid.");
  }
  return value;
}

function requireTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
    throw new RangeError("Cloud proxy timeout is invalid.");
  }
  return value;
}

function hasExactAuthorization(
  request: IncomingMessage,
  expected: string,
): boolean {
  const values = request.rawHeaders
    .filter((_value, index) => index % 2 === 0)
    .map((name, index) =>
      name.toLowerCase() === "authorization"
        ? request.rawHeaders[index * 2 + 1]
        : undefined,
    )
    .filter((value): value is string => value !== undefined);
  if (values.length !== 1 || !values[0]) return false;
  const actualBytes = Buffer.from(values[0]);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function parseApiTarget(
  request: IncomingMessage,
): { method: string; pathname: string; search: string } | undefined {
  const method = request.method?.toUpperCase();
  if (!method || !PERMITTED_METHODS.has(method) || !request.url) {
    return undefined;
  }
  const rawPath = request.url.split("?", 1)[0] ?? "";
  if (
    !rawPath.startsWith("/api/") ||
    rawPath.includes("\\") ||
    /%(?:2f|5c)/i.test(rawPath) ||
    /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath) ||
    rawPath.includes("//")
  ) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(request.url, "http://127.0.0.1");
  } catch {
    return undefined;
  }
  if (url.origin !== "http://127.0.0.1" || !url.pathname.startsWith("/api/")) {
    return undefined;
  }
  return { method, pathname: url.pathname, search: url.search };
}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = request.headers["content-length"];
  if (
    typeof declaredLength === "string" &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new RequestBodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      request.destroy();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, bytes);
}

async function readResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    await response.body?.cancel();
    throw new UpstreamUnavailableError();
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new UpstreamUnavailableError();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isBearerToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 16_384 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function blobFromBytes(bytes: Uint8Array): Blob {
  // Copy into an ArrayBuffer-backed view: TypeScript rightly distinguishes a
  // possible SharedArrayBuffer view from a fetch BodyInit.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer]);
}

function normalizeStatus(status: number): number {
  return Number.isInteger(status) && status >= 200 && status <= 599
    ? status
    : 502;
}

function replyError(
  response: ServerResponse,
  status: number,
  code: string,
): void {
  if (response.headersSent) return;
  const body = Buffer.from(JSON.stringify({ error: { code } }));
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.byteLength),
    "cache-control": "no-store",
  });
  response.end(body);
}

function listenLoopback(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const rejectOnce = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", rejectOnce);
      const address = server.address();
      if (
        !address ||
        typeof address === "string" ||
        address.address !== "127.0.0.1"
      ) {
        reject(
          new Error("Loopback cloud proxy did not bind to IPv4 loopback."),
        );
        return;
      }
      resolve(address.port);
    };
    server.once("error", rejectOnce);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

class RequestBodyTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}
class LocalAuthenticationUnavailableError extends Error {}
class UpstreamUnavailableError extends Error {}
