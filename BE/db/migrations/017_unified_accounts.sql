-- CLAUDE.md §8 decision 15 — one account table, one sign-in, roles.
--
-- staff_users becomes the single account table for staff AND complainants
-- (role PENGADU). The table keeps its name so every FK stays put. Everyone
-- signs in with email + password + slider captcha + emailed code, under the
-- same password policy (decision 14). The complainant email-OTP login
-- (decision 4) and its tables are retired.
--
-- 1. email_verified_at: self-registration inserts NULL explicitly; the code
--    emailed at registration verifies it. Login refuses unverified accounts.
--    Every other way an account is made (ADMIN, the CLI) vouches for the
--    address and every login proves it again (MFA), so the default is now().
--    Existing accounts count as verified from their creation.
-- 2. Verified complainant_accounts (014) move across as PENGADU with no
--    password: "Lupa kata laluan" sets one (the emailed code proves the
--    address). An address already used by a staff account is left alone.
-- 3. The OTP tables go. Nothing else referenced them.
-- 4. staff_auth_challenges gains the REGISTER purpose.

BEGIN;

ALTER TABLE staff_users ADD COLUMN email_verified_at TIMESTAMPTZ DEFAULT now();
UPDATE staff_users SET email_verified_at = created_at;

INSERT INTO staff_users (full_name, role, email, email_verified_at, created_at)
SELECT a.full_name, 'PENGADU', a.email, a.verified_at, a.created_at
  FROM complainant_accounts a
 WHERE a.verified_at IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM staff_users u WHERE lower(u.email) = a.email
       );

DROP TABLE complainant_sessions;
DROP TABLE complainant_otp_codes;
DROP TABLE complainant_accounts;

ALTER TABLE staff_auth_challenges
    DROP CONSTRAINT staff_auth_challenges_purpose_check,
    ADD CONSTRAINT staff_auth_challenges_purpose_check
        CHECK (purpose IN ('LOGIN_MFA', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'REGISTER'));

COMMIT;
