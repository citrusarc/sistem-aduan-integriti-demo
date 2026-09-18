"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BarChart3Icon,
  CalendarDaysIcon,
  FileTextIcon,
  GavelIcon,
  InboxIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MenuIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { useSession } from "@/components/providers/session"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/states"
import {
  activeHref,
  canAccess,
  navFor,
  type NavIcon,
  type NavSection,
} from "@/lib/access"
import { cn } from "@/lib/utils"
import { STAFF_ROLE } from "@/types/enums"

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  complaints: FileTextIcon,
  jmm: CalendarDaysIcon,
  decisions: GavelIcon,
  reports: BarChart3Icon,
  protection: ShieldCheckIcon,
  inbox: InboxIcon,
  tasks: ListChecksIcon,
  staff: UsersIcon,
  settings: SettingsIcon,
}

/**
 * The console gate and chrome.
 *
 *   no session            -> /login?next=<this page>
 *   no console (PENGADU)  -> /me, the complainant's own page
 *   can't open page       -> /tiada-akses?dari=<this page>
 *
 * This runs in the browser because the session cookie is scoped to BE's /api
 * path and never reaches Next's server. It decides only what to render; BE
 * refuses the data regardless (401/403), and a page that gets a 403 from BE
 * should show ErrorState, which reads as "Tiada akses".
 *
 * Children render only once access is confirmed, so a page never fires its
 * data requests for a user who is about to be redirected.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const session = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const signingOut = React.useRef(false)

  const user = session.status === "authenticated" ? session.user : null
  const allowed = user !== null && canAccess(user, pathname)

  React.useEffect(() => {
    if (session.status === "anonymous") {
      router.replace(
        signingOut.current
          ? "/login"
          : `/login?next=${encodeURIComponent(pathname)}`
      )
    } else if (user && !user.hasConsole) {
      router.replace("/me")
    } else if (user && !canAccess(user, pathname)) {
      router.replace(`/tiada-akses?dari=${encodeURIComponent(pathname)}`)
    }
  }, [session.status, user, pathname, router])

  // Re-check the session on every console navigation, quietly (no loading
  // flash). A deactivated account, an expired session, or a role changed by
  // an ADMIN takes effect on the next click — even on a page that makes no
  // API call of its own.
  const { refresh } = session
  const checkedPath = React.useRef(pathname)
  React.useEffect(() => {
    if (checkedPath.current === pathname) return
    checkedPath.current = pathname
    void refresh()
  }, [pathname, refresh])

  if (session.status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <ErrorState
          error={session.error}
          onRetry={() => void session.refresh()}
          className="w-full max-w-lg"
        />
      </div>
    )
  }

  if (session.status !== "authenticated" || !allowed) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <LoadingState
          label={
            session.status === "loading" ? "Menyemak sesi…" : "Mengalihkan…"
          }
        />
      </div>
    )
  }

  const sections = navFor(session.user)

  async function signOut() {
    signingOut.current = true
    await session.logout()
  }

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <Sidebar
        sections={sections}
        pathname={pathname}
        staffName={session.user.fullName}
        roleLabel={STAFF_ROLE[session.user.role]}
        onSignOut={signOut}
      />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  )
}

function Sidebar({
  sections,
  pathname,
  staffName,
  roleLabel,
  onSignOut,
}: {
  sections: NavSection[]
  pathname: string
  staffName: string
  roleLabel: string
  onSignOut: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const active = activeHref(sections, pathname)

  // Close the mobile menu after navigating.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false)
  }, [pathname])

  return (
    <aside className="bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-svh md:w-64 md:shrink-0 md:flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        <Link href="/" className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Sistem Aduan Integriti</span>
          <span className="text-xs text-sidebar-foreground/70">
            Konsol Kakitangan
          </span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-foreground md:hidden"
          aria-expanded={open}
          aria-controls="console-nav"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <XIcon /> : <MenuIcon />}
        </Button>
      </div>

      <div
        id="console-nav"
        className={cn(
          "flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4",
          open ? "flex" : "hidden md:flex"
        )}
      >
        <nav aria-label="Navigasi konsol" className="flex flex-col gap-5">
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1">
              <p className="px-2 text-[0.7rem] font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
                {section.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const Icon = ICONS[item.icon]
                  const isActive = item.href === active
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent",
                          isActive &&
                            "bg-sidebar-accent font-medium text-sidebar-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]"
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 border-t border-sidebar-border pt-4">
          <div className="px-2 leading-tight">
            <p className="truncate text-sm font-medium">{staffName}</p>
            <p className="text-xs text-sidebar-foreground/70">{roleLabel}</p>
          </div>
          <Button
            variant="ghost"
            className="justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={onSignOut}
          >
            Log keluar
          </Button>
        </div>
      </div>
    </aside>
  )
}
