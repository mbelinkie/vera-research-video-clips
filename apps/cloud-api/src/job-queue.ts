import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { z } from "zod";

import type { SharedProjectCatalog } from "@research-video/catalog";

const JobQueueMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobId: z.uuid(),
    executionLocation: z.enum(["local", "hosted"]),
  })
  .strict();

export type JobQueueMessage = z.infer<typeof JobQueueMessageSchema>;

export type JobQueueDelivery = JobQueueMessage & {
  messageId: string;
  receiptHandle: string;
};

export interface JobQueue {
  publish(message: JobQueueMessage): Promise<void>;
  receive(visibilitySeconds: number): Promise<JobQueueDelivery | undefined>;
  changeVisibility(
    receiptHandle: string,
    visibilitySeconds: number,
  ): Promise<void>;
  delete(receiptHandle: string): Promise<void>;
}

export async function pumpJobQueueOnce(
  queue: JobQueue,
  catalog: Pick<
    SharedProjectCatalog,
    | "listUndispatchedTranscriptionJobs"
    | "markTranscriptionJobDispatched"
    | "markTranscriptionJobQueueDelivered"
  >,
): Promise<void> {
  const jobs = await catalog.listUndispatchedTranscriptionJobs();
  for (const job of jobs) {
    await queue.publish({
      schemaVersion: 1,
      jobId: job.jobId,
      executionLocation: job.executionLocation,
    });
    await catalog.markTranscriptionJobDispatched(job.jobId);
  }
  const delivery = await queue.receive(30);
  if (!delivery) return;
  await catalog.markTranscriptionJobQueueDelivered(
    delivery.jobId,
    delivery.executionLocation,
  );
  await queue.delete(delivery.receiptHandle);
}

export class SqsJobQueue implements JobQueue {
  readonly #client: SQSClient;
  readonly #queueUrl: string;

  constructor(options: {
    queueUrl: string;
    region: string;
    client?: SQSClient;
  }) {
    this.#client = options.client ?? new SQSClient({ region: options.region });
    this.#queueUrl = options.queueUrl;
  }

  async publish(message: JobQueueMessage) {
    await this.#client.send(
      new SendMessageCommand({
        QueueUrl: this.#queueUrl,
        MessageBody: JSON.stringify(JobQueueMessageSchema.parse(message)),
      }),
    );
  }

  async receive(visibilitySeconds: number) {
    const result = await this.#client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.#queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 1,
        VisibilityTimeout: visibilitySeconds,
      }),
    );
    const message = result.Messages?.[0];
    if (!message) return undefined;
    if (!message.Body || !message.MessageId || !message.ReceiptHandle) {
      throw new Error("SQS returned an incomplete job delivery.");
    }
    return {
      ...JobQueueMessageSchema.parse(JSON.parse(message.Body)),
      messageId: message.MessageId,
      receiptHandle: message.ReceiptHandle,
    };
  }

  async changeVisibility(receiptHandle: string, visibilitySeconds: number) {
    await this.#client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.#queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilitySeconds,
      }),
    );
  }

  async delete(receiptHandle: string) {
    await this.#client.send(
      new DeleteMessageCommand({
        QueueUrl: this.#queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  destroy() {
    this.#client.destroy();
  }
}
