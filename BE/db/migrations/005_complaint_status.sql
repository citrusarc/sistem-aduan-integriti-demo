-- Stored complaint status — CLAUDE.md §8 decision 1.
--
-- Replaces read-time guessing with a column the API writes on each transition:
--   new complaint                        -> BARU
--   added to a meeting agenda            -> MENUNGGU_JMM
--   decision recorded, outcome <> NFA    -> DALAM_TINDAKAN
--   decision recorded, outcome = NFA     -> NFA
--   staff closes the case                -> SELESAI
--
-- Existing rows are backfilled with the same logic as
-- src/db/complaintStatus.ts#deriveComplaintStatus, plus agenda placement from
-- 004 (a pre-decision complaint on an open meeting is MENUNGGU_JMM).
--
-- ⚠️ The SELESAI backfill inherits that function's free-text match on
-- case_actions.feedback_status. Rows it marks SELESAI are a one-time guess;
-- staff should review them. Every row written after this migration comes from
-- an explicit API transition, not a match.

BEGIN;

CREATE TYPE complaint_status_enum AS ENUM (
    'BARU',
    'MENUNGGU_JMM',
    'DALAM_TINDAKAN',
    'SELESAI',
    'NFA'
);

ALTER TABLE complaints
    ADD COLUMN status complaint_status_enum NOT NULL DEFAULT 'BARU',
    ADD COLUMN status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

WITH latest_decision AS (
    SELECT DISTINCT ON (complaint_id) complaint_id, outcome
    FROM jmm_decisions
    ORDER BY complaint_id, decision_date DESC, id DESC
),
closed_by_text AS (
    SELECT DISTINCT complaint_id
    FROM case_actions
    WHERE lower(feedback_status) LIKE ANY (
        ARRAY['%selesai%', '%tamat%', '%ditutup%', '%closed%', '%complete%']
    )
),
on_open_agenda AS (
    SELECT DISTINCT i.complaint_id
    FROM jmm_meeting_items i
    JOIN jmm_meetings m ON m.id = i.meeting_id
    WHERE m.status = 'DIJADUALKAN'
)
UPDATE complaints c
SET status = CASE
        WHEN d.outcome IS NULL AND a.complaint_id IS NOT NULL THEN 'MENUNGGU_JMM'
        WHEN d.outcome IS NULL                                THEN 'BARU'
        WHEN d.outcome = 'NFA'                                THEN 'NFA'
        WHEN x.complaint_id IS NOT NULL                       THEN 'SELESAI'
        ELSE 'DALAM_TINDAKAN'
    END::complaint_status_enum
FROM complaints c2
LEFT JOIN latest_decision d ON d.complaint_id = c2.id
LEFT JOIN closed_by_text  x ON x.complaint_id = c2.id
LEFT JOIN on_open_agenda  a ON a.complaint_id = c2.id
WHERE c.id = c2.id;

CREATE INDEX idx_complaints_status ON complaints(status);

COMMIT;
