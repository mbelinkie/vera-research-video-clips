/**
 * Mac pilot operations (#53): write admission, disk-space pause, bounded
 * diagnostics counters and the loopback-only operator listener.
 *
 * The public listener is reachable through the Cloudflare tunnel, whose
 * connector also connects from 127.0.0.1, so "loopback" alone no longer
 * proves a request came from the Producer's own laptop. Operator endpoints
 * therefore live on a separate port that the tunnel never targets, and that
 * listener additionally refuses any proxy or Cloudflare header.
 */
import { statfs } from "node:fs/promises";

import Fastify, { type FastifyInstance } from "fastify";

import { pilotBackupGateIsActive } from "@research-video/db-cloud";

export class PilotWritesPausedError extends Error {
  readonly statusCode = 507;
  readonly code = "host_disk_low";
  constructor() {
    super(
      "Saving is paused because the host laptop is nearly out of disk space. Reading still works.",
    );
  }
}

/** Free-space probe for the volume that holds transcripts (and usually PostgreSQL). */
export class DiskSpaceMonitor {
  private cached: { at: number; freeBytes: number } | undefined;
  constructor(
    private readonly path: string,
    private readonly pauseBelowBytes: number,
    private readonly now: () => number = Date.now,
    private readonly probe: (path: string) => Promise<number> = async (p) => {
      const info = await statfs(p);
      return Number(info.bavail) * Number(info.bsize);
    },
    private readonly cacheMs = 15_000,
  ) {}

  async freeBytes(): Promise<number> {
    const at = this.now();
    if (this.cached && at - this.cached.at < this.cacheMs)
      return this.cached.freeBytes;
    const freeBytes = await this.probe(this.path);
    this.cached = { at, freeBytes };
    return freeBytes;
  }

  async paused(): Promise<boolean> {
    try {
      return (await this.freeBytes()) < this.pauseBelowBytes;
    } catch {
      // An unreadable volume is not evidence that a write can succeed.
      return true;
    }
  }

  get thresholdBytes(): number {
    return this.pauseBelowBytes;
  }
}

/** Tracks admitted writes so a backup can drain them, and refuses new ones when unsafe. */
export class PilotWriteGate {
  inFlightWrites = 0;
  constructor(
    readonly objectRoot: string,
    private readonly disk?: DiskSpaceMonitor,
  ) {}

  writesBlocked(): Promise<boolean> {
    return pilotBackupGateIsActive(this.objectRoot);
  }

  async diskPaused(): Promise<boolean> {
    return this.disk ? this.disk.paused() : false;
  }

  async status() {
    return {
      writesBlocked: await this.writesBlocked(),
      inFlightWrites: this.inFlightWrites,
      diskPaused: await this.diskPaused(),
    };
  }
}

type CounterName =
  | "signedOut"
  | "forbidden"
  | "accessDenied"
  | "callbackFailed"
  | "writesPaused"
  | "serverErrors";

/** Bounded, process-lifetime counters. No user identifiers, URLs or tokens are kept. */
export class OperatorCounters {
  readonly startedAt: string;
  private readonly counts: Record<CounterName, number> = {
    signedOut: 0,
    forbidden: 0,
    accessDenied: 0,
    callbackFailed: 0,
    writesPaused: 0,
    serverErrors: 0,
  };
  private readonly lastAt: Partial<Record<CounterName, string>> = {};

  constructor(private readonly now: () => Date = () => new Date()) {
    this.startedAt = now().toISOString();
  }

  record(statusCode: number, routeUrl: string, errorCode?: string): void {
    let name: CounterName | undefined;
    if (statusCode === 401) name = "signedOut";
    else if (statusCode === 403)
      name = errorCode === "access_denied" ? "accessDenied" : "forbidden";
    else if (statusCode === 400 && routeUrl.startsWith("/auth/callback"))
      name = "callbackFailed";
    else if (statusCode === 507 || statusCode === 503) name = "writesPaused";
    else if (statusCode >= 500) name = "serverErrors";
    if (!name) return;
    this.counts[name] = Math.min(
      this.counts[name] + 1,
      Number.MAX_SAFE_INTEGER,
    );
    this.lastAt[name] = this.now().toISOString();
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      counts: { ...this.counts },
      lastAt: { ...this.lastAt },
    };
  }
}

const proxyHeaderPattern = /^(?:x-forwarded-|forwarded$|cf-|x-real-ip$)/u;

/**
 * A loopback-only operator listener for `pilot status`, backups and drills.
 * Never point the tunnel at this port.
 */
export function createOperatorApi(options: {
  port: number;
  gate?: PilotWriteGate;
  counters: OperatorCounters;
  disk?: DiskSpaceMonitor;
  publicOrigin?: string;
}): FastifyInstance {
  const app = Fastify({ logger: false });
  const allowedHosts = new Set([
    `127.0.0.1:${options.port}`,
    `localhost:${options.port}`,
    `[::1]:${options.port}`,
  ]);
  app.addHook("onRequest", async (request, reply) => {
    const proxied = Object.keys(request.headers).some((name) =>
      proxyHeaderPattern.test(name.toLowerCase()),
    );
    // Host allowlist defeats DNS rebinding from a page in the Producer's browser.
    if (
      proxied ||
      !allowedHosts.has(request.headers.host ?? "") ||
      request.method !== "GET"
    )
      return reply.code(404).send({ error: { code: "not_found" } });
  });
  app.get("/health", async () => ({
    service: "cloud-api-operator",
    status: "ok",
    timestamp: new Date().toISOString(),
  }));
  app.get("/__maintenance/status", async () =>
    options.gate
      ? options.gate.status()
      : { writesBlocked: false, inFlightWrites: 0, diskPaused: false },
  );
  app.get("/__operator/diagnostics", async () => ({
    pid: process.pid,
    node: process.version,
    publicOrigin: options.publicOrigin ?? null,
    process: options.counters.snapshot(),
    maintenance: options.gate ? await options.gate.status() : null,
    disk: options.disk
      ? {
          freeBytes: await options.disk.freeBytes().catch(() => null),
          pauseBelowBytes: options.disk.thresholdBytes,
        }
      : null,
  }));
  return app;
}
