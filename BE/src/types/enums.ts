/**
 * Mirrors every Postgres ENUM in `db/schema.sql` plus `db/migrations/*` 1:1, by
 * name and by value.
 *
 * Keep this file and the database in lockstep — change them in the same PR,
 * never one without the other. `FE/types/enums.ts` mirrors this file again for
 * the UI; it carries the Malay display labels and must be updated too.
 */

// grade_level_group_enum — Month_Year!G2 / !J2
export const GRADE_LEVEL_GROUP = [
  "PENGURUSAN_TERTINGGI",
  "P_DAN_P",
  "SOKONGAN",
  "EKSEKUTIF",
  "BUKAN_EKSEKUTIF",
  "LAIN_LAIN",
] as const;
export type GradeLevelGroup = (typeof GRADE_LEVEL_GROUP)[number];

// complaint_directed_to_enum — Month_Year!D
export const COMPLAINT_DIRECTED_TO = ["KDN", "AGENSI"] as const;
export type ComplaintDirectedTo = (typeof COMPLAINT_DIRECTED_TO)[number];

// source_channel_enum — Month_Year!H2. Note: NOT interchangeable with
// JMM_SOURCE below; they come from two different forms.
export const SOURCE_CHANNEL = [
  "EMEL",
  "SURAT_MENYURAT",
  "BERSEMUKA",
  "SAI",
  "TELEFON",
  "RUJUKAN_AGENSI_LUAR",
  "SURAT_LAYANG",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNEL)[number];

// info_classification_enum — Month_Year!L2
export const INFO_CLASSIFICATION = [
  "ADUAN_INTEGRITI",
  "PERKHIDMATAN",
  "MAKLUMAT_PENGUATKUASAAN",
  "JENAYAH",
  "BUKAN_ADUAN",
] as const;
export type InfoClassification = (typeof INFO_CLASSIFICATION)[number];

// integrity_category_enum — Month_Year!M2
export const INTEGRITY_CATEGORY = [
  "SALAH_LAKU",
  "SALAH_GUNA_KUASA",
  "RASUAH",
  "JENAYAH",
  "PELANGGARAN_ARAHAN_SOP_ETIKA_ORGANISASI",
  "LAIN_LAIN",
] as const;
export type IntegrityCategory = (typeof INTEGRITY_CATEGORY)[number];

// sector_enum — Month_Year!N2
export const SECTOR = [
  "PENTADBIRAN",
  "PEROLEHAN",
  "KEWANGAN",
  "PENGUATKUASAAN",
  "PERLESENAN",
  "LAIN_LAIN_SEKTOR",
] as const;
export type Sector = (typeof SECTOR)[number];

// case_action_type_enum — Month_Year!T2.
// Business rule 4: this vocabulary is NOT interchangeable with JMM_OUTCOME.
// Both happen to contain 'NFA'; that coincidence is not a mapping.
export const CASE_ACTION_TYPE = [
  "KIV",
  "NFA",
  "RUJUK_AGENSI",
  "RUJUK_BAHAGIAN",
  "SIASATAN_PS",
  "RUJUK_SPRM",
] as const;
export type CaseActionType = (typeof CASE_ACTION_TYPE)[number];

// jmm_source_enum — the JMM form's own source list (8 values)
export const JMM_SOURCE = [
  "MAKLUMAT_SPRM",
  "EMEL",
  "SURAT_MENYURAT",
  "BERSEMUKA",
  "SISTEM_ADUAN_INTEGRITI",
  "TELEFON",
  "MEDIA_SOSIAL_CETAK_ELEKTRONIK",
  "LAIN_LAIN",
] as const;
export type JmmSource = (typeof JMM_SOURCE)[number];

// jmm_classification_enum — the JMM form's own classification list (9 values)
export const JMM_CLASSIFICATION = [
  "RASUAH",
  "KEWANGAN",
  "PEROLEHAN",
  "PENTADBIRAN",
  "SALAH_LAKU",
  "PERKHIDMATAN",
  "SALAH_GUNA_KUASA",
  "PENGUATKUASAAN",
  "LAIN_LAIN",
] as const;
export type JmmClassification = (typeof JMM_CLASSIFICATION)[number];

/**
 * jmm_outcome_enum — exactly 6 values, in form order.
 *
 * Business rule 3: never accept or store a 7th value. An earlier draft used an
 * 8-value list from the generic SPRM Tatacara PDF; it was superseded by the
 * actual BORANG JMM form and must not be reintroduced without an explicit
 * product decision plus an enum migration.
 */
export const JMM_OUTCOME = [
  "UTK_MAKLUMAN_KSU",
  "TINDAKAN_SPRM",
  "TINDAKAN_BAHAGIAN_JABATAN_AGENSI",
  "PENUBUHAN_JKSD",
  "TINDAKAN_TATATERTIB",
  "NFA",
] as const;
export type JmmOutcome = (typeof JMM_OUTCOME)[number];

// jmm_signatory_category_enum
export const JMM_SIGNATORY_CATEGORY = [
  "PENGERUSI",
  "AHLI",
  "URUS_SETIA",
] as const;
export type JmmSignatoryCategory = (typeof JMM_SIGNATORY_CATEGORY)[number];

// staff_role_enum — KJ and SUB_UNIT added by db/migrations/002 (appended, so
// they come last). Both are outside the Integrity Unit; see src/auth/roles.ts.
export const STAFF_ROLE = [
  "KUI",
  "PI",
  "PSU",
  "KPSU",
  "SETIAUSAHA",
  "ADMIN",
  "KJ",
  "SUB_UNIT",
] as const;
export type StaffRole = (typeof STAFF_ROLE)[number];

/**
 * complaint_status_enum — stored on `complaints.status` since
 * db/migrations/005, written by the API on each transition (CLAUDE.md §8
 * decision 1). Until the API switches over, responses still use the read-time
 * derivation in `src/db/complaintStatus.ts`.
 */
export const COMPLAINT_STATUS = [
  "BARU",
  "MENUNGGU_JMM",
  "DALAM_TINDAKAN",
  "SELESAI",
  "NFA",
] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUS)[number];

// jmm_meeting_status_enum — db/migrations/004
export const JMM_MEETING_STATUS = ["DIJADUALKAN", "SELESAI"] as const;
export type JmmMeetingStatus = (typeof JMM_MEETING_STATUS)[number];

// protection_request_status_enum — db/migrations/009
export const PROTECTION_REQUEST_STATUS = [
  "DITERIMA",
  "DILULUSKAN",
  "DITOLAK",
] as const;
export type ProtectionRequestStatus =
  (typeof PROTECTION_REQUEST_STATUS)[number];
