/**
 * Mirrors `BE/src/types/enums.ts`, which in turn mirrors every Postgres ENUM in
 * `BE/db/schema.sql`. Three copies is the cost of the FE/BE split — change all
 * three in the same PR, or the UI will silently drop values the API accepts.
 *
 * This copy adds the Malay display labels; the BE copy has none, because the
 * API speaks enum values and leaves presentation to the client.
 */

export const GRADE_LEVEL_GROUP = {
  PENGURUSAN_TERTINGGI: "Pengurusan Tertinggi",
  P_DAN_P: "P&P",
  SOKONGAN: "Kump. Sokongan",
  EKSEKUTIF: "Eksekutif",
  BUKAN_EKSEKUTIF: "Bukan Eksekutif",
  LAIN_LAIN: "Lain-lain",
} as const
export type GradeLevelGroup = keyof typeof GRADE_LEVEL_GROUP

export const COMPLAINT_DIRECTED_TO = {
  KDN: "KDN",
  AGENSI: "Agensi",
} as const
export type ComplaintDirectedTo = keyof typeof COMPLAINT_DIRECTED_TO

export const SOURCE_CHANNEL = {
  EMEL: "Emel",
  SURAT_MENYURAT: "Surat-menyurat",
  BERSEMUKA: "Bersemuka",
  SAI: "Sistem Aduan Integriti",
  TELEFON: "Telefon",
  RUJUKAN_AGENSI_LUAR: "Rujukan Agensi Luar",
  SURAT_LAYANG: "Surat Layang",
} as const
export type SourceChannel = keyof typeof SOURCE_CHANNEL

export const INFO_CLASSIFICATION = {
  ADUAN_INTEGRITI: "Aduan Integriti",
  PERKHIDMATAN: "Perkhidmatan",
  MAKLUMAT_PENGUATKUASAAN: "Maklumat Penguatkuasaan",
  JENAYAH: "Jenayah",
  BUKAN_ADUAN: "Bukan Aduan (Pertanyaan/Cadangan)",
} as const
export type InfoClassification = keyof typeof INFO_CLASSIFICATION

export const INTEGRITY_CATEGORY = {
  SALAH_LAKU: "Salah Laku",
  SALAH_GUNA_KUASA: "Salah Guna Kuasa",
  RASUAH: "Rasuah",
  JENAYAH: "Jenayah",
  PELANGGARAN_ARAHAN_SOP_ETIKA_ORGANISASI:
    "Pelanggaran Arahan/SOP/Etika Organisasi",
  LAIN_LAIN: "Lain-lain",
} as const
export type IntegrityCategory = keyof typeof INTEGRITY_CATEGORY

export const SECTOR = {
  PENTADBIRAN: "Pentadbiran",
  PEROLEHAN: "Perolehan",
  KEWANGAN: "Kewangan",
  PENGUATKUASAAN: "Penguatkuasaan",
  PERLESENAN: "Perlesenan",
  LAIN_LAIN_SEKTOR: "Lain-lain Sektor",
} as const
export type Sector = keyof typeof SECTOR

/**
 * The masterlist's follow-up vocabulary. Never render a JMM_OUTCOME value
 * through this map or vice versa — they are different lists off different
 * forms (business rule 4) and only coincidentally share "NFA".
 */
export const CASE_ACTION_TYPE = {
  KIV: "KIV",
  NFA: "NFA",
  RUJUK_AGENSI: "Rujuk Agensi",
  RUJUK_BAHAGIAN: "Rujuk Bahagian",
  SIASATAN_PS: "Siasatan PS",
  RUJUK_SPRM: "Rujuk SPRM",
} as const
export type CaseActionType = keyof typeof CASE_ACTION_TYPE

export const JMM_SOURCE = {
  MAKLUMAT_SPRM: "Maklumat SPRM",
  EMEL: "Emel",
  SURAT_MENYURAT: "Surat-menyurat",
  BERSEMUKA: "Bersemuka",
  SISTEM_ADUAN_INTEGRITI: "Sistem Aduan Integriti",
  TELEFON: "Telefon",
  MEDIA_SOSIAL_CETAK_ELEKTRONIK: "Media Sosial/Cetak/Elektronik",
  LAIN_LAIN: "Lain-lain",
} as const
export type JmmSource = keyof typeof JMM_SOURCE

export const JMM_CLASSIFICATION = {
  RASUAH: "Rasuah",
  KEWANGAN: "Kewangan",
  PEROLEHAN: "Perolehan",
  PENTADBIRAN: "Pentadbiran",
  SALAH_LAKU: "Salah Laku",
  PERKHIDMATAN: "Perkhidmatan",
  SALAH_GUNA_KUASA: "Salah Guna Kuasa",
  PENGUATKUASAAN: "Penguatkuasaan",
  LAIN_LAIN: "Lain-lain",
} as const
export type JmmClassification = keyof typeof JMM_CLASSIFICATION

/**
 * Exactly 6 — business rule 3. A 7th entry here would render a value the API
 * and the database both reject.
 */
export const JMM_OUTCOME = {
  UTK_MAKLUMAN_KSU: "Untuk Makluman KSU",
  TINDAKAN_SPRM: "Tindakan SPRM",
  TINDAKAN_BAHAGIAN_JABATAN_AGENSI: "Tindakan Bahagian/Jabatan/Agensi",
  PENUBUHAN_JKSD: "Penubuhan JKSD",
  TINDAKAN_TATATERTIB: "Tindakan Tatatertib",
  NFA: "NFA",
} as const
export type JmmOutcome = keyof typeof JMM_OUTCOME

