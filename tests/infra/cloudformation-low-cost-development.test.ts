import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const template = readFileSync(
  new URL("infra/aws/low-cost-development.yaml", root),
  "utf8",
);
const deploymentScript = readFileSync(
  new URL("scripts/deploy-aws-low-cost-dev.sh", root),
  "utf8",
);

describe("AWS low-cost development boundary", () => {
  it("uses an admin-invite-only Cognito public PKCE client", () => {
    expect(template).toContain("Type: AWS::Cognito::UserPool");
    expect(template).toContain("AllowAdminCreateUserOnly: true");
    expect(template).toContain("Type: AWS::Cognito::UserPoolClient");
    expect(template).toContain('MfaConfiguration: "OFF"');
    expect(template).toContain("GenerateSecret: false");
    expect(template).toContain("AllowedOAuthFlows: [code]");
    expect(template).toContain(
      'CallbackURLs: ["research-video-clips://oauth/callback"]',
    );
    expect(template).toContain("EnableTokenRevocation: true");
  });

  it("runs one encrypted ARM development instance with IMDSv2 and no SSH ingress", () => {
    expect(template).toContain("Default: t4g.micro");
    expect(template).toContain("Type: AWS::EC2::Instance");
    expect(template).toContain("Encrypted: true");
    expect(template).toContain("HttpTokens: required");
    expect(template).toContain("dnf install -y git tar xz gzip");
    expect(template).not.toContain("dnf install -y git tar xz gzip curl");
    expect(template).toContain("FromPort: 80");
    expect(template).toContain("FromPort: 443");
    expect(template).not.toContain("FromPort: 22");
    expect(template).toContain("NoNewPrivileges=true");
  });

  it("keeps explicit development fallbacks and does not pretend to be the production topology", () => {
    expect(template).toContain("NODE_ENV=development");
    expect(template).toContain("CLOUD_DATABASE_MODE=pglite");
    expect(template).toContain("CLOUD_AUTH_MODE=cognito");
    expect(template).toContain("OBJECT_STORE_MODE=memory");
    expect(template).toContain("QUEUE_MODE=memory");
    expect(template).toContain("TRANSLATION_PROVIDER=disabled");
    for (const expensiveResource of [
      "AWS::RDS::DBInstance",
      "AWS::ECS::Service",
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      "AWS::EC2::NatGateway",
      "AWS::Route53::RecordSet",
      "AWS::CertificateManager::Certificate",
    ]) {
      expect(template).not.toContain(expensiveResource);
    }
  });

  it("makes bootstrap verify the real HTTPS health endpoint", () => {
    expect(template).toContain("/health >/tmp/health.json");
    expect(template).toContain("systemctl status research-video-api.service");
    expect(template).toContain("PersistenceNotice:");
  });

  it("injects YouTube search through one least-privilege SSM SecureString boundary", () => {
    expect(template).toContain("YouTubeApiKeyParameterName:");
    expect(template).toContain("Type: AWS::IAM::InstanceProfile");
    expect(template).toContain("AmazonSSMManagedInstanceCore");
    expect(template).toContain("Action: ssm:GetParameter");
    expect(template).toContain("parameter${YouTubeApiKeyParameterName}");
    expect(template).toContain("Type: AWS::SSM::Association");
    expect(template).toContain("--with-decryption");
    expect(template).toContain(
      "EnvironmentFile=-/etc/research-video/cloud-api-provider.env",
    );
    expect(template).toContain("YOUTUBE_API_KEY=%s");
    expect(template).not.toContain("YOUTUBE_API_KEY=${");
    expect(deploymentScript).toContain("--capabilities CAPABILITY_IAM");
  });
});
