import type { DesktopAuthStatus } from "@research-video/contracts";

export function desktopAuthenticationIssue(
  status: DesktopAuthStatus | undefined,
): string | undefined {
  if (!status) return undefined;
  if (status.issue === "protected_storage_unavailable") {
    return "macOS protected credential storage is unavailable. Sign-in tokens cannot be retained safely on this workstation.";
  }
  if (status.issue === "configuration_required") {
    return "Cloud sign-in is not configured in this build. Add the approved API and Cognito settings, then restart the app.";
  }
  if (status.issue === "session_expired") {
    return "Your saved session expired. Sign in again to reconnect.";
  }
  if (status.issue === "authentication_failed") {
    return "Sign-in could not be completed. Check that the browser opened, then try again.";
  }
  return undefined;
}

export function desktopAuthenticationSummary(
  status: DesktopAuthStatus | undefined,
): string {
  const issue = desktopAuthenticationIssue(status);
  if (issue) return issue;
  switch (status?.state) {
    case "signed_in":
      return "Signed in to your account.";
    case "signing_in":
      return "Complete sign-in in the browser. This app will reconnect automatically.";
    case "refreshing":
      return "Refreshing your protected sign-in session…";
    default:
      return "Sign in through the browser to use project-authorized cloud data.";
  }
}

export function desktopSignInUnavailable(
  status: DesktopAuthStatus | undefined,
): boolean {
  return (
    status?.state === "unavailable" ||
    status?.state === "signing_in" ||
    status?.state === "refreshing"
  );
}
