-- KJ / sub-unit assignment — CLAUDE.md §8 decision 5.
--
-- Gives the kj/inbox and subunit/tasks screens a data source. The column only
-- links an action to a person; what that person may see is enforced by the
-- API, which returns KJ/SUB_UNIT staff a narrow field allow-list:
--   actionTaken, actionDate, fileRefNo, responseReceivedDate, feedbackStatus,
--   and the complaint's reference number
-- and never internal notes, case description, accused party, JMM data, or any
-- action on an NFA complaint (rules 2 and 9).

BEGIN;

ALTER TABLE case_actions
    ADD COLUMN assigned_to_staff_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL;

CREATE INDEX idx_case_actions_assignee ON case_actions(assigned_to_staff_id);

COMMIT;
