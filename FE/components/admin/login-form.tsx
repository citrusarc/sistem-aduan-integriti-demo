"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { useStaffSession } from "@/components/providers/staff-session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LoadingState } from "@/components/ui/states"
import { canAccess, homeFor, safeNextPath } from "@/lib/access"
import { ApiRequestError } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import type { StaffRole } from "@/types/enums"

/** Where to go after signing in: `?next=` if it's safe and the role may open it. */
function destination(role: StaffRole, next: string | null): string {
  const path = safeNextPath(next)
  return path && canAccess(role, path) ? path : homeFor(role)
}

export function LoginForm() {
  const session = useStaffSession()
  const router = useRouter()
  const next = useSearchParams().get("next")

  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const signedInRole =
    session.status === "authenticated" ? session.staff.role : null

  // Already signed in (or just signed in): leave the login page.
  React.useEffect(() => {
    if (signedInRole) router.replace(destination(signedInRole, next))
  }, [signedInRole, next, router])

  if (session.status === "loading" || signedInRole) {
    return <LoadingState label="Menyemak sesi…" />
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await session.login(email, password)
    } catch (err) {
      // 401 and 423 carry BE's Malay message; everything else is described.
      setError(
        err instanceof ApiRequestError &&
          (err.status === 401 || err.status === 423)
          ? err.message
          : errorMessage(err)
      )
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {next && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Sila log masuk untuk meneruskan.
        </p>
      )}
      <FormField label="E-mel" required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
      </FormField>
      <FormField label="Kata laluan" required>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </FormField>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={submitting || !email || !password}
      >
        {submitting ? "Sedang log masuk…" : "Log masuk"}
      </Button>
      <Link
        href="/"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Kembali ke portal awam
      </Link>
    </form>
  )
}
