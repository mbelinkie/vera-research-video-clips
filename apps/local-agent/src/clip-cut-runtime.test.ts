import { describe, expect, it, vi } from "vitest";

import { HttpProjectClipCatalog } from "./clip-cut-runtime.ts";

const projectId = "019fbb95-cd76-7920-93fa-e23ba755e391";
const clipId = "019fbb95-cd76-7920-93fa-e23ba755e392";

describe("authenticated cloud clip reader", () => {
  it("forwards the caller bearer only to the configured cloud GET without redirects", async () => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    const reader = new HttpProjectClipCatalog(
      "http://127.0.0.1:43111",
      fetcher as typeof fetch,
    );
    await expect(
      reader.getAuthorizedClip({
        projectId,
        clipId,
        authorization: "Bearer test-secret",
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe(
      `http://127.0.0.1:43111/api/projects/${projectId}/clips/${clipId}`,
    );
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      headers: {
        accept: "application/json",
        authorization: "Bearer test-secret",
      },
      redirect: "error",
    });
  });

  it("refuses member denial or cloud failure with sanitized status messages", async () => {
    for (const status of [401, 403, 404, 500]) {
      const reader = new HttpProjectClipCatalog(
        "http://127.0.0.1:43111",
        vi.fn(
          async () => new Response("Do not print credentials", { status }),
        ) as typeof fetch,
      );
      await expect(
        reader.getAuthorizedClip({
          projectId,
          clipId,
          authorization: "Bearer private-value",
        }),
      ).rejects.toMatchObject({
        statusCode: status === 500 ? 502 : status,
      });
    }
  });

  it("does not follow redirects and cannot interpret a broken catalog response as authority", async () => {
    const reader = new HttpProjectClipCatalog(
      "http://127.0.0.1:43111",
      vi.fn(async () => {
        throw new TypeError("fetch redirect not followed");
      }) as typeof fetch,
    );
    await expect(
      reader.getAuthorizedClip({
        projectId,
        clipId,
        authorization: "Bearer private-value",
      }),
    ).rejects.toMatchObject({ statusCode: 502 });
  });
});
