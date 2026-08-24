import {
  DerivedTranslationSchema,
  LookupDerivedTranslationSchema,
  type DerivedTranslation,
  type DerivedTranslationIdentity,
} from "@research-video/contracts";

/**
 * Local-agent-only cloud adapter.  Its result is consumed by the verified
 * sync layer; no cloud object metadata crosses the renderer boundary.
 */
export class CloudDerivedTranslationClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authorization: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Read-only project-shared reuse lookup. A miss never queues provider work. */
  async lookupDerivedTranslation(
    identity: DerivedTranslationIdentity,
  ): Promise<DerivedTranslation | undefined> {
    const request = LookupDerivedTranslationSchema.parse({ identity });
    const response = await this.request(identity, request);
    if (response.status === 204) return undefined;
    return this.readyResponse(response, identity);
  }

  private async request(
    identity: DerivedTranslationIdentity,
    body: unknown,
  ): Promise<Response> {
    try {
      return await this.fetcher(
        `${this.baseUrl}/api/projects/${encodeURIComponent(identity.projectId)}/videos/${encodeURIComponent(identity.catalogVideoId)}/derived-translations/lookup`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: this.authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw cloudTranslationError(503, "derived_translation_unavailable");
    }
  }

  private async readyResponse(
    response: Response,
    identity: DerivedTranslationIdentity,
  ): Promise<DerivedTranslation> {
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw cloudTranslationError(
        response.status,
        response.status === 401
          ? "authentication_required"
          : response.status === 403
            ? "authorization_denied"
            : "derived_translation_unavailable",
      );
    }
    return parseReadyTranslation(payload, identity);
  }
}

function sameIdentity(
  left: DerivedTranslationIdentity,
  right: DerivedTranslationIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.catalogVideoId === right.catalogVideoId &&
    left.baseTranscriptVersionId === right.baseTranscriptVersionId &&
    left.originalTrackId === right.originalTrackId &&
    left.originalContentSha256 === right.originalContentSha256 &&
    left.targetLanguage === right.targetLanguage &&
    left.provider === right.provider &&
    (left.model ?? undefined) === (right.model ?? undefined) &&
    left.normalizationSchemaVersion === right.normalizationSchemaVersion
  );
}

function parseReadyTranslation(
  payload: unknown,
  identity: DerivedTranslationIdentity,
): DerivedTranslation {
  const parsed = DerivedTranslationSchema.safeParse(payload);
  if (
    !parsed.success ||
    !sameIdentity(parsed.data.manifest.identity, identity)
  ) {
    throw cloudTranslationError(502, "derived_translation_invalid_response");
  }
  return parsed.data;
}

function cloudTranslationError(statusCode: number, code: string): Error {
  return Object.assign(
    new Error("The preferred translation is temporarily unavailable."),
    { statusCode, code },
  );
}
