import type {
  AuthenticatedActor,
  ProjectRole,
} from "@research-video/contracts";

export type ProjectPermission = "read" | "write" | "manage_members";

export interface SessionProvider<Request = unknown> {
  authenticate(request: Request): Promise<AuthenticatedActor>;
}

export class AuthenticationError extends Error {
  readonly statusCode = 401;
  readonly code = "authentication_required";
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;
  readonly code = "project_access_denied";
}

const permissions: Record<ProjectRole, ReadonlySet<ProjectPermission>> = {
  owner: new Set(["read", "write", "manage_members"]),
  editor: new Set(["read", "write"]),
  researcher: new Set(["read", "write"]),
  viewer: new Set(["read"]),
};

export function requirePermission(
  role: ProjectRole | undefined,
  permission: ProjectPermission,
): asserts role is ProjectRole {
  if (!role || !permissions[role].has(permission)) {
    throw new AuthorizationError("You do not have access to this project.");
  }
}
