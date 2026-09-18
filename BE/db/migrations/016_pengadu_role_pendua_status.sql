-- CLAUDE.md §8 decisions 15 and 16 — the two new enum values.
--
--   PENGADU  staff_role_enum: a registered complainant. One account table and
--            one sign-in for everybody (decision 15); PENGADU is the role every
--            self-registration gets. It is NOT an Integrity Unit role and holds
--            no console permission — see src/auth/permissions.ts.
--   PENDUA   complaint_status_enum: staff confirmed the complaint repeats an
--            existing case (decision 16). Set only by staff, never automatically.
--
-- Kept in its own file with no other statements: a value added by
-- ALTER TYPE ... ADD VALUE cannot be used until the adding transaction commits.
-- New values append at the end; mirror that order in both enums.ts files.

ALTER TYPE staff_role_enum ADD VALUE IF NOT EXISTS 'PENGADU';
ALTER TYPE complaint_status_enum ADD VALUE IF NOT EXISTS 'PENDUA';
