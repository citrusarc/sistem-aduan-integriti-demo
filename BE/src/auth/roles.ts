import type { StaffRole } from "../types/enums.js";

/**
 * Roles inside the Integrity Unit — the only roles that may see the full case
 * register, JMM decisions, NFA cases, and internal notes.
 *
 * KJ and SUB_UNIT are real staff roles but sit OUTSIDE the unit: a department
 * head or sub-unit officer receiving a referred action. Letting them through
 * this gate would break business rule 2 (NFA confidentiality) and rule 9
 * (internal notes), so every /api/admin/* router is gated on this list rather
 * than on "any logged-in staff".
 *
 * Adding a role to staff_role_enum does NOT add it here. That is deliberate.
 */
export const INTEGRITY_UNIT_ROLES = [
  "KUI",
  "PI",
  "PSU",
  "KPSU",
  "SETIAUSAHA",
  "ADMIN",
] as const satisfies readonly StaffRole[];

/**
 * Roles that receive referred case actions (§8 decision 5). They gate
 * /api/referrals and are the only valid `case_actions.assigned_to_staff_id`
 * targets. They are NOT Integrity Unit roles and never pass that gate.
 */
export const REFERRAL_RECIPIENT_ROLES = [
  "KJ",
  "SUB_UNIT",
] as const satisfies readonly StaffRole[];
