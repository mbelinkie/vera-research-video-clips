import type { RuntimeControl, RuntimeQuiescence } from "./types.js";

export type LocalRuntimeHttpRequest = Readonly<{
  method: "GET" | "POST";
  path: "/api/runtime/drain" | "/api/runtime/quiescence";
  authorization: string;
}>;

export type LocalRuntimeHttpResponse = Readonly<{
  status: number;
  body: unknown;
}>;

/**
 * The concrete local-agent client owns loopback addressing. The supervision
 * boundary only permits its two authenticated runtime routes.
 */
export interface LocalRuntimeHttpTransport {
  request(input: LocalRuntimeHttpRequest): Promise<LocalRuntimeHttpResponse>;
}

export class LocalRuntimeControlError extends Error {
  constructor() {
    super("The local runtime control is unavailable.");
  }
}

export const createHttpRuntimeControl = (
  transport: LocalRuntimeHttpTransport,
  authorization: string,
): RuntimeControl => {
  const request = async (
    method: "GET" | "POST",
    path: "/api/runtime/drain" | "/api/runtime/quiescence",
  ): Promise<RuntimeQuiescence> => {
    const response = await transport.request({ method, path, authorization });
    if (response.status < 200 || response.status >= 300) {
      throw new LocalRuntimeControlError();
    }
    return parseQuiescence(response.body);
  };

  return {
    requestDrain: () => request("POST", "/api/runtime/drain"),
    readQuiescence: () => request("GET", "/api/runtime/quiescence"),
  };
};

const parseQuiescence = (body: unknown): RuntimeQuiescence => {
  const candidate =
    isRecord(body) && isRecord(body.quiescence) ? body.quiescence : body;
  if (
    !isRecord(candidate) ||
    typeof candidate.draining !== "boolean" ||
    typeof candidate.safeToStop !== "boolean"
  ) {
    throw new LocalRuntimeControlError();
  }
  return {
    draining: candidate.draining,
    safeToStop: candidate.safeToStop,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
