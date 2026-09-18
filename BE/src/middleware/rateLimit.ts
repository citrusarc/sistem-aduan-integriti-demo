import type { Request, RequestHandler } from "express";
import { config } from "../config.js";
import { HttpError } from "./error-handler.js";

/**
 * Portal submission flood guard — CLAUDE.md §8 decision 16.
 *
 * Counts successful submissions per client IP over a rolling hour, in memory
 * only: the IP is never written to the database or a log, because an
 * anonymous complainant's address must not be kept (rule 6). A restart
 * forgets the counts, which is acceptable for a flood guard.
 *
 * Only registrations count. A 409 duplicate prompt or a 422 typo doesn't use
 * up the allowance, so a genuine complainant correcting a form isn't blocked.
 */

const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const kept = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (kept.length) hits.set(key, kept);
  else hits.delete(key);
  return kept;
}

const keyOf = (req: Request) => req.ip ?? "unknown";

/** 429 once this IP has used its allowance. Mount before the upload parser. */
export const submissionAllowance: RequestHandler = (req, _res, next) => {
  const limit = config.portal.submissionsPerIpPerHour;
  if (limit > 0 && recent(keyOf(req), Date.now()).length >= limit) {
    return next(
      new HttpError(
        429,
        "Terlalu banyak aduan dihantar dari rangkaian ini dalam sejam yang lalu. Cuba lagi kemudian, atau hubungi Unit Integriti terus.",
      ),
    );
  }
  next();
};

/** Counts one registered submission against this IP. */
export function recordSubmission(req: Request): void {
  if (config.portal.submissionsPerIpPerHour <= 0) return;
  const key = keyOf(req);
  const now = Date.now();
  hits.set(key, [...recent(key, now), now]);
}

/** Tests only. */
export function resetSubmissionCounts(): void {
  hits.clear();
}
