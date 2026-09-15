-- Staff authentication: email + password, server-side sessions.
--
-- Sessions are rows, not signed tokens, so access can be revoked immediately:
-- deactivating a staff member or changing their password deletes their
-- sessions, and every authenticated request re-checks staff_users.is_active.

BEGIN;

ALTER TABLE staff_users
    ADD COLUMN password_hash       TEXT,          -- scrypt, self-describing format; NULL = cannot log in
    ADD COLUMN password_changed_at TIMESTAMPTZ,
    ADD COLUMN failed_login_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN locked_until        TIMESTAMPTZ,   -- brute-force lockout
    ADD COLUMN last_login_at       TIMESTAMPTZ;

-- Login looks staff up by email; make that case-insensitive and unambiguous.
-- The existing UNIQUE(email) is case-sensitive, so two rows differing only in
-- case would otherwise both be able to exist.
CREATE UNIQUE INDEX idx_staff_users_email_lower ON staff_users (lower(email));

CREATE TABLE staff_sessions (
    -- SHA-256 of the session token, hex. The raw token lives only in the
    -- client's cookie; a leaked copy of this table cannot be replayed.
    id            TEXT PRIMARY KEY,
    staff_id      BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,           -- absolute cap
    ip            TEXT,
    user_agent    TEXT
);

CREATE INDEX idx_staff_sessions_staff   ON staff_sessions(staff_id);
CREATE INDEX idx_staff_sessions_expires ON staff_sessions(expires_at);

COMMIT;
