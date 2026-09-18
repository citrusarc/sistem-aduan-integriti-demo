import type { ComplaintStatus, ProtectionRequestStatus } from "@/types/enums"

/**
 * What each status means to a complainant. There is deliberately no NFA entry:
 * the public and complainant APIs never return an NFA case (rule 2).
 */
export const PUBLIC_STATUS_MEANING: Partial<Record<ComplaintStatus, string>> = {
  BARU: "Aduan telah diterima dan sedang dinilai oleh Unit Integriti.",
  MENUNGGU_JMM:
    "Aduan akan dibentangkan dalam mesyuarat jawatankuasa untuk keputusan.",
  DALAM_TINDAKAN:
    "Keputusan telah dibuat dan tindakan susulan sedang dijalankan.",
  SELESAI: "Tindakan ke atas aduan ini telah selesai.",
  PENDUA:
    "Aduan ini mengenai perkara yang sama dengan aduan lain yang telah diterima, dan diproses bersama aduan tersebut.",
}

/** Complainant-facing wording; review notes are never shown (rule 9). */
export const PROTECTION_STATUS_TEXT: Record<ProtectionRequestStatus, string> = {
  DITERIMA: "Diterima — menunggu semakan",
  DILULUSKAN: "Diluluskan",
  DITOLAK: "Tidak diluluskan",
}
