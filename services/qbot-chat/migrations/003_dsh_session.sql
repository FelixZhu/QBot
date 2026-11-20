-- qbot-migrate-role: runtime
-- Pointer to the DSH session file. The JSONL itself stays in the DSH home.
ALTER TABLE conversations ADD COLUMN dsh_session_id text;
