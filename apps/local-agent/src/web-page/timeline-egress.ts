// Timeline policy.ts at 4472ddeb1c8b882e6aa1ee318f36ecf551710d8f.
// See README.md for upstream and the Research-specific transport limits.
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { TLSSocket } from "node:tls";
import { domainToASCII } from "node:url";

export type AddressClass =
  | "public"
  | "loopback"
  | "private"
  | "link_local"
  | "multicast"
  | "unspecified"
  | "reserved";

export interface AddressAssessment {
  readonly address: string;
  readonly family: 4 | 6;
  readonly addressClass: AddressClass;
}

export interface InspectedPublicUrl {
  readonly url: URL;
  readonly canonicalUrl: string;
  readonly redactedUrl: string;
  readonly queryKeys: readonly string[];
}

export class CaptureDenied extends Error {
  override readonly name = "CaptureDenied";

  constructor(
    readonly code: string,
    readonly safeMessage: string,
    readonly phase:
      | "url_parse"
      | "dns"
      | "connect"
      | "frame"
      | "redirect"
      | "response"
      | "subresource",
    readonly navigationStarted = false,
  ) {
    super(safeMessage);
  }
}

const secretQueryKeys = new Set([
  "access_token",
  "api-key",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "credential",
  "jwt",
  "key-pair-id",
  "password",
  "secret",
  "session",
  "sig",
  "signature",
  "token",
  "x-api-key",
]);

const localNameSuffixes = [
  ".home",
  ".home.arpa",
  ".internal",
  ".lan",
  ".local",
  ".localhost",
];

function deny(
  code: string,
  safeMessage: string,
  phase: CaptureDenied["phase"],
): never {
  throw new CaptureDenied(code, safeMessage, phase);
}

function v4Integer(address: string): number {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    deny("invalid_address", "A DNS answer was not a valid IP address.", "dns");
  }
  return (
    ((octets[0]! << 24) |
      (octets[1]! << 16) |
      (octets[2]! << 8) |
      octets[3]!) >>>
    0
  );
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (v4Integer(base) & mask);
}

function expandIpv6(input: string): bigint {
  let address = input;
  const withoutZone = address.split("%", 1)[0]!;
  if (withoutZone.includes(".")) {
    const lastColon = withoutZone.lastIndexOf(":");
    const embedded = withoutZone.slice(lastColon + 1);
    if (isIP(embedded) !== 4) {
      deny(
        "invalid_address",
        "A DNS answer was not a valid IP address.",
        "dns",
      );
    }
    const value = v4Integer(embedded);
    address = `${withoutZone.slice(0, lastColon)}:${(value >>> 16).toString(16)}:${(
      value & 0xffff
    ).toString(16)}`;
  } else {
    address = withoutZone;
  }

  const halves = address.split("::");
  if (halves.length > 2) {
    deny("invalid_address", "A DNS answer was not a valid IP address.", "dns");
  }
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = 8 - left.length - right.length;
  if ((halves.length === 1 && omitted !== 0) || omitted < 0) {
    deny("invalid_address", "A DNS answer was not a valid IP address.", "dns");
  }
  const groups =
    halves.length === 2
      ? [...left, ...Array<string>(omitted).fill("0"), ...right]
      : left;
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))
  ) {
    deny("invalid_address", "A DNS answer was not a valid IP address.", "dns");
  }
  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)),
    0n,
  );
}

function inV6Range(value: bigint, base: string, prefix: number): boolean {
  const shift = 128n - BigInt(prefix);
  return value >> shift === expandIpv6(base) >> shift;
}

function classifyV4(address: string): AddressAssessment {
  const value = v4Integer(address);
  const addressClass: AddressClass = inV4Range(value, "0.0.0.0", 8)
    ? "unspecified"
    : inV4Range(value, "127.0.0.0", 8)
      ? "loopback"
      : inV4Range(value, "169.254.0.0", 16)
        ? "link_local"
        : inV4Range(value, "10.0.0.0", 8) ||
            inV4Range(value, "100.64.0.0", 10) ||
            inV4Range(value, "172.16.0.0", 12) ||
            inV4Range(value, "192.168.0.0", 16)
          ? "private"
          : inV4Range(value, "224.0.0.0", 4)
            ? "multicast"
            : inV4Range(value, "192.0.0.0", 24) ||
                inV4Range(value, "192.0.2.0", 24) ||
                inV4Range(value, "192.88.99.0", 24) ||
                inV4Range(value, "198.18.0.0", 15) ||
                inV4Range(value, "198.51.100.0", 24) ||
                inV4Range(value, "203.0.113.0", 24) ||
                inV4Range(value, "240.0.0.0", 4)
              ? "reserved"
              : "public";
  return { address, family: 4, addressClass };
}

