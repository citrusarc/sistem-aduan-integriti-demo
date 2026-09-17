"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { LoginForm } from "@/components/admin/login-form"
import { useStaffSession } from "@/components/providers/staff-session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { homeFor } from "@/lib/access"
import { getSetupStatus, meetsPasswordPolicy } from "@/lib/auth"
import {
  PasswordInput,
  PasswordRequirements,
} from "@/components/ui/password-input"
import { ApiRequestError } from "@/lib/api"
import { errorMessage } from "@/lib/errors"

/**
 * /login. On a brand-new installation (no staff accounts at all) it offers
 * first-run setup instead — §8 decision 13. BE decides whether setup is open
 * and refuses it (409) once any account exists; this only picks the form.
 */
export function StaffSignIn() {
  const [setup, setSetup] = React.useState<
    | { status: "loading" }
    | { status: "ready"; required: boolean }
    | { status: "error"; error: Error }
  >({ status: "loading" })

  const check = React.useCallback(async () => {
    setSetup({ status: "loading" })
    try {
      setSetup({ status: "ready", required: await getSetupStatus() })
    } catch (err) {
      setSetup({
        status: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      })
    }
  }, [])

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check()
  }, [check])

  if (setup.status === "loading") return <LoadingState label="Menyemak…" />
  if (setup.status === "error") {
    return <ErrorState error={setup.error} onRetry={() => void check()} />
  }

  const required = setup.required
  return (
    <>
      <div className="mb-6 flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          Unit Integriti
        </p>
        <h1 className="text-xl font-semibold text-primary">
          {required ? "Persediaan awal" : "Log masuk kakitangan"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {required ? (
            "Belum ada akaun kakitangan. Cipta akaun ADMIN pertama — selepas itu, ADMIN mencipta akaun lain di Tetapan › Pengurusan staf."
          ) : (
            <>
              Untuk pengadu, gunakan{" "}
              <a href="/me" className="underline underline-offset-4">
                log masuk / daftar pengadu
              </a>
              .
            </>
          )}
        </p>
      </div>
      {required ? (
        <FirstRunSetupForm onClosed={() => void check()} />
      ) : (
        <LoginForm />
      )}
    </>
  )
}

function FirstRunSetupForm({ onClosed }: { onClosed: () => void }) {
  const session = useStaffSession()
  const router = useRouter()
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (fullName.trim().length < 2) return setError("Masukkan nama penuh.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Masukkan alamat e-mel yang sah.")
    }
    if (!meetsPasswordPolicy(password)) {
      return setError("Kata laluan belum memenuhi semua syarat.")
    }
    if (password !== confirm) return setError("Kata laluan tidak sepadan.")

    setBusy(true)
    setError(null)
    try {
      const staff = await session.setupFirstAdmin({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
      })
      router.replace(homeFor(staff.role))
    } catch (err) {
      setBusy(false)
      // Someone else finished setup first: show the normal login instead.
      if (err instanceof ApiRequestError && err.status === 409) onClosed()
      else setError(errorMessage(err))
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormField label="Nama penuh" required>
        <Input
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoFocus
        />
      </FormField>
      <FormField label="E-mel" required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormField>
      <FormField label="Kata laluan" required>
        <PasswordInput
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FormField>
      <PasswordRequirements password={password} />
      <FormField label="Sahkan kata laluan" required>
        <PasswordInput
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </FormField>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Mencipta akaun…" : "Cipta akaun ADMIN"}
      </Button>
    </form>
  )
}
