import { describe, expect, it } from "vitest";

import {
  desktopAuthenticationIssue,
  desktopAuthenticationSummary,
  desktopSignInUnavailable,
} from "./desktop-auth-status.ts";

describe("desktop authentication presentation", () => {
  it("explains why an unconfigured build cannot open managed login", () => {
    const status = {
      state: "unavailable" as const,
      issue: "configuration_required" as const,
    };
    expect(desktopAuthenticationIssue(status)).toContain("not configured");
    expect(desktopAuthenticationSummary(status)).toContain("Cognito");
    expect(desktopSignInUnavailable(status)).toBe(true);
  });

  it("shows browser completion while preventing duplicate sign-in attempts", () => {
    const status = { state: "signing_in" as const };
    expect(desktopAuthenticationSummary(status)).toContain("browser");
    expect(desktopSignInUnavailable(status)).toBe(true);
  });

  it("keeps a failed attempt retryable and gives visible remediation", () => {
    const status = {
      state: "signed_out" as const,
      issue: "authentication_failed" as const,
    };
    expect(desktopAuthenticationIssue(status)).toContain("try again");
    expect(desktopSignInUnavailable(status)).toBe(false);
  });
});