export function classifyAddress(address: string): AddressAssessment {
  const family = isIP(address);
  if (family === 4) return classifyV4(address);
  if (family !== 6) {
    deny("invalid_address", "A DNS answer was not a valid IP address.", "dns");
  }

  const value = expandIpv6(address);
  if (inV6Range(value, "::ffff:0:0", 96)) {
    const mapped = Number(value & 0xffffffffn);
    return classifyV4(
      [
        (mapped >>> 24) & 0xff,
        (mapped >>> 16) & 0xff,
        (mapped >>> 8) & 0xff,
        mapped & 0xff,
      ].join("."),
    );
  }
  const addressClass: AddressClass =
    value === 0n
      ? "unspecified"
      : value === 1n
        ? "loopback"
        : inV6Range(value, "fc00::", 7)
          ? "private"
          : inV6Range(value, "fe80::", 10)
            ? "link_local"
            : inV6Range(value, "ff00::", 8)
              ? "multicast"
              : !inV6Range(value, "2000::", 3) ||
                  inV6Range(value, "2002::", 16) ||
                  inV6Range(value, "2001::", 23) ||
                  inV6Range(value, "2001:db8::", 32) ||
                  inV6Range(value, "3fff::", 20)
                ? "reserved"
                : "public";
  return { address, family: 6, addressClass };
}

function normalizedPeer(address: string): string {
  const assessment = classifyAddress(address);
  return assessment.family === 4
    ? assessment.address
    : expandIpv6(address).toString(16);
}

export function inspectPublicUrl(raw: string): InspectedPublicUrl {
  if (Buffer.byteLength(raw, "utf8") > 2048) {
    deny(
      "url_too_long",
      "The requested URL exceeds the capture limit.",
      "url_parse",
    );
  }
  if (
    // eslint-disable-next-line no-control-regex -- Reject the C0 and DEL ranges explicitly.
    /[\\\u0000-\u001f\u007f]/u.test(raw) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(raw)
  ) {
    deny(
      raw.includes("\\") ? "ambiguous_url" : "control_character",
      "The requested URL contains an ambiguous or control character.",
      "url_parse",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    deny("invalid_url", "The requested URL is not valid.", "url_parse");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    deny(
      "scheme_not_allowed",
      "Only HTTP and HTTPS pages can be captured.",
      "url_parse",
    );
  }
  if (url.username || url.password) {
    deny(
      "userinfo_not_allowed",
      "Credentials are not allowed in capture URLs.",
      "url_parse",
    );
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    deny("port_not_allowed", "Only ports 80 and 443 are allowed.", "url_parse");
  }

  const rawHost = url.hostname.replace(/^\[|\]$/gu, "");
  if (isIP(rawHost) !== 0) {
    deny(
      "ip_literal_not_allowed",
      "Capture URLs must use a public DNS name.",
      "url_parse",
    );
  }
  const asciiHost = domainToASCII(rawHost).toLowerCase().replace(/\.$/u, "");
  if (!asciiHost) {
    deny("invalid_url", "The requested URL has no valid host.", "url_parse");
  }
  if (
    asciiHost === "localhost" ||
    !asciiHost.includes(".") ||
    asciiHost === "metadata.google.internal" ||
    localNameSuffixes.some((suffix) => asciiHost.endsWith(suffix))
  ) {
    deny(
      "local_name_not_allowed",
      "Local host names cannot be captured.",
      "url_parse",
    );
  }
  for (const key of url.searchParams.keys()) {
    const name = key.toLowerCase();
    if (
      secretQueryKeys.has(name) ||
      /^(?:x-amz-|x-goog-|x-ms-|oauth_)/u.test(name)
    ) {
      deny(
        "credential_shape_not_allowed",
        "Credential-shaped query parameters are not allowed.",
        "url_parse",
      );
    }
  }

  url.hostname = asciiHost;
  url.hash = "";
  const redacted = new URL(url);
  const queryKeys = [...new Set([...redacted.searchParams.keys()])].sort();
  for (const key of queryKeys) {
    const count = redacted.searchParams.getAll(key).length;
    redacted.searchParams.delete(key);
    for (let index = 0; index < count; index += 1) {
      redacted.searchParams.append(key, "[REDACTED]");
    }
  }
  return {
    url,
    canonicalUrl: url.toString(),
    redactedUrl: redacted.toString(),
    queryKeys,
  };
}

export interface DnsAnswer {
  readonly address: string;
  readonly family: 4 | 6;
}

export interface DnsResolver {
  resolve(host: string): Promise<readonly DnsAnswer[]>;
}

export class SystemDnsResolver implements DnsResolver {
  async resolve(host: string): Promise<readonly DnsAnswer[]> {
    const answers = await lookup(`${host}.`, { all: true, verbatim: true });
    return answers.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    }));
  }
}

