import { describe, expect, it } from "vitest";

import { AuthorizationError, requirePermission } from "./index.ts";

describe("project authorization", () => {
  it("allows researchers to publish but not manage members", () => {
    expect(() => requirePermission("researcher", "write")).not.toThrow();
    expect(() => requirePermission("researcher", "manage_members")).toThrow(
      AuthorizationError,
    );
  });

  it("denies users without membership", () => {
    expect(() => requirePermission(undefined, "read")).toThrow(
      AuthorizationError,
    );
  });
});
