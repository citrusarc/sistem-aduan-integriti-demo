-- CLAUDE.md §8 decision 16 — duplicate complaints, and not spamming email.
--
-- Every submission is still registered (rule 5 is about not registering a
-- repeat *silently*). What changes:
--
--   suspected_duplicate_of_complaint_id / duplicate_score / duplicate_reasons
--     written at registration by src/duplicates/assess.ts when a new complaint
--     scores as a likely repeat of an existing one. A hint for staff, nothing
--     more: it moves no status. Staff dismiss it, or confirm it below.
--
--   duplicate_of_complaint_id
--     set when staff confirm the repeat, just before status moves to PENDUA,
--     and cleared just after they undo it (both in one transaction). A PENDUA
--     row must name its original: chk_pendua_has_original. It is one-way
--     because a CHECK is evaluated per statement and status has exactly one
--     writer (applyStatusEvent), which sets nothing else.

BEGIN;

ALTER TABLE complaints
    ADD COLUMN suspected_duplicate_of_complaint_id BIGINT
        REFERENCES complaints(id) ON DELETE RESTRICT,
    ADD COLUMN duplicate_score NUMERIC(4,3)
        CHECK (duplicate_score BETWEEN 0 AND 1),
    ADD COLUMN duplicate_reasons TEXT[],
    ADD COLUMN duplicate_of_complaint_id BIGINT
        REFERENCES complaints(id) ON DELETE RESTRICT,
    ADD CONSTRAINT chk_not_own_duplicate CHECK (
        suspected_duplicate_of_complaint_id IS DISTINCT FROM id
        AND duplicate_of_complaint_id IS DISTINCT FROM id
    ),
    ADD CONSTRAINT chk_pendua_has_original CHECK (
        status <> 'PENDUA' OR duplicate_of_complaint_id IS NOT NULL
    ),
    ADD CONSTRAINT chk_duplicate_suspicion_complete CHECK (
        (suspected_duplicate_of_complaint_id IS NULL)
          = (duplicate_score IS NULL)
    );

CREATE INDEX idx_complaints_suspected_duplicate
    ON complaints(suspected_duplicate_of_complaint_id)
    WHERE suspected_duplicate_of_complaint_id IS NOT NULL;

COMMIT;
