#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/configure-youtube-search-dev.sh

Securely stores an official YouTube Data API v3 key in the low-cost development
stack's SSM SecureString parameter and starts the stack-managed refresh.

Environment:
  AWS_PROFILE   AWS CLI profile (default: research-video-dev)
  AWS_REGION    AWS region (default: us-east-1)
  AWS_CLI_BIN   AWS CLI executable (default: aws)
  STACK_NAME    CloudFormation stack (default: research-video-clips-low-cost-development)
EOF
}

if [[ $# -gt 0 ]]; then
  usage >&2
  exit 2
fi

aws_cli="${AWS_CLI_BIN:-aws}"
aws_profile="${AWS_PROFILE:-research-video-dev}"
aws_region="${AWS_REGION:-us-east-1}"
stack_name="${STACK_NAME:-research-video-clips-low-cost-development}"
parameter_name="/research-video-clips/development/youtube-api-key"

identity="$(${aws_cli} sts get-caller-identity \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --output json)"
if ! grep -q 'AWSReservedSSO_PowerUserAccess' <<<"${identity}"; then
  echo "Refusing configuration: caller must be the approved SSO PowerUserAccess role." >&2
  exit 2
fi

association_id="$(${aws_cli} cloudformation describe-stack-resource \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --logical-resource-id YouTubeSearchConfigurationAssociation \
  --query 'StackResourceDetail.PhysicalResourceId' \
  --output text)"
if [[ -z "${association_id}" || "${association_id}" == "None" ]]; then
  echo "The stack does not have the YouTube search configuration boundary yet." >&2
  exit 2
fi

if [[ ! -t 0 ]]; then
  echo "Run this script in an interactive terminal so the key is never echoed." >&2
  exit 2
fi
read -r -s -p "Official YouTube Data API v3 key: " youtube_api_key
printf '\n'
if [[ ! "${youtube_api_key}" =~ ^[A-Za-z0-9_-]{20,200}$ ]]; then
  echo "The key must be 20-200 letters, digits, underscores, or hyphens." >&2
  exit 2
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT
chmod 0700 "${temporary_directory}"
key_file="${temporary_directory}/key"
payload_file="${temporary_directory}/put-parameter.json"
printf '%s' "${youtube_api_key}" > "${key_file}"
chmod 0600 "${key_file}"
unset youtube_api_key

node --input-type=module - "${key_file}" "${payload_file}" "${parameter_name}" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [, , keyFile, payloadFile, parameterName] = process.argv;
const value = readFileSync(keyFile, "utf8");
writeFileSync(
  payloadFile,
  JSON.stringify({
    Name: parameterName,
    Description: "Server-only official YouTube Data API v3 key for VERA development search",
    Value: value,
    Type: "SecureString",
    Tier: "Standard",
    Overwrite: true,
  }),
  { mode: 0o600 },
);
NODE

${aws_cli} ssm put-parameter \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --cli-input-json "file://${payload_file}" \
  --query Version \
  --output text >/dev/null

${aws_cli} ssm start-associations-once \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --association-ids "${association_id}" >/dev/null

echo "YouTube search configuration refresh started. Reopen Search in about one minute."
