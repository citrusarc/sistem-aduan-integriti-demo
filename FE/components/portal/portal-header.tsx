"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOutIcon, MenuIcon, ShieldCheckIcon, XIcon } from "lucide-react"

import { useSession } from "@/components/providers/session"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/states"
import { homeFor } from "@/lib/access"
import { cn } from "@/lib/utils"

const LINKS = [
  { href: "/", label: "Utama" },
  { href: "/submit", label: "Hantar Aduan" },
  { href: "/track", label: "Semak Status" },
  { href: "/hubungi", label: "Hubungi Kami" },
] as const

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

export function PortalHeader() {
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" aria-hidden />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-semibold text-primary">
              Sistem Aduan Integriti
            </span>
            <span className="text-xs text-muted-foreground">
              Unit Integriti
            </span>
          </span>
        </Link>

        <nav
          aria-label="Navigasi utama"
          className="hidden items-center gap-1 md:flex"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted hover:text-foreground",
                isActive(pathname, link.href) &&
                  "font-medium text-primary shadow-[inset_0_-2px_0_var(--accent)]"
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <ComplainantMenu />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={open}
          aria-controls="portal-mobile-nav"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <XIcon /> : <MenuIcon />}
        </Button>
      </div>

      {open && (
        <div
          id="portal-mobile-nav"
          className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden"
        >
          <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={
                  isActive(pathname, link.href) ? "page" : undefined
                }
                className="rounded-md px-3 py-2 text-sm hover:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-primary"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-border pt-3">
            <ComplainantMenu />
          </div>
        </div>
      )}
    </header>
  )
}

/**
 * The one session (§8 decision 15). Anyone signed in gets "Aduan saya"; an
 * account with a console also gets a way back to it.
 */
function ComplainantMenu() {
  const session = useSession()

  if (session.status === "loading") {
    return <Skeleton className="h-8 w-32" aria-label="Menyemak sesi" />
  }

  if (session.status !== "authenticated") {
    return (
      <div className="flex items-center gap-2">
        <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
          Log masuk
        </Link>
        <Link
          href="/daftar"
          className={buttonVariants({ variant: "outline-cta" })}
        >
          Daftar
        </Link>
      </div>
    )
  }

  const { user } = session
  return (
    <div className="flex items-center gap-2">
      {user.hasConsole && (
        <Link
          href={homeFor(user)}
          className={buttonVariants({ variant: "outline" })}
        >
          Konsol
        </Link>
      )}
      <Link href="/me" className={buttonVariants({ variant: "secondary" })}>
        Aduan saya
      </Link>
      <span
        className="hidden max-w-40 truncate text-xs text-muted-foreground lg:inline"
        title={user.email}
      >
        {user.email}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Log keluar"
        title="Log keluar"
        onClick={() => void session.logout()}
      >
        <LogOutIcon />
      </Button>
    </div>
  )
}
