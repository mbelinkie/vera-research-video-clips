import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const template = readFileSync(
  fileURLToPath(new URL("../../infra/aws/template.yaml", import.meta.url)),
  "utf8",
);

describe("AWS transcript storage template", () => {
  it("keeps transcript storage private, encrypted, versioned, and browser-transfer capable", () => {
    expect(template).toContain("SSEAlgorithm: AES256");
    expect(template).toContain("VersioningConfiguration:");
    expect(template).toContain("Status: Enabled");
    expect(template).toContain("BlockPublicAcls: true");
    expect(template).toContain("ObjectOwnership: BucketOwnerEnforced");
    expect(template).toContain("AllowedMethods:");
    expect(template).toContain("- PUT");
    expect(template).toContain("x-amz-version-id");
  });

  it("limits the optional runtime principal to project-prefixed objects", () => {
    expect(template).toContain("HasCloudApiRole");
    expect(template).toContain(
      'Resource: !Sub "${TranscriptBucket.Arn}/projects/*"',
    );
    expect(template).toContain("s3:GetObjectVersion");
    expect(template).not.toContain("Action: iam:*");
  });
});
