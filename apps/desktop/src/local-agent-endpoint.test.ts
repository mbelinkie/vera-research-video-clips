import { describe, expect, it } from "vitest";

import { LocalAgentEndpointRegistry } from "./local-agent-endpoint.ts";

describe("local-agent endpoint lifecycle", () => {
  it("makes a crashed child's stale port unavailable immediately", () => {
    const endpoints = new LocalAgentEndpointRegistry();
    endpoints.activate(43_210);

    endpoints.clear(43_210);

    expect(endpoints.currentPort()).toBeUndefined();
  });

  it("does not let a late old-child exit clear a ready replacement", () => {
    const endpoints = new LocalAgentEndpointRegistry();
    endpoints.activate(43_210);
    endpoints.activate(43_211);

    endpoints.clear(43_210);

    expect(endpoints.currentPort()).toBe(43_211);
  });
});
