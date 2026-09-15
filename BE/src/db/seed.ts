import { hashPassword } from "../auth/password.js";
import { createStaffAccount } from "../auth/store.js";
import { queryOne } from "./client.js";
import { closeComplaint, createComplaint } from "./queries/complaints.js";
import {
  createCaseAction,
  setCaseActionAssignee,
} from "./queries/caseActions.js";
import { createDecision } from "./queries/jmmDecisions.js";
import {
  addAgendaItem,
  closeMeeting,
  createMeeting,
} from "./queries/jmmMeetings.js";
import {
  createProtectionRequest,
  reviewProtectionRequest,
} from "./queries/protectionRequests.js";
import type {
  CaseActionType,
  GradeLevelGroup,
  IntegrityCategory,
  JmmOutcome,
  Sector,
  SourceChannel,
  StaffRole,
} from "../types/enums.js";

/**
 * Local demo data — `npm run db:seed`, after `npm run db:reset`.
 *
 * Built through the real query functions, not raw INSERTs, so every status is
 * the result of a genuine transition (§4), agendas obey the one-open-meeting
 * rule, and meetings close only once every item is decided. If a business rule
 * tightens later, the seed fails loudly instead of planting data the API could
 * never have produced.
 *
 * All names, emails, and reference text are fictional.
 */

export class SeedError extends Error {}

/** Known credentials, printed by the script. Local demo only. */
export const SEED_STAFF: {
  role: StaffRole;
  email: string;
  fullName: string;
  password: string;
}[] = [
  {
    role: "KUI",
    email: "kui@demo.aduan.gov.my",
    fullName: "Ketua Unit Integriti (Demo)",
    password: "Demo-KUI-2026!",
  },
  {
    role: "PI",
    email: "pi@demo.aduan.gov.my",
    fullName: "Pegawai Integriti (Demo)",
    password: "Demo-PI-2026!",
  },
  {
    role: "PSU",
    email: "psu@demo.aduan.gov.my",
    fullName: "Penolong Setiausaha (Demo)",
    password: "Demo-PSU-2026!",
  },
  {
    role: "KPSU",
    email: "kpsu@demo.aduan.gov.my",
    fullName: "Ketua Penolong Setiausaha (Demo)",
    password: "Demo-KPSU-2026!",
  },
  {
    role: "SETIAUSAHA",
    email: "setiausaha@demo.aduan.gov.my",
    fullName: "Setiausaha JMM (Demo)",
    password: "Demo-SETIAUSAHA-2026!",
  },
  {
    role: "ADMIN",
    email: "admin@demo.aduan.gov.my",
    fullName: "Pentadbir Sistem (Demo)",
    password: "Demo-ADMIN-2026!",
  },
  {
    role: "KJ",
    email: "kj@demo.aduan.gov.my",
    fullName: "Ketua Jabatan (Demo)",
    password: "Demo-KJ-2026!",
  },
  {
    role: "SUB_UNIT",
    email: "subunit@demo.aduan.gov.my",
    fullName: "Pegawai Sub-unit (Demo)",
    password: "Demo-SUB_UNIT-2026!",
  },
];

/** Complainant logins for the portal's email OTP (codes print to the BE console). */
export const SEED_COMPLAINANTS = {
  identified: "pengadu.demo@contoh.my",
  anonymous: "tanpa.nama.demo@contoh.my",
};