export const JMM_SIGNATORY_CATEGORY = {
  PENGERUSI: "Pengerusi",
  AHLI: "Ahli",
  URUS_SETIA: "Urus Setia",
} as const
export type JmmSignatoryCategory = keyof typeof JMM_SIGNATORY_CATEGORY

export const STAFF_ROLE = {
  KUI: "KUI",
  PI: "PI",
  PSU: "PSU",
  KPSU: "KPSU",
  SETIAUSAHA: "Setiausaha",
  ADMIN: "Admin",
  KJ: "Ketua Jabatan",
  SUB_UNIT: "Sub-unit",
  // §8 decision 15: a registered complainant. Every self-registration starts
  // here; ADMIN gives staff their role.
  PENGADU: "Pengadu",
} as const

/**
 * Roles inside the Integrity Unit. Mirrors INTEGRITY_UNIT_ROLES in
 * BE/src/auth/roles.ts. Only for deciding what to SHOW — the API enforces the
 * real gate, and KJ / SUB_UNIT get 403 from /api/admin/* regardless of what
 * the UI renders.
 */
export const INTEGRITY_UNIT_ROLES: readonly StaffRole[] = [
  "KUI",
  "PI",
  "PSU",
  "KPSU",
  "SETIAUSAHA",
  "ADMIN",
]
export type StaffRole = keyof typeof STAFF_ROLE

/**
 * Roles that receive referred case actions (§8 decision 5). Mirrors
 * REFERRAL_RECIPIENT_ROLES in BE/src/auth/roles.ts. Outside the Integrity Unit.
 */
export const REFERRAL_RECIPIENT_ROLES: readonly StaffRole[] = ["KJ", "SUB_UNIT"]

/**
 * Permissions (§8 decision 15). Mirrors PERMISSIONS in
 * BE/src/auth/permissions.ts; which role holds which comes from BE in
 * GET /api/auth/me, so the matrix itself is never copied here.
 */
export const PERMISSION = [
  "complaints.manage",
  "jmm.manage",
  "reports.view",
  "protection.review",
  "referrals.respond",
  "users.manage",
  "security.manage",
  "portal.use",
] as const
export type Permission = (typeof PERMISSION)[number]

/**
 * complaint_status_enum — stored on `complaints.status` and written by the API
 * on each transition (CLAUDE.md §4). Render through StatusPill.
 */
export const COMPLAINT_STATUS = {
  BARU: "Baru",
  MENUNGGU_JMM: "Menunggu JMM",
  DALAM_TINDAKAN: "Dalam Tindakan",
  SELESAI: "Selesai",
  NFA: "NFA",
  // §8 decision 16: staff confirmed it repeats an existing case.
  PENDUA: "Pendua",
} as const
export type ComplaintStatus = keyof typeof COMPLAINT_STATUS

export const JMM_MEETING_STATUS = {
  DIJADUALKAN: "Dijadualkan",
  SELESAI: "Selesai",
} as const
export type JmmMeetingStatus = keyof typeof JMM_MEETING_STATUS

export const PROTECTION_REQUEST_STATUS = {
  DITERIMA: "Diterima",
  DILULUSKAN: "Diluluskan",
  DITOLAK: "Ditolak",
} as const
export type ProtectionRequestStatus = keyof typeof PROTECTION_REQUEST_STATUS

// ─── BORANG ADUAN/ MAKLUMAT (Lampiran 2) — db/migrations/010 ───────────────

export const COMPLAINANT_CATEGORY = {
  WARGA_AGENSI: "Warga Agensi",
  ORANG_AWAM: "Orang Awam",
} as const
export type ComplainantCategory = keyof typeof COMPLAINANT_CATEGORY

export const GENDER = {
  LELAKI: "Lelaki",
  PEREMPUAN: "Perempuan",
} as const
export type Gender = keyof typeof GENDER

/** Lampiran 2 "WARGANEGARA" — two options only (§8 decision 12). */
export const NATIONALITY = {
  WARGANEGARA: "Warganegara",
  BUKAN_WARGANEGARA: "Bukan warganegara",
} as const
export type Nationality = keyof typeof NATIONALITY

/**
 * "Cara aduan/ maklumat diterima" — the form's own 14-item list, in form order.
 * Not SOURCE_CHANNEL (Masterlist) and not JMM_SOURCE (BORANG JMM).
 */
export const RECEIVED_VIA = {
  PENGADU_DATANG_SENDIRI: "Pengadu Datang Sendiri",
  SISTEM_ADUAN_INTEGRITI: "Sistem Aduan Integriti",
  PEGAWAI_INTEGRITI: "Pegawai Integriti",
  KETUA_JABATAN: "Ketua Jabatan",
  SISPAA: "SISPAA",
  BPA: "BPA",
  LSPRM: "LSPRM",
  LKAN: "LKAN",
  SURAT_RASMI_JABATAN_KERAJAAN: "Surat Rasmi Jabatan Kerajaan",
  EMEL_FAKSIMILI: "E-mel & Faksimile",
  TELEFON: "Telefon",
  MEDIA_SOSIAL: "Media Sosial",
  MEDIA_MASSA: "Media Massa",
  SURAT_LAYANG: "Surat Layang",
} as const
export type ReceivedVia = keyof typeof RECEIVED_VIA

/** Narrow an unknown API string to a known enum key, for defensive rendering. */
export function labelFor<T extends Record<string, string>>(
  map: T,
  value: string | null | undefined
): string {
  if (!value) return "—"
  return (map as Record<string, string>)[value] ?? value
}
