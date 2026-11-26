import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("requires a registered account before approving a Chrome connection", async () => {
  vi.stubEnv("VITE_BROWSER_AUTH", "true");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ authenticated: true, registered: false }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const { captureSession } = await import("./capture-session.ts");
  await expect(captureSession()).rejects.toThrow("Sign in");
  expect(fetchMock).toHaveBeenCalledWith("/cloud-api/api/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
});
it("rejects the plain development bearer mode", async () => {
  vi.stubEnv("PROD", false);
  vi.stubEnv("VITE_MANAGED_RESEARCH", "false");
  vi.stubEnv("VITE_BROWSER_AUTH", "false");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { captureSession } = await import("./capture-session.ts");
  await expect(captureSession()).rejects.toThrow("signed-in or managed");
  expect(fetchMock).not.toHaveBeenCalled();
});