const CATEGORIES: IntegrityCategory[] = [
  "SALAH_LAKU",
  "SALAH_GUNA_KUASA",
  "RASUAH",
  "PELANGGARAN_ARAHAN_SOP_ETIKA_ORGANISASI",
  "JENAYAH",
  "LAIN_LAIN",
];
const SECTORS: Sector[] = [
  "PEROLEHAN",
  "PENTADBIRAN",
  "KEWANGAN",
  "PENGUATKUASAAN",
  "PERLESENAN",
  "LAIN_LAIN_SEKTOR",
];
const CHANNELS: SourceChannel[] = [
  "EMEL",
  "SURAT_MENYURAT",
  "BERSEMUKA",
  "TELEFON",
  "RUJUKAN_AGENSI_LUAR",
  "SURAT_LAYANG",
];
const GRADES: GradeLevelGroup[] = [
  "SOKONGAN",
  "P_DAN_P",
  "EKSEKUTIF",
  "BUKAN_EKSEKUTIF",
];
const ACTING_OUTCOMES: JmmOutcome[] = [
  "TINDAKAN_SPRM",
  "TINDAKAN_BAHAGIAN_JABATAN_AGENSI",
  "PENUBUHAN_JKSD",
  "TINDAKAN_TATATERTIB",
  "UTK_MAKLUMAN_KSU",
];
const ACTION_TYPES: CaseActionType[] = [
  "RUJUK_BAHAGIAN",
  "RUJUK_AGENSI",
  "SIASATAN_PS",
  "RUJUK_SPRM",
  "KIV",
];
const MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MAC",
  "APRIL",
  "MEI",
  "JUN",
  "JULAI",
  "OGOS",
  "SEPTEMBER",
];
const DESCRIPTIONS: Record<IntegrityCategory, string> = {
  SALAH_LAKU:
    "Dakwaan pegawai kerap tidak hadir bertugas tanpa kebenaran dan memalsukan rekod kehadiran.",
  SALAH_GUNA_KUASA:
    "Dakwaan penggunaan kenderaan jabatan untuk urusan peribadi pada hujung minggu.",
  RASUAH:
    "Dakwaan permintaan wang tunai bagi mempercepatkan kelulusan permohonan lesen.",
  PELANGGARAN_ARAHAN_SOP_ETIKA_ORGANISASI:
    "Dakwaan sebut harga dipecahkan bagi mengelak proses tender terbuka.",
  JENAYAH:
    "Dakwaan kehilangan peralatan pejabat yang disyaki diambil oleh kakitangan.",
  LAIN_LAIN:
    "Aduan berkaitan layanan kurang sopan di kaunter perkhidmatan awam.",
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Refuses unless the database is migrated and empty — run `npm run db:reset`
 * first. Seeding on top of existing data would mix demo cases into real ones.
 */
async function assertEmptyDatabase(): Promise<void> {
  const migrated = await queryOne<{ ok: boolean }>(
    "SELECT to_regclass('public.protection_requests') IS NOT NULL AS ok",
  );
  if (!migrated?.ok) {
    throw new SeedError(
      "Pangkalan data belum dimigrasi — jalankan npm run db:reset dahulu",
    );
  }
  const counts = await queryOne<{ staff: number; complaints: number }>(
    `SELECT (SELECT count(*)::int FROM staff_users) AS staff,
            (SELECT count(*)::int FROM complaints) AS complaints`,
  );
  if ((counts?.staff ?? 0) > 0 || (counts?.complaints ?? 0) > 0) {
    throw new SeedError(
      "Pangkalan data tidak kosong — jalankan npm run db:reset sebelum db:seed",
    );
  }
}

export type SeedSummary = {
  staff: number;
  complaints: number;
  meetings: number;
  decisions: number;
  caseActions: number;
  protectionRequests: number;
};

export async function seedDatabase({
  log = console.log,
}: { log?: (message: string) => void } = {}): Promise<SeedSummary> {
  await assertEmptyDatabase();

  // ── Staff ────────────────────────────────────────────────────────────────
  const staff = {} as Record<StaffRole, string>;
  for (const account of SEED_STAFF) {
    const row = await createStaffAccount({
      email: account.email,
      fullName: account.fullName,
      role: account.role,
      passwordHash: await hashPassword(account.password),
    });
    staff[account.role] = row.id;
  }
  log(`✔ ${SEED_STAFF.length} akaun staf`);

  // ── Complaints: 30, registered BARU ─────────────────────────────────────
  // index → group: 0–5 BARU, 6–10 MENUNGGU_JMM, 11–18 DALAM_TINDAKAN,
  // 19–23 SELESAI, 24–29 NFA.
  const IDENTIFIED = new Set([0, 6, 11, 19, 24]);
  const ANONYMOUS = new Set([1, 12]);

  const complaints: { id: string; refNo: string }[] = [];
  for (let i = 0; i < 30; i += 1) {
    const category = CATEGORIES[i % CATEGORIES.length]!;
    const month = 1 + (i % 9);
    const day = 3 + ((i * 7) % 24);
    const portal = IDENTIFIED.has(i) || ANONYMOUS.has(i);

    const row = await createComplaint({
      reportMonth: MONTHS[month - 1],
      reportYear: 2026,
      directedTo: i % 3 === 0 ? "AGENSI" : "KDN",
      sourceChannel: portal ? "SAI" : CHANNELS[i % CHANNELS.length],
      accusedParticulars: `Pegawai ${String.fromCharCode(65 + (i % 26))} (demo)`,
      accusedGradeLevel: GRADES[(i + 1) % GRADES.length],
      accusedDepartment: `Bahagian Demo ${1 + (i % 5)}`,
      infoClassification: "ADUAN_INTEGRITI",
      integrityCategory: category,
      sector: SECTORS[i % SECTORS.length],
      caseDescription: `${DESCRIPTIONS[category]} (Kes demo #${i + 1})`,
      complaintDate: `2026-${pad(month)}-${pad(Math.max(1, day - 2))}`,
      receivedDateUi: `2026-${pad(month)}-${pad(day)}`,
      complainant: IDENTIFIED.has(i)
        ? {
            particulars: "Pengadu Demo (Berdaftar)",
            gradeLevel: "EKSEKUTIF",
            contactEmail: SEED_COMPLAINANTS.identified,
            contactPhone: "012-345 6789",
            isAnonymous: false,
          }
        : ANONYMOUS.has(i)
          ? {
              contactEmail: SEED_COMPLAINANTS.anonymous,
              isAnonymous: true,
            }
          : {
              particulars: `Pengadu surat demo ${i + 1}`,
              gradeLevel: GRADES[i % GRADES.length],
            },
      disclaimerAcknowledged: portal,
    });
    complaints.push({ id: row.id, refNo: row.complaint_ref_no });
  }
  const at = (i: number) => complaints[i]!;
  log(`✔ ${complaints.length} aduan`);

  // ── Decisions ────────────────────────────────────────────────────────────
  const signatories = (date: string, signed: "all" | "chair" | "none") => [
    {
      staffId: staff.KUI,
      roleCategory: "PENGERUSI" as const,
      roleTitle: "KUI (Pengerusi)",
      signedAt: signed === "none" ? null : `${date}T10:00:00+08:00`,
    },
    {
      staffId: staff.PI,
      roleCategory: "AHLI" as const,
      roleTitle: "PI (Ahli 1)",
      signedAt: signed === "all" ? `${date}T10:05:00+08:00` : null,
    },
    {
      staffId: staff.PSU,
      roleCategory: "URUS_SETIA" as const,
      roleTitle: "PSU (PA) (Urus Setia)",
      signedAt: signed === "all" ? `${date}T10:10:00+08:00` : null,
    },
  ];

  let decisionCount = 0;
  const decisions = new Map<number, string>();
  const decide = async (
    i: number,
    outcome: JmmOutcome,
    date: string,
    signed: "all" | "chair" | "none",
    meetingId?: string,
  ) => {
    const { decision } = await createDecision({
      complaintId: at(i).id,
      decisionDate: date,
      agencyFileNo: `UI.100-1/3/${i + 1}`,
      summary: `Ringkasan keputusan JMM bagi kes demo #${i + 1}.`,
      jmmSource: "SISTEM_ADUAN_INTEGRITI",
      jmmClassification: "SALAH_LAKU",
      outcome,
      remarksFurtherAction:
        outcome === "NFA"
          ? "Tiada tindakan lanjut; maklumat tidak mencukupi."
          : "Rujuk kepada pihak berkenaan untuk tindakan.",
      meetingId,
      signatories: signatories(date, signed),
    });
    decisions.set(i, decision.id);
    decisionCount += 1;
  };

  // Meeting 1 — held and closed. Items: 11–14 (in action), 19–23 (to be
  // closed as SELESAI), 24–26 (NFA).
  const m1 = await createMeeting({
    meetingNo: "JMM Bil. 1/2026",
    meetingDate: "2026-04-15",
    venue: "Bilik Mesyuarat Integriti, Aras 3",
  });
  const m1Items = [11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 26];
  for (const i of m1Items) {
    await addAgendaItem({ meetingId: m1.id, complaintId: at(i).id });
  }
  for (const i of m1Items) {
    const outcome =
      i >= 24 ? "NFA" : ACTING_OUTCOMES[i % ACTING_OUTCOMES.length]!;
    // 13 and 14: signed by the chair only — not yet finalized (rule 1).
    await decide(
      i,
      outcome,
      "2026-04-15",
      i === 13 || i === 14 ? "chair" : "all",
      m1.id,
    );
  }
  await closeMeeting(m1.id);

  // Decided outside a recorded meeting (historical forms).
  for (const i of [15, 16, 17, 18]) {
    await decide(
      i,
      ACTING_OUTCOMES[i % ACTING_OUTCOMES.length]!,
      "2026-02-20",
      i >= 17 ? "none" : "all",
    );
  }
  await decide(27, "NFA", "2026-03-05", "all");
  await decide(28, "NFA", "2026-03-05", "none");
  await decide(29, "TINDAKAN_BAHAGIAN_JABATAN_AGENSI", "2026-03-05", "all");

  // ── Case actions, referrals, closures ───────────────────────────────────
  let actionCount = 0;
  const action = async (i: number, closed: boolean) => {
    const row = await createCaseAction({
      complaintId: at(i).id,
      jmmDecisionId: decisions.get(i) ?? null,
      psuActionNotes: `Surat rujukan dihantar bagi kes demo #${i + 1}.`,
      actionTaken: ACTION_TYPES[i % ACTION_TYPES.length],
      actionDate: i >= 19 ? "2026-04-22" : "2026-04-25",
      responseReceivedDate: closed ? "2026-06-10" : null,
      feedbackStatus: closed
        ? "Laporan akhir diterima; kes selesai"
        : "Menunggu maklum balas jabatan",
      uiRemarks: "Catatan dalaman Unit Integriti (demo).",
      fileRefNo: `UI.100-1/4/${i + 1}`,
    });
    actionCount += 1;
    return row.id;
  };

  const referTo: Partial<Record<number, StaffRole>> = {
    11: "KJ",
    12: "KJ",
    15: "KJ",
    19: "KJ",
    13: "SUB_UNIT",
    16: "SUB_UNIT",
  };
  for (let i = 11; i <= 23; i += 1) {
    const id = await action(i, i >= 19);
    const role = referTo[i];
    if (role) await setCaseActionAssignee(id, staff[role]);
  }
  for (const i of [19, 20, 21, 22, 23]) await closeComplaint(at(i).id);

  // 29: referred to KJ while in action, later re-decided NFA. The referral
  // row stays, but the KJ inbox must no longer show it (rule 2).
  const lateNfaAction = await action(29, false);
  await setCaseActionAssignee(lateNfaAction, staff.KJ);
  await decide(29, "NFA", "2026-07-01", "all");

  // Meeting 2 — scheduled, still open. Items 6–10 → MENUNGGU_JMM.
  const m2 = await createMeeting({
    meetingNo: "JMM Bil. 2/2026",
    meetingDate: "2026-09-30",
    venue: "Bilik Mesyuarat Integriti, Aras 3",
  });
  for (const i of [6, 7, 8, 9, 10]) {
    await addAgendaItem({ meetingId: m2.id, complaintId: at(i).id });
  }
  log(`✔ 2 mesyuarat, ${decisionCount} keputusan, ${actionCount} tindakan kes`);

  // ── Protection requests: one in each status ─────────────────────────────
  const reason =
    "Saya bimbang identiti saya diketahui dan akan menerima tindakan balas di tempat kerja.";
  // Left pending (DITERIMA).
  await createProtectionRequest({
    email: SEED_COMPLAINANTS.identified,
    complaintRefNo: at(0).refNo,
    reason,
  });
  const approved = await createProtectionRequest({
    email: SEED_COMPLAINANTS.identified,
    complaintRefNo: at(6).refNo,
    reason,
  });
  const rejected = await createProtectionRequest({
    email: SEED_COMPLAINANTS.identified,
    complaintRefNo: at(11).refNo,
    reason,
  });
  await reviewProtectionRequest({
    id: approved.id,
    status: "DILULUSKAN",
    reviewNotes: "Diluluskan; identiti pengadu dirahsiakan daripada jabatan.",
    reviewerId: staff.KUI,
  });
  await reviewProtectionRequest({
    id: rejected.id,
    status: "DITOLAK",
    reviewNotes: "Tiada risiko tindakan balas dikenal pasti.",
    reviewerId: staff.KUI,
  });
  log("✔ 3 permohonan perlindungan (Diterima, Diluluskan, Ditolak)");

  return {
    staff: SEED_STAFF.length,
    complaints: complaints.length,
    meetings: 2,
    decisions: decisionCount,
    caseActions: actionCount,
    protectionRequests: 3,
  };
}
