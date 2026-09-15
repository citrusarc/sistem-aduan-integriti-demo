-- Adds the two roles the sitemap already assumed (kj/inbox, subunit/tasks)
-- but staff_role_enum never had.
--
--   KJ        Ketua Jabatan — head of the department a case is referred to
--   SUB_UNIT  Sub-unit officer carrying out a referred action
--
-- Both sit OUTSIDE the Integrity Unit. They must never pass the Integrity Unit
-- role gate on /api/admin/* — business rule 2 (NFA confidentiality) and rule 9
-- (internal notes) both depend on that. See INTEGRITY_UNIT_ROLES in
-- src/auth/roles.ts.
--
-- Kept in its own file with no other statements: a value added by
-- ALTER TYPE ... ADD VALUE cannot be used until the adding transaction commits,
-- so nothing that references 'KJ' or 'SUB_UNIT' may run alongside it.
-- New values append after 'ADMIN'; mirror that order in both enums.ts files.

ALTER TYPE staff_role_enum ADD VALUE IF NOT EXISTS 'KJ';
ALTER TYPE staff_role_enum ADD VALUE IF NOT EXISTS 'SUB_UNIT';
