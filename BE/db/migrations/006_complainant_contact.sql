-- Complainant contact + anonymous submission — CLAUDE.md §8 decision 3.
--
-- Closes the schema gap behind business rule 6: an anonymous complainant still
-- needs a way back to them, and that way is an email address — never a name
-- stuffed into `particulars`.
--
-- contact_phone is for staff to call manually ONLY. Business rule 10: no code
-- sends anything to it. There is no SMS channel in this system.

BEGIN;

ALTER TABLE complainants
    ADD COLUMN contact_email TEXT,
    ADD COLUMN contact_phone TEXT,
    ADD COLUMN is_anonymous  BOOLEAN NOT NULL DEFAULT FALSE,

    -- Anonymous means a return channel and nothing that names the person.
    ADD CONSTRAINT chk_anonymous_contact CHECK (
        NOT is_anonymous
        OR (contact_email IS NOT NULL AND particulars IS NULL)
    ),
    ADD CONSTRAINT chk_contact_email_shape CHECK (
        contact_email IS NULL OR contact_email ~ '^[^@\s]+@[^@\s]+$'
    );

-- Complainant login (007) finds a person's complaints by email, case-insensitively.
-- Not unique: the same person may file several complaints, each with its own
-- complainants row, as the masterlist has always recorded them.
CREATE INDEX idx_complainants_contact_email_lower ON complainants (lower(contact_email));

-- When the submitter acknowledged the handling disclaimer. Set by portal
-- submissions, which the API refuses without it. NULL on staff-registered and
-- historical masterlist rows, where no portal disclaimer was ever shown.
ALTER TABLE complaints
    ADD COLUMN disclaimer_acknowledged_at TIMESTAMPTZ;

COMMIT;
