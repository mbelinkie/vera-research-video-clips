# AWS boundaries

## Low-cost personal development

`low-cost-development.yaml` is a separate, explicitly non-production boundary
for personal dogfood. It provisions an admin-invite-only Cognito pool/public
PKCE client and one encrypted ARM EC2 instance with IMDSv2 behind Caddy HTTPS.
The instance runs the existing Cognito-verifying API with a disk-backed PGlite
catalog, memory transcript storage, an in-memory queue, and translation
disabled. It does not modify or weaken the production template below.

At current `us-east-1` on-demand rates, the `t4g.micro`, one public IPv4
address, and 12 GiB gp3 root volume have an approximate **$11/month floor**,
before data transfer, request charges, taxes, or optional services. Stopping the
instance avoids compute charges but not public IPv4/EBS charges and makes the
API unavailable. Delete the dedicated stack to stop all of its recurring
resources.

The deployment script verifies an SSO PowerUser caller, validates the template,
creates and describes a change set, and executes only with `--execute`:

```bash
AWS_PROFILE=your-sso-profile AWS_REGION=us-east-1 \
AWS_CLI_BIN=/path/to/current/aws \
scripts/deploy-aws-low-cost-dev.sh \
  --vpc-id vpc-approved \
  --subnet-id subnet-approved-public \
  --source-commit reviewed-full-git-sha \
  --cognito-domain-prefix approved-unique-prefix

# After inspecting the change set, repeat with --execute.
```

### Enable official YouTube search

Search uses the official YouTube Data API v3 from the cloud API; the key never
belongs in the web renderer, desktop package, repository, CloudFormation
parameters, UserData, logs, or command line. In Google Cloud, enable **YouTube
Data API v3**, create an API key restricted to that API, and restrict its
application access to the development server's Elastic IP `/32`. The default
Data API quota makes search a deliberately bounded development feature.

The stack gives the API instance permission to decrypt exactly one SSM
SecureString parameter and uses an SSM State Manager association to refresh a
root-owned `0640` systemd environment file. If the parameter is absent, Search
stays visibly unavailable; the direct pasted-URL workflow still works through
YouTube oEmbed metadata and automatic local processing.

After the reviewed stack update has created
`YouTubeSearchConfigurationAssociation`, store or rotate the key without
echoing it:

```bash
AWS_PROFILE=your-sso-profile AWS_REGION=us-east-1 \
scripts/configure-youtube-search-dev.sh
```

The script verifies the approved SSO role, prompts without echo, writes the key
through a private temporary JSON request, triggers the managed refresh, and
deletes its temporary files. Reopen the Search tab after about one minute; its
YouTube provider should report available. A scheduled 30-minute refresh picks
up later rotations or removal, and removal returns Search to unavailable after
restarting the API.

Do not use this boundary as shared-transcript durability evidence: memory
objects and queue messages do not survive an API process restart, and replacing
or deleting the instance loses its PGlite catalog. The full production boundary
remains required for M7-01.

For functional requirements, current price evidence, and lower-cost 10–20-user
pilot alternatives, see
`docs/research/AWS-small-team-hosting-requirements-and-options.md`.

## Production boundary

The CloudFormation template defines the M7-01 production boundary: a private,
versioned transcript bucket; encrypted SQS queue and DLQ; private ECS/Fargate
API tasks behind an HTTPS ALB; private encrypted multi-AZ PostgreSQL; Cognito;
managed secrets; logs; alarms; and separate execution/task roles.

Normal tests make no AWS calls. The deployment script validates its parameter
file, verifies the selected AWS identity, validates the template, and creates
an inspectable CloudFormation change set. It never executes that change set.

## Prepare a change set

Fill the appropriate file under `infra/aws/environments/`. Every placeholder
must be replaced with an approved value, including the VPC and its resolver,
two public and two private subnets in separate availability zones, ACM
certificate, DNS name, immutable image digest, bucket, Cognito domain, and
runtime database-password secret.

The database runtime role is an explicit prerequisite. An authorized database
administrator must create it and grant only the reviewed schema-migration and
catalog privileges; the API task never receives the RDS master secret. The
supplied private subnets must also have approved NAT or VPC-endpoint egress for
ECR, Logs, Secrets Manager, S3, SQS, Cognito JWKS, and Amazon Translate.

```bash
AWS_PROFILE=your-profile AWS_REGION=us-east-1 \
npm run aws:deploy -- production
```

Use `--parameter-file PATH` or `--change-set-name NAME` when needed. Inspect the
reported identity and full change set before separately authorizing any stack
mutation. Production execution, rollback, backup/restore, alarm, Cognito, S3,
SQS, PostgreSQL, and Translate acceptance evidence is required before M7-01 can
close.

The opt-in S3 boundary test remains available for an already approved bucket:

```bash
AWS_PROFILE=your-profile AWS_REGION=us-east-1 \
AWS_TRANSCRIPT_TEST_BUCKET=approved-versioned-test-bucket \
npm run test:aws:s3
```
