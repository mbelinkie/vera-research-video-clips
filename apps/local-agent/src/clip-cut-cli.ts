import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { loadConfig } from "@research-video/config";
import {
  openLocalDatabase,
  runLocalMigrations,
} from "@research-video/db-local";
import {
  HttpArtifactDownloader,
  VerifiedTranscriptCache,
} from "@research-video/sync";
import { z } from "zod";

import { safeClipCutMessage } from "./app.ts";
import {
  ClipSourceDisabledError,
  createClipCutRunner,
} from "./clip-cut-runtime.ts";
import type { CutClipResult, CutLoggedClipsRequest } from "./clip-cutter.ts";

const ArgsSchema = z.object({
  projectId: z.uuid(),
  clipIds: z.array(z.uuid()).min(1).max(20),
  authorizationConfirmed: z.literal(true),
});

export function parseClipCutArguments(argv: string[]): {
  projectId: string;
  clipIds: string[];
  authorizationConfirmed: true;
} {
  const { values } = parseArgs({
    args: argv,
    options: {
      "project-id": { type: "string" },
      "clip-id": { type: "string", multiple: true },
      "confirm-rights": { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  const parsed = ArgsSchema.parse({
    projectId: values["project-id"],
    clipIds: values["clip-id"],
    authorizationConfirmed: values["confirm-rights"],
  });
  if (new Set(parsed.clipIds).size !== parsed.clipIds.length)
    throw new Error("Duplicate clip IDs are not allowed.");
  return parsed;
}

/** CLI seam for offline tests; the default path opens the real verified cache. */
export async function runClipCutCli(
  argv: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    run?: (request: CutLoggedClipsRequest) => Promise<CutClipResult[]>;
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? ((message) => console.log(message));
  const stderr = options.stderr ?? ((message) => console.error(message));
  let closeDatabase: (() => void) | undefined;
  try {
    const args = parseClipCutArguments(argv);
    const authorization = env.RESEARCH_AUTHORIZATION;
    if (!authorization || !/^Bearer\s+[^\s]+$/u.test(authorization)) {
      throw new Error(
        "Set RESEARCH_AUTHORIZATION to a project member's Bearer credential.",
      );
    }
    let run = options.run;
    if (!run) {
      const config = loadConfig(env);
      if (config.exportSourceProvider !== "yt-dlp")
        throw new ClipSourceDisabledError();
      await mkdir(config.dataDir, { recursive: true });
      const database = openLocalDatabase(join(config.dataDir, "local.sqlite"));
      closeDatabase = () => database.close();
      runLocalMigrations(database);
      const cache = new VerifiedTranscriptCache(
        database,
        new HttpArtifactDownloader(),
        join(config.dataDir, "transcript-cache"),
      );
      run = createClipCutRunner(config, cache);
    }
    const clips = await run({ ...args, authorization });
    stdout(JSON.stringify({ clips }));
    return 0;
  } catch (error) {
    stderr(safeClipCutMessage(error));
    return 1;
  } finally {
    closeDatabase?.();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runClipCutCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
