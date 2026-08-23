import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SharedProjectCatalog } from "@research-video/catalog";
import type { AuthenticatedActor } from "@research-video/contracts";

import { createCloudApi } from "./app.ts";

const actor: AuthenticatedActor = {
  userId: randomUUID(),
  externalSubject: "cognito:fixture:queue-worker",
};

describe("queued transcription claim route", () => {
  it("claims only database work acknowledged by the service-side queue consumer", async () => {
    const claimTranscriptionJob = vi.fn(async () => undefined);
    const app = createCloudApi({
      catalog: { claimTranscriptionJob } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
      queueDeliveryRequired: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      payload: {
        executionLocation: "local",
        leaseSeconds: 120,
      },
    });

    expect(response.statusCode).toBe(204);
    expect(claimTranscriptionJob).toHaveBeenCalledWith(
      actor,
      "local",
      120,
      true,
    );
    await app.close();
  });

  it("keeps development database claims independent of SQS", async () => {
    const claimTranscriptionJob = vi.fn(async () => undefined);
    const app = createCloudApi({
      catalog: { claimTranscriptionJob } as unknown as SharedProjectCatalog,
      authenticate: async () => actor,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/transcription-jobs/claim",
      payload: { executionLocation: "local", leaseSeconds: 120 },
    });

    expect(response.statusCode).toBe(204);
    expect(claimTranscriptionJob).toHaveBeenCalledWith(
      actor,
      "local",
      120,
      false,
    );
    await app.close();
  });
});
