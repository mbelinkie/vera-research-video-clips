import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { approvedWhisperModelPin } from "./release-config.ts";

export const WhisperModelPinSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    url: z.url().refine((value) => value.startsWith("https://")),
    byteSize: z
      .number()
      .int()
      .min(1)
      .max(100 * 1024 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const DesktopRuntimeConfigurationSchema = z
  .object({
    publicApiOrigin: z
      .url()
      .refine((value) => value.startsWith("https://"))
      .optional(),
    cognitoAuthority: z
      .url()
      .refine((value) => value.startsWith("https://"))
      .optional(),
    cognitoClientId: z.string().trim().min(1).max(512).optional(),
    whisperModelPin: WhisperModelPinSchema.refine(
      (pin) =>
        pin.name === approvedWhisperModelPin.name &&
        pin.url === approvedWhisperModelPin.url &&
        pin.byteSize === approvedWhisperModelPin.byteSize &&
        pin.sha256 === approvedWhisperModelPin.sha256,
      "The desktop model pin must match the approved release artifact.",
    ),
    localModelCatalogTrustRoots: z
      .record(
        z.string().trim().min(1).max(160),
        z.string().trim().min(1).max(32_768),
      )
      .default({}),
    argosSidecarPath: z.string().trim().min(1).optional(),
    argosRuntimeVersions: z
      .array(z.string().trim().min(1).max(160))
      .max(32)
      .default(["1.9"]),
  })
  .strict()
  .superRefine((configuration, context) => {
    const cloudValueCount = [
      configuration.publicApiOrigin,
      configuration.cognitoAuthority,
      configuration.cognitoClientId,
    ].filter(Boolean).length;
    if (cloudValueCount !== 0 && cloudValueCount !== 3) {
      context.addIssue({
        code: "custom",
        message: "Desktop cloud configuration must be absent or complete.",
      });
    }
  });

export type DesktopRuntimeConfiguration = z.infer<
  typeof DesktopRuntimeConfigurationSchema
>;

export type CloudDesktopRuntimeConfiguration = DesktopRuntimeConfiguration & {
  publicApiOrigin: string;
  cognitoAuthority: string;
  cognitoClientId: string;
};

export function hasCloudDesktopRuntimeConfiguration(
  configuration: DesktopRuntimeConfiguration,
): configuration is CloudDesktopRuntimeConfiguration {
  return Boolean(
    configuration.publicApiOrigin &&
    configuration.cognitoAuthority &&
    configuration.cognitoClientId,
  );
}

export async function loadDesktopRuntimeConfiguration(
  userDataDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
  bundledConfigurationPath?: string,
): Promise<DesktopRuntimeConfiguration | undefined> {
  const fromEnvironment = {
    publicApiOrigin: environment.PUBLIC_API_ORIGIN,
    cognitoAuthority: environment.COGNITO_DOMAIN,
    cognitoClientId: environment.COGNITO_CLIENT_ID,
    whisperModelPin: approvedWhisperModelPin,
    localModelCatalogTrustRoots: readTrustRoots(
      environment.LOCAL_MODEL_CATALOG_TRUST_ROOTS_JSON,
    ),
    argosSidecarPath: environment.ARGOS_SIDECAR_PATH,
    argosRuntimeVersions: (environment.ARGOS_RUNTIME_VERSIONS ?? "1.9")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  if (
    fromEnvironment.publicApiOrigin &&
    fromEnvironment.cognitoAuthority &&
    fromEnvironment.cognitoClientId
  ) {
    return DesktopRuntimeConfigurationSchema.parse(fromEnvironment);
  }
  for (const path of [
    bundledConfigurationPath,
    join(userDataDirectory, "desktop-config.json"),
  ]) {
    if (!path) continue;
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      return DesktopRuntimeConfigurationSchema.parse(value);
    } catch {
      // Try the next approved source. Invalid or partial configuration fails closed.
    }
  }
  return DesktopRuntimeConfigurationSchema.parse({
    whisperModelPin: approvedWhisperModelPin,
  });
}

function readTrustRoots(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
