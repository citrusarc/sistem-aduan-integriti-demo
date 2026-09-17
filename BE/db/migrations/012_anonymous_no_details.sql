-- CLAUDE.md §8 decision 11 (refines decision 10).
--
-- "Tanpa nama" means no complainant details at all — not even a way back.
-- An anonymous row keeps only is_anonymous: no name, grade, category, email or
-- phone (identity fields are already refused by chk_anonymous_identity, 010).
-- The complainant tracks the case with the reference number alone.
--
-- NOT VALID: rows created under decisions 3/10 may carry a contact email the
-- complainant was promised updates on. Those stay as they are; the constraint
-- binds every new and updated row.

BEGIN;

ALTER TABLE complainants
    ADD CONSTRAINT chk_anonymous_no_details CHECK (
        NOT is_anonymous
        OR (particulars IS NULL AND grade_level IS NULL
            AND complainant_category IS NULL AND contact_email IS NULL
            AND contact_phone IS NULL AND contact_phone_2 IS NULL)
    ) NOT VALID;

COMMIT;
