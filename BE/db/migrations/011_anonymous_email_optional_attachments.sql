-- CLAUDE.md §8 decision 10 (supersedes parts of decisions 3 and 9).
--
-- 1. Anonymous complaints no longer need a contact email. Lampiran 2 makes
--    every BUTIR-BUTIR PENGADU field optional and accepts "Surat Layang", so a
--    complaint with no way back to its maker is valid. The trade-off is the
--    complainant's to make, and the portal warns them: no email means no SAT,
--    no "Rujuk pengadu" follow-up and no login — only the reference number.
--    An anonymous row still never carries a name (particulars).
--
-- 2. Supporting documents (DOKUMEN SOKONGAN) can be uploaded. Files live on the
--    BE's local disk (UPLOAD_DIR); this table is their register. Integrity
--    Unit only: no public or complainant route reads it (rule 9).

BEGIN;

ALTER TABLE complainants
    DROP CONSTRAINT chk_anonymous_contact,
    ADD CONSTRAINT chk_anonymous_no_name CHECK (
        NOT is_anonymous OR particulars IS NULL
    );

CREATE TABLE complaint_attachments (
    id                   BIGSERIAL PRIMARY KEY,
    -- RESTRICT: a file is evidence; deleting a complaint must not silently
    -- orphan or drop it.
    complaint_id         BIGINT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
    -- Random name on disk. The original name is shown to staff only.
    storage_key          TEXT NOT NULL UNIQUE,
    original_name        TEXT NOT NULL,
    mime_type            TEXT NOT NULL,
    size_bytes           INTEGER NOT NULL,
    sha256               TEXT NOT NULL,
    -- NULL = uploaded by the complainant through the portal.
    uploaded_by_staff_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_attachment_mime CHECK (mime_type IN (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )),
    CONSTRAINT chk_attachment_size CHECK (size_bytes > 0),
    CONSTRAINT chk_attachment_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_attachment_storage_key CHECK (storage_key ~ '^[0-9a-f-]{36}$')
);

CREATE INDEX idx_complaint_attachments_complaint ON complaint_attachments(complaint_id);

COMMIT;
