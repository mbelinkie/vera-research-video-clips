#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-aws-low-cost-dev.sh [--execute] \
  --vpc-id VPC --subnet-id SUBNET --source-commit COMMIT \
  --cognito-domain-prefix PREFIX

Creates and describes an inspectable CloudFormation change set for the separate
low-cost development stack. It executes only when --execute is explicitly set.

Environment:
  AWS_PROFILE   AWS CLI profile (default: research-video-dev)
  AWS_REGION    AWS region (default: us-east-1)
  AWS_CLI_BIN   AWS CLI executable (default: aws)
EOF
}

execute=false
vpc_id=""
subnet_id=""
source_commit=""
cognito_domain_prefix=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)
      execute=true
      shift
      ;;
    --vpc-id)
      vpc_id="${2:-}"
      shift 2
      ;;
    --subnet-id)
      subnet_id="${2:-}"
      shift 2
      ;;
    --source-commit)
      source_commit="${2:-}"
      shift 2
      ;;
    --cognito-domain-prefix)
      cognito_domain_prefix="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "${vpc_id}" =~ ^vpc-[0-9a-f]+$ ]] ||
  [[ ! "${subnet_id}" =~ ^subnet-[0-9a-f]+$ ]] ||
  [[ ! "${source_commit}" =~ ^[0-9a-f]{7,40}$ ]] ||
  [[ ! "${cognito_domain_prefix}" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
  usage >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_file="${repository_root}/infra/aws/low-cost-development.yaml"
aws_cli="${AWS_CLI_BIN:-aws}"
aws_profile="${AWS_PROFILE:-research-video-dev}"
aws_region="${AWS_REGION:-us-east-1}"
stack_name="research-video-clips-low-cost-development"
change_set_name="low-cost-dev-$(date -u +%Y%m%dT%H%M%SZ)"

identity="$(${aws_cli} sts get-caller-identity \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --output json)"
printf '%s\n' "${identity}"
if ! grep -q 'AWSReservedSSO_PowerUserAccess' <<<"${identity}"; then
  echo "Refusing deployment: caller must be the approved SSO PowerUserAccess role." >&2
  exit 2
fi

${aws_cli} cloudformation validate-template \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --template-body "file://${template_file}" >/dev/null

change_set_type="CREATE"
if ${aws_cli} cloudformation describe-stacks \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" >/dev/null 2>&1; then
  change_set_type="UPDATE"
fi

${aws_cli} cloudformation create-change-set \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}" \
  --change-set-type "${change_set_type}" \
  --template-body "file://${template_file}" \
  --capabilities CAPABILITY_IAM \
  --parameters \
    "ParameterKey=VpcId,ParameterValue=${vpc_id}" \
    "ParameterKey=PublicSubnetId,ParameterValue=${subnet_id}" \
    "ParameterKey=SourceCommit,ParameterValue=${source_commit}" \
    "ParameterKey=CognitoDomainPrefix,ParameterValue=${cognito_domain_prefix}" \
  --tags \
    Key=application,Value=research-video-clips \
    Key=environment,Value=development \
    Key=cost-profile,Value=low-cost-development \
  --output json

${aws_cli} cloudformation wait change-set-create-complete \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}"

${aws_cli} cloudformation describe-change-set \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}" \
  --query '{Status:Status,StatusReason:StatusReason,Changes:Changes[].ResourceChange.{Action:Action,LogicalResourceId:LogicalResourceId,ResourceType:ResourceType,Replacement:Replacement}}' \
  --output json

if [[ "${execute}" != true ]]; then
  echo "Change set ${change_set_name} is ready and has not been executed."
  exit 0
fi

${aws_cli} cloudformation execute-change-set \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --change-set-name "${change_set_name}"

if [[ "${change_set_type}" == "CREATE" ]]; then
  ${aws_cli} cloudformation wait stack-create-complete \
    --profile "${aws_profile}" \
    --region "${aws_region}" \
    --stack-name "${stack_name}"
else
  ${aws_cli} cloudformation wait stack-update-complete \
    --profile "${aws_profile}" \
    --region "${aws_region}" \
    --stack-name "${stack_name}"
fi

${aws_cli} cloudformation describe-stacks \
  --profile "${aws_profile}" \
  --region "${aws_region}" \
  --stack-name "${stack_name}" \
  --query 'Stacks[0].{Status:StackStatus,Outputs:Outputs}' \
  --output json
