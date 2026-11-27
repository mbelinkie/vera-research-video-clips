import {
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { GetQueueAttributesCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { expect, it, vi } from "vitest";

import { verifyAwsDevDurability } from "./aws-dev-durability.ts";

const account = "123456789012";
const region = "us-east-1";
const arn = `arn:aws:sqs:${region}:${account}:jobs`;
const verify = (s3Send: unknown, sqsSend: unknown) =>
  verifyAwsDevDurability({
    s3: { send: s3Send as S3Client["send"] },
    sqs: { send: sqsSend as SQSClient["send"] },
    bucket: "fixture-transcripts",
    queueUrl: `https://sqs.${region}.amazonaws.com/${account}/jobs`,
    region,
  });

it("verifies bucket owner, region, versioning and the Standard queue before startup", async () => {
  const s3 = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ Status: "Enabled" });
  const sqs = vi.fn(async (command: GetQueueAttributesCommand) => {
    // Real Standard queues reject an explicitly requested FIFO-only attribute.
    if (command.input.AttributeNames?.includes("FifoQueue")) {
      throw new Error("InvalidAttributeName: Unknown Attribute FifoQueue");
    }
    return { Attributes: { QueueArn: arn } };
  });
  await expect(verify(s3, sqs)).resolves.toBeUndefined();
  expect(
    s3.mock.calls.map(([command]) => [command.constructor, command.input]),
  ).toEqual([
    [
      GetBucketLocationCommand,
      { Bucket: "fixture-transcripts", ExpectedBucketOwner: account },
    ],
    [
      GetBucketVersioningCommand,
      { Bucket: "fixture-transcripts", ExpectedBucketOwner: account },
    ],
  ]);
  expect(sqs).toHaveBeenCalledWith(expect.any(GetQueueAttributesCommand));
  expect(sqs.mock.calls[0]?.[0].input.AttributeNames).toEqual(["All"]);
});

it.each([
  [{ LocationConstraint: "us-west-2" }, {}, {}, "must be in AWS_REGION"],
  [{}, { Status: "Suspended" }, {}, "enabled versioning"],
  [
    {},
    { Status: "Enabled" },
    { QueueArn: arn, FifoQueue: "true" },
    "SQS Standard",
  ],
  [
    {},
    { Status: "Enabled" },
    { QueueArn: arn.replace(account, "999999999999") },
    "SQS Standard",
  ],
])(
  "fails closed on mismatched resource metadata",
  async (location, versioning, attributes, message) => {
    const s3 = vi
      .fn()
      .mockResolvedValueOnce(location)
      .mockResolvedValueOnce(versioning);
    const sqs = vi.fn().mockResolvedValue({ Attributes: attributes });
    await expect(verify(s3, sqs)).rejects.toThrow(message);
  },
);

it("fails closed without exposing upstream details when IAM denies startup verification", async () => {
  const denied = vi.fn().mockRejectedValue(new Error("private bucket/key"));
  const s3 = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ Status: "Enabled" });
  await expect(verify(denied, vi.fn())).rejects.toThrow(
    "Cannot verify the development transcript bucket owner and region.",
  );
  await expect(verify(s3, denied)).rejects.toThrow(
    "Cannot verify the development transcription queue.",
  );
});
