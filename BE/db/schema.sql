-- ============================================================================
-- Pengurusan Aduan — PostgreSQL Schema
-- ============================================================================
-- SOURCE OF TRUTH:
--   - `complaints` / `complainants` fields  <- "Month_Year" sheet, Masterlist
--     Aduan TEMPLATE.xlsx (the operational masterlist ledger; header occupies
--     rows 1-2, one data row = one complaint).
--   - `jmm_decisions` / `jmm_decision_signatories` fields <- "BORANG JMM" and
--     "B. JMM" sheets (the JMM decision form itself; the two sheets are two
--     versions of the same form and were reconciled into one table below).
--   - The 6-value decision outcome list and 9-value classification list were
--     cross-checked against the "JMM Template" sheet (the monthly JMM log),
--     which uses the same two vocabularies — confirming they're canonical.
--   - `case_actions` fields <- the tail end of the "Month_Year" row (columns
--     R-Z: TINDAKAN PSU(PA)/PS onward), split out into its own table because
--     a complaint can accumulate more than one tracked action over time, and
--     to give the requested explicit complainant / complaint / jmm_decision /
--     case_action relationship shape.
--   - `staff_users` is a light supporting lookup (not itself an Excel sheet)
--     so JMM signatories can optionally resolve to a real system user instead
--     of being a bare name string.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

-- Month_Year!G2 and !J2 — grade/level/group, used for both complainant (Pengadu)
-- and named/accused party (Penama). J2 omits "KUMP." before Sokongan; treated
-- as the same value.
CREATE TYPE grade_level_group_enum AS ENUM (
    'PENGURUSAN_TERTINGGI',
    'P_DAN_P',
    'SOKONGAN',
    'EKSEKUTIF',
    'BUKAN_EKSEKUTIF',
    'LAIN_LAIN'
);

-- Month_Year!D1/D2/D3 — "ADUAN KEPADA"
CREATE TYPE complaint_directed_to_enum AS ENUM (
    'KDN',
    'AGENSI'
);

-- Month_Year!H2 — "SUMBER ADUAN" (masterlist ledger version)
CREATE TYPE source_channel_enum AS ENUM (
    'EMEL',
    'SURAT_MENYURAT',
    'BERSEMUKA',
    'SAI',                     -- Sistem Aduan Integriti
    'TELEFON',
    'RUJUKAN_AGENSI_LUAR',
    'SURAT_LAYANG'
);

-- Month_Year!L2 — "KLASIFIKASI MAKLUMAT"
CREATE TYPE info_classification_enum AS ENUM (
    'ADUAN_INTEGRITI',
    'PERKHIDMATAN',
    'MAKLUMAT_PENGUATKUASAAN',
    'JENAYAH',
    'BUKAN_ADUAN'              -- Pertanyaan/Cadangan
);

-- Month_Year!M2 — "KATEGORI ADUAN INTEGRITI"
CREATE TYPE integrity_category_enum AS ENUM (
    'SALAH_LAKU',
    'SALAH_GUNA_KUASA',
    'RASUAH',
    'JENAYAH',
    'PELANGGARAN_ARAHAN_SOP_ETIKA_ORGANISASI',
    'LAIN_LAIN'
);

-- Month_Year!N2 — "SEKTOR"
CREATE TYPE sector_enum AS ENUM (
    'PENTADBIRAN',
    'PEROLEHAN',
    'KEWANGAN',
    'PENGUATKUASAAN',
    'PERLESENAN',
    'LAIN_LAIN_SEKTOR'
);

