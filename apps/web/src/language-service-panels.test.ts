import { describe, expect, it, vi } from "vitest";

import type { CloudProviderDescriptor } from "@research-video/contracts";
import type {
  CloudProviderAccessRequest,
  LocalModelCandidate,
  LocalModelSource,
  SignedLocalModelCatalogRelease,
} from "@research-video/contracts";

import {
  approvedTranscriptionProviderOptions,
  createLanguageServiceClient,
  transcriptionProviderOptions,
  translationLanguageOptions,
} from "./language-service-panels.tsx";

const localModelSource: LocalModelSource = {
  id: "argos-package-index",
  adapter: "argos-package-index",
  sourceUrl: "https://example.test/argos/index.json",
  state: "enabled",
  refreshIntervalHours: 24,
  version: 7,
};

const translatedProvider: CloudProviderDescriptor = {
  id: "provider-aurora",
  service: "translation" as const,
  displayName: "Aurora Translate",
  adapterContractVersion: 1,
  configurationRevision: "cfg-1",
  capabilityRevision: "cap-1",
  supportedLanguages: [
    {
      language: "fr",
      roles: ["target"],
      supportsAutoDetection: false,
    },
    {
      language: "es",
      roles: ["source", "target"],
      supportsAutoDetection: true,
    },
  ],
  inputModes: ["text_segments"],
  disclosure: {
    version: 1,
    title: "Transcript text",
    summary: "Selected transcript text leaves this device.",
    dataCategories: ["transcript_text"],
    publishedAt: "2026-08-26T00:00:00.000Z",
  },
  pricing: {
    currency: "USD",
    unit: "characters" as const,
    amountMicros: 1,
    quantity: 1,
    effectiveAt: "2026-08-26T00:00:00.000Z",
  },
  state: "enabled" as const,
};

describe("dynamic language-service UI seams", () => {
  it("derives provider-neutral translation language and transcription options", () => {
    const transcription: CloudProviderDescriptor = {
      ...translatedProvider,
      id: "provider-nova",
      service: "transcription" as const,
      displayName: "Nova Speech",
      supportedLanguages: [
        {
          language: "de",
          roles: ["source"],
          supportsAutoDetection: true,
        },
      ],
    };
    expect(
      translationLanguageOptions([translatedProvider, transcription]),
    ).toEqual([
      { value: "es", label: "es" },
      { value: "fr", label: "fr" },
    ]);
    expect(
      transcriptionProviderOptions([translatedProvider, transcription]),
    ).toEqual([transcription]);
    const approvedAccess = {
      id: "00000000-0000-4000-8000-000000000003",
      providerId: transcription.id,
      service: "transcription",
      accountId: "00000000-0000-4000-8000-000000000002",
      disclosureVersion: 1,
      consentAcceptedAt: "2026-08-26T00:00:00.000Z",
      state: "approved",
      decisionBy: "00000000-0000-4000-8000-000000000004",
      decisionAt: "2026-08-26T00:00:00.000Z",
      version: 1,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    } satisfies CloudProviderAccessRequest;
    expect(
      approvedTranscriptionProviderOptions(
        [translatedProvider, transcription],
        [approvedAccess],
      ),
    ).toEqual([transcription]);
    expect(
      approvedTranscriptionProviderOptions(
        [translatedProvider, transcription],
        [{ ...approvedAccess, state: "requested" }],
      ),
    ).toEqual([]);
  });

  it("posts an arbitrary descriptor access request through the typed command seam", async () => {
    const request = vi.fn(
      async (
        _path: string,
        _options?: Pick<RequestInit, "body" | "method" | "signal">,
      ) =>
        new Response(
          JSON.stringify({
            id: "00000000-0000-4000-8000-000000000001",
            providerId: translatedProvider.id,
            service: translatedProvider.service,
            accountId: "00000000-0000-4000-8000-000000000002",
            disclosureVersion: 1,
            consentAcceptedAt: "2026-08-26T00:00:00.000Z",
            state: "requested",
            version: 1,
            createdAt: "2026-08-26T00:00:00.000Z",
            updatedAt: "2026-08-26T00:00:00.000Z",
          }),
          { status: 201 },
        ),
    );
    const client = createLanguageServiceClient(request);

    await expect(
      client.requestAccess(translatedProvider),
    ).resolves.toMatchObject({
      providerId: "provider-aurora",
      state: "requested",
    });
    expect(request).toHaveBeenCalledWith(
      "/api/account/cloud-provider-requests",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(request.mock.calls[0]![1]?.body as string);
    expect(body).toMatchObject({
      providerId: "provider-aurora",
      service: "translation",
      disclosureVersion: 1,
      consentAccepted: true,
    });
    expect(body.idempotencyKey).toEqual(expect.any(String));
  });

  it("includes optimistic version and audit fields in dynamic model commands", async () => {
    const request = vi.fn(
      async (
        _path: string,
        _options?: Pick<RequestInit, "body" | "method" | "signal">,
      ) => new Response(JSON.stringify(localModelSource), { status: 200 }),
    );
    const client = createLanguageServiceClient(request);
    const candidate = {
      id: "00000000-0000-4000-8000-000000000005",
      version: 9,
    } as LocalModelCandidate;
    const version = {
      id: "00000000-0000-4000-8000-000000000006",
      availability: { version: 4 },
    } as SignedLocalModelCatalogRelease["versions"][number];

    await client.evaluateCandidate(candidate);
    await client.updateSourceState(localModelSource, "disabled");
    await client.updateModelAvailability(
      version,
      "enabled_by_override",
      "Reviewed advisory finding.",
      "License provenance was independently verified.",
    );

    expect(JSON.parse(request.mock.calls[0]![1]?.body as string)).toMatchObject(
      {
        expectedVersion: 9,
        expectedState: "discovered",
      },
    );
    expect(JSON.parse(request.mock.calls[1]![1]?.body as string)).toMatchObject(
      {
        state: "disabled",
        expectedVersion: 7,
      },
    );
    expect(JSON.parse(request.mock.calls[2]![1]?.body as string)).toMatchObject(
      {
        state: "enabled_by_override",
        expectedVersion: 4,
        reason: "Reviewed advisory finding.",
        overrideReason: "License provenance was independently verified.",
      },
    );
  });
});
