-- qbot-migrate-role: superuser
-- pgvector 0.8.7 is not a trusted extension, so this statement needs a superuser
-- connected to the app database. The runtime role must not gain that privilege.
-- The chat tables do not store embeddings. The extension is created so this
-- database, not only the maintenance database, actually has vector available.
CREATE EXTENSION IF NOT EXISTS vector;
