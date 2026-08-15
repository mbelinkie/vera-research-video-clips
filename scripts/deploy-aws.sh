#!/usr/bin/env bash
set -euo pipefail

environment_name="${1:-development}"
transcript_bucket="${2:-}"
allowed_origins="${3:-http://localhost:43112}"
cloud_api_role_arn="${4:-}"
aws_profile="${AWS_PROFILE:-default}"
aws_region="${AWS_REGION:-us-east-1}"
stack_name="research-video-clip-tool-${environment_name}"

if [[ "${environment_name}" != "development" && "${environment_name}" != "production" ]]; then
  echo "Environment must be development or production." >&2
  exit 2
fi

if [[ -z "${transcript_bucket}" || "${transcript_bucket}" == replace-with-* ]]; then
  echo "Pass a globally unique transcript bucket name as argument 2." >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_file="${repository_root}/infra/aws/template.yaml"

aws sts get-caller-identity \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --output json

aws cloudformation validate-template \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --template-body "file://${template_file}" >/dev/null

parameter_overrides=(
  "EnvironmentName=${environment_name}"
  "TranscriptBucketName=${transcript_bucket}"
  "AllowedUploadOrigins=${allowed_origins}"
)
if [[ -n "${cloud_api_role_arn}" ]]; then
  parameter_overrides+=("CloudApiRoleArn=${cloud_api_role_arn}")
fi

aws cloudformation deploy \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --template-file "${template_file}" \
  --stack-name "${stack_name}" \
  --parameter-overrides "${parameter_overrides[@]}" \
  --tags \
    "application=research-video-clip-tool" \
    "environment=${environment_name}" \
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --query "Stacks[0].Outputs" \
  --output table

aws s3api get-bucket-versioning \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --bucket "${transcript_bucket}"
aws s3api get-public-access-block \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --bucket "${transcript_bucket}"
aws s3api get-bucket-encryption \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --bucket "${transcript_bucket}"
