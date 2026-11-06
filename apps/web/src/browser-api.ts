/** Production browsers never receive or send bearer credentials. */
export const browserMode =
  import.meta.env.PROD || import.meta.env.VITE_BROWSER_AUTH === "true";
export type BrowserSession =
  | { authenticated: false; registered: false }
  | {
      authenticated: true;
      registered: boolean;
      csrfToken: string;
      user: { id: string; displayName: string } | null;
    };

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
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        ...(!browserMode && auth.authorization
          ? { authorization: auth.authorization }
          : {}),
        ...(browserMode &&
        init.method &&
        !["GET", "HEAD"].includes(init.method.toUpperCase())
          ? { "x-vera-csrf": auth.csrfToken ?? "" }
          : {}),
        ...init.headers,
      },
    });
    if (browserMode && response.status === 401) auth.onUnavailable?.();
    return response;
  } catch (error) {
    if (browserMode) auth.onUnavailable?.();
    throw error;
  }
}
