import {
  listDuplicatePool,
  listRecentDescriptions,
  type DuplicatePoolRow,
} from "../db/queries/complaints.js";
import {
  contentTokens,
  cosine,
  idfFrom,
  identifiers,
  nameSimilarity,
} from "./similarity.js";

/**
 * Likely-repeat scoring — CLAUDE.md §8 decision 16.
 *
 * Runs at registration, after the rule 5 check, and never refuses or moves
 * anything: the complaint is always registered. A score at or above
 * SUSPECT_THRESHOLD stores a suspicion on the new complaint for staff to
 * confirm (PENDUA) or dismiss, and — when the same email sent it — holds back
 * the acknowledgement email, so resubmitting doesn't turn into a mail flood.
 *
 * The score is a weighted sum of signals, each 0..1, so the reasons shown to
 * staff are exactly what produced it:
 *
 *   text        0.40  TF-IDF cosine of case-identifying words (similarity.ts)
 *   accused     0.25  best name match across both accused slots, >= 0.75
 *   agency      0.10  best agency/department match, >= 0.75
 *   identifiers 0.15  shared amounts / plate / file numbers (2+ = full)
 *   same sender 0.10  same complainant email
 *
 * Or, whatever else: description text >= 0.85 on its own (copy-paste).
 *
 * Same category and topic words ("rasuah", "belanja") count for nothing: two
 * bribery complaints are not the same case.
 */

export const SUSPECT_THRESHOLD = 0.5;
const NEAR_COPY = 0.85;
const NAME_MATCH = 0.75;

export type DuplicateInput = {
  accusedParticulars?: string | null;
  accused2Particulars?: string | null;
  accusedDepartment?: string | null;
  accused2Department?: string | null;
  caseDescription?: string | null;
  /** Lower-cased already, or null (anonymous, or not given). */
  contactEmail?: string | null;
};

export type DuplicateAssessment = {
  complaintId: string;
  complaintRefNo: string;
  score: number;
  reasons: string[];
  /** Same complainant email — the case where the acknowledgement is held back. */
  sameSender: boolean;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

function best(
  mine: readonly (string | null | undefined)[],
  theirs: readonly (string | null | undefined)[],
): number {
  let top = 0;
  for (const a of mine) {
    for (const b of theirs) top = Math.max(top, nameSimilarity(a, b));
  }
  return top;
}

export function scoreAgainst(
  input: DuplicateInput,
  candidate: DuplicatePoolRow,
  idf: (token: string) => number,
): Omit<DuplicateAssessment, "complaintId" | "complaintRefNo"> {
  const reasons: string[] = [];

  const text = cosine(
    contentTokens(input.caseDescription),
    contentTokens(candidate.case_description),
    idf,
  );
  if (text >= 0.3) {
    reasons.push(
      `Kandungan aduan ${pct(text)} serupa (perkataan umum diabaikan)`,
    );
  }

  const accusedRaw = best(
    [input.accusedParticulars, input.accused2Particulars],
    [candidate.accused_particulars, candidate.accused2_particulars],
  );
  const accused = accusedRaw >= NAME_MATCH ? accusedRaw : 0;
  if (accused) reasons.push(`Nama pihak diadu sepadan (${pct(accused)})`);

  const agencyRaw = best(
    [input.accusedDepartment, input.accused2Department],
    [candidate.accused_department, candidate.accused2_department],
  );
  const agency = agencyRaw >= NAME_MATCH ? agencyRaw : 0;
  if (agency) reasons.push("Jabatan/agensi pihak diadu sepadan");

  const mine = identifiers(input.caseDescription);
  const shared = [...identifiers(candidate.case_description)].filter((t) =>
    mine.has(t),
  );
  const ids = Math.min(1, shared.length / 2);
  if (shared.length) {
    reasons.push(`Butiran khusus sama: ${shared.slice(0, 5).join(", ")}`);
  }

  const sameSender = Boolean(
    input.contactEmail && candidate.contact_email === input.contactEmail,
  );
  if (sameSender) reasons.push("Dihantar oleh e-mel pengadu yang sama");

  const weighted =
    0.4 * text +
    0.25 * accused +
    0.1 * agency +
    0.15 * ids +
    0.1 * (sameSender ? 1 : 0);
  const score = Math.min(1, Math.max(weighted, text >= NEAR_COPY ? text : 0));
  return { score: Math.round(score * 1000) / 1000, reasons, sameSender };
}

/**
 * The strongest likely repeat of `input` among existing complaints, or null
 * when nothing reaches SUSPECT_THRESHOLD.
 */
export async function assessDuplicate(
  input: DuplicateInput,
): Promise<DuplicateAssessment | null> {
  const accusedNames = [input.accusedParticulars, input.accused2Particulars]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s && s.length >= 3));
  const departments = [input.accusedDepartment, input.accused2Department]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s && s.length >= 3));

  const pool = await listDuplicatePool({
    accusedNames,
    departments,
    caseDescription: input.caseDescription?.trim() || null,
    contactEmail: input.contactEmail ?? null,
  });
  if (!pool.length) return null;

  const corpus = (await listRecentDescriptions()).map(contentTokens);
  corpus.push(contentTokens(input.caseDescription));
  const idf = idfFrom(corpus);

  let top: DuplicateAssessment | null = null;
  for (const candidate of pool) {
    const result = scoreAgainst(input, candidate, idf);
    if (
      result.score >= SUSPECT_THRESHOLD &&
      (!top || result.score > top.score)
    ) {
      top = {
        complaintId: candidate.id,
        complaintRefNo: candidate.complaint_ref_no,
        ...result,
      };
    }
  }
  return top;
}
