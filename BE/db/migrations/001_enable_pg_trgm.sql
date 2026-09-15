-- Layered on top of schema.sql, not folded into it: schema.sql is the direct
-- transcription of the Masterlist/BORANG JMM mapping and stays that way.
--
-- `pg_trgm` backs the similarity() call in the duplicate/repeat check
-- (business rule 5) in src/db/queries/complaints.ts. Without it, registering a
-- complaint fails with "function similarity(text, text) does not exist".

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Supports the ILIKE and similarity() predicates in findDuplicateCandidates().
CREATE INDEX IF NOT EXISTS idx_complaints_accused_trgm
    ON complaints USING gin (accused_particulars gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_complaints_description_trgm
    ON complaints USING gin (case_description gin_trgm_ops);
