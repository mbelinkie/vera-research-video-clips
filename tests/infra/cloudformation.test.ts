import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const template = readFileSync(new URL("infra/aws/template.yaml", root), "utf8");
const deployScript = readFileSync(
  new URL("scripts/deploy-aws.sh", root),
  "utf8",
);
const developmentParameters = JSON.parse(
  readFileSync(
    new URL("infra/aws/environments/development.json", root),
    "utf8",
  ),
) as Record<string, string>;
const productionParameters = JSON.parse(
  readFileSync(new URL("infra/aws/environments/production.json", root), "utf8"),
) as Record<string, string>;

describe("AWS production boundary template", () => {
  it("keeps transcript storage private, encrypted, versioned, and split between immutable projects and disposable staging", () => {
    expect(template).toContain("Type: AWS::S3::Bucket");
    expect(template).toContain("SSEAlgorithm: AES256");
    expect(template).toContain("BucketKeyEnabled: true");
    expect(template).toContain("VersioningConfiguration:");
    expect(template).toContain("Status: Enabled");
    expect(template).toContain("BlockPublicAcls: true");
    expect(template).toContain("ObjectOwnership: BucketOwnerEnforced");
    expect(template).toContain("AllowedMethods: [GET, HEAD, PUT]");
    expect(template).toContain("x-amz-version-id");
    expect(template).toContain("ReadImmutableProjectObjects");
    expect(template).toContain("WriteImmutableProjectVersions");
    expect(template).toContain("ManageJobScopedStagingOnly");
    expect(template).toContain("${TranscriptBucket.Arn}/staging/*");
    expect(template).toContain("ExpireDisposableStagingVersions");
    expect(template).toContain("NoncurrentDays: 7");
  });

  it("uses private Fargate tasks behind a TLS-only ALB with exact application and database security-group edges", () => {
    expect(template).toContain("Type: AWS::ECS::Service");
    expect(template).toContain("LaunchType: FARGATE");
    expect(template).toContain("AssignPublicIp: DISABLED");
    expect(template).toContain("Subnets: !Ref PrivateSubnetIds");
    expect(template).toContain("Type: AWS::ElasticLoadBalancingV2::Listener");
    expect(template).toContain("Protocol: HTTPS");
    expect(template).toContain("CertificateArn: !Ref AcmCertificateArn");
    expect(template).toContain("FromPort: 443");
    expect(template).toContain(
      "SourceSecurityGroupId: !Ref LoadBalancerSecurityGroup",
    );
    expect(template).toContain(
      "DestinationSecurityGroupId: !Ref DatabaseSecurityGroup",
    );
    expect(template).toContain("FromPort: 5432");
    expect(template).toContain("CidrIp: !Ref VpcDnsResolverCidr");
    expect(template).toContain("SecurityGroupEgress: []");
    expect(template).toContain("Type: AWS::Route53::RecordSet");
  });

  it("makes PostgreSQL private, encrypted, multi-AZ, backed up, deletion-protected in production, and Secrets Manager-managed", () => {
    expect(template).toContain("Type: AWS::RDS::DBSubnetGroup");
    expect(template).toContain("SubnetIds: !Ref PrivateSubnetIds");
    expect(template).toContain("Type: AWS::RDS::DBInstance");
    expect(template).toContain("Engine: postgres");
    expect(template).toContain("StorageEncrypted: true");
    expect(template).toContain("MultiAZ: true");
    expect(template).toContain("PubliclyAccessible: false");
    expect(template).toContain("ManageMasterUserPassword: true");
    expect(template).toContain(
      "BackupRetentionPeriod: !Ref DatabaseBackupRetentionDays",
    );
    expect(template).toContain(
      "DeletionProtection: !If [IsProduction, true, false]",
    );
    expect(template).toContain("MasterUserSecret.SecretArn");
    expect(template).toContain("DatabaseRuntimePasswordSecretArn");
    const executionRole = template.slice(
      template.indexOf("  ApiTaskExecutionRole:"),
      template.indexOf("  ApiTaskRole:"),
    );
    expect(executionRole).not.toContain(
      "PostgresDatabase.MasterUserSecret.SecretArn",
    );
  });

  it("uses encrypted queues with an explicit DLQ redrive allow-list and observable alarms", () => {
    expect(template).toContain("Type: AWS::SQS::Queue");
    expect(template).toContain("SqsManagedSseEnabled: true");
    expect(template).toContain("RedrivePolicy:");
    expect(template).toContain("RedriveAllowPolicy:");
    expect(template).toContain("redrivePermission: byQueue");
    expect(template).toContain("sourceQueueArns:");
    expect(template).toContain("Type: AWS::CloudWatch::Alarm");
    expect(template).toContain("JobDeadLetterQueueAlarm");
    expect(template).toContain("DatabaseCpuAlarm");
  });

  it("defines separate ECS execution and application roles, with Translate available only to the server task role", () => {
    expect(template).toContain("ApiTaskExecutionRole:");
    expect(template).toContain("ApiTaskRole:");
    expect(template).toContain(
      "ExecutionRoleArn: !GetAtt ApiTaskExecutionRole.Arn",
    );
    expect(template).toContain("TaskRoleArn: !GetAtt ApiTaskRole.Arn");
    expect(template).toContain("ReadInjectedSecrets");
    const taskRole = template.slice(
      template.indexOf("  ApiTaskRole:"),
      template.indexOf("  ApiTaskDefinition:"),
    );
    const executionRole = template.slice(
      template.indexOf("  ApiTaskExecutionRole:"),
      template.indexOf("  ApiTaskRole:"),
    );
    expect(taskRole).toContain("translate:TranslateText");
    expect(executionRole).not.toContain("translate:TranslateText");
    expect(taskRole).not.toContain("s3:DeleteObjectVersion");
    expect(template).toContain("HasDevelopmentCloudApiRole");
  });

  it("uses a Cognito public PKCE client with only the registered native callback and logout URL", () => {
    expect(template).toContain("Type: AWS::Cognito::UserPool");
    expect(template).toContain("Type: AWS::Cognito::UserPoolClient");
    expect(template).toContain("GenerateSecret: false");
    expect(template).toContain("AllowAdminCreateUserOnly: true");
    expect(template).toContain("AllowedOAuthFlows: [code]");
    expect(template).toContain(
      'CallbackURLs: ["research-video-clips://oauth/callback"]',
    );
    expect(template).toContain("LogoutURLs: [!Ref CognitoLogoutUrl]");
    expect(template).toContain("Type: AWS::Cognito::UserPoolDomain");
    expect(template).toContain("Name: CLOUD_DATABASE_MODE, Value: postgres");
    expect(template).toContain("Name: CLOUD_AUTH_MODE, Value: cognito");
    expect(template).toContain("Name: OBJECT_STORE_MODE, Value: s3");
    expect(template).toContain("Name: QUEUE_MODE, Value: sqs");
    expect(template).toContain(
      "Name: TRANSLATION_PROVIDER, Value: aws-translate",
    );
  });
});