export interface TlsEvidence {
  readonly availability: "available" | "unavailable" | "not_applicable";
  readonly protocol: string | null;
  readonly cipher: string | null;
  readonly peerCertificateSha256: string | null;
  readonly unavailableReason: string | null;
}

export interface TransportRequest {
  readonly url: URL;
  readonly host: string;
  readonly port: 80 | 443;
  readonly pinnedAddress: string;
  readonly family: 4 | 6;
  readonly method: "GET" | "HEAD";
  readonly headers: Readonly<Record<string, string>>;
  readonly maxBytes: number;
  readonly timeoutMilliseconds: number;
  readonly signal?: AbortSignal;
}

export interface TransportResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly remoteAddress: string;
  readonly tls: TlsEvidence;
}

export interface PinnedTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}

export interface DnsAdmissionEvidence {
  readonly host: string;
  readonly answers: readonly AddressAssessment[];
  readonly admitted: boolean;
}

export interface RedirectEvidence {
  readonly sequence: number;
  readonly canonicalUrl: string;
  readonly redactedUrl: string;
  readonly status: number;
  readonly admitted: boolean;
}

export interface EgressTrace {
  readonly dnsAdmissions: readonly DnsAdmissionEvidence[];
  readonly peerConnections: readonly {
    host: string;
    address: string;
    port: 80 | 443;
    matchedAdmission: true;
  }[];
  readonly redirectChain: readonly RedirectEvidence[];
  readonly actualConnectionCount: number;
  readonly tls: TlsEvidence;
}

export interface GuardedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly finalUrl: string;
  readonly redactedFinalUrl: string;
  readonly trace: EgressTrace;
}

export interface EgressLimits {
  readonly maxDnsAnswers: number;
  readonly maxRedirects: number;
  readonly maxResponseBytes: number;
  readonly timeoutMilliseconds: number;
}

const defaultLimits: EgressLimits = {
  maxDnsAnswers: 16,
  maxRedirects: 10,
  maxResponseBytes: 8 * 1024 * 1024,
  timeoutMilliseconds: 15_000,
};

export class PublicEgressGuard {
  readonly limits: EgressLimits;

  constructor(
    private readonly resolver: DnsResolver,
    private readonly transport: PinnedTransport,
    limits: Partial<EgressLimits> = {},
  ) {
    this.limits = { ...defaultLimits, ...limits };
  }

  async fetch(
    raw: string,
    method: "GET" | "HEAD" = "GET",
    signal?: AbortSignal,
  ): Promise<GuardedResponse> {
    const dnsAdmissions: DnsAdmissionEvidence[] = [];
    const peerConnections: EgressTrace["peerConnections"][number][] = [];
    const redirectChain: RedirectEvidence[] = [];
    let current = raw;
    for (
      let sequence = 0;
      sequence <= this.limits.maxRedirects;
      sequence += 1
    ) {
      signal?.throwIfAborted();
      const inspected = inspectPublicUrl(current);
      let rawAnswers: readonly DnsAnswer[];
      try {
        rawAnswers = await this.resolver.resolve(inspected.url.hostname);
      } catch {
        deny(
          "dns_unavailable",
          "The destination could not be resolved safely.",
          "dns",
        );
      }
      signal?.throwIfAborted();
      if (rawAnswers.length === 0) {
        deny(
          "dns_no_answers",
          "The destination returned no usable DNS answers.",
          "dns",
        );
      }
      if (rawAnswers.length > this.limits.maxDnsAnswers) {
        deny(
          "dns_answer_limit",
          "The destination returned too many DNS answers.",
          "dns",
        );
      }
      const answers = rawAnswers.map(({ address, family }) => {
        const assessment = classifyAddress(address);
        if (assessment.family !== family) {
          deny(
            "dns_family_mismatch",
            "A DNS answer had inconsistent address metadata.",
            "dns",
          );
        }
        return assessment;
      });
      const admitted = answers.every(
        ({ addressClass }) => addressClass === "public",
      );
      dnsAdmissions.push({
        host: inspected.url.hostname,
        answers,
        admitted,
      });
      if (!admitted) {
        deny(
          "dns_not_public",
          "The destination did not resolve exclusively to public addresses.",
          "dns",
        );
      }

      const selected = answers[0]!;
      const port = Number(
        inspected.url.port || (inspected.url.protocol === "https:" ? 443 : 80),
      ) as 80 | 443;
      let response: TransportResponse;
      try {
        response = await this.transport.request({
          url: inspected.url,
          host: inspected.url.hostname,
          port,
          pinnedAddress: selected.address,
          family: selected.family,
          method,
          headers: {
            accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
            "user-agent": "VERA Public Page Capture/1",
          },
          maxBytes: this.limits.maxResponseBytes,
          timeoutMilliseconds: this.limits.timeoutMilliseconds,
          ...(signal && { signal }),
        });
      } catch (error) {
        if (error instanceof CaptureDenied) throw error;
        deny(
          "connection_failed",
          "The public destination could not be fetched.",
          "connect",
        );
      }
      if (
        normalizedPeer(response.remoteAddress) !==
        normalizedPeer(selected.address)
      ) {
        deny(
          "peer_mismatch",
          "The connected peer did not match the admitted DNS address.",
          "connect",
        );
      }
      if (response.body.byteLength > this.limits.maxResponseBytes) {
        deny(
          "response_too_large",
          "The response exceeded the configured capture limit.",
          "response",
        );
      }
      peerConnections.push({
        host: inspected.url.hostname,
        address: response.remoteAddress,
        port,
        matchedAdmission: true,
      });
      redirectChain.push({
        sequence,
        canonicalUrl: inspected.canonicalUrl,
        redactedUrl: inspected.redactedUrl,
        status: response.status,
        admitted: true,
      });

      const location = response.headers.location;
      if (
        response.status < 300 ||
        response.status > 399 ||
        location === undefined
      ) {
        return {
          status: response.status,
          headers: response.headers,
          body: response.body,
          finalUrl: inspected.canonicalUrl,
          redactedFinalUrl: inspected.redactedUrl,
          trace: {
            dnsAdmissions,
            peerConnections,
            redirectChain,
            actualConnectionCount: peerConnections.length,
            tls: response.tls,
          },
        };
      }
      if (sequence === this.limits.maxRedirects) {
        deny(
          "redirect_limit",
          "The destination exceeded the redirect limit.",
          "redirect",
        );
      }
      try {
        current = new URL(location, inspected.url).toString();
      } catch {
        deny(
          "invalid_redirect",
          "The destination returned an invalid redirect.",
          "redirect",
        );
      }
    }
    throw new Error("unreachable");
  }
}

