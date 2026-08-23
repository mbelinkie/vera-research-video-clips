import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const forge = readFileSync(new URL("forge.config.cjs", root), "utf8");
const html = readFileSync(new URL("apps/web/index.html", root), "utf8");
const player = readFileSync(
  new URL("apps/web/src/youtube-player.tsx", root),
  "utf8",
);
const main = readFileSync(new URL("apps/desktop/src/main.ts", root), "utf8");

describe("local Intel desktop package boundary", () => {
  it("pins the approved Electron/Forge toolchain and x64 package path", () => {
    expect(packageJson.devDependencies).toMatchObject({
      electron: "43.4.1",
      "@electron-forge/cli": "7.11.2",
    });
    expect(packageJson.scripts["desktop:package:x64"]).toContain(
      "--platform=darwin --arch=x64",
    );
    expect(forge).toContain("asar: true");
    expect(forge).toContain("osxSign: false");
    expect(forge).toContain('schemes: ["research-video-clips"]');
    expect(forge).toContain("NSAllowsArbitraryLoads: false");
  });

  it("keeps remote code out of the preload-bearing renderer", () => {
    expect(html).toContain("script-src 'self';");
    expect(html).not.toMatch(/script-src[^;]*https:/u);
    expect(player).not.toContain("iframe_api");
    expect(player).not.toContain('createElement("script")');
    expect(player).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
    expect(player).toContain("event.origin !== playerOrigin");
    expect(main).toContain("script-src 'self';");
    expect(main).not.toMatch(/script-src[^;]*https:/u);
  });

  it("hardens BrowserWindow and obtains the child-owned port over private IPC", () => {
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain('environment.LOCAL_AGENT_PORT = "0"');
    expect(main).toContain('child.on("message", onMessage)');
    expect(main).not.toContain("reserveLoopbackPort");
  });
});
