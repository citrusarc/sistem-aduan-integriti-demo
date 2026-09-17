-- CLAUDE.md §8 decision 14 — staff password and sign-in security.
--
--   (a) 12+ characters, and MFA: every staff login is confirmed by a code sent
--       to the staff member's email (printed to the BE terminal locally)
--   (b) upper case, lower case, digit and special character — checked in
--       code (auth/password.ts); a hash can't be checked here
--   (c) passwords expire after security_settings.password_max_age_days
--       (default 180, set by ADMIN); an expired or ADMIN-set password must be
--       changed before a session is issued
--   (d) 5 failed passwords block the account until ADMIN unlocks it or the
--       owner resets it through "Lupa kata laluan" (locked_until = infinity)
--   (g) a slider image captcha is solved before the password is checked

BEGIN;

ALTER TABLE staff_users
    -- Set when ADMIN creates the account or resets its password: the first
    -- login must replace that password with one only the owner knows.
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Single-row table: the one place the expiry period is configured.
CREATE TABLE security_settings (
    id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    password_max_age_days  INTEGER NOT NULL DEFAULT 180
        CHECK (password_max_age_days BETWEEN 1 AND 3650),
    updated_by             BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO security_settings DEFAULT VALUES;

-- Slider captcha. Only the SHA-256 of each token is stored.
CREATE TABLE staff_captcha_challenges (
    id              TEXT PRIMARY KEY,               -- sha256(challenge token)
    target_x        INTEGER NOT NULL,
    attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
    expires_at      TIMESTAMPTZ NOT NULL,
    pass_token_hash TEXT UNIQUE,                    -- sha256(pass token), once solved
    pass_expires_at TIMESTAMPTZ,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time codes and tokens for the staff sign-in steps after the password:
--   LOGIN_MFA        code emailed after a correct password
--   PASSWORD_CHANGE  no code; lets an expired/ADMIN-set password be replaced
--   PASSWORD_RESET   code emailed by "Lupa kata laluan"
CREATE TABLE staff_auth_challenges (
    id            TEXT PRIMARY KEY,                 -- sha256(token)
    staff_id      BIGINT REFERENCES staff_users(id) ON DELETE CASCADE,
    purpose       TEXT NOT NULL CHECK (purpose IN ('LOGIN_MFA', 'PASSWORD_CHANGE', 'PASSWORD_RESET')),
    code_hash     TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_auth_challenges_staff ON staff_auth_challenges(staff_id, purpose, created_at);

COMMIT;