describe("AWS parameter and change-set boundary", () => {
  it("keeps development and production values as explicit placeholders rather than embedded account-specific values", () => {
    expect(developmentParameters.EnvironmentName).toBe("development");
    expect(productionParameters.EnvironmentName).toBe("production");
    for (const parameters of [developmentParameters, productionParameters]) {
      expect(parameters).toHaveProperty("TranscriptBucketName");
      expect(parameters).toHaveProperty("VpcId");
      expect(parameters).toHaveProperty("PublicSubnetIds");
      expect(parameters).toHaveProperty("PrivateSubnetIds");
      expect(parameters).toHaveProperty("AcmCertificateArn");
      expect(parameters).toHaveProperty("ApiDomainName");
      expect(parameters).toHaveProperty("ApiContainerImage");
      expect(parameters).toHaveProperty("CognitoDomainPrefix");
      expect(parameters).toHaveProperty("DatabaseRuntimePasswordSecretArn");
      expect(parameters.CloudApiRoleArn).toBe("");
    }
    expect(productionParameters.ApiDomainName).toContain("replace-with-");
    expect(productionParameters.AlarmTopicArn).toContain("replace-with-");
  });

  it("validates then creates and describes a change set without a deploy or execute path", () => {
    expect(deployScript).toContain("cloudformation validate-template");
    expect(deployScript).toContain("cloudformation create-change-set");
    expect(deployScript).toContain("cloudformation describe-change-set");
    expect(deployScript).toContain("change-set-create-complete");
    expect(deployScript).toContain("CAPABILITY_NAMED_IAM");
    expect(deployScript).not.toContain("cloudformation deploy");
    expect(deployScript).not.toContain("execute-change-set");
    expect(deployScript).toContain(
      "at least two subnets in separate Availability Zones",
    );
    expect(deployScript).toContain("non-placeholder");
  });
});