export class NodePinnedTransport implements PinnedTransport {
  async request(request: TransportRequest): Promise<TransportResponse> {
    return await new Promise<TransportResponse>((resolve, reject) => {
      const client = request.url.protocol === "https:" ? https : http;
      const options: https.RequestOptions & { autoSelectFamily: boolean } = {
        agent: false,
        autoSelectFamily: false,
        rejectUnauthorized: true,
        ...(request.signal && { signal: request.signal }),
        headers: request.headers,
        method: request.method,
        lookup: (_host, _options, callback) => {
          callback(null, request.pinnedAddress, request.family);
        },
      };
      if (request.url.protocol === "https:") options.servername = request.host;
      const outgoing = client.request(request.url, options, (incoming) => {
        const socket = incoming.socket;
        const remoteAddress = socket.remoteAddress;
        if (
          !remoteAddress ||
          normalizedPeer(remoteAddress) !==
            normalizedPeer(request.pinnedAddress)
        ) {
          incoming.destroy();
          reject(
            new CaptureDenied(
              "peer_mismatch",
              "The connected peer did not match the admitted DNS address.",
              "connect",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let byteLength = 0;
        incoming.on("data", (chunk: Buffer) => {
          byteLength += chunk.byteLength;
          if (byteLength > request.maxBytes) {
            incoming.destroy(
              new CaptureDenied(
                "response_too_large",
                "The response exceeded the configured capture limit.",
                "response",
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        incoming.once("error", reject);
        incoming.once("end", () => {
          const headers = Object.fromEntries(
            Object.entries(incoming.headers)
              .filter(
                (entry): entry is [string, string | string[]] =>
                  entry[1] !== undefined,
              )
              .map(([name, value]) => [
                name.toLowerCase(),
                Array.isArray(value) ? value.join(", ") : value,
              ]),
          );
          let tls: TlsEvidence;
          if (socket instanceof TLSSocket) {
            const certificate = socket.getPeerCertificate();
            tls = {
              availability: "available",
              protocol: socket.getProtocol(),
              cipher: socket.getCipher()?.name ?? null,
              peerCertificateSha256: certificate?.raw
                ? `sha256:${createHash("sha256")
                    .update(certificate.raw)
                    .digest("hex")}`
                : null,
              unavailableReason: certificate?.raw
                ? null
                : "The peer certificate bytes were unavailable.",
            };
          } else {
            tls = {
              availability: "not_applicable",
              protocol: null,
              cipher: null,
              peerCertificateSha256: null,
              unavailableReason: "The request used HTTP.",
            };
          }
          resolve({
            status: incoming.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
            remoteAddress,
            tls,
          });
        });
      });
      outgoing.setTimeout(request.timeoutMilliseconds, () => {
        outgoing.destroy(
          new CaptureDenied(
            "connection_timeout",
            "The public destination did not respond within the time limit.",
            "connect",
          ),
        );
      });
      outgoing.once("error", reject);
      outgoing.end();
    });
  }
}
