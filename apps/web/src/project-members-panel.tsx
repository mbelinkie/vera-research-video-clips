import { useEffect, useRef, useState } from "react";

import {
  ApiErrorSchema,
  GrantProjectMemberByEmailSchema,
  ProjectMemberDetailsSchema,
  ProjectMemberSchema,
  type ProjectMember,
} from "@research-video/contracts";

import { cloudFetch } from "./browser-api.ts";

type ProjectMemberDetails = ReturnType<typeof ProjectMemberDetailsSchema.parse>;

type ProjectMembersPanelProps = {
  authorization: string;
  csrfToken?: string | undefined;
  onAuthUnavailable?: (() => void) | undefined;
  projectId: string;
  projectName: string;
};

class MembershipRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MembershipRequestError";
    this.status = status;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Membership request failed.";
}

function isEditorRole(role: ProjectMember["role"]) {
  return role === "editor" || role === "researcher";
}

function roleLabel(role: ProjectMember["role"]) {
  // The membership store keeps the hosted Editor write role as Researcher.
  if (role === "researcher") return "Editor";
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

export function ProjectMembersPanel({
  authorization,
  csrfToken,
  onAuthUnavailable,
  projectId,
  projectName,
}: ProjectMembersPanelProps) {
  const [membership, setMembership] = useState<ProjectMember>();
  const [members, setMembers] = useState<ProjectMemberDetails[]>([]);
  const [email, setEmail] = useState("");
  const [grantRole, setGrantRole] = useState<"editor" | "viewer">("editor");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(false);
  const requestController = useRef<AbortController | undefined>(undefined);

  async function request(path: string, init: RequestInit = {}) {
    const response = await cloudFetch(
      `/cloud-api${path}`,
      {
        ...init,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      {
        authorization,
        csrfToken,
        onUnavailable: onAuthUnavailable
          ? () => {
              if (mountedRef.current) onAuthUnavailable();
            }
          : undefined,
      },
    );
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(payload);
      throw new MembershipRequestError(
        parsed.success
          ? parsed.data.error.message
          : "Membership request failed.",
        response.status,
      );
    }
    return payload;
  }

  async function loadMembers() {
    if (!projectId || !authorization) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError("");
    try {
      const ownPayload = await request(
        `/api/projects/${projectId}/my-membership`,
        { signal: controller.signal },
      );
      const ownMembership = ProjectMemberSchema.parse(ownPayload.membership);
      setMembership(ownMembership);
      if (ownMembership.role === "owner") {
        const listed = await request(`/api/projects/${projectId}/members`, {
          signal: controller.signal,
        });
        setMembers(ProjectMemberDetailsSchema.array().parse(listed));
      } else {
        setMembers([]);
      }
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError")
        return;
      setMembership(undefined);
      setMembers([]);
      setError(errorMessage(requestError));
    } finally {
      if (requestController.current === controller) {
        requestController.current = undefined;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestController.current?.abort();
      requestController.current = undefined;
    };
  }, []);

  useEffect(() => {
    setMembership(undefined);
    setMembers([]);
    setMessage("");
    setError("");
    void loadMembers();
    // Keyed mounting plus aborts keep old project/session responses out of view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorization, projectId]);

  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
      await loadMembers();
      setMessage(success);
    } catch (requestError) {
      if (
        requestError instanceof MembershipRequestError &&
        requestError.status === 409
      ) {
        await loadMembers();
        setMessage(
          "This membership changed in another session. Review the refreshed member list and try again.",
        );
      } else {
        setError(errorMessage(requestError));
      }
    } finally {
      setBusy(false);
    }
  }

  function displayName(member: ProjectMemberDetails) {
    return member.displayName || "Registered member";
  }

  function memberContact(member: ProjectMemberDetails) {
    return member.verifiedEmail ?? "Verified email unavailable";
  }

  async function grantMember() {
    const parsed = GrantProjectMemberByEmailSchema.safeParse({
      email: email.trim(),
      role: grantRole,
    });
    if (!parsed.success) {
      setError("Enter a valid registered email address.");
      return;
    }
    await perform(async () => {
      await request(`/api/projects/${projectId}/members/by-email`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      setEmail("");
    }, `Granted ${grantRole} access to the existing account.`);
  }

  async function changeRole(
    member: ProjectMemberDetails,
    role: "editor" | "viewer",
  ) {
    if (member.role === role) return;
    await perform(
      async () => {
        await request(`/api/projects/${projectId}/members/${member.userId}`, {
          method: "PATCH",
          body: JSON.stringify({ role, expectedVersion: member.version }),
        });
      },
      `Changed ${displayName(member)} to ${role}.`,
    );
  }

  async function revoke(member: ProjectMemberDetails) {
    if (
      !window.confirm(
        `Remove ${displayName(member)} from “${projectName}”? They will lose access to this project.`,
      )
    )
      return;
    await perform(
      async () => {
        await request(`/api/projects/${projectId}/members/${member.userId}`, {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: member.version }),
        });
      },
      `Removed ${displayName(member)} from the project.`,
    );
  }

  async function transfer(member: ProjectMemberDetails) {
    if (
      !window.confirm(
        `Transfer ownership of “${projectName}” to ${displayName(member)}? You will become an Editor and lose member-management access.`,
      )
    )
      return;
    if (!membership) return;
    await perform(
      async () => {
        await request(`/api/projects/${projectId}/members/transfer`, {
          method: "POST",
          body: JSON.stringify({
            targetUserId: member.userId,
            expectedOwnerVersion: membership.version,
            expectedTargetVersion: member.version,
          }),
        });
      },
      `Ownership transferred to ${displayName(member)}.`,
    );
  }

  if (!projectId || !authorization) return null;

  return (
    <section
      className="queue-card members-panel"
      aria-labelledby="members-title"
    >
      <div className="members-heading">
        <div>
          <h3 id="members-title">Project members</h3>
          <p className="muted">Sharing “{projectName}”</p>
        </div>
        <button
          type="button"
          className="quiet-button"
          disabled={loading || busy}
          onClick={() => void loadMembers()}
        >
          Refresh
        </button>
      </div>

      <p className="form-message" role="status" aria-live="polite">
        {loading ? "Loading membership…" : message}
      </p>
      {error ? (
        <p className="form-message error" role="alert">
          {error}
        </p>
      ) : null}

      {membership && membership.role !== "owner" ? (
        <p className="members-own-role">
          Your access is <strong>{roleLabel(membership.role)}</strong>. Only the
          Project Owner can manage members.
        </p>
      ) : null}

      {membership?.role === "owner" ? (
        <>
          <form
            className="members-grant-form"
            onSubmit={(event) => {
              event.preventDefault();
              void grantMember();
            }}
          >
            <label htmlFor="member-email">Registered user email</label>
            <div className="members-grant-row">
              <input
                id="member-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="friend@example.com"
                maxLength={320}
                disabled={busy}
              />
              <select
                aria-label="New member role"
                value={grantRole}
                onChange={(event) =>
                  setGrantRole(event.target.value as "editor" | "viewer")
                }
                disabled={busy}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                className="primary-action"
                disabled={busy || !email.trim()}
              >
                Grant access
              </button>
            </div>
            <p className="members-help">
              This grants an existing registered account. It does not create an
              account or send an invitation.
            </p>
          </form>

          {members.length ? (
            <div className="members-list" aria-live="polite">
              {members.map((member) => {
                const isOwner = member.role === "owner";
                const isCurrent = member.userId === membership.userId;
                return (
                  <article className="member-row" key={member.userId}>
                    <div className="member-identity">
                      <strong>
                        {displayName(member)} {isCurrent ? "(you)" : ""}
                      </strong>
                      <span>{memberContact(member)}</span>
                    </div>
                    <div className="member-role">
                      <span className="member-role-label">
                        {roleLabel(member.role)}
                      </span>
                      {!isOwner ? (
                        <div className="member-actions">
                          {member.role !== "administrator" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void changeRole(
                                  member,
                                  isEditorRole(member.role)
                                    ? "viewer"
                                    : "editor",
                                )
                              }
                            >
                              Make{" "}
                              {isEditorRole(member.role) ? "Viewer" : "Editor"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void transfer(member)}
                          >
                            Transfer ownership
                          </button>
                          <button
                            type="button"
                            className="danger-action"
                            disabled={busy}
                            onClick={() => void revoke(member)}
                          >
                            Revoke
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="muted">No members are currently listed.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