-- Month_Year!T2 — "TINDAKAN" (the masterlist's own follow-up action tracker,
-- distinct from the JMM's formal decision outcome below)
CREATE TYPE case_action_type_enum AS ENUM (
    'KIV',
    'NFA',
    'RUJUK_AGENSI',
    'RUJUK_BAHAGIAN',
    'SIASATAN_PS',
    'RUJUK_SPRM'
);

-- "BORANG JMM" / "B. JMM" — "Sumber Aduan" as printed on the JMM form itself
-- (a slightly different 8-item list than the masterlist's source_channel_enum:
-- adds "Maklumat SPRM" and "Media Sosial/Cetak/Elektronik", drops "Rujukan
-- Agensi Luar" and "Surat Layang" — kept as its own type for fidelity).
CREATE TYPE jmm_source_enum AS ENUM (
    'MAKLUMAT_SPRM',
    'EMEL',
    'SURAT_MENYURAT',
    'BERSEMUKA',
    'SISTEM_ADUAN_INTEGRITI',
    'TELEFON',
    'MEDIA_SOSIAL_CETAK_ELEKTRONIK',
    'LAIN_LAIN'
);

-- "BORANG JMM" / "B. JMM" — "Klasifikasi Aduan" (9 options on the form;
-- cross-checked against "JMM Template"!G5:O5, same 9 values).
CREATE TYPE jmm_classification_enum AS ENUM (
    'RASUAH',
    'KEWANGAN',
    'PEROLEHAN',
    'PENTADBIRAN',
    'SALAH_LAKU',
    'PERKHIDMATAN',
    'SALAH_GUNA_KUASA',
    'PENGUATKUASAAN',
    'LAIN_LAIN'
);

-- "BORANG JMM" / "B. JMM" — "Keputusan JMM" (6 options; cross-checked against
-- "JMM Template"!Q5:V5, same 6 values in the same order).
CREATE TYPE jmm_outcome_enum AS ENUM (
    'UTK_MAKLUMAN_KSU',
    'TINDAKAN_SPRM',
    'TINDAKAN_BAHAGIAN_JABATAN_AGENSI',
    'PENUBUHAN_JKSD',              -- Jawatankuasa Siasatan Dalaman
    'TINDAKAN_TATATERTIB',         -- Seksyen Tatatertib, Unit Integriti
    'NFA'
);

-- Signature block on both form versions: "BORANG JMM" names 5 slots
-- (KUI/Pengerusi, KPSU(TU)/Ahli 1, KPSU(TT)/Ahli 2, PSU(PA), Setiausaha);
-- "B. JMM" names 3 (Pengerusi/KUI, Ahli I/PI, Urus Setia/PSU(PA)). Both
-- collapse into the 3 categories below, with the exact title kept in
-- `role_title` on the signatories table.
CREATE TYPE jmm_signatory_category_enum AS ENUM (
    'PENGERUSI',
    'AHLI',
    'URUS_SETIA'
);

CREATE TYPE staff_role_enum AS ENUM (
    'KUI', 'PI', 'PSU', 'KPSU', 'SETIAUSAHA', 'ADMIN'
);

-- ============================================================================
-- 2. SUPPORTING LOOKUP TABLE (not itself an Excel sheet)
-- ============================================================================

CREATE TABLE staff_users (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name  TEXT NOT NULL,
    role       staff_role_enum NOT NULL,
    email      TEXT UNIQUE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. COMPLAINANT — Month_Year!F ("Butiran Pengadu") + !G ("Gred/Tahap/Kumpulan Pengadu")
-- ============================================================================

CREATE TABLE complainants (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    particulars  TEXT,                       -- BUTIRAN PENGADU (free text as kept in the sheet)
    grade_level  grade_level_group_enum,     -- GRED/ TAHAP/ KUMPULAN PENGADU
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. COMPLAINT — Month_Year!A-Q
-- ============================================================================

CREATE TABLE complaints (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    seq_no             INTEGER,                              -- BIL
    report_month       TEXT,                                  -- BULAN
    report_year        SMALLINT,                              -- TAHUN
    directed_to        complaint_directed_to_enum,             -- ADUAN KEPADA
    complaint_ref_no   TEXT NOT NULL UNIQUE,                  -- NO. RUJUKAN ADUAN

    complainant_id     BIGINT REFERENCES complainants(id) ON DELETE SET NULL,

    source_channel     source_channel_enum,                   -- SUMBER ADUAN

    -- PENAMA (ADUAN TERHADAP) — the sheet models exactly one named/accused
    -- party per row, so these stay inline rather than a child table.
    accused_particulars TEXT,                                  -- PENAMA (ADUAN TERHADAP)
    accused_grade_level grade_level_group_enum,                 -- GRED/ TAHAP/ KUMPULAN PENAMA
    accused_department  TEXT,                                   -- JABATAN

    info_classification  info_classification_enum,              -- KLASIFIKASI MAKLUMAT
    integrity_category   integrity_category_enum,                -- KATEGORI ADUAN INTEGRITI
    sector                sector_enum,                            -- SEKTOR

    case_description   TEXT,                                    -- PERIHAL KES
    complaint_date      DATE,                                    -- TARIKH ADUAN
    received_date_ui    DATE,                                    -- TARIKH TERIMA DI UI

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_report_month CHECK (report_month IS NULL OR char_length(report_month) > 0)
);

CREATE INDEX idx_complaints_complainant ON complaints(complainant_id);
CREATE INDEX idx_complaints_source      ON complaints(source_channel);
CREATE INDEX idx_complaints_category    ON complaints(integrity_category);
CREATE INDEX idx_complaints_period      ON complaints(report_year, report_month);

-- ============================================================================
-- 5. JMM DECISION — "BORANG JMM" / "B. JMM"
-- ============================================================================

CREATE TABLE jmm_decisions (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    complaint_id           BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,

    decision_date          DATE NOT NULL,        -- Tarikh
    agency_file_no         TEXT,                  -- No. Fail
    complaint_no_on_form   TEXT,                  -- No. Aduan (as printed on the form itself)
    summary                TEXT,                  -- Ringkasan Aduan

    jmm_source             jmm_source_enum,        -- Sumber Aduan (form's own list)
    jmm_classification     jmm_classification_enum, -- Klasifikasi Aduan (form's own list)
    outcome                jmm_outcome_enum NOT NULL, -- Keputusan JMM

    remarks_further_action TEXT,                  -- Ulasan / Tindakan Selanjutnya

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jmm_decisions_complaint ON jmm_decisions(complaint_id);
CREATE INDEX idx_jmm_decisions_outcome   ON jmm_decisions(outcome);

-- Signature block: KUI (Pengerusi) / KPSU(TU) Ahli 1 / KPSU(TT) Ahli 2 /
-- PSU(PA) / Setiausaha ("BORANG JMM"), or Pengerusi-KUI / Ahli I-PI /
-- Urus Setia-PSU(PA) ("B. JMM"). Both reduce to the 3 categories, with the
-- exact printed title preserved in role_title.
CREATE TABLE jmm_decision_signatories (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jmm_decision_id  BIGINT NOT NULL REFERENCES jmm_decisions(id) ON DELETE CASCADE,
    staff_id         BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
    role_category    jmm_signatory_category_enum NOT NULL,
    role_title       TEXT NOT NULL,   -- e.g. 'KUI (Pengerusi)', 'KPSU (TU) UI (Ahli 1)', 'PSU (PA)'
    signed_at        TIMESTAMPTZ,
    UNIQUE (jmm_decision_id, role_title)
);

CREATE INDEX idx_jmm_signatories_decision ON jmm_decision_signatories(jmm_decision_id);

-- ============================================================================
-- 6. CASE ACTION — Month_Year!R-Z (post-decision tracking columns)
-- ============================================================================

CREATE TABLE case_actions (
    id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    complaint_id             BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    jmm_decision_id          BIGINT REFERENCES jmm_decisions(id) ON DELETE SET NULL, -- Month_Year!S "JMM"

    psu_action_notes         TEXT,                    -- TINDAKAN PSU(PA)/PS
    action_taken             case_action_type_enum,    -- TINDAKAN
    action_date              DATE,                      -- TARIKH TINDAKAN DIAMBIL/ SURAT DIPANJANGKAN
    response_received_date   DATE,                      -- TARIKH TERIMA M/BALAS DARI JABATAN
    feedback_status          TEXT,                      -- MAKLUM BALAS/ STATUS TERKINI
    ui_remarks               TEXT,                      -- CATATAN UI
    file_ref_no              TEXT,                      -- NO. RUJUKAN FAIL
    misc_notes               TEXT,                      -- LAIN-LAIN

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_case_actions_complaint ON case_actions(complaint_id);
CREATE INDEX idx_case_actions_decision  ON case_actions(jmm_decision_id);
CREATE INDEX idx_case_actions_type      ON case_actions(action_taken);

COMMIT;
