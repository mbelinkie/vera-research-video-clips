# AWS foundation

The initial infrastructure-as-code format is plain AWS CloudFormation so the foundation has no deployment-library dependency. Development and production use separate parameter files and must use separate buckets, queues, databases, and identity resources.

The current template establishes the private versioned transcript bucket and encrypted job queue/DLQ boundaries. The application has an S3 adapter and issues short-lived, project-authorized PUT URLs when `OBJECT_STORE_MODE=s3`, `AWS_REGION`, and `TRANSCRIPT_BUCKET` are configured. It uses the standard AWS credential chain; attach least-privilege access to the runtime identity rather than storing AWS keys in this repository.

The template does not grant a runtime identity access yet. Least-privilege service roles, database networking, production identity, lifecycle rules, and deployment automation belong to the infrastructure deployment work.

No live AWS account is required by the normal test suite. Validate or deploy this template only from an explicitly selected AWS account and region.

## Development deployment

First verify the selected profile and account. Deployment creates billable AWS resources, so inspect the returned identity before continuing.

```bash
AWS_PROFILE=your-profile AWS_REGION=us-east-1 aws sts get-caller-identity
AWS_PROFILE=your-profile AWS_REGION=us-east-1 npm run aws:deploy -- \
  development globally-unique-transcript-bucket http://localhost:43112 \
  arn:aws:iam::123456789012:role/existing-cloud-api-role
```

The role argument is optional. When supplied, the bucket policy grants that existing role only project-prefixed list/get/versioned-get/put/delete access. For production, pass `production`, the production bucket name, and the deployed web origin. The script validates the template, deploys the stack, prints its outputs, and verifies bucket versioning, public-access blocking, and encryption.

After deployment, run the opt-in real-boundary acceptance test. It uploads only under a newly generated project prefix and deletes every created object version afterward:

```bash
AWS_PROFILE=your-profile AWS_REGION=us-east-1 \
AWS_TRANSCRIPT_TEST_BUCKET=globally-unique-transcript-bucket \
npm run test:aws:s3
```

Without `AWS_TRANSCRIPT_TEST_BUCKET`, this live test is skipped and the normal test suite remains AWS-independent.
