import { afterEach, describe, expect, it, vi } from "vitest";

import { startLoopbackCloudCredentialProxy } from "./cloud-proxy.ts";

const launchSecret = "u".repeat(43);
const cloudBearer = "cloud-access-token-not-for-renderers";
const liveProxies: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(liveProxies.splice(0).map((proxy) => proxy.close()));
});

async function start(
  options: Parameters<typeof startLoopbackCloudCredentialProxy>[0],
) {
  const proxy = await startLoopbackCloudCredentialProxy(options);
  liveProxies.push(proxy);
  return proxy;
}

function localHeaders(extra: HeadersInit = {}): Headers {
  return new Headers({ authorization: `Bearer ${launchSecret}`, ...extra });
}

describe("loopback cloud credential proxy", () => {
  it("binds literal IPv4 loopback, strips caller headers, and injects a fresh cloud bearer", async () => {
    const tokenProvider = vi.fn(async () => cloudBearer);
    const upstream = vi.fn(
      async () =>
        new Response(JSON.stringify({ projectId: "project-1" }), {
          status: 201,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": "cloud-session=must-not-cross-loopback",
            location: "https://untrusted.example/never-forwarded",
          },
        }),
    );
    const proxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider,
      fetch: upstream,
    });

    const response = await fetch(`${proxy.origin}/api/projects?limit=1`, {
      method: "POST",
      headers: localHeaders({
        cookie: "renderer-cookie=must-not-forward",
        origin: "https://untrusted.example",
        "x-forwarded-for": "203.0.113.1",
      }),
      body: JSON.stringify({ name: "Research" }),
    });

    expect(proxy.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(response.status).toBe(201);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ projectId: "project-1" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledWith(
      new URL("https://api.example.test/api/projects?limit=1"),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${cloudBearer}`,
          "content-type": "application/json",
        },
      }),
    );
    expect(responseBody).not.toContain(cloudBearer);
  });

  it("requires exactly the current per-launch bearer before token lookup or forwarding", async () => {
    const tokenProvider = vi.fn(async () => cloudBearer);
    const upstream = vi.fn(async () => new Response("{}"));
    const proxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider,
      fetch: upstream,
    });

    for (const authorization of [
      undefined,
      "Bearer wrong-secret",
      `bearer ${launchSecret}`,
    ]) {
      const response = await fetch(`${proxy.origin}/api/projects`, {
        ...(authorization ? { headers: { authorization } } : {}),
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(cloudBearer);
    }
    expect(tokenProvider).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards bounded DELETE commands for authenticated comment tombstones", async () => {
    const upstream = vi.fn(async () => new Response("{}"));
    const proxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => cloudBearer,
      fetch: upstream,
    });
    const response = await fetch(
      `${proxy.origin}/api/projects/project-1/clips/clip-1/comments/comment-1`,
      {
        method: "DELETE",
        headers: localHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          idempotencyKey: "delete-1",
          expectedVersion: 1,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith(
      new URL(
        "https://api.example.test/api/projects/project-1/clips/clip-1/comments/comment-1",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([
    ["HEAD", "/api/projects"],
    ["OPTIONS", "/api/projects"],
    ["GET", "/not-api/projects"],
    ["GET", "/api/../private"],
    ["GET", "/api/%2f%2fevil.example"],
    ["GET", "/api//evil.example"],
  ])(
    "rejects closed method/path input %s %s before credential lookup",
    async (method, path) => {
      const tokenProvider = vi.fn(async () => cloudBearer);
      const upstream = vi.fn(async () => new Response("{}"));
      const proxy = await start({
        cloudOrigin: "https://api.example.test",
        launchSecret,
        tokenProvider,
        fetch: upstream,
      });

      const response = await fetch(`${proxy.origin}${path}`, {
        method,
        headers: localHeaders(),
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("bounds request and streamed response bytes while returning only stable errors", async () => {
    const requestProxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => cloudBearer,
      fetch: vi.fn(async () => new Response("{}")),
      maxRequestBodyBytes: 1_024,
    });
    const oversizedRequest = await fetch(
      `${requestProxy.origin}/api/projects`,
      {
        method: "POST",
        headers: localHeaders(),
        body: "x".repeat(1_025),
      },
    );
    expect(oversizedRequest.status).toBe(413);

    const responseProxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => cloudBearer,
      fetch: vi.fn(async () => new Response("y".repeat(1_025))),
      maxResponseBodyBytes: 1_024,
    });
    const oversizedResponse = await fetch(
      `${responseProxy.origin}/api/projects`,
      {
        headers: localHeaders(),
      },
    );
    expect(oversizedResponse.status).toBe(502);
    expect(await oversizedResponse.text()).not.toContain(cloudBearer);
  });

  it("rejects upstream redirects and inaccessible provider credentials without leaking them", async () => {
    const redirect = new Response("redirect", { status: 302 });
    Object.defineProperty(redirect, "redirected", { value: true });
    const redirectedProxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => cloudBearer,
      fetch: vi.fn(async () => redirect),
    });
    const redirected = await fetch(`${redirectedProxy.origin}/api/projects`, {
      headers: localHeaders(),
    });
    expect(redirected.status).toBe(502);

    const unavailableProxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => {
        throw new Error(cloudBearer);
      },
      fetch: vi.fn(async () => new Response("{}")),
    });
    const unavailable = await fetch(`${unavailableProxy.origin}/api/projects`, {
      headers: localHeaders(),
    });
    expect(unavailable.status).toBe(502);
    expect(await unavailable.text()).not.toContain(cloudBearer);
  });

  it("aborts in-flight upstream work during bounded desktop shutdown", async () => {
    const upstream = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const proxy = await start({
      cloudOrigin: "https://api.example.test",
      launchSecret,
      tokenProvider: async () => cloudBearer,
      fetch: upstream,
      requestTimeoutMs: 60_000,
    });
    const pending = fetch(`${proxy.origin}/api/projects`, {
      headers: localHeaders(),
    });
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));

    await expect(proxy.close()).resolves.toBeUndefined();
    await expect(pending).rejects.toThrow();
  });

  it.each([
    "http://api.example.test",
    "https://user:password@api.example.test",
    "https://api.example.test/nested",
    "https://api.example.test?query=yes",
    "https://api.example.test#fragment",
  ])("rejects non-origin cloud configuration %s", async (cloudOrigin) => {
    await expect(
      startLoopbackCloudCredentialProxy({
        cloudOrigin,
        launchSecret,
        tokenProvider: async () => cloudBearer,
      }),
    ).rejects.toThrow("HTTPS origin");
  });
});
