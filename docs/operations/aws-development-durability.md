# AWS development API durability

[Research #125](https://github.com/mbelinkie/vera-research-video-clips/issues/125) adds an opt-in configuration for the one low-cost development API. PGlite on its existing EBS volume remains the catalog, S3 holds version-pinned artifact bytes, and SQS delivers job notifications. The catalog acknowledges delivery, then an authorized worker claims a lease. A job completes when the catalog commits the published version. Redeploying the process with the same volume, bucket and queue preserves these records. Replacing the instance or losing its volume requires catalog disaster recovery.

## Authorized upgrade procedure

Obtain approval for the change window, AWS costs and test scope before doing any live work. Data access, transfer and restoration require separate approval. Keep the current Cognito app, public HTTPS origin, data directory and instance.

1. Record the installed revision, service config, schema version, AWS account and region, instance role, and EBS volume. Stage the reviewed revision and install locked runtime dependencies before the change window. The checkout deployed by #122 was `400ff65`; verify the current revision independently. Test the migration against a scratch restore and check reference and job identities. A second migration run should apply zero migrations.
2. Use the separate [development add-on template](../../infra/aws/low-cost-development-durable-addons.yaml) in the existing API's account and region. Supply the existing instance **role name**, an unused Standard queue name, and the exact approved HTTPS browser origin. Review the create change set and estimated cost. Stop if it proposes changes outside the add-on's bucket, queues, policies and attachment to that role. Use the service's instance role credentials. The template retains the versioned bucket and both queues and sets no expiration for pinned object versions. Queue retention is four days and DLQ retention is 14 days.
3. Close submissions, pause workers, and record queued, claimed and canceling jobs. Drain active work or explicitly plan for its lease to expire during the outage. Stop `research-video-api` and make a service-quiesced PGlite backup. Record a checksum and restore it to scratch. Verify the restored catalog against the staged revision before switching. Preserve the old checkout, service configuration and backup.
4. Put the following settings in a root-owned `0600` file under `/etc/research-video` and load it after the existing `EnvironmentFile` in a systemd drop-in for `research-video-api.service`. Take both resource values from the add-on outputs.

   ```dotenv
   AWS_DEV_DURABILITY=enabled
   CLOUD_DATABASE_MODE=pglite
   OBJECT_STORE_MODE=s3
   TRANSCRIPT_BUCKET=<TranscriptBucketName output>
   QUEUE_MODE=sqs
   JOB_QUEUE_URL=<JobQueueUrl output>
   ```

5. Use the existing account, region and live data directory when switching the checkout. Reload systemd and start the service. Startup checks the bucket's account and region, enabled versioning and the matching regional Standard queue using the runtime credentials. These read-only metadata checks cannot prove write, receive, delete, or presigned client access. Before reopening submissions, verify the role policy and effective permissions, then use an approved isolated synthetic project to exercise a signed PUT and version-pinned GET and an SQS send, receipt and acknowledgement. Keep Cognito enabled and verify that an unauthorized actor cannot use the project. Allow for S3 versioning propagation after first enabling it. Stop if the runtime role, pinned version ID, worker delivery, backup or permission check fails.
6. With separately approved external acceptance, publish a synthetic transcript and accept a synthetic job, restart the API again, and check identical logical transcript ID and bytes, queue recovery, and one final transcript version after duplicate delivery. Reopen submissions only after the smoke checks pass. Keep a redacted evidence record with the source SHA and operator approval reference.

## Recovery after an interrupted job

The queue conveys the job ID and intended execution location. The catalog keeps the payload, worker attempt and completion state. When a dispatch reservation was persisted before the send, the pump can reserve it again after five minutes. A send with no recorded delivery is retried after the same window if the notification never arrives. A redelivered receipt cannot replace an existing acknowledgement or reopen completed, canceled, paused-pending or unapproved work. Claimed work can be retried after its lease expires, with an incremented attempt. An expired worker cannot finalize or fail the replacement attempt.

Check the API and queue pump logs, oldest queued age, unacknowledged jobs, active leases, and DLQ count. A receipt left in the DLQ does not determine the job's state. Fix the underlying configuration or poison message first, then let the catalog pump retry eligible undispatched work. Avoid bulk redrive or queue purges. A job pending more than a reservation window plus the time needed to drain the queue warrants inspection of eligibility, credentials and provider health. Keep cancellation and approval state intact.

## Transcript inventory and unavailable content

The [#122 upgrade record](https://github.com/mbelinkie/vera-research-video-clips/issues/122) reported four versions and twelve artifact references. Two active versions had six retained-copy candidates. The other six historical references had no recoverable bytes in the snapshot or memory store. Those counts describe the November 23 checkpoint. The two candidate bundles need complete verification against a current authorized snapshot. The evidence does not establish the present condition of live data.

A video with no active pointer returns `404`. A published pointer whose manifest fails verification returns `422` and the client reports **Published transcript unavailable. Stored content could not be verified.** A later download or checksum failure can also make a published bundle unavailable to a fresh client. Leave the active pointer intact and resolve the missing bytes independently of transcription.

On an approved, isolated Linux scratch catalog restored from a quiesced backup, run the audit with explicit offline inventories. Omit either inventory to report its references as missing; the tool never contacts AWS. PGlite can write to its scratch data directory during recovery. The CLI runs a read-only SQL transaction after opening it. Keep each inventory in a private directory with stable contents throughout the audit.

```sh
node --import tsx scripts/audit-dev-transcript-refs.ts \
  --scratch-catalog /disposable/cloud-catalog \
  --retained /disposable/retained-index \
  --destination /disposable/destination-export
```

Each supplied directory needs an `index.json` array. Include one entry per logical transcript version and artifact type. `file` is a relative path under that directory. For a destination export, include the physical `objectVersionId` from the exact version-pinned download. Example entry:

```json
{
  "transcriptVersionId": "7f7a30ea-5b5f-4b45-a0ad-1f73eb7085f1",
  "type": "manifest",
  "file": "bundle/manifest.json",
  "objectVersionId": "fixture-physical-version"
}
```

Keep the report private. It provides logical IDs, active flags, pin-set digests and per-artifact states. It omits object locators, URLs, transcript text and local filenames. **Verified** requires the complete typed manifest bound to the original logical identity and every catalog artifact with matching original keys, physical versions, sizes and hashes. **Partial** means only some files verified. **Missing** means the inventory supplies no usable bytes. **Corrupt** includes a duplicate, invalid path, invalid manifest binding or mismatched bytes. A verified destination export attests to the supplied captured bytes. Confirm current readability separately with an authorized read.

## Restore a verified bundle only after data approval

Use a fresh private scratch audit and stop if the pin-set digest changed, any artifact is absent, or the candidate is ambiguous. Keep originals and backups. A separately reviewed maintenance procedure must:

1. Upload every verified payload to approved immutable object keys. Read the exact new physical versions back and compare length and SHA-256. Keep the logical transcript ID, project, video, lineage, provenance and timing.
2. Rebuild the original manifest with the new physical artifact pins, upload it, and verify its new physical pin and SHA-256.
3. In one catalog transaction lock the version, its artifact rows and the project-video row. Compare all old pins and the active pointer to the audited snapshot. Update every physical artifact reference and the manifest reference and hash together. Abort on any mismatch. Preserve the logical version and project-video pointer.
4. Verify through an authorized fresh client and record only logical IDs and counts. If a previous attempt already committed, verify that exact destination mapping before repeating any writes. If S3 staging succeeded but the catalog transaction failed, record the staged versions privately for later reconciliation. Keep them until safely reviewed.

The audit has no apply operation. An unverified or incomplete version remains unavailable.

## Rollback

Before reopening writes, stop the service, preserve the failed revision and another catalog copy, then restore the previous checkout and config. If migrations require restoring the pre-upgrade catalog, first prove that no accepted work or publication has been added since the backup. Verify service health, authorization and expected catalog reads after restart.

After any new work or publication, keep the newest catalog, bucket and queues. Do not switch back to memory or restore an older catalog over later accepted work. Roll forward, or roll back to a compatible revision that continues to use those same durable resources. If a compatible rollback is unavailable, keep submissions paused and plan reconciliation from both snapshots. Retain backups, the resource identifiers and access policies until recovery is verified.

## Illustrative monthly incremental cost

Estimate for us-east-1 in USD over 30 days. The existing EC2, EBS and Cognito baseline is unchanged by this add-on.

| Component           | Assumption                                                                          |                                                           Estimate |
| ------------------- | ----------------------------------------------------------------------------------- | -----------------------------------------------------------------: |
| S3 Standard storage | 10 GB-month across current and noncurrent versions at $0.023/GB-month               |                                                             $0.230 |
| S3 requests         | 1,000 PUT/LIST at $0.005 per 1,000, 10,000 GET/HEAD at $0.0004 per 1,000            |                                                             $0.009 |
| SQS Standard        | Up to 1.296 million idle receives at one poll per two seconds and $0.40 per million |                                            $0.518 before free tier |
| Total               | Above workload before transfer and other usage                                      | $0.757 gross, about $0.357 if the full 1M SQS free requests remain |

With the same requests and 1 GB retained, estimate $0.55 gross or $0.15 with the full remaining SQS allowance. At 100 GB, estimate $2.83 gross or $2.43 with the allowance.

SQS sends, deletes, retries, DLQ inspection and metadata calls add requests. Include signed desktop downloads in regional internet transfer estimates, and budget retained noncurrent bytes, snapshots and any approved provider use separately. Reprice actual retained GB, request volume and egress before approval. [AWS S3 pricing](https://aws.amazon.com/s3/pricing/) · [AWS SQS pricing](https://aws.amazon.com/sqs/pricing/).
