-- Whistleblower protection requests — CLAUDE.md §8 decision 6.
--
-- Submitted by a signed-in complainant for one of their own complaints;
-- reviewed by KUI only (enforced by the API). review_notes is internal and
-- falls under rule 9: never returned by a public or complainant route.

BEGIN;

CREATE TYPE protection_request_status_enum AS ENUM (
    'DITERIMA',     -- received, awaiting review
    'DILULUSKAN',   -- approved
    'DITOLAK'       -- rejected
);

CREATE TABLE protection_requests (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    complaint_id      BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    -- The complainant session email that filed it (lower-cased), kept so the
    -- request can be traced to who asked even if contact details change.
    requested_by_email TEXT NOT NULL,
    reason            TEXT NOT NULL,
    status            protection_request_status_enum NOT NULL DEFAULT 'DITERIMA',
    reviewed_by       BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    reviewed_at       TIMESTAMPTZ,
    review_notes      TEXT,                     -- internal only
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_protection_reason CHECK (char_length(btrim(reason)) > 0),
    CONSTRAINT chk_protection_email_lower CHECK (requested_by_email = lower(requested_by_email)),
    -- A decided request has a review time; an undecided one has none.
    -- reviewed_by is not required here because ON DELETE SET NULL may clear it.
    CONSTRAINT chk_protection_review CHECK (
        (status = 'DITERIMA') = (reviewed_at IS NULL)
    )
);

CREATE INDEX idx_protection_requests_complaint ON protection_requests(complaint_id);
CREATE INDEX idx_protection_requests_status    ON protection_requests(status);

COMMIT;
