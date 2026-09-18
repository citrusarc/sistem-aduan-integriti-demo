import type { CurrentUser } from "@/lib/auth"
import type { Permission, StaffRole } from "@/types/enums"

/**
 * Which account may open which console path — for deciding what to SHOW. BE
 * enforces the real rules on every request; hiding a link or a page never
 * protects the data behind it.
 *
 * Rules name a permission (§8 decision 15), which BE hands over in
 * GET /api/auth/me. Deny by default: a console path with no rule is refused
 * for everyone, so a new page can't silently appear for KJ, SUB_UNIT or a
 * complainant. The most specific (longest) matching prefix wins.
 */

type AccessRule = {
  prefix: string
  /** null: any signed-in account with a console. */
  permission: Permission | null
  /** Narrower still: these roles only (the two referral inboxes). */
  roles?: readonly StaffRole[]
}

const RULES: AccessRule[] = [
  { prefix: "/dashboard", permission: "reports.view" },
  { prefix: "/complaints", permission: "complaints.manage" },
  { prefix: "/jmm", permission: "jmm.manage" },
  { prefix: "/reports", permission: "reports.view" },
  // §8 decision 6: listed and reviewed by KUI only.
  { prefix: "/protection-requests", permission: "protection.review" },
  // §8 decision 5: referred actions, outside the Integrity Unit.
  { prefix: "/kj", permission: "referrals.respond", roles: ["KJ"] },
  { prefix: "/subunit", permission: "referrals.respond", roles: ["SUB_UNIT"] },
  // Every console user changes their own password; accounts are ADMIN's.
  { prefix: "/settings", permission: null },
  { prefix: "/settings/staff", permission: "users.manage" },
]

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

type Access = Pick<CurrentUser, "role" | "permissions" | "hasConsole">

export function canAccess(user: Access, pathname: string): boolean {
  if (!user.hasConsole) return false
  const rule = RULES.filter((r) => matches(pathname, r.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0]
  if (!rule) return false
  if (rule.roles && !rule.roles.includes(user.role)) return false
  return rule.permission === null || user.permissions.includes(rule.permission)
}

/** Portal pages a signed-in account may be sent back to after sign-in. */
const PORTAL_PREFIXES = ["/me", "/submit", "/track"]

/** Where an account lands after signing in, or when sent "home". */
export function homeFor(user: Access): string {
  if (!user.hasConsole) return "/me"
  if (user.role === "KJ") return "/kj/inbox"
  if (user.role === "SUB_UNIT") return "/subunit/tasks"
  return canAccess(user, "/dashboard") ? "/dashboard" : "/settings"
}

/** After sign-in: `?next=` if it's safe and this account may open it. */
export function destinationFor(user: Access, next: string | null): string {
  const path = safeNextPath(next)
  if (!path) return homeFor(user)
  const bare = path.split("?")[0]!
  if (PORTAL_PREFIXES.some((p) => matches(bare, p))) return path
  return canAccess(user, bare) ? path : homeFor(user)
}

export type NavIcon =
  | "dashboard"
  | "complaints"
  | "jmm"
  | "decisions"
  | "reports"
  | "protection"
  | "inbox"
  | "tasks"
  | "staff"
  | "settings"

export type NavItem = { href: string; label: string; icon: NavIcon }

export type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: "Unit Integriti",
    items: [
      { href: "/dashboard", label: "Papan Pemuka", icon: "dashboard" },
      { href: "/complaints", label: "Daftar Aduan", icon: "complaints" },
      { href: "/jmm", label: "Mesyuarat JMM", icon: "jmm" },
      { href: "/jmm/decisions", label: "Log Keputusan", icon: "decisions" },
      { href: "/reports", label: "Laporan", icon: "reports" },
      {
        href: "/protection-requests",
        label: "Permohonan Perlindungan",
        icon: "protection",
      },
    ],
  },
  {
    title: "Rujukan",
    items: [
      { href: "/kj/inbox", label: "Peti Masuk KJ", icon: "inbox" },
      { href: "/subunit/tasks", label: "Tugasan Sub-unit", icon: "tasks" },
    ],
  },
  {
    title: "Pentadbiran",
    items: [
      { href: "/settings/staff", label: "Pengurusan Akaun", icon: "staff" },
      { href: "/settings", label: "Tetapan Akaun", icon: "settings" },
    ],
  },
]

/** The nav an account sees: only items it can open, empty sections dropped. */
export function navFor(user: Access): NavSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(user, item.href)),
  })).filter((section) => section.items.length > 0)
}

/**
 * The active nav item for a path: the longest href that is the path or a
 * parent of it, so /jmm/decisions highlights "Log Keputusan", not "Mesyuarat".
 */
export function activeHref(
  sections: NavSection[],
  pathname: string
): string | null {
  const hrefs = sections
    .flatMap((s) => s.items.map((i) => i.href))
    .filter((href) => matches(pathname, href))
    .sort((a, b) => b.length - a.length)
  return hrefs[0] ?? null
}

/**
 * A post-login `?next=` target, only if it is a plain same-site path. Anything
 * else (absolute URLs, protocol-relative `//host`, backslashes, `javascript:`)
 * is dropped — router.replace must never receive an untrusted URL.
 */
export function safeNextPath(next: string | null): string | null {
  if (!next) return null
  if (!/^\/[A-Za-z0-9\-._~%/?=&]*$/.test(next)) return null
  if (next.startsWith("//")) return null
  return next
}
