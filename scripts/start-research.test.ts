import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { managedResearchEnvironment } from "./start-research.ts";

const roots: string[] = [];
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "vera-research-19-managed-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("single-command private Research environment", () => {
  it("retains identity and signing across restarts but rotates in-browser CSRF", async () => {
    const root = await tempRoot();
    const first = await managedResearchEnvironment({}, root);
    const second = await managedResearchEnvironment({}, root);
    expect(first.WORKER_AUTHORIZATION).toBe(second.WORKER_AUTHORIZATION);
    expect(first.MANAGED_RESEARCH_AUTHORIZATION).toBe(
      first.WORKER_AUTHORIZATION,
    );
    expect(first.LOCAL_UPLOAD_SIGNING_SECRET).toBe(
      second.LOCAL_UPLOAD_SIGNING_SECRET,
    );
    expect(first.MANAGED_RESEARCH_CSRF).not.toBe(second.MANAGED_RESEARCH_CSRF);
    expect(first.OBJECT_STORE_MODE).toBe("local");
    expect(first.DATABASE_MODE).toBe("pglite");
    expect(first.WORKER_MODE).toBe("continuous");
    expect(first.NODE_ENV).toBe("development");
    expect(first.PILOT_OBJECT_ROOT).toBe(join(root, "transcript-objects"));
    expect(first.VITE_MANAGED_RESEARCH).toBe("true");
    expect((await lstat(join(root, "identity.json"))).mode & 0o077).toBe(0);
    expect((await lstat(first.PILOT_OBJECT_ROOT!)).mode & 0o077).toBe(0);
    const file = await readFile(join(root, "identity.json"), "utf8");
    expect(file).not.toContain("Bearer");
  });

  it("does not silently switch to production, hosted storage or an arbitrary bearer", async () => {
    const root = await tempRoot();
    for (const unsafe of [
      { NODE_ENV: "production" },
      { VERA_RUNTIME_MODE: "mac-pilot" },
      { CLOUD_API_HOST: "0.0.0.0" },
      { LOCAL_AGENT_HOST: "0.0.0.0" },
      { CLOUD_AUTH_MODE: "browser" },
      { DATABASE_MODE: "postgres" },
      { OBJECT_STORE_MODE: "memory" },
      { QUEUE_MODE: "sqs" },
      { WORKER_MODE: "once" },
      { WORKER_EXECUTION_LOCATION: "hosted" },
      {
        WORKER_AUTHORIZATION: `Bearer ${randomUUID()}|managed:${randomUUID()}`,
      },
      { PILOT_OBJECT_ROOT: "/tmp/unrelated-objects" },
      { LOCAL_UPLOAD_SIGNING_SECRET: "malicious-secret" },
      { VITE_PUBLIC_TOKEN: "not-allowed" },
    ])
      await expect(managedResearchEnvironment(unsafe, root)).rejects.toThrow();
  });

  it("refuses symlinked identity, public identity permissions and public/symlink root", async () => {
    const root = await tempRoot();
    await symlink(join(root, "elsewhere"), join(root, "identity.json"));
    await expect(managedResearchEnvironment({}, root)).rejects.toThrow();
    await rm(join(root, "identity.json"));
    await managedResearchEnvironment({}, root);
    await chmod(join(root, "identity.json"), 0o644);
    await expect(managedResearchEnvironment({}, root)).rejects.toThrow(
      "private regular file",
    );
    await chmod(join(root, "identity.json"), 0o600);
    await chmod(root, 0o755);
    await expect(managedResearchEnvironment({}, root)).rejects.toThrow(
      "private, non-symlink",
    );
  });

  it("refuses a symlinked identity even when the target is a valid private file", async () => {
    const root = await tempRoot();
    await managedResearchEnvironment({}, root);
    const identity = join(root, "identity.json");
    const privateBackup = join(root, "previous-identity.json");
    await rename(identity, privateBackup);
    await symlink(privateBackup, identity);
    await expect(managedResearchEnvironment({}, root)).rejects.toThrow();
  });

  it("rejects invalid private state rather than substituting a new credential", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "identity.json"), "{}", { mode: 0o600 });
    await expect(managedResearchEnvironment({}, root)).rejects.toThrow(
      "Invalid private",
    );
  });
});
