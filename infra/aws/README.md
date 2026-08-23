# AWS production boundary

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
