#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-aws.sh [--parameter-file PATH] [--change-set-name NAME] <development|production>

Validates the template, creates a CloudFormation change set, waits for it to be
created, and describes it. It never executes a change set or deploys resources.
Populate the selected parameter JSON with approved account-specific values first.
EOF
}

environment_name=""
parameter_file=""
change_set_name=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --parameter-file)
      parameter_file="${2:-}"
      shift 2
      ;;
    --change-set-name)
      change_set_name="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    development|production)
      if [[ -n "${environment_name}" ]]; then
        usage >&2
        exit 2
      fi
      environment_name="$1"
      shift
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${environment_name}" ]]; then
  usage >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_file="${repository_root}/infra/aws/template.yaml"
if [[ -z "${parameter_file}" ]]; then
  parameter_file="${repository_root}/infra/aws/environments/${environment_name}.json"
fi

if [[ ! -f "${parameter_file}" ]]; then
  echo "Parameter file does not exist: ${parameter_file}" >&2
  exit 2
fi

aws_profile="${AWS_PROFILE:-default}"
aws_region="${AWS_REGION:-us-east-1}"
stack_name="research-video-clip-tool-${environment_name}"
if [[ -z "${change_set_name}" ]]; then
  change_set_name="review-$(date -u +%Y%m%dT%H%M%SZ)"
fi

temporary_parameters="$(mktemp "${TMPDIR:-/tmp}/research-video-clips-cfn-parameters.XXXXXX")"
trap 'rm -f "${temporary_parameters}"' EXIT

node --input-type=module - "${parameter_file}" "${environment_name}" "${temporary_parameters}" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [parameterPath, environmentName, outputPath] = process.argv.slice(2);
let parameters;
try {
  parameters = JSON.parse(readFileSync(parameterPath, "utf8"));
} catch (error) {
  console.error(`Could not parse parameter file ${parameterPath}: ${error.message}`);
  process.exit(2);
}

if (parameters === null || Array.isArray(parameters) || typeof parameters !== "object") {
  console.error("Parameter JSON must be an object whose keys are CloudFormation parameter names.");
  process.exit(2);
}
if (parameters.EnvironmentName !== environmentName) {
  console.error(`Parameter file EnvironmentName must equal ${environmentName}.`);
  process.exit(2);
}

const required = [
  "TranscriptBucketName",
  "VpcId",
  "VpcDnsResolverCidr",
  "PublicSubnetIds",
  "PrivateSubnetIds",
  "AcmCertificateArn",
  "ApiDomainName",
  "ApiContainerImage",
  "CognitoDomainPrefix",
  "DatabaseRuntimePasswordSecretArn",
];
for (const key of required) {
  const value = parameters[key];
  if (typeof value !== "string" || value.trim() === "" || value.includes("replace-with-")) {
    console.error(`Set an approved non-placeholder ${key} value before creating a change set.`);
    process.exit(2);
  }
}

for (const key of ["PublicSubnetIds", "PrivateSubnetIds"]) {
  if (parameters[key].split(",").filter(Boolean).length < 2) {
    console.error(`${key} must identify at least two subnets in separate Availability Zones.`);
    process.exit(2);
  }
}

const hasHostedZone = typeof parameters.HostedZoneId === "string" && parameters.HostedZoneId !== "";
if (hasHostedZone && (typeof parameters.ApiDomainName !== "string" || parameters.ApiDomainName === "")) {
  console.error("HostedZoneId requires the fully qualified ApiDomainName it should alias.");
  process.exit(2);
}
for (const [key, value] of Object.entries(parameters)) {
  if (typeof value !== "string" && typeof value !== "number") {
    console.error(`${key} must be a string or number parameter value.`);
    process.exit(2);
  }
  if (String(value).includes("replace-with-")) {
    console.error(`Set an approved non-placeholder ${key} value before creating a change set.`);
    process.exit(2);
  }
}

writeFileSync(
  outputPath,
  `${JSON.stringify(
    Object.entries(parameters).map(([ParameterKey, value]) => ({
      ParameterKey,
      ParameterValue: String(value),
    })),
    null,
    2,
  )}\n`,
);
NODE

aws sts get-caller-identity \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --output json

aws cloudformation validate-template \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --template-body "file://${template_file}" >/dev/null

change_set_type="CREATE"
if aws cloudformation describe-stacks \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" >/dev/null 2>&1; then
  change_set_type="UPDATE"
fi

aws cloudformation create-change-set \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}" \
  --change-set-type "${change_set_type}" \
  --template-body "file://${template_file}" \
  --parameters "file://${temporary_parameters}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags \
    "Key=application,Value=research-video-clip-tool" \
    "Key=environment,Value=${environment_name}" \
  --output json

if ! aws cloudformation wait change-set-create-complete \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}"; then
  echo "Change-set creation did not complete successfully; describing it for inspection." >&2
fi

aws cloudformation describe-change-set \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}" \
  --output json

echo "Change set ${change_set_name} is inspectable and has not been executed."
