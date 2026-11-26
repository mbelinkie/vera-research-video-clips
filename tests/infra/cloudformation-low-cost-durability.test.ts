import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const template = readFileSync(
  new URL(
    "../../infra/aws/low-cost-development-durable-addons.yaml",
    import.meta.url,
  ),
  "utf8",
);

it("adds private, retained versioned artifacts without replacing the development host", () => {
  expect(template).not.toMatch(/AWS::(EC2|Cognito|RDS|ECS)::/u);
  expect(template).toContain("VersioningConfiguration: { Status: Enabled }");
  expect(template).toContain("SSEAlgorithm: AES256");
  for (const field of [
    "BlockPublicAcls",
    "BlockPublicPolicy",
    "IgnorePublicAcls",
    "RestrictPublicBuckets",
  ])
    expect(template).toContain(`${field}: true`);
  expect(template).toContain("AllowedOrigins: [!Ref UploadOrigin]");
  expect(template).toContain("x-amz-version-id");
  expect(template).not.toContain("NoncurrentVersionExpiration");
  expect(template.match(/DeletionPolicy: Retain/gu)).toHaveLength(3);
});

it("redrives Standard notifications and grants the existing role scoped runtime access", () => {
  expect(template.match(/SqsManagedSseEnabled: true/gu)).toHaveLength(2);
  expect(template).toContain(
    "deadLetterTargetArn: !GetAtt JobDeadLetterQueue.Arn",
  );
  expect(template).toContain("Roles: [!Ref ApiRoleName]");
  expect(template).toContain("Resource: !GetAtt JobQueue.Arn");
  expect(template).toContain("s3:GetObjectVersion");
  expect(template).not.toMatch(
    /Resource: ["']?\*|sqs:PurgeQueue|FifoQueue: true/u,
  );
});
