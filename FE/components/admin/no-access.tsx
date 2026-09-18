"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ShieldOffIcon } from "lucide-react"

import { useSession } from "@/components/providers/session"
import { Button, buttonVariants } from "@/components/ui/button"
import { LoadingState } from "@/components/ui/states"
import { homeFor, safeNextPath } from "@/lib/access"
import { STAFF_ROLE } from "@/types/enums"

/**
 * "Tiada akses": where the console gate sends a signed-in user whose role
 * can't open the page they asked for. Offers their own home, or signing in as
 * someone else.
 */
export function NoAccess() {
  const session = useSession()
  const router = useRouter()
  const from = safeNextPath(useSearchParams().get("dari"))

  if (session.status === "loading") {
    return <LoadingState label="Menyemak sesi…" />
  }

  const staff = session.status === "authenticated" ? session.user : null

  async function switchAccount() {
    await session.logout()
    router.replace(from ? `/login?next=${encodeURIComponent(from)}` : "/login")
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldOffIcon className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold text-primary">Tiada akses</h1>
      <p className="text-sm text-muted-foreground">
        {staff ? (
          <>
            Peranan anda (
            <span className="font-medium text-foreground">
              {STAFF_ROLE[staff.role]}
            </span>
            ) tidak dibenarkan membuka{" "}
            {from ? (
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {from}
              </code>
            ) : (
              "halaman ini"
            )}
            .
          </>
        ) : (
          "Anda tidak log masuk, atau sesi anda telah tamat."
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {staff ? (
          <>
            <Link href={homeFor(staff)} className={buttonVariants()}>
              Ke halaman utama saya
            </Link>
            <Button variant="outline" onClick={switchAccount}>
              Log masuk sebagai pengguna lain
            </Button>
          </>
        ) : (
          <Link href="/login" className={buttonVariants()}>
            Log masuk
          </Link>
        )}
      </div>
    </div>
  )
}
