-- CLAUDE.md §8 decision 13.
--
-- 1. complaint_status_history: one row per status a complaint has entered,
--    written next to every write of complaints.status (applyStatusEvent, and
--    the BARU of a new registration). The complainant sees it as a timeline —
--    status and time only, nothing about who or why (rule 9). A complaint that
--    was ever NFA is never disclosed at all (rule 2), so no public timeline can
--    show NFA.
--
-- 2. complainant_accounts: real registration for the portal. Name + email,
--    confirmed by an email OTP (decision 4's codes and sessions are reused).
--    An address may sign in once verified, with or without complaints.

BEGIN;

CREATE TABLE complaint_status_history (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    complaint_id BIGINT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    from_status  complaint_status_enum,          -- NULL for the first entry
    to_status    complaint_status_enum NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaint_status_history_complaint
    ON complaint_status_history(complaint_id, changed_at, id);

-- Complaints that predate this table get what is actually known: registered
-- (BARU at created_at), and their current status since status_changed_at.
-- Intermediate steps before this migration were never recorded.
INSERT INTO complaint_status_history (complaint_id, from_status, to_status, changed_at)
SELECT id, NULL, 'BARU', created_at FROM complaints;

INSERT INTO complaint_status_history (complaint_id, from_status, to_status, changed_at)
SELECT id, NULL, status, status_changed_at
  FROM complaints
 WHERE status <> 'BARU';

CREATE TABLE complainant_accounts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    full_name   TEXT NOT NULL,
    -- NULL until the first OTP for this address is verified.
    verified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_complainant_account_email_lower CHECK (email = lower(email)),
    CONSTRAINT chk_complainant_account_email_shape CHECK (email ~ '^[^@\s]+@[^@\s]+$'),
    CONSTRAINT chk_complainant_account_name CHECK (length(btrim(full_name)) BETWEEN 2 AND 200)
);

COMMIT;
