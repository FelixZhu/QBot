-- qbot-migrate-role: runtime
-- Bots stay in agents. This file only adds columns and tables.
-- It does not update, delete, or truncate owners, conversations, runs, or messages.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS visibility text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bio text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_visibility_check') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_visibility_check
      CHECK (visibility IS NULL OR visibility IN ('private', 'public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_display_name_len') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_display_name_len
      CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_bio_len') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_bio_len
      CHECK (bio IS NULL OR char_length(bio) BETWEEN 1 AND 280);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS owner_bootstrap (
  owner_id uuid PRIMARY KEY REFERENCES owners (id),
  qbot_follow_seeded boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS follows (
  owner_id uuid NOT NULL REFERENCES owners (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, agent_id)
);

CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY,
  agent_id uuid NOT NULL REFERENCES agents (id),
  visibility text NOT NULL,
  title text NOT NULL,
  published_at timestamptz NOT NULL,
  authored_at timestamptz NOT NULL,
  provenance text NOT NULL,
  artifact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cards_visibility CHECK (visibility IN ('public', 'followers')),
  CONSTRAINT cards_provenance CHECK (provenance = 'manual'),
  CONSTRAINT cards_title_len CHECK (char_length(title) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  card_id uuid NOT NULL REFERENCES cards (id),
  version integer NOT NULL,
  manifest_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_version_pos CHECK (version >= 1),
  CONSTRAINT artifacts_sha CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (card_id, version)
);

CREATE TABLE IF NOT EXISTS artifact_files (
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  rel_path text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  content_type text NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (artifact_id, rel_path),
  CONSTRAINT artifact_files_role CHECK (role IN ('cover', 'page', 'asset')),
  CONSTRAINT artifact_files_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifact_files_len CHECK (byte_length > 0 AND byte_length <= 1500000),
  CONSTRAINT artifact_files_path CHECK (
    rel_path ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
    AND rel_path !~ '(^|/)\.\.(/|$)'
  )
);

CREATE TABLE IF NOT EXISTS artifact_capabilities (
  token_hash bytea PRIMARY KEY,
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  owner_id uuid NOT NULL REFERENCES owners (id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cards_published_idx ON cards (published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS cards_agent_idx ON cards (agent_id);
CREATE INDEX IF NOT EXISTS artifact_capabilities_expires_idx ON artifact_capabilities (expires_at);
