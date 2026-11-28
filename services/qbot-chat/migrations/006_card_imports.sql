-- qbot-migrate-role: runtime
-- Async card-package import queue, versioned card pointers, and rollback metadata.
-- Additive only: preserves existing owners, agents, conversations, runs, messages, and seeded cards.

ALTER TABLE artifact_files DROP CONSTRAINT IF EXISTS artifact_files_len;
ALTER TABLE artifact_files ADD CONSTRAINT artifact_files_len
  CHECK (byte_length > 0 AND byte_length <= 8388608);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS card_key text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS current_version integer;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS current_content_digest text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS current_import_id uuid;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS visible_from timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS visible_until timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_artifact_id uuid;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_version integer;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_title text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_authored_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_published_at timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_content_digest text;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_visible_from timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_visible_until timestamptz;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS previous_import_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_card_key_format') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_card_key_format
      CHECK (card_key IS NULL OR card_key ~ '^[a-z0-9][a-z0-9-]{0,63}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_current_version_pos') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_current_version_pos
      CHECK (current_version IS NULL OR current_version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_previous_version_pos') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_previous_version_pos
      CHECK (previous_version IS NULL OR previous_version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_current_content_digest_sha') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_current_content_digest_sha
      CHECK (current_content_digest IS NULL OR current_content_digest ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_previous_content_digest_sha') THEN
    ALTER TABLE cards ADD CONSTRAINT cards_previous_content_digest_sha
      CHECK (previous_content_digest IS NULL OR previous_content_digest ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cards_agent_card_key_idx
  ON cards (agent_id, card_key)
  WHERE card_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS card_imports (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  idempotency_key text NOT NULL,
  zip_sha256 text NOT NULL,
  zip_bytes integer NOT NULL,
  state text NOT NULL,
  agent_id uuid REFERENCES agents (id),
  bot_slug text,
  card_key text,
  content_version integer,
  expected_previous_version integer,
  manifest_digest text,
  content_digest text,
  sample boolean,
  authoring_claim text,
  card_title text,
  card_authored_at timestamptz,
  visibility_mode text,
  visible_from timestamptz,
  visible_until timestamptz,
  card_id uuid REFERENCES cards (id) ON DELETE SET NULL,
  artifact_id uuid,
  failure_reason text,
  failure_errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  rolled_back_at timestamptz,
  CONSTRAINT card_imports_state CHECK (
    state IN ('queued', 'validating', 'staged', 'ready', 'rejected', 'published', 'rolled-back')
  ),
  CONSTRAINT card_imports_zip_sha CHECK (zip_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT card_imports_zip_bytes CHECK (zip_bytes > 0 AND zip_bytes <= 8388608),
  CONSTRAINT card_imports_idempotency_len CHECK (char_length(idempotency_key) BETWEEN 8 AND 200),
  CONSTRAINT card_imports_version_pos CHECK (content_version IS NULL OR content_version >= 1),
  CONSTRAINT card_imports_prev_version_pos CHECK (expected_previous_version IS NULL OR expected_previous_version >= 1),
  CONSTRAINT card_imports_manifest_digest CHECK (manifest_digest IS NULL OR manifest_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT card_imports_content_digest CHECK (content_digest IS NULL OR content_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT card_imports_authoring_claim CHECK (authoring_claim IS NULL OR authoring_claim IN ('human', 'bot')),
  CONSTRAINT card_imports_visibility_mode CHECK (visibility_mode IS NULL OR visibility_mode IN ('manual', 'schedule'))
);

CREATE UNIQUE INDEX IF NOT EXISTS card_imports_active_idempotency_idx
  ON card_imports (owner_id, idempotency_key)
  WHERE state <> 'rejected';

CREATE UNIQUE INDEX IF NOT EXISTS card_imports_four_tuple_idx
  ON card_imports (owner_id, agent_id, card_key, content_version)
  WHERE state <> 'rejected'
    AND COALESCE(sample, false) = false
    AND agent_id IS NOT NULL
    AND card_key IS NOT NULL
    AND content_version IS NOT NULL;

CREATE INDEX IF NOT EXISTS card_imports_queue_idx
  ON card_imports (created_at ASC, id ASC)
  WHERE state IN ('queued', 'validating');
