-- qbot-migrate-role: runtime
-- One owner, one agent definition, many conversations and runs.
-- A run is a row in this process, not a process of its own.
-- kind `background` is reserved for a later scheduled or event artifact run.
-- This migration does not create embedding columns, tools, or a scheduler.

CREATE TABLE owners (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  slug text NOT NULL,
  persona text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_slug_len CHECK (char_length(slug) BETWEEN 1 AND 40),
  CONSTRAINT agents_persona_len CHECK (char_length(persona) BETWEEN 1 AND 4000),
  CONSTRAINT agents_model_len CHECK (char_length(model) BETWEEN 1 AND 128),
  UNIQUE (owner_id, slug)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_title_len CHECK (char_length(title) BETWEEN 1 AND 80)
);

CREATE INDEX conversations_owner_updated_idx
  ON conversations (owner_id, updated_at DESC);

CREATE TABLE runs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  agent_id uuid NOT NULL REFERENCES agents (id),
  conversation_id uuid REFERENCES conversations (id),
  kind text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT runs_kind CHECK (kind IN ('interactive', 'background')),
  CONSTRAINT runs_status CHECK (status IN ('running', 'complete', 'failed', 'cancelled')),
  CONSTRAINT runs_interactive_conversation CHECK (kind <> 'interactive' OR conversation_id IS NOT NULL)
);

CREATE INDEX runs_owner_status_idx ON runs (owner_id, status);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  owner_id uuid NOT NULL REFERENCES owners (id),
  run_id uuid NOT NULL REFERENCES runs (id),
  role text NOT NULL,
  content text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  CONSTRAINT messages_role CHECK (role IN ('user', 'assistant')),
  CONSTRAINT messages_status CHECK (status IN ('complete', 'pending', 'failed', 'cancelled')),
  CONSTRAINT messages_user_text CHECK (role <> 'user' OR char_length(content) > 0)
);

CREATE INDEX messages_conversation_seq_idx
  ON messages (conversation_id, seq);

CREATE INDEX messages_pending_idx
  ON messages (conversation_id)
  WHERE status = 'pending';
