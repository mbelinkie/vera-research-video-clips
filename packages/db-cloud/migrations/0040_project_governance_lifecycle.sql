CREATE TABLE project_invitations (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  invitee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inviter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('administrator', 'researcher')),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
  version integer NOT NULL CHECK (version > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX project_invitations_one_pending_target
  ON project_invitations(project_id, invitee_user_id)
  WHERE state = 'pending';
CREATE INDEX project_invitations_invitee_state
  ON project_invitations(invitee_user_id, state, created_at DESC, id);

CREATE TABLE project_governance_commands (
  idempotency_key text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  command_type text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (actor_user_id, idempotency_key)
);

CREATE TABLE project_governance_audit_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'project_converted', 'visibility_changed', 'invitation_created',
    'invitation_accepted', 'invitation_rejected', 'invitation_revoked',
    'open_joined', 'member_role_changed', 'member_removed',
    'ownership_transferred'
  )),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL
);

CREATE INDEX project_governance_audit_events_project
  ON project_governance_audit_events(project_id, created_at DESC, id DESC);
