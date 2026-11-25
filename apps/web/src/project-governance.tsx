import { useEffect, useState } from "react";

import {
  OpenProjectDiscoverySchema,
  ProjectGovernanceEventSchema,
  ProjectInvitationSchema,
  ProjectMemberSummarySchema,
  ProjectSummarySchema,
  type OpenProjectDiscovery,
  type ProjectGovernanceEvent,
  type ProjectInvitation,
  type ProjectMemberSummary,
  type ProjectSummary,
} from "@research-video/contracts";

type CloudRequest = (path: string, init?: RequestInit) => Promise<unknown>;

export function CollaborationAccessPanel({
  request,
  onProjectsChanged,
}: {
  request: CloudRequest;
  onProjectsChanged(): Promise<void>;
}) {
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [openProjects, setOpenProjects] = useState<OpenProjectDiscovery[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const [nextInvitations, nextOpen] = await Promise.all([
      request("/api/project-invitations"),
      request("/api/projects/discover"),
    ]);
    setInvitations(ProjectInvitationSchema.array().parse(nextInvitations));
    setOpenProjects(OpenProjectDiscoverySchema.array().parse(nextOpen));
  }

  useEffect(() => {
    void load().catch(() => undefined);
  }, [request]);

  async function decide(
    invitation: ProjectInvitation,
    decision: "accept" | "reject",
  ) {
    await request(`/api/project-invitations/${invitation.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        idempotencyKey: `vera-invitation:${invitation.id}:${decision}`,
        expectedVersion: invitation.version,
        decision,
      }),
    });
    await onProjectsChanged();
    await load();
    setMessage(
      decision === "accept" ? "Invitation accepted." : "Invitation rejected.",
    );
  }

  async function join(project: OpenProjectDiscovery) {
    await request(`/api/projects/${project.id}/join`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: `vera-open-join:${project.id}` }),
    });
    await onProjectsChanged();
    await load();
    setMessage(`Joined ${project.name} as Researcher.`);
  }

  if (
    !invitations.some((invitation) => invitation.state === "pending") &&
    !openProjects.length
  )
    return null;
  return (
    <article className="queue-card" aria-label="Project access">
      <h3>Project access</h3>
      {message ? <p role="status">{message}</p> : null}
      {invitations
        .filter((invitation) => invitation.state === "pending")
        .map((invitation) => (
          <div key={invitation.id} className="action-row">
            <span>
              {invitation.projectName} · {invitation.role} · invited by @
              {invitation.inviter.handle}
            </span>
            <button
              type="button"
              onClick={() => void decide(invitation, "accept")}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => void decide(invitation, "reject")}
            >
              Reject
            </button>
          </div>
        ))}
      {openProjects.map((project) => (
        <div key={project.id} className="action-row">
          <span>
            {project.name} · {project.memberCount} members
          </span>
          <button type="button" onClick={() => void join(project)}>
            Join as Researcher
          </button>
        </div>
      ))}
    </article>
  );
}

export function ProjectGovernanceControls({
  project,
  request,
  onProjectUpdated,
}: {
  project: ProjectSummary | undefined;
  request: CloudRequest;
  onProjectUpdated(project: ProjectSummary): void;
}) {
  const [members, setMembers] = useState<ProjectMemberSummary[]>([]);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [events, setEvents] = useState<ProjectGovernanceEvent[]>([]);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"administrator" | "researcher">(
    "researcher",
  );
  const [message, setMessage] = useState("");

  async function load() {
    if (!project) return;
    const [memberPayload, invitationPayload, eventPayload] = await Promise.all([
      request(`/api/projects/${project.id}/members`),
      request(`/api/projects/${project.id}/invitations`),
      request(`/api/projects/${project.id}/governance-events`),
    ]);
    setMembers(ProjectMemberSummarySchema.array().parse(memberPayload));
    setInvitations(ProjectInvitationSchema.array().parse(invitationPayload));
    setEvents(ProjectGovernanceEventSchema.array().parse(eventPayload));
  }

  useEffect(() => {
    void load().catch((error) =>
      setMessage(
        error instanceof Error ? error.message : "Unable to load governance.",
      ),
    );
  }, [project?.id, request]);

  async function updateProject(action: unknown) {
    if (!project) return;
    const result = ProjectSummarySchema.parse(
      await request(`/api/projects/${project.id}/governance`, {
        method: "PATCH",
        body: JSON.stringify({
          idempotencyKey: `vera-governance:${project.id}:${crypto.randomUUID()}`,
          expectedVersion: project.version,
          action,
        }),
      }),
    );
    onProjectUpdated(result);
    await load();
  }

  async function revoke(invitation: ProjectInvitation) {
    if (!project) return;
    await request(`/api/projects/${project.id}/invitations/${invitation.id}`, {
      method: "DELETE",
      body: JSON.stringify({
        idempotencyKey: `vera-revoke:${invitation.id}:${crypto.randomUUID()}`,
        expectedVersion: invitation.version,
      }),
    });
    setMessage(`Invitation for @${invitation.invitee.handle} revoked.`);
    await load();
  }

  async function invite() {
    if (!project || !handle.trim()) return;
    await request(`/api/projects/${project.id}/invitations`, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `vera-invite:${project.id}:${crypto.randomUUID()}`,
        handle,
        role,
        expiresInDays: 7,
      }),
    });
    setHandle("");
    setMessage("Invitation created without granting access.");
    await load();
  }

  if (!project) return <p>Choose a project.</p>;
  const owner = project.currentUserRole === "owner";
  const administrator = project.currentUserRole === "administrator";
  return (
    <article className="queue-card" aria-label="Project governance">
      <h3>Members and access</h3>
      <p>
        {project.kind} · {project.visibility} · version {project.version}
      </p>
      {message ? <p role="status">{message}</p> : null}
      {owner && project.kind === "personal" ? (
        <button
          type="button"
          onClick={() =>
            void updateProject({
              type: "convert_to_shared",
              visibility: "invitation_only",
            })
          }
        >
          Convert once to shared
        </button>
      ) : null}
      {owner && project.kind === "shared" ? (
        <label>
          Visibility
          <select
            value={project.visibility}
            onChange={(event) =>
              void updateProject({
                type: "set_visibility",
                visibility: event.target.value,
              })
            }
          >
            <option value="invitation_only">Invitation only</option>
            <option value="open_to_join">Open to join</option>
          </select>
        </label>
      ) : null}
      {project.kind === "shared" && (owner || administrator) ? (
        <div className="clip-filter-grid">
          <label>
            Invite @handle
            <input
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
            />
          </label>
          <label>
            Proposed role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              {owner ? (
                <option value="administrator">Administrator</option>
              ) : null}
              <option value="researcher">Researcher</option>
            </select>
          </label>
          <button type="button" onClick={() => void invite()}>
            Create invitation
          </button>
        </div>
      ) : null}
      <ul>
        {members.map((member) => (
          <li key={member.userId}>
            @{member.user.handle} · {member.user.displayName} · {member.role}
            {owner && member.role !== "owner" ? (
              <select
                aria-label={`Role for @${member.user.handle}`}
                value={member.role}
                onChange={(event) =>
                  void updateProject({
                    type: "set_member_role",
                    userId: member.userId,
                    role: event.target.value,
                    expectedMemberVersion: member.version,
                  })
                }
              >
                <option value="administrator">Administrator</option>
                <option value="researcher">Researcher</option>
              </select>
            ) : null}
            {owner && member.role !== "owner" ? (
              <button
                type="button"
                onClick={() =>
                  void updateProject({
                    type: "transfer_ownership",
                    userId: member.userId,
                  })
                }
              >
                Transfer ownership
              </button>
            ) : null}
            {(owner || (administrator && member.role === "researcher")) &&
            member.role !== "owner" ? (
              <button
                type="button"
                onClick={() =>
                  void updateProject({
                    type: "remove_member",
                    userId: member.userId,
                    expectedMemberVersion: member.version,
                  })
                }
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {invitations
        .filter((invitation) => invitation.state === "pending")
        .map((invitation) => (
          <div key={invitation.id} className="action-row">
            <span>
              Pending @{invitation.invitee.handle} · {invitation.role}
            </span>
            <button type="button" onClick={() => void revoke(invitation)}>
              Revoke
            </button>
          </div>
        ))}
      <h4>Governance history</h4>
      <ul>
        {events.map((event) => (
          <li key={event.id}>
            {event.eventType.replaceAll("_", " ")} ·{" "}
            {new Date(event.createdAt).toLocaleString()}
          </li>
        ))}
      </ul>
    </article>
  );
}
