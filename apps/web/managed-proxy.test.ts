import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import {
  managedResearchGuard,
  managedResearchPlugin,
  managedResearchProxyOptions,
} from "./managed-proxy.ts";

const authorization =
  "Bearer 83d2ba23-ea11-4343-8c2b-a19a821f7a12|managed:76495c1e-3d89-4f0b-a9a1-2320d1a492f6";
const csrf = "ab".repeat(32);
const origin = "http://127.0.0.1:43112";
const settings = { authorization, csrf, webPort: 43112 };

function request(
  options: {
    path?: string;
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  let status = 0;
  let body = "";
  let nextCalled = false;
  const req = {
    url: options.path ?? "/cloud-api/api/projects",
    method: options.method ?? "GET",
    headers: {
      host: "127.0.0.1:43112",
      "sec-fetch-site": "same-origin",
      ...options.headers,
    },
  } as unknown as IncomingMessage;
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(value?: string) {
      body = value ?? "";
      return res;
    },
  } as unknown as ServerResponse;
  managedResearchGuard(settings)(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

describe("managed loopback reverse-proxy guard", () => {
  it("allows local reads but never returns a bearer to the browser", () => {
    expect(request().nextCalled).toBe(true);
    expect(
      request({ path: "/local-agent/api/projects/anything" }).nextCalled,
    ).toBe(true);
    const response = request({ path: "/__research/session" });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      mode: "managed-local",
      csrfToken: csrf,
    });
    expect(response.body).not.toContain("Bearer");
  });

  it("requires the correct same-origin CSRF token for every mutation", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(request({ method }).status).toBe(403);
      expect(request({ method, headers: { origin } }).status).toBe(403);
      expect(
        request({ method, headers: { origin, "x-vera-csrf": "forged" } })
          .status,
      ).toBe(403);
      expect(
        request({ method, headers: { origin, "x-vera-csrf": "cd".repeat(32) } })
          .status,
      ).toBe(403);
      expect(
        request({ method, headers: { origin, "x-vera-csrf": csrf } })
          .nextCalled,
      ).toBe(true);
    }
  });

  it("rejects cross-site origin, DNS rebinding, cross-site fetch and browser bearer override", () => {
    for (const headers of [
      { origin: "https://evil.example" },
      { host: "evil.example" },
      { "sec-fetch-site": "cross-site" },
      { authorization: authorization },
      { authorization: "Bearer forged" },
    ])
      expect(request({ headers }).status).toBe(403);
    expect(
      request({
        method: "POST",
        headers: { origin: "https://evil.example", "x-vera-csrf": csrf },
      }).status,
    ).toBe(403);
  });

  it("does not proxy signed object, arbitrary, encoded or dot-segment paths", () => {
    for (const path of [
      "/cloud-api/__objects/token",
      "/local-agent/__objects/token",
      "/cloud-api/auth/logout",
      "/cloud-api/api/../__objects/token",
      "/cloud-api/api/%2e%2e/__objects/token",
      "/cloud-api/api//projects",
      "/local-agent/evil/path",
    ])
      expect(request({ path }).status, path).toBe(403);
  });

  it("injects the server-side owner identity only after the guard; strips request cookies and CSRF", () => {
    const proxy = new EventEmitter();
    const options = managedResearchProxyOptions(
      "http://127.0.0.1:43111",
      settings,
    );
    options.configure?.(proxy as never, {} as never);
    const headers = new Map<string, string>([
      ["cookie", "untrusted=1"],
      ["x-vera-csrf", csrf],
      ["origin", origin],
    ]);
    const forwarded = {
      setHeader(key: string, value: string) {
        headers.set(key, value);
      },
      removeHeader(key: string) {
        headers.delete(key);
      },
    };
    proxy.emit("proxyReq", forwarded);
    expect(headers.get("authorization")).toBe(authorization);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("x-vera-csrf")).toBe(false);
    expect(headers.has("origin")).toBe(false);
    expect(options.rewrite?.("/cloud-api/api/projects")).toBe("/api/projects");
  });

  it("refuses startup without the required proxy and CSRF material", () => {
    expect(() =>
      managedResearchPlugin({ ...settings, authorization: "" }),
    ).toThrow();
    expect(() => managedResearchPlugin({ ...settings, csrf: "bad" })).toThrow();
    expect(managedResearchPlugin(settings).name).toBe(
      "research-managed-proxy-guard",
    );
  });
});
