import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("unpacked extension permissions", () => {
  it("keeps default access narrow and receives no web-page content script", () => {
    const manifest = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "apps/chrome-extension/manifest.json"),
        "utf8",
      ),
    ) as {
      permissions: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
      content_scripts?: unknown[];
      externally_connectable?: unknown;
    };
    expect(manifest.permissions).toEqual([
      "activeTab",
      "contextMenus",
      "scripting",
      "storage",
    ]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual([
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ]);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.externally_connectable).toBeUndefined();
  });
});
