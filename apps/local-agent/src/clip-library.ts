import {
  ClipLibraryPageSchema,
  ClipLibraryQuerySchema,
  LocalClipLibraryPageSchema,
  UpdateLocalClipLibrarySelectionSchema,
  type ClipLibraryPage,
  type ClipLibraryQuery,
  type LocalClipLibraryPage,
  type UpdateLocalClipLibrarySelection,
} from "@research-video/contracts";
import {
  LocalArtifactLocatorRepository,
  LocalArtifactCatalogError,
  LocalClipLibraryCacheRepository,
  clipLibraryAuthorizationScope,
} from "@research-video/db-local";

export class LocalClipLibraryUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = "clip_library_unavailable";

  constructor() {
    super(
      "The Clip Library is unavailable and no matching cached page exists.",
    );
  }
}

export class LocalClipLibraryService {
  constructor(
    private readonly cache: LocalClipLibraryCacheRepository,
    private readonly locators: LocalArtifactLocatorRepository,
  ) {}

  async resolvePage(input: {
    projectId: string;
    authorization: string;
    query: ClipLibraryQuery;
    fetchCloud(): Promise<ClipLibraryPage>;
  }): Promise<LocalClipLibraryPage> {
    const query = ClipLibraryQuerySchema.parse(input.query);
    const authorizationScopeSha256 = clipLibraryAuthorizationScope(
      input.authorization,
    );
    let cloudPage: ClipLibraryPage;
    try {
      cloudPage = await input.fetchCloud();
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 401) {
        this.cache.purgeAuthorizationScope(authorizationScopeSha256);
        throw error;
      }
      if (statusCode === 403) {
        this.cache.purgeScope(input.projectId, authorizationScopeSha256);
        throw error;
      }
      if (statusCode === undefined || statusCode < 500) throw error;
      const cached = this.cache.getPage({
        projectId: input.projectId,
        authorizationScopeSha256,
        query,
      });
      if (!cached) throw new LocalClipLibraryUnavailableError();
      return this.decorate(
        cached.query,
        cached.page,
        cached.cachedAt,
        "stale",
        authorizationScopeSha256,
      );
    }
    const page = ClipLibraryPageSchema.parse(cloudPage);
    const cached = this.cache.storePage({
      projectId: input.projectId,
      authorizationScopeSha256,
      query,
      page,
    });
    return this.decorate(
      cached.query,
      cached.page,
      cached.cachedAt,
      "fresh",
      authorizationScopeSha256,
    );
  }

  async resolveLatestPage(input: {
    projectId: string;
    authorization: string;
    fetchCloud(query: ClipLibraryQuery): Promise<ClipLibraryPage>;
  }): Promise<LocalClipLibraryPage> {
    const authorizationScopeSha256 = clipLibraryAuthorizationScope(
      input.authorization,
    );
    const latest = this.cache.getLatestPage(
      input.projectId,
      authorizationScopeSha256,
    );
    if (!latest) throw new LocalClipLibraryUnavailableError();
    return this.resolvePage({
      projectId: input.projectId,
      authorization: input.authorization,
      query: latest.query,
      fetchCloud: () => input.fetchCloud(latest.query),
    });
  }

  updateSelection(input: {
    projectId: string;
    authorization: string;
    command: UpdateLocalClipLibrarySelection;
  }): string[] {
    const command = UpdateLocalClipLibrarySelectionSchema.parse(input.command);
    const authorizationScopeSha256 = clipLibraryAuthorizationScope(
      input.authorization,
    );
    const cachedClipIds = new Set(
      this.cache.listCachedClipIds(input.projectId, authorizationScopeSha256),
    );
    if (
      [...command.pageClipIds, ...command.selectedClipIds].some(
        (clipId) => !cachedClipIds.has(clipId),
      )
    ) {
      throw new LocalArtifactCatalogError(
        "Clip Library selection must come from an authorized cached page.",
      );
    }
    return this.cache.replaceSelection({
      projectId: input.projectId,
      authorizationScopeSha256,
      pageClipIds: command.pageClipIds,
      selectedClipIds: command.selectedClipIds,
    });
  }

  purgeRevokedAuthorization(input: {
    projectId: string;
    authorization: string;
    statusCode: number | undefined;
  }): void {
    const authorizationScopeSha256 = clipLibraryAuthorizationScope(
      input.authorization,
    );
    if (input.statusCode === 401) {
      this.cache.purgeAuthorizationScope(authorizationScopeSha256);
    } else if (input.statusCode === 403) {
      this.cache.purgeScope(input.projectId, authorizationScopeSha256);
    }
  }

  private decorate(
    query: ClipLibraryQuery,
    page: ClipLibraryPage,
    cachedAt: string,
    freshness: "fresh" | "stale",
    authorizationScopeSha256: string,
  ): LocalClipLibraryPage {
    const artifactVersionIds = [
      ...new Set(
        page.entries.flatMap((entry) =>
          entry.recentArtifactVersions.map(
            (version) => version.artifactVersionId,
          ),
        ),
      ),
    ];
    const pageClipIds = new Set(page.entries.map((entry) => entry.clip.id));
    return LocalClipLibraryPageSchema.parse({
      ...page,
      query,
      freshness,
      cachedAt,
      cacheCoverage: "cached_subset",
      selectedClipIds: this.cache
        .listSelection(page.projectId, authorizationScopeSha256)
        .filter((clipId) => pageClipIds.has(clipId)),
      localAvailability: artifactVersionIds.map((artifactVersionId) => ({
        artifactVersionId,
        locators: this.locators.listLocators(artifactVersionId),
      })),
    });
  }
}
