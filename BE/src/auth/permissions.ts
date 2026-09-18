import { STAFF_ROLE, type StaffRole } from "../types/enums.js";
import { INTEGRITY_UNIT_ROLES, REFERRAL_RECIPIENT_ROLES } from "./roles.js";

/**
 * Roles and permissions — CLAUDE.md §8 decision 15.
 *
 * Routers are gated on a permission (requirePermission), never on a role name.
 * Which role holds which permission is fixed here, in code, rather than
 * editable by ADMIN: several permissions expose NFA cases (rule 2) or internal
 * notes (rule 9), and a checkbox must not be able to hand those to KJ,
 * SUB_UNIT or a complainant. ADMIN manages people by giving them a role.
 *
 * The Integrity Unit permissions are granted to INTEGRITY_UNIT_ROLES as a
 * whole, so adding a role to staff_role_enum grants none of them by default.
 */
export const PERMISSIONS = [
  /** Case register, case file, decisions, case actions (/api/admin/complaints, decisions, case-actions). */
  "complaints.manage",
  /** JMM meetings and agendas (/api/admin/jmm/meetings). */
  "jmm.manage",
  /** Dashboard and reports (/api/admin/stats). */
  "reports.view",
  /** Whistleblower protection review — KUI only (§8 decision 6). */
  "protection.review",
  /** Referred actions (/api/referrals) — KJ / SUB_UNIT (§8 decision 5). */
  "referrals.respond",
  /** Accounts and roles (/api/admin/staff). */
  "users.manage",
  /** Password policy (/api/admin/settings). */
  "security.manage",
  /** Own complaints and protection requests (/api/complainant). */
  "portal.use",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions that reach NFA cases or internal notes — Integrity Unit only. */
const INTEGRITY_UNIT_PERMISSIONS = [
  "complaints.manage",
  "jmm.manage",
  "reports.view",
] as const satisfies readonly Permission[];

function grants(role: StaffRole): Permission[] {
  const granted: Permission[] = ["portal.use"];
  if ((INTEGRITY_UNIT_ROLES as readonly StaffRole[]).includes(role)) {
    granted.push(...INTEGRITY_UNIT_PERMISSIONS);
  }
  if ((REFERRAL_RECIPIENT_ROLES as readonly StaffRole[]).includes(role)) {
    granted.push("referrals.respond");
  }
  if (role === "KUI") granted.push("protection.review");
  if (role === "ADMIN") granted.push("users.manage", "security.manage");
  return granted;
}

export const ROLE_PERMISSIONS = Object.fromEntries(
  STAFF_ROLE.map((role) => [role, grants(role)]),
) as unknown as Readonly<Record<StaffRole, readonly Permission[]>>;

export function hasPermission(
  role: StaffRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Whether a role has any console page at all; PENGADU uses the portal only. */
export function hasConsoleAccess(role: StaffRole): boolean {
  return ROLE_PERMISSIONS[role].some((p) => p !== "portal.use");
}
