import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "./api-client.ts";

afterEach(() => vi.unstubAllGlobals());

describe("desktop API client", () => {
  it("sends only the validated closed request shape to the desktop bridge", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      body: '{"ok":true}',
      contentType: "application/json",
    }));
    vi.stubGlobal("window", {
      researchVideoDesktop: {
        getStatus: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
        request,
      },
    });

    const response = await apiFetch(
      "cloud",
      "/api/projects/project-1",
      { method: "PATCH", body: '{"name":"New name"}' },
      "Bearer never-forward-this-development-value",
    );

    expect(request).toHaveBeenCalledWith({
      target: "cloud",
      method: "PATCH",
      path: "/api/projects/project-1",
      body: '{"name":"New name"}',
      contentType: "application/json",
    });
    expect(await response.json()).toEqual({ ok: true });
  });

  it("retains the explicit browser-development authorization header", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await apiFetch("local", "/api/exports", { method: "GET" }, "Bearer dev");

    expect(fetch).toHaveBeenCalledWith("/local-agent/api/exports", {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: "Bearer dev",
      },
    });
  });
});
