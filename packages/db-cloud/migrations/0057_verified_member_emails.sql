CREATE TABLE verified_member_emails (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX verified_member_emails_exact_lookup
  ON verified_member_emails (email)
  WHERE email IS NOT NULL;
