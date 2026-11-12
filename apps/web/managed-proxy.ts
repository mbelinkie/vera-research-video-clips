import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin, ProxyOptions } from "vite";

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameSecret(supplied: string | undefined, expected: string): boolean {
  if (!supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export type ManagedProxySettings = {
  authorization: string;
  csrf: string;
  webPort: number;
};

/** No authentication secrets are ever returned to React or copied into VITE_* variables. */
export function managedResearchGuard(settings: ManagedProxySettings) {
  const origin = `http://127.0.0.1:${settings.webPort}`;
  return (
    request: IncomingMessage,
    reply: ServerResponse,
    next: () => void,
  ) => {
    const path = (request.url ?? "").split("?", 1)[0] ?? "";
    const relevant =
      path === "/__research/session" ||
      path === "/cloud-api" ||
      path.startsWith("/cloud-api/") ||
      path === "/local-agent" ||
      path.startsWith("/local-agent/");
    if (!relevant) return next();
    const allowedPath =
      path === "/__research/session" ||
      /^\/(?:cloud-api|local-agent)\/(?:api(?:\/|$)|health$)/u.test(path);
    const sameHost = request.headers.host === `127.0.0.1:${settings.webPort}`;
    const sameOrigin =
      request.headers.origin === undefined || request.headers.origin === origin;
    const fetchSite = request.headers["sec-fetch-site"];
    const sameSite =
      fetchSite === undefined ||
      fetchSite === "same-origin" ||
      fetchSite === "none";
    const isMutation = mutating.has((request.method ?? "GET").toUpperCase());
    const noBrowserBearer = request.headers.authorization === undefined;
    const correctCsrf =
      !isMutation ||
      (request.headers.origin === origin &&
        typeof request.headers["x-vera-csrf"] === "string" &&
        sameSecret(request.headers["x-vera-csrf"], settings.csrf));
    // Reject encoded path tricks, requests from unrelated pages, and attempts
    // to smuggle arbitrary bearer identities through the private reverse proxy.
    if (
      !allowedPath ||
      /[%\\]|\/\.|\/\//u.test(path) ||
      !sameHost ||
      !sameOrigin ||
      !sameSite ||
      !noBrowserBearer ||
      !correctCsrf
    ) {
      reply.writeHead(403, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      reply.end(
        '{"error":{"code":"managed_request_denied","message":"This local Research request was refused."}}',
      );
      return;
    }
    if (path === "/__research/session") {
      if (request.method !== "GET") {
        reply.writeHead(405, { allow: "GET" });
        reply.end();
        return;
      }
      reply.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      reply.end(
        JSON.stringify({ mode: "managed-local", csrfToken: settings.csrf }),
      );
      return;
    }
    next();
  };
}

export function managedResearchProxyOptions(
  target: string,
  settings: ManagedProxySettings,
): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/(?:cloud-api|local-agent)/u, ""),
    configure(proxy) {
      proxy.on("proxyReq", (proxyRequest) => {
        proxyRequest.removeHeader("cookie");
        proxyRequest.removeHeader("origin");
        proxyRequest.removeHeader("referer");
        proxyRequest.removeHeader("x-vera-csrf");
        proxyRequest.removeHeader("x-forwarded-for");
        proxyRequest.removeHeader("x-forwarded-host");
        proxyRequest.removeHeader("x-forwarded-proto");
        proxyRequest.setHeader("authorization", settings.authorization);
      });
    },
  };
}

export function managedResearchPlugin(settings: ManagedProxySettings): Plugin {
  if (
    !/^Bearer [0-9a-f-]{36}\|managed:[0-9a-f-]{36}$/iu.test(
      settings.authorization,
    ) ||
    !/^[0-9a-f]{64}$/iu.test(settings.csrf)
  )
    throw new Error(
      "Managed Research requires private launcher-provided proxy and CSRF credentials.",
    );
  return {
    name: "research-managed-proxy-guard",
    configureServer(server) {
      server.middlewares.use(managedResearchGuard(settings));
    },
  };
}
