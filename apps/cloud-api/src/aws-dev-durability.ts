import {
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { GetQueueAttributesCommand, type SQSClient } from "@aws-sdk/client-sqs";

/** Check the configured resources before opening the catalog or listening. */
export async function verifyAwsDevDurability({
  s3,
  sqs,
  bucket,
  queueUrl,
  region,
}: {
  s3: Pick<S3Client, "send">;
  sqs: Pick<SQSClient, "send">;
  bucket: string;
  queueUrl: string;
  region: string;
}) {
  const [, accountId, queueName] = new URL(queueUrl).pathname.split("/");
  const s3Input = { Bucket: bucket, ExpectedBucketOwner: accountId };
  const { LocationConstraint } = await s3
    .send(new GetBucketLocationCommand(s3Input))
    .catch(() => {
      throw new Error(
        "Cannot verify the development transcript bucket owner and region.",
      );
    });
  const bucketRegion =
    LocationConstraint === "EU"
      ? "eu-west-1"
      : LocationConstraint || "us-east-1";
  if (bucketRegion !== region) {
    throw new Error("The development transcript bucket must be in AWS_REGION.");
  }
  const { Status } = await s3
    .send(new GetBucketVersioningCommand(s3Input))
    .catch(() => {
      throw new Error(
        "Cannot verify development transcript bucket versioning.",
      );
    });
  if (Status !== "Enabled") {
    throw new Error(
      "The development transcript bucket requires enabled versioning.",
    );
  }
  const { Attributes } = await sqs
    .send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        // Standard queues reject an explicit FIFO-only attribute request.
        // All returns the ARN and FIFO metadata when applicable.
        AttributeNames: ["All"],
      }),
    )
    .catch(() => {
      throw new Error("Cannot verify the development transcription queue.");
    });
  if (
    Attributes?.QueueArn !==
      `arn:aws:sqs:${region}:${accountId}:${queueName}` ||
    Attributes.FifoQueue === "true"
  ) {
    throw new Error(
      "The development transcription queue must be a regional SQS Standard queue in the transcript bucket account.",
    );
  }
}
