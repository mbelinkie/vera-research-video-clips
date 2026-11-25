import { spawn } from "node:child_process";

import type { LocalArtifactLauncher } from "./artifact-locators.ts";

export class PlatformArtifactLauncher implements LocalArtifactLauncher {
  async revealPackage(packagePath: string): Promise<void> {
    if (process.platform === "darwin") {
      return run("open", ["-R", packagePath]);
    }
    if (process.platform === "win32") {
      return run("explorer.exe", ["/select,", packagePath]);
    }
    return run("xdg-open", [packagePath]);
  }

  async openMedia(mediaPath: string): Promise<void> {
    if (process.platform === "darwin") return run("open", [mediaPath]);
    if (process.platform === "win32") return run("explorer.exe", [mediaPath]);
    return run("xdg-open", [mediaPath]);
  }
}

function run(command: string, arguments_: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reject(new Error("Artifact action failed.")));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Artifact action failed."));
    });
  });
}
