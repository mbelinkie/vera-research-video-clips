# M7-01 current AWS and Cognito production boundary

Date checked: 2026-08-23

This record captures version-sensitive primary-source constraints used by
M7-01. It is not a deployment record and contains no account identifiers,
credentials, domains, certificates, image URIs, or production parameters.

## Cognito native public client

- Use a public app client with no secret, authorization-code grant only, and
  S256 PKCE. Cognito authorization codes expire after five minutes. The request
  includes an exact registered callback, high-entropy state, challenge, and
  `code_challenge_method=S256`; token exchange supplies the original verifier.
- Cognito permits registered absolute custom-scheme callbacks without
  fragments. M7 retains the approved
  `research-video-clips://oauth/callback`; M7-02 owns OS registration, external
  browser launch, exact callback routing, and Keychain-backed persistence.
- Refresh uses the same public client at `/oauth2/token`. Rotation-aware clients
  atomically adopt a returned replacement refresh token and otherwise retain
  the current token. Sign-out separately revokes the refresh-token chain at
  `/oauth2/revoke` and opens the registered managed-login `/logout` redirect.
  Local sign-out must still clear protected state when remote revocation is
  unavailable.

Sources:

- <https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html>
- <https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html>
- <https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html>
- <https://docs.aws.amazon.com/cognito/latest/developerguide/revocation-endpoint.html>
- <https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html>
- <https://www.rfc-editor.org/rfc/rfc8252.html>

## ECS, ALB, and private RDS

- Fargate tasks use `awsvpc`. Production tasks have no public IP and run in
  private subnets; their security group accepts the API port only from the ALB
  security group. The public ALB accepts HTTPS, uses an ACM certificate and an
  explicit TLS policy, and reaches the unauthenticated bounded health endpoint.
- RDS uses a DB subnet group spanning at least two availability zones,
  `PubliclyAccessible=false`, storage encryption, TLS with CA validation, and
  port 5432 ingress only from the API task security group. Clients connect to
  the RDS DNS name, not a fixed address.
- Production automated backup retention is positive. The master password is
  RDS-managed in Secrets Manager. Runtime access must use a distinct
  least-privilege database identity rather than exposing master credentials to
  the desktop.

Sources:

- <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html>
- <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html>
- <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html>
- <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.Enabling.html>

## S3, SQS, and task-role Translate

- Transcript storage remains private, versioned, encrypted, and blocked from
  public access. Lifecycle rules explicitly handle abandoned staging and
  noncurrent objects; versioning itself is not cleanup.
- SQS is at-least-once. Visibility is extended during owned work and a message
  is deleted only after durable completion. The same-region DLQ has greater
  retention, a redrive-allow policy restricted to its source queue, and a
  nonzero-depth alarm. Database leases and idempotency remain authoritative.
- The ECS task role is distinct from the execution role. Only the cloud API task
  role receives `translate:TranslateText`; neither desktop nor local-worker
  configuration receives AWS credentials. Amazon Translate input remains below
  10,000 UTF-8 bytes per request and requires explicit user consent before
  transcript text leaves the workstation.

Sources:

- <https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html>
- <https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html>
- <https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-encryption.html>
- <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
- <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>
- <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-security-best-practices.html>
- <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html>
- <https://docs.aws.amazon.com/translate/latest/dg/security_iam_service-with-iam.html>
- <https://docs.aws.amazon.com/translate/latest/APIReference/translate-api.pdf>

## Parameters that remain external

Do not infer the AWS account/region, DNS name and hosted zone, certificate ARN,
container image URI, RDS engine/class/Multi-AZ choice, backup retention/window,
KMS strategy, NAT versus VPC endpoints, alarm notification target, or approved
cost/retention policy. The implementation may validate and expose these as
parameters. A production mutation waits for their explicit values, an inspected
change set, rollback review, and deployment authority.

The database runtime identity is also an external bootstrap prerequisite. The
task definition accepts only an approved runtime-password secret and never
receives the RDS master secret. Before API tasks can start, that runtime role
must be provisioned with the reviewed migration/catalog grants by an authorized
database administrator; M7-01 does not invent or execute those grants.
