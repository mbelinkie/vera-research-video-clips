import { describe, expect, it, vi } from "vitest";
import { PublicEgressGuard, type TransportRequest } from "./timeline-egress.ts";

const url = "https://allowed.fixture.example/article";
const approved = { address: "93.184.216.34", family: 4 as const };
const nonPublic = { address: "192.168.1.10", family: 4 as const };
function response(address = approved.address) {
  return {
    remoteAddress: address,
    status: 200,
    headers: {},
    body: Buffer.from("Synthetic response"),
    tls: {
      availability: "unavailable" as const,
      protocol: null,
      cipher: null,
      peerCertificateSha256: null,
      unavailableReason: "Synthetic fixture",
    },
  };
}

describe("Timeline public-page egress in the Mac agent", () => {
  it("pins a public answer and supplies only anonymous request headers", async () => {
    const request = vi.fn(async (_input: TransportRequest) => response());
    const guard = new PublicEgressGuard(
      { resolve: async () => [approved] },
      { request },
    );
    await expect(guard.fetch(url)).resolves.toMatchObject({ status: 200 });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pinnedAddress: approved.address,
        method: "GET",
      }),
    );
    expect(Object.keys(request.mock.calls[0]![0].headers).sort()).toEqual([
      "accept",
      "user-agent",
    ]);
  });

  it("rejects mixed public and nonpublic DNS answers before transport", async () => {
    const request = vi.fn();
    const guard = new PublicEgressGuard(
      { resolve: async () => [approved, nonPublic] },
      { request },
    );
    await expect(guard.fetch(url)).rejects.toMatchObject({
      code: "dns_not_public",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("declines signed addresses before DNS and transport", async () => {
    const resolve = vi.fn();
    const request = vi.fn();
    const guard = new PublicEgressGuard({ resolve }, { request });
    await expect(
      guard.fetch(`${url}?X-Amz-Signature=synthetic`),
    ).rejects.toMatchObject({ code: "credential_shape_not_allowed" });
    expect(resolve).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("validates a redirect's DNS before opening a second connection", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValueOnce([approved])
      .mockResolvedValueOnce([nonPublic]);
    const request = vi.fn(async () => ({
      ...response(),
      status: 302,
      headers: { location: "https://denied.fixture.example/story" },
    }));
    const guard = new PublicEgressGuard({ resolve }, { request });
    await expect(guard.fetch(url)).rejects.toMatchObject({
      code: "dns_not_public",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a peer that does not match the pinned address", async () => {
    const guard = new PublicEgressGuard(
      { resolve: async () => [approved] },
      {
        request: async () => response(nonPublic.address),
      },
    );
    await expect(guard.fetch(url)).rejects.toMatchObject({
      code: "peer_mismatch",
    });
  });

  it("does not connect after a deadline expires during DNS", async () => {
    const controller = new AbortController();
    const request = vi.fn();
    const guard = new PublicEgressGuard(
      {
        resolve: async () => {
          controller.abort();
          return [approved];
        },
      },
      { request },
    );
    await expect(
      guard.fetch(url, "GET", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });
});
