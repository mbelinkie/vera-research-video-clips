import type { AppConfig } from "@research-video/config";
import { ClipCandidateSchema } from "@research-video/contracts";
import {
  createFullVideoAcquirer,
  FfmpegRangeRenderer,
  FfprobeMediaInspector,
} from "@research-video/media";
import {
  HttpActiveTranscriptCatalogClient,
  readVerifiedLoggedClipTracks,
  SharedFirstTranscriptResolver,
  type VerifiedTranscriptCache,
} from "@research-video/sync";

import {
  cutLoggedClips,
  type ClipCatalogReader,
  type ClipCutterDependencies,
  type CutLoggedClipsRequest,
} from "./clip-cutter.ts";

/** Only authenticated catalog records, never request-body clip JSON, authorize cutting. */
export class HttpProjectClipCatalog implements ClipCatalogReader {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getAuthorizedClip(input: {
    projectId: string;
    clipId: string;
    authorization: string;
  }) {
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/api/projects/${encodeURIComponent(input.projectId)}/clips/${encodeURIComponent(input.clipId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: input.authorization,
          },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new ProjectClipAccessError(
        502,
        "Project clip catalog could not be reached.",
      );
    }
    if (!response.ok) {
      const status = [401, 403, 404].includes(response.status)
        ? response.status
        : 502;
      throw new ProjectClipAccessError(
        status,
        status === 401
          ? "Project clip authentication was refused."
          : status === 403 || status === 404
            ? "Project clip is unavailable to this member."
            : "Project clip catalog request failed.",
      );
    }
    // Parsed and rechecked again against the requested IDs in cutLoggedClips.
    return ClipCandidateSchema.parse(await response.json());
  }
}

export class ProjectClipAccessError extends Error {
  readonly code = "project_clip_access_failed";

  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class ClipSourceDisabledError extends Error {
  readonly statusCode = 503;
  readonly code = "clip_source_disabled";

  constructor() {
    super(
      "Clip cutting is disabled; set EXPORT_SOURCE_PROVIDER=yt-dlp locally.",
    );
  }
}

/** The foreground CLI and loopback API use the identical authorized cutter. */
export function createClipCutRunner(
  config: AppConfig,
  cache: VerifiedTranscriptCache,
): (request: CutLoggedClipsRequest) => ReturnType<typeof cutLoggedClips> {
  const acquirer = createFullVideoAcquirer({
    mode: config.exportSourceProvider,
    ytDlpPath: config.ytDlpPath,
  });
  if (!acquirer) {
    return async () => {
      throw new ClipSourceDisabledError();
    };
  }
  const cloudApiUrl = `http://${config.cloudApiHost}:${config.cloudApiPort}`;
  const deps: ClipCutterDependencies = {
    catalog: new HttpProjectClipCatalog(cloudApiUrl),
    transcripts: {
      getVerifiedTracks: async ({
        clip,
        authorization,
        sourceLanguageClass,
      }) => {
        const resolution = await new SharedFirstTranscriptResolver(
          new HttpActiveTranscriptCatalogClient(cloudApiUrl, authorization),
          cache,
        ).resolve(clip.projectId, clip.catalogVideoId);
        return readVerifiedLoggedClipTracks({
          resolution,
          clip,
          sourceLanguageClass,
        });
      },
    },
    acquirer,
    inspector: new FfprobeMediaInspector({ executable: config.ffprobePath }),
    renderer: new FfmpegRangeRenderer({ executable: config.ffmpegPath }),
    exportDirectory: config.clipExportDir,
  };
  return (request) => cutLoggedClips(request, deps);
}
