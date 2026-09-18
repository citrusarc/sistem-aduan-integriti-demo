import type { ComplaintStatus, JmmOutcome } from "../types/enums.js";

/**
 * Complaint status transitions — CLAUDE.md §8 decision 1.
 *
 * `complaints.status` is stored and written explicitly by the API. Nothing is
 * derived or guessed at read time any more. This file is the single table of
 * which events may move a complaint from which status to which; every write
 * path asks it first, inside the same transaction that locks the complaint.
 *
 *   event                 allowed from                            -> to
 *   ─────────────────────────────────────────────────────────────────────────
 *   AGENDA_ADDED          BARU, DALAM_TINDAKAN, NFA               -> MENUNGGU_JMM
 *   AGENDA_REMOVED        MENUNGGU_JMM                            -> BARU, or the
 *                         outcome of the last recorded decision (re-tabled case)
 *   DECISION_RECORDED     BARU, MENUNGGU_JMM, DALAM_TINDAKAN, NFA -> DALAM_TINDAKAN
 *                                                                    (NFA if outcome = NFA)
 *   CASE_CLOSED           DALAM_TINDAKAN                          -> SELESAI
 *   DUPLICATE_CONFIRMED   BARU                                    -> PENDUA
 *   DUPLICATE_UNDONE      PENDUA                                  -> BARU
 *
 * SELESAI is terminal: nothing moves a closed case. Re-tabling a decided case
 * (DALAM_TINDAKAN / NFA) is allowed, because a case can go back to JMM and a
 * correction to a signed decision is a new decision row (rule 8). NFA cannot
 * be "closed" — it is already a closure, just not a SELESAI one.
 *
 * MENUNGGU_JMM always means "on an open meeting's agenda": removing the item
 * reverts it, and a meeting cannot be closed while an item has no decision.
 * So AGENDA_ADDED from MENUNGGU_JMM is refused — the complaint is already
 * queued (the database trigger from migration 004 refuses it too).
 *
 * PENDUA (§8 decision 16) is staff confirming a new complaint repeats an
 * existing case. Only a BARU complaint can be: one on an agenda is taken off it
 * first, and a decided one has a JMM record of its own. PENDUA is never tabled
 * or decided; staff can undo it, which puts the complaint back to BARU.
 */

export type StatusEvent =
  | { type: "AGENDA_ADDED" }
  | {
      type: "AGENDA_REMOVED";
      /** Outcome of the most recently recorded decision, if any. */
      lastOutcome: JmmOutcome | null;
    }
  | { type: "DECISION_RECORDED"; outcome: JmmOutcome }
  | { type: "CASE_CLOSED" }
  | { type: "DUPLICATE_CONFIRMED" }
  | { type: "DUPLICATE_UNDONE" };

const ALLOWED_FROM: Record<StatusEvent["type"], readonly ComplaintStatus[]> = {
  AGENDA_ADDED: ["BARU", "DALAM_TINDAKAN", "NFA"],
  AGENDA_REMOVED: ["MENUNGGU_JMM"],
  DECISION_RECORDED: ["BARU", "MENUNGGU_JMM", "DALAM_TINDAKAN", "NFA"],
  CASE_CLOSED: ["DALAM_TINDAKAN"],
  DUPLICATE_CONFIRMED: ["BARU"],
  DUPLICATE_UNDONE: ["PENDUA"],
};

const ACTION_LABEL: Record<StatusEvent["type"], string> = {
  AGENDA_ADDED: "dimasukkan ke agenda JMM",
  AGENDA_REMOVED: "dikeluarkan dari agenda JMM",
  DECISION_RECORDED: "direkodkan keputusan JMM",
  CASE_CLOSED: "ditutup sebagai Selesai",
  DUPLICATE_CONFIRMED: "ditandakan sebagai Pendua",
  DUPLICATE_UNDONE: "dinyahtanda daripada Pendua",
};

// Status names as the UI shows them, so refusals read naturally.
const STATUS_LABEL: Record<ComplaintStatus, string> = {
  BARU: "Baru",
  MENUNGGU_JMM: "Menunggu JMM",
  DALAM_TINDAKAN: "Dalam Tindakan",
  SELESAI: "Selesai",
  NFA: "NFA",
  PENDUA: "Pendua",
};

export type TransitionResult =
  { ok: true; to: ComplaintStatus } | { ok: false; reason: string };

function outcomeStatus(outcome: JmmOutcome | null): ComplaintStatus {
  if (outcome === null) return "BARU";
  return outcome === "NFA" ? "NFA" : "DALAM_TINDAKAN";
}

export function transition(
  from: ComplaintStatus,
  event: StatusEvent,
): TransitionResult {
  if (!ALLOWED_FROM[event.type].includes(from)) {
    return {
      ok: false,
      reason: `Aduan berstatus ${STATUS_LABEL[from]} tidak boleh ${ACTION_LABEL[event.type]}`,
    };
  }

  switch (event.type) {
    case "AGENDA_ADDED":
      return { ok: true, to: "MENUNGGU_JMM" };
    case "AGENDA_REMOVED":
      return { ok: true, to: outcomeStatus(event.lastOutcome) };
    case "DECISION_RECORDED":
      return { ok: true, to: outcomeStatus(event.outcome) };
    case "CASE_CLOSED":
      return { ok: true, to: "SELESAI" };
    case "DUPLICATE_CONFIRMED":
      return { ok: true, to: "PENDUA" };
    case "DUPLICATE_UNDONE":
      return { ok: true, to: "BARU" };
  }
}
