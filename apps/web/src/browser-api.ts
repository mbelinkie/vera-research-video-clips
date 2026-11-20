/** Production browsers never receive or send bearer credentials. */
export const browserMode =
  import.meta.env.PROD || import.meta.env.VITE_BROWSER_AUTH === "true";
/** Private credentials stay inside Vite's managed loopback proxy. */
export const managedResearch =
  !browserMode && import.meta.env.VITE_MANAGED_RESEARCH === "true";

export async function managedResearchSession(): Promise<string> {
  const response = await fetch("/__research/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Managed Research is unavailable.");
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("mode" in payload) ||
    payload.mode !== "managed-local" ||
    !("csrfToken" in payload) ||
    typeof payload.csrfToken !== "string" ||
    !/^[0-9a-f]{64}$/iu.test(payload.csrfToken)
  )
    throw new Error("Managed Research session is invalid.");
  return payload.csrfToken;
}
export type BrowserSession =
  | { authenticated: false; registered: false }
  | {
      authenticated: true;
      registered: boolean;
      csrfToken: string;
      user: { id: string; displayName: string } | null;
    };

/**
 * The pilot runs on the host's laptop behind Cloudflare. While it sleeps or is
 * offline, Cloudflare itself answers with a gateway error page (502/504 or a
 * 52x/530 status) instead of our JSON. Treat that as "host unavailable", not
 * as an application error. Our own JSON errors (for example a 503 while a
 * backup briefly pauses saving) are left to the caller.
 */
export function hostUnreachable(response: Response): boolean {
  const gateway =
    response.status === 502 ||
    response.status === 504 ||
    (response.status >= 520 && response.status <= 530);
  return (
    gateway &&
    !(response.headers.get("content-type") ?? "").includes("application/json")
  );
}

export async function cloudFetch(
  path: string,
  init: RequestInit,
  auth: {
    authorization: string;
    csrfToken?: string | undefined;
    onUnavailable?: (() => void) | undefined;
  },
): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    // Managed requests may never override the proxy's private bearer.
    if (managedResearch || browserMode) headers.delete("authorization");
    else if (!browserMode && auth.authorization)
      headers.set("authorization", auth.authorization);
    if (
      (browserMode || managedResearch) &&
      init.method &&
      !["GET", "HEAD"].includes(init.method.toUpperCase())
    )
      headers.set("x-vera-csrf", auth.csrfToken ?? "");
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
    if (
      (browserMode || managedResearch) &&
      (response.status === 401 || hostUnreachable(response))
    )
      auth.onUnavailable?.();
    return response;
  } catch (error) {
    // An intentional project/video switch aborts the old request, not the session.
    if (
      (browserMode || managedResearch) &&
      !(error instanceof Error && error.name === "AbortError")
    )
      auth.onUnavailable?.();
    throw error;
  }
}
