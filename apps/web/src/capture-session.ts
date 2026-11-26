import { z } from "zod";
import {
  browserMode,
  managedResearch,
  managedResearchSession,
} from "./browser-api.ts";

export async function captureSession() {
  if (managedResearch) {
    return {
      authorization: "managed-local",
      csrfToken: await managedResearchSession(),
      account: "Local Research",
    };
  }
  if (!browserMode)
    throw new Error("Open the signed-in or managed Research site to connect.");
  const response = await fetch("/cloud-api/api/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Research is unavailable.");
  const session = z
    .object({
      authenticated: z.literal(true),
      registered: z.literal(true),
      csrfToken: z.string().min(1),
      user: z.object({ id: z.uuid(), displayName: z.string() }),
    })
    .safeParse(await response.json());
  if (!session.success)
    throw new Error("Sign in to Research, then retry the connection.");
  return {
    authorization: session.data.user.id,
    csrfToken: session.data.csrfToken,
    account: session.data.user.displayName,
  };
}
