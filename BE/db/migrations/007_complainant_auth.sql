-- Complainant login by EMAIL OTP — CLAUDE.md §8 decision 4.
--
-- Deliberately separate from staff auth (003): own tables, own cookie
-- (aduan_csid). A complainant session identifies an email address, not a
-- staff member, and grants only the public-safe view of complaints whose
-- complainant has that contact_email. Rules 2 and 9 still hold.
--
-- Codes are delivered only through notifyByEmail(). No SMS — business rule 10.

BEGIN;

CREATE TABLE complainant_otp_codes (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email          TEXT NOT NULL,              -- stored lower-cased
    -- Hash of the 6-digit code, never the code itself. A leaked copy of this
    -- table must not let anyone sign in.
    code_hash      TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,       -- issued + 10 minutes
    attempt_count  INTEGER NOT NULL DEFAULT 0, -- wrong guesses; dead at 5
    consumed_at    TIMESTAMPTZ,                -- set on successful verify; single use
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip             TEXT,

    CONSTRAINT chk_otp_email_lower CHECK (email = lower(email)),
    CONSTRAINT chk_otp_attempts    CHECK (attempt_count BETWEEN 0 AND 5),
    CONSTRAINT chk_otp_expiry      CHECK (expires_at > created_at)
);

CREATE INDEX idx_complainant_otp_email   ON complainant_otp_codes(email, created_at DESC);
CREATE INDEX idx_complainant_otp_expires ON complainant_otp_codes(expires_at);

CREATE TABLE complainant_sessions (
    -- SHA-256 of the session token, hex — same scheme as staff_sessions.
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL,               -- stored lower-cased
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    ip            TEXT,
    user_agent    TEXT,

    CONSTRAINT chk_csession_email_lower CHECK (email = lower(email))
);

CREATE INDEX idx_complainant_sessions_email   ON complainant_sessions(email);
CREATE INDEX idx_complainant_sessions_expires ON complainant_sessions(expires_at);

COMMIT;
