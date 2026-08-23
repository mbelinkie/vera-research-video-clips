import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

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
    publicApiOrigin: z.url().refine((value) => value.startsWith("https://")),
    cognitoAuthority: z.url().refine((value) => value.startsWith("https://")),
    cognitoClientId: z.string().trim().min(1).max(512),
    whisperModelPin: WhisperModelPinSchema.optional(),
  })
  .strict();

export type DesktopRuntimeConfiguration = z.infer<
  typeof DesktopRuntimeConfigurationSchema
>;

export async function loadDesktopRuntimeConfiguration(
  userDataDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DesktopRuntimeConfiguration | undefined> {
  const fromEnvironment = {
    publicApiOrigin: environment.PUBLIC_API_ORIGIN,
    cognitoAuthority: environment.COGNITO_DOMAIN,
    cognitoClientId: environment.COGNITO_CLIENT_ID,
  };
  if (Object.values(fromEnvironment).every(Boolean)) {
    return DesktopRuntimeConfigurationSchema.parse(fromEnvironment);
  }
  try {
    const value = JSON.parse(
      await readFile(join(userDataDirectory, "desktop-config.json"), "utf8"),
    );
    return DesktopRuntimeConfigurationSchema.parse(value);
  } catch {
    return undefined;
  }
}
