import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const csrfToken = "ab".repeat(32);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("PROD", false);
  vi.stubEnv("VITE_BROWSER_AUTH", "false");
  vi.stubEnv("VITE_MANAGED_RESEARCH", "true");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("managed browser fetch boundary", () => {
  it("accepts only a managed CSRF session, never a bearer response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ mode: "managed-local", csrfToken })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { managedResearchSession } = await import("./browser-api.ts");
    expect(await managedResearchSession()).toBe(csrfToken);
    expect(fetchMock).toHaveBeenCalledWith("/__research/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ mode: "managed-local", csrfToken: "Bearer private" }),
      ),
    );
    await expect(managedResearchSession()).rejects.toThrow("invalid");
  });

  it("strips browser-provided bearer and requires CSRF on mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const { cloudFetch, managedResearch } = await import("./browser-api.ts");
    expect(managedResearch).toBe(true);
    await cloudFetch(
      "/cloud-api/api/projects",
      { method: "POST", headers: { authorization: "Bearer forged" } },
      { authorization: "Bearer should-never-leave-browser", csrfToken },
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("x-vera-csrf")).toBe(csrfToken);
    expect(request.credentials).toBe("same-origin");
  });

  it("does not let production callers smuggle a bearer via init headers", async () => {
    vi.stubEnv("PROD", true);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const { cloudFetch, browserMode } = await import("./browser-api.ts");
    expect(browserMode).toBe(true);
    await cloudFetch(
      "/cloud-api/api/projects",
      { headers: { authorization: "Bearer forged" } },
      { authorization: "", csrfToken },
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(request.headers).has("authorization")).toBe(false);
  });

  it("does not mistake an intentionally aborted request for lost authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")),
    );
    const onUnavailable = vi.fn();
    const { cloudFetch } = await import("./browser-api.ts");
    await expect(
      cloudFetch(
        "/cloud-api/api/projects",
        {},
        {
          authorization: "managed-local",
          csrfToken,
          onUnavailable,
        },
      ),
    ).rejects.toThrow("aborted");
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

describe("host laptop unavailable behind Cloudflare", () => {
  it("treats Cloudflare gateway pages as unavailable but not our own JSON errors", async () => {
    vi.stubEnv("PROD", true);
    const { cloudFetch, hostUnreachable } = await import("./browser-api.ts");
    const html = (status: number) =>
      new Response("<html>Cloudflare tunnel error</html>", {
        status,
        headers: { "content-type": "text/html" },
      });
    const json = (status: number) =>
      new Response(JSON.stringify({ error: { code: "x" } }), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    for (const status of [502, 504, 521, 530])
      expect(hostUnreachable(html(status))).toBe(true);
    for (const response of [
      html(500),
      html(503),
      json(502),
      json(503),
      json(200),
    ])
      expect(hostUnreachable(response)).toBe(false);
    const onUnavailable = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(html(530)));
    await cloudFetch(
      "/cloud-api/api/projects",
      {},
      { authorization: "", onUnavailable },
    );
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503)));
    await cloudFetch(
      "/cloud-api/api/projects",
      {},
      { authorization: "", onUnavailable },
    );
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });
});
