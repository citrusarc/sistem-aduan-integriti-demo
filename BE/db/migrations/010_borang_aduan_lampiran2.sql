-- BORANG ADUAN/ MAKLUMAT — SPRM Tatacara Pengurusan Aduan (2022), Lampiran 2.
--
-- Both registration forms (portal /submit and staff /complaints/new) follow
-- that form. This adds the columns it has that the Masterlist sheet didn't.
--
-- Every new column is optional (product decision): nothing here is required to
-- register a complaint. Identity columns are internal to the Integrity Unit and
-- never cross the public API (rule 9, toPublicComplaint allow-lists fields).
--
-- received_via is the form's own 14-item "Cara aduan/ maklumat diterima" list.
-- It is kept apart from source_channel_enum (Masterlist, 7 values) and
-- jmm_source_enum (BORANG JMM, 8 values), exactly as those two are kept apart
-- from each other: three forms, three vocabularies, no mapping between them.

BEGIN;

CREATE TYPE complainant_category_enum AS ENUM (
    'WARGA_AGENSI',
    'ORANG_AWAM'
);

CREATE TYPE gender_enum AS ENUM (
    'LELAKI',
    'PEREMPUAN'
);

-- "RUANGAN INI PERLU DIISI OLEH PENERIMA ADUAN/ MAKLUMAT", in form order.
CREATE TYPE received_via_enum AS ENUM (
    'PENGADU_DATANG_SENDIRI',
    'SISTEM_ADUAN_INTEGRITI',
    'PEGAWAI_INTEGRITI',
    'KETUA_JABATAN',
    'SISPAA',
    'BPA',
    'LSPRM',
    'LKAN',
    'SURAT_RASMI_JABATAN_KERAJAAN',
    'EMEL_FAKSIMILI',
    'TELEFON',
    'MEDIA_SOSIAL',
    'MEDIA_MASSA',
    'SURAT_LAYANG'
);

-- BUTIR-BUTIR PENGADU. `particulars` stays the NAMA column.
ALTER TABLE complainants
    ADD COLUMN complainant_category complainant_category_enum,  -- KATEGORI PENGADU
    ADD COLUMN ic_no                TEXT,                       -- NO. KAD PENGENALAN
    ADD COLUMN passport_no          TEXT,                       -- NO. PASSPORT
    ADD COLUMN age                  SMALLINT,                   -- UMUR
    ADD COLUMN gender               gender_enum,                -- JANTINA
    ADD COLUMN race                 TEXT,                       -- BANGSA
    ADD COLUMN nationality          TEXT,                       -- WARGANEGARA
    ADD COLUMN contact_phone_2      TEXT,                       -- NO. TELEFON (2)
    ADD COLUMN postal_address       TEXT,                       -- ALAMAT SURAT-MENYURAT
    ADD COLUMN occupation           TEXT,                       -- PEKERJAAN
    ADD COLUMN employer             TEXT,                       -- AGENSI/ SYARIKAT MAJIKAN

    ADD CONSTRAINT chk_complainant_age CHECK (age IS NULL OR age BETWEEN 0 AND 130),

    -- Extends chk_anonymous_contact (006): an anonymous row keeps nothing that
    -- identifies the person. Category, grade and phones are allowed, as before.
    ADD CONSTRAINT chk_anonymous_identity CHECK (
        NOT is_anonymous
        OR (ic_no IS NULL AND passport_no IS NULL AND age IS NULL
            AND gender IS NULL AND race IS NULL AND nationality IS NULL
            AND postal_address IS NULL AND occupation IS NULL
            AND employer IS NULL)
    );

-- MAKLUMAT ADUAN. Person (1) stays in the existing accused_* columns, with
-- accused_department as its NAMA AGENSI/ SYARIKAT.
ALTER TABLE complaints
    ADD COLUMN accused_position         TEXT,               -- JAWATAN (1)
    ADD COLUMN accused2_particulars     TEXT,               -- NAMA ORANG YANG DITOHMAH (2)
    ADD COLUMN accused2_department      TEXT,               -- NAMA AGENSI/ SYARIKAT (2)
    ADD COLUMN accused2_position        TEXT,               -- JAWATAN (2)
    ADD COLUMN incident_date            DATE,               -- TARIKH KEJADIAN
    ADD COLUMN incident_time            TIME,               -- MASA KEJADIAN
    ADD COLUMN has_supporting_documents BOOLEAN,            -- DOKUMEN SOKONGAN: ADA/ TIADA (NULL = not stated)
    ADD COLUMN received_via             received_via_enum;  -- Cara aduan/ maklumat diterima

CREATE INDEX idx_complaints_received_via ON complaints(received_via);

COMMIT;
