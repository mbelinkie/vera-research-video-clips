import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { describe, expect, it, vi } from "vitest";

import { pumpJobQueueOnce, SqsJobQueue, type JobQueue } from "./job-queue.ts";

describe("pumpJobQueueOnce", () => {
  it("moves SQS receipt handling behind the service boundary", async () => {
    const delivery = {
      schemaVersion: 1 as const,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee31",
      executionLocation: "local" as const,
      messageId: "message-1",
      receiptHandle: "receipt-1",
    };
    const queue: JobQueue = {
      publish: vi.fn(),
      receive: vi.fn(async () => delivery),
      changeVisibility: vi.fn(),
      delete: vi.fn(),
    };
    const catalog = {
      listUndispatchedTranscriptionJobs: vi.fn(async () => [
        { jobId: delivery.jobId, executionLocation: "local" as const },
      ]),
      markTranscriptionJobDispatched: vi.fn(async () => undefined),
      markTranscriptionJobQueueDelivered: vi.fn(async () => true),
    };

    await pumpJobQueueOnce(queue, catalog);

    expect(queue.publish).toHaveBeenCalledWith({
      schemaVersion: 1,
      jobId: delivery.jobId,
      executionLocation: "local",
    });
    expect(catalog.markTranscriptionJobQueueDelivered).toHaveBeenCalledWith(
      delivery.jobId,
      "local",
    );
    expect(queue.delete).toHaveBeenCalledWith("receipt-1");
  });
});

describe("SqsJobQueue", () => {
  it("publishes, leases, extends, and deletes bounded job signals", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof ReceiveMessageCommand) {
        return {
          Messages: [
            {
              MessageId: "message-1",
              ReceiptHandle: "receipt-1",
              Body: JSON.stringify({
                schemaVersion: 1,
                jobId: "019fbb95-cd76-7920-93fa-e23ba755ee31",
                executionLocation: "local",
              }),
            },
          ],
        };
      }
      return {};
    });
    const queue = new SqsJobQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123/jobs",
      region: "us-east-1",
      client: { send, destroy: vi.fn() } as unknown as SQSClient,
    });
    const message = {
      schemaVersion: 1 as const,
      jobId: "019fbb95-cd76-7920-93fa-e23ba755ee31",
      executionLocation: "local" as const,
    };

    await queue.publish(message);
    await expect(queue.receive(120)).resolves.toEqual({
      ...message,
      messageId: "message-1",
      receiptHandle: "receipt-1",
    });
    await queue.changeVisibility("receipt-1", 180);
    await queue.delete("receipt-1");

    expect(send.mock.calls[0]![0]).toBeInstanceOf(SendMessageCommand);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(ReceiveMessageCommand);
    expect(send.mock.calls[2]![0]).toBeInstanceOf(
      ChangeMessageVisibilityCommand,
    );
    expect(send.mock.calls[3]![0]).toBeInstanceOf(DeleteMessageCommand);
  });

  it("rejects malformed queue bodies without acknowledging them", async () => {
    const queue = new SqsJobQueue({
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123/jobs",
      region: "us-east-1",
      client: {
        send: async () => ({
          Messages: [
            {
              MessageId: "message-1",
              ReceiptHandle: "receipt-1",
              Body: JSON.stringify({ jobId: "not-a-uuid" }),
            },
          ],
        }),
        destroy: vi.fn(),
      } as unknown as SQSClient,
    });

    await expect(queue.receive(120)).rejects.toThrow();
  });
});
