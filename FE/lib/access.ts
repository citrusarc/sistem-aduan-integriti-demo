import { INTEGRITY_UNIT_ROLES, STAFF_ROLE, type StaffRole } from "@/types/enums"

/**
 * Which staff role may open which console path — for deciding what to SHOW.
 * BE enforces the real rules on every request; hiding a link or a page never
 * protects the data behind it.
 *
 * Deny by default: a console path with no rule here is refused for every role,
 * so a new page can't silently appear for KJ or SUB_UNIT. The most specific
 * (longest) matching prefix wins.
 */

const ALL_STAFF = Object.keys(STAFF_ROLE) as StaffRole[]

type AccessRule = { prefix: string; roles: readonly StaffRole[] }

const RULES: AccessRule[] = [
  { prefix: "/dashboard", roles: INTEGRITY_UNIT_ROLES },
  { prefix: "/complaints", roles: INTEGRITY_UNIT_ROLES },
  { prefix: "/jmm", roles: INTEGRITY_UNIT_ROLES },
  { prefix: "/reports", roles: INTEGRITY_UNIT_ROLES },
  // §8 decision 6: listed and reviewed by KUI only (BE: requireStaff("KUI")).
  { prefix: "/protection-requests", roles: ["KUI"] },
  // §8 decision 5: referred actions, outside the Integrity Unit.
  { prefix: "/kj", roles: ["KJ"] },
  { prefix: "/subunit", roles: ["SUB_UNIT"] },
  // Everyone changes their own password; account management is ADMIN only.
  { prefix: "/settings", roles: ALL_STAFF },
  { prefix: "/settings/staff", roles: ["ADMIN"] },
]

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function canAccess(role: StaffRole, pathname: string): boolean {
  const rule = RULES.filter((r) => matches(pathname, r.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0]
  return rule ? rule.roles.includes(role) : false
}

/** Where a role lands after signing in, or when sent "home". */
export function homeFor(role: StaffRole): string {
  if (role === "KJ") return "/kj/inbox"
  if (role === "SUB_UNIT") return "/subunit/tasks"
  return "/dashboard"
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
      { href: "/settings/staff", label: "Pengurusan Staf", icon: "staff" },
      { href: "/settings", label: "Tetapan Akaun", icon: "settings" },
    ],
  },
]

/** The nav a role sees: only items it can open, empty sections dropped. */
export function navFor(role: StaffRole): NavSection[] {
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccess(role, item.href)),
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
