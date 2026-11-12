import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapManagedResearch,
  managedResearchActor,
} from "./managed-bootstrap.ts";

const userId = randomUUID();
const externalSubject = `managed:${randomUUID()}`;
const authorization = `Bearer ${userId}|${externalSubject}`;
const projectId = randomUUID();

function fakeCatalog(existing = false) {
  const registerUser = vi.fn(
    async (actor: { userId: string; externalSubject: string }) => ({
      id: actor.userId,
      externalSubject: actor.externalSubject,
    }),
  );
  const listProjects = vi.fn(async () => (existing ? [{ id: projectId }] : []));
  const createProject = vi.fn(async () => ({ id: projectId }));
  return { registerUser, listProjects, createProject };
}

describe("private managed startup project", () => {
  it("registers the stable identity and creates a visible personal project once", async () => {
    const catalog = fakeCatalog();
    expect(
      await bootstrapManagedResearch(catalog as never, authorization),
    ).toBe(projectId);
    expect(catalog.registerUser).toHaveBeenCalledWith(
      { userId, externalSubject },
      "Local researcher",
    );
    expect(catalog.createProject).toHaveBeenCalledWith(
      { userId, externalSubject },
      { name: "Personal research" },
    );
  });
  it("reuses an existing project after restart", async () => {
    const catalog = fakeCatalog(true);
    expect(
      await bootstrapManagedResearch(catalog as never, authorization),
    ).toBe(projectId);
    expect(catalog.createProject).not.toHaveBeenCalled();
  });
  it("refuses forged, malformed or unregistered bootstrap owners", async () => {
    for (const value of [
      "",
      `Bearer ${userId}|evil:remote`,
      `Bearer ${userId}|managed:wrong`,
      `Bearer ${userId}|${externalSubject} extra`,
    ])
      expect(() => managedResearchActor(value)).toThrow();
    const catalog = fakeCatalog();
    catalog.registerUser.mockResolvedValueOnce({
      id: randomUUID(),
      externalSubject,
    });
    await expect(
      bootstrapManagedResearch(catalog as never, authorization),
    ).rejects.toThrow("identity did not match");
    expect(catalog.createProject).not.toHaveBeenCalled();
  });
});
