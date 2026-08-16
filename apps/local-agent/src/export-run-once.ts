import { join } from "node:path";

import { loadConfig, type AppConfig } from "@research-video/config";
import {
  LocalExportQueue,
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  createExportSourceAcquisitionProvider,
  FfmpegH264AacRangeRenderer,
  FfprobeMediaInspector,
  type ExportSourceAcquisitionProvider,
  type ExportSourceInspector,
  type FfmpegRangeRenderer,
} from "@research-video/media";

import { LocalExportSourceProcessor } from "./export-source.ts";

export type LocalExportOnceResult = {
  requestId: string;
  status: "complete" | "already_complete" | "failed";
  state: string;
  packageIdentity?: string;
  artifacts?: readonly {
    role: string;
    byteSize: number;
    contentSha256: string;
  }[];
  error?: { code: string; message: string };
};

export type LocalExportRuntimeDependencies = {
  queue: LocalExportQueue;
  sourceProvider?: ExportSourceAcquisitionProvider;
  inspector?: ExportSourceInspector;
  renderer?: FfmpegRangeRenderer;
  dataRoot: string;
};

/**
 * Runs exactly one persisted request. It intentionally has no polling,
 * concurrency, server, or fire-and-forget work: the processor owns the full
 * M5 lifecycle and all cleanup before this returns.
 */
export async function runLocalExportOnce(
  input: { requestId: string; authorizationConfirmed: boolean },
  dependencies: LocalExportRuntimeDependencies,
): Promise<LocalExportOnceResult> {
  const request = dependencies.queue.get(input.requestId);
  if (!request) {
    return failedResult(input.requestId, undefined, {
      code: "export_request_not_found",
      message: "Export request not found.",
    });
  }
  if (request.state === "complete") return completedResult(request, true);

  const processor = new LocalExportSourceProcessor(
    dependencies.queue,
    dependencies.sourceProvider,
    dependencies.inspector ?? new FfprobeMediaInspector(),
    dependencies.renderer ?? new FfmpegH264AacRangeRenderer(),
    dependencies.dataRoot,
  );
  try {
    await processor.process(input);
    const completed = dependencies.queue.get(input.requestId);
    if (!completed || completed.state !== "complete") {
      return failedResult(input.requestId, completed?.state, {
        code: "export_completion_unverified",
        message:
          "Export processing ended without a verified completed package.",
      });
    }
    return completedResult(completed, false);
  } catch (error) {
    const persisted = dependencies.queue.get(input.requestId);
    return failedResult(
      input.requestId,
      persisted?.state,
      safeRuntimeError(error),
    );
  }
}

export async function runConfiguredLocalExportOnce(
  input: { requestId: string; authorizationConfirmed: boolean },
  options: {
    config?: AppConfig;
    sourceProvider?: ExportSourceAcquisitionProvider;
    inspector?: ExportSourceInspector;
    renderer?: FfmpegRangeRenderer;
  } = {},
): Promise<LocalExportOnceResult> {
  const config = options.config ?? loadConfig();
  const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
  try {
    runLocalMigrations(database);
    const sourceProvider =
      options.sourceProvider ??
      createExportSourceAcquisitionProvider({
        mode: config.exportSourceProvider,
        ytDlpPath: config.ytDlpPath,
      });
    return await runLocalExportOnce(input, {
      queue: new LocalExportQueue(database),
      ...(sourceProvider ? { sourceProvider } : {}),
      ...(options.inspector ? { inspector: options.inspector } : {}),
      ...(options.renderer ? { renderer: options.renderer } : {}),
      dataRoot: config.dataDir,
    });
  } finally {
    database.close();
  }
}

function completedResult(
  request: NonNullable<ReturnType<LocalExportQueue["get"]>>,
  alreadyComplete: boolean,
): LocalExportOnceResult {
  const artifacts = request.finalArtifacts ?? [];
  return {
    requestId: request.id,
    status: alreadyComplete ? "already_complete" : "complete",
    state: request.state,
    ...(artifacts[0]?.packageIdentity
      ? { packageIdentity: artifacts[0].packageIdentity }
      : {}),
    artifacts: artifacts.map(({ role, byteSize, contentSha256 }) => ({
      role,
      byteSize,
      contentSha256,
    })),
  };
}

function failedResult(
  requestId: string,
  state: string | undefined,
  error: { code: string; message: string },
): LocalExportOnceResult {
  return {
    requestId,
    status: "failed",
    state: state ?? "not_found",
    error,
  };
}

function safeRuntimeError(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown };
  return {
    code:
      typeof candidate?.code === "string"
        ? candidate.code.slice(0, 120)
        : "export_runtime_failed",
    message: sanitizeMessage(
      typeof candidate?.message === "string"
        ? candidate.message
        : "Local export processing failed.",
    ),
  };
}

function sanitizeMessage(message: string): string {
  return message
    .replaceAll(/(?:[A-Za-z]:)?\/(?:[^\s'"]+)/gu, "<path>")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .trim()
    .slice(0, 500);
}

function parseCommandLine(
  argv: readonly string[],
):
  | { requestId: string; authorizationConfirmed: true }
  | { error: { code: string; message: string } } {
  let requestId: string | undefined;
  let authorizationConfirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--request-id") {
      const value = argv[index + 1];
      if (!value || requestId) {
        return {
          error: {
            code: "invalid_arguments",
            message: "Specify exactly one --request-id value.",
          },
        };
      }
      requestId = value;
      index += 1;
    } else if (argument === "--authorization-confirmed") {
      authorizationConfirmed = true;
    } else {
      return {
        error: {
          code: "invalid_arguments",
          message:
            "Usage: export:run-once -- --request-id <uuid> --authorization-confirmed",
        },
      };
    }
  }
  if (!requestId || !authorizationConfirmed) {
    return {
      error: {
        code: authorizationConfirmed
          ? "export_request_id_required"
          : "source_authorization_required",
        message: authorizationConfirmed
          ? "An explicit export request ID is required."
          : "Pass --authorization-confirmed for this one authorized processing run.",
      },
    };
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      requestId,
    )
  ) {
    return {
      error: {
        code: "export_request_id_invalid",
        message: "The export request ID must be a UUID.",
      },
    };
  }
  return { requestId, authorizationConfirmed: true };
}

export async function runExportOnceCommand(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const parsed = parseCommandLine(argv);
  if ("error" in parsed) {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", ...parsed })}\n`,
    );
    return 2;
  }
  const result = await runConfiguredLocalExportOnce(parsed);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "failed" ? 1 : 0;
}

if (import.meta.main) process.exitCode = await runExportOnceCommand();
