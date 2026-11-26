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

  it("transfers retained image bytes and limits multipart writes to Research picture routes", async () => {
    const project = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const base = `/api/projects/${project}`;
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const request = vi.fn(async () => ({
      status: 200,
      body: "",
      bytes,
      contentType: "image/png",
    }));
    vi.stubGlobal("window", {
      location: { href: "https://desktop.invalid/" },
      researchVideoDesktop: { request },
    });
    const response = await apiFetch(
      "cloud",
      `${base}/stills/${project}/assets/thumbnail`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const form = new FormData();
    form.set("image", new Blob([bytes], { type: "image/png" }), "fixture.png");
    await apiFetch("cloud", `${base}/stills/from-file`, {
      method: "POST",
      body: form,
    });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: `${base}/stills/from-file`,
        contentType: expect.stringMatching(/^multipart\/form-data; boundary=/u),
        bytes: expect.any(Uint8Array),
      }),
    );
    await expect(
      apiFetch("cloud", `${base}/sources`, { method: "POST", body: form }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("restricts raw Speech bytes to the authenticated workstation route", async () => {
    const project = "019fbb95-cd76-7920-93fa-e23ba755ee40";
    const path = `/api/projects/${project}/audio/${project}/transcript`;
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const request = vi.fn(async () => ({ status: 200, body: "{}" }));
    vi.stubGlobal("window", { researchVideoDesktop: { request } });
    const body = new Blob([bytes], { type: "audio/wav" });
    await apiFetch("local", path, { method: "POST", body });
    expect(request).toHaveBeenCalledExactlyOnceWith({
      target: "local",
      path,
      method: "POST",
      bytes,
      contentType: "application/octet-stream",
    });
    await expect(
      apiFetch("cloud", path, { method: "POST", body }),
    ).rejects.toThrow();
    await expect(
      apiFetch("local", path + "?other=true", { method: "POST", body }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
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
