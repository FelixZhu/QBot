-- qbot-migrate-role: runtime
-- Allow dynamically published cards from manual, agent, or scheduled sources.

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_provenance;
ALTER TABLE cards ADD CONSTRAINT cards_provenance
  CHECK (provenance IN ('manual', 'agent', 'scheduled'));
