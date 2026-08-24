ALTER TABLE project_keyword_suggestions
  ADD COLUMN withdrawn_by uuid REFERENCES users(id),
  ADD COLUMN withdrawn_at timestamptz,
  ADD COLUMN withdraw_reason text
    CHECK (withdraw_reason IS NULL OR length(withdraw_reason) BETWEEN 1 AND 1000);

ALTER TABLE project_keyword_suggestions
  DROP CONSTRAINT project_keyword_suggestions_state_check,
  DROP CONSTRAINT project_keyword_suggestions_check1,
  ADD CONSTRAINT project_keyword_suggestions_state_check
    CHECK (state IN ('pending', 'approved', 'rejected', 'withdrawn')),
  ADD CONSTRAINT project_keyword_suggestions_lifecycle_evidence_check CHECK (
    (
      state = 'pending'
      AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL
      AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdraw_reason IS NULL
    ) OR (
      state IN ('approved', 'rejected')
      AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdraw_reason IS NULL
    ) OR (
      state = 'withdrawn'
      AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL
      AND withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL
    )
  );

ALTER TABLE project_keyword_commands
  DROP CONSTRAINT project_keyword_commands_command_kind_check,
  ADD CONSTRAINT project_keyword_commands_command_kind_check
    CHECK (command_kind IN (
      'suggest', 'review', 'withdraw', 'keyword_update', 'alias_update'
    ));
