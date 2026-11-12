import { z } from "zod";

import type { SharedProjectCatalog } from "@research-video/catalog";
import type { AuthenticatedActor } from "@research-video/contracts";

type ProjectCatalog = Pick<
  SharedProjectCatalog,
  "registerUser" | "listProjects" | "createProject"
>;

/** Identity is persisted by the local launcher, never supplied by the browser. */
export function managedResearchActor(
  authorization: string,
): AuthenticatedActor {
  const match = /^Bearer ([0-9a-f-]{36})\|(managed:[0-9a-f-]{36})$/iu.exec(
    authorization,
  );
  if (
    !match ||
    !z.uuid().safeParse(match[1]).success ||
    !z.uuid().safeParse(match[2]?.slice("managed:".length)).success
  )
    throw new Error(
      "Managed Research bootstrap requires a private launcher identity.",
    );
  return { userId: match[1]!, externalSubject: match[2]! };
}

/** Idempotent across restarts; never creates a second hidden default project. */
export async function bootstrapManagedResearch(
  catalog: ProjectCatalog,
  authorization: string,
): Promise<string> {
  const actor = managedResearchActor(authorization);
  const registered = await catalog.registerUser(actor, "Local researcher");
  if (
    registered.id !== actor.userId ||
    registered.externalSubject !== actor.externalSubject
  )
    throw new Error(
      "Managed Research identity did not match its registered owner.",
    );
  const projects = await catalog.listProjects(actor);
  if (projects.length > 0) return projects[0]!.id;
  const created = await catalog.createProject(actor, {
    name: "Personal research",
  });
  return created.id;
}
