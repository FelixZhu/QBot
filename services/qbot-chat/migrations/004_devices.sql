-- qbot-migrate-role: runtime
-- One-time enrollment codes and per-device credentials.
-- The raw code and the raw device token are never stored.

CREATE TABLE enrollment_codes (
  id uuid PRIMARY KEY,
  code_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT enrollment_codes_hash_len CHECK (octet_length(code_hash) = 32)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT devices_hash_len CHECK (octet_length(token_hash) = 32)
);
