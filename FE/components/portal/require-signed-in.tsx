"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserRoundIcon } from "lucide-react"

import { useSession } from "@/components/providers/session"
import { buttonVariants } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/ui/states"

/**
 * Renders `children` for a signed-in account, and a sign-in / register card
 * otherwise. Guards /me, a complaint's page and the protection request form;
 * a session that expires mid-visit falls back to the card in place, and both
 * links bring the visitor back here afterwards (`?next=`).
 */
export function RequireSignedIn({
  children,
  intro,
}: {
  children: React.ReactNode
  intro?: React.ReactNode
}) {
  const session = useSession()
  const pathname = usePathname()

  if (session.status === "loading")
    return <LoadingState label="Menyemak sesi…" />
  if (session.status === "error") {
    return (
      <ErrorState
        error={session.error}
        onRetry={() => void session.refresh()}
      />
    )
  }
  if (session.status === "authenticated") return <>{children}</>

  const next = encodeURIComponent(pathname)
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 surface-card border-border/70 bg-card p-6">
      <div className="flex flex-col gap-1">
        <span className="flex size-10 items-center justify-center rounded-full bg-status-menunggu-jmm text-primary">
          <UserRoundIcon className="size-5" aria-hidden />
        </span>
        <h2 className="mt-2 text-lg font-semibold text-primary">
          Log masuk untuk meneruskan
        </h2>
        <p className="text-sm text-muted-foreground">
          {intro ??
            "Aduan anda dipaparkan mengikut e-mel akaun anda — gunakan e-mel yang sama seperti semasa membuat aduan."}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/login?next=${next}`}
          className={buttonVariants({ size: "lg" })}
        >
          Log masuk
        </Link>
        <Link
          href={`/daftar?next=${next}`}
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          Daftar
        </Link>
      </div>
      <p className="text-xs text-muted-foreground">
        Anda tidak perlu akaun untuk{" "}
        <Link href="/submit" className="underline">
          menghantar aduan
        </Link>{" "}
        atau{" "}
        <Link href="/track" className="underline">
          menyemak status
        </Link>{" "}
        dengan no. rujukan.
      </p>
    </div>
  )
}
