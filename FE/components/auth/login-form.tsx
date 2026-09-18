"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { SliderCaptcha } from "@/components/auth/slider-captcha"
import { useSession } from "@/components/providers/session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  PasswordInput,
  PasswordRequirements,
} from "@/components/ui/password-input"
import { Notice } from "@/components/ui/section"
import { LoadingState } from "@/components/ui/states"
import { destinationFor } from "@/lib/access"
import { ApiRequestError } from "@/lib/api"
import {
  changeExpiredPassword,
  meetsPasswordPolicy,
  submitLoginCode,
  submitPassword,
} from "@/lib/auth"
import { errorMessage } from "@/lib/errors"

/** Locally, BE prints outgoing email (and so every code) to its terminal. */
const LOCAL_DEV = process.env.NODE_ENV !== "production"

type Step =
  | { kind: "credentials" }
  | { kind: "captcha" }
  | { kind: "code"; mfaToken: string; sentTo: string }
  | { kind: "change"; changeToken: string }

/**
 * Sign-in for every account, staff and complainant alike (§8 decisions 14
 * and 15):
 *   email + password  ->  slider captcha  ->  6-digit code sent by email
 *   ->  (new password, if expired or set by ADMIN)  ->  signed in
 *
 * Every refusal repeats BE's single message; nothing here guesses whether an
 * email exists.
 */
export function LoginForm() {
  const session = useSession()
  const router = useRouter()
  const next = useSearchParams().get("next")

  const [step, setStep] = React.useState<Step>({ kind: "credentials" })
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [code, setCode] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const user = session.status === "authenticated" ? session.user : null

  // Already signed in (or just signed in): leave the login page — a
  // complainant for their own page, staff for their console home.
  React.useEffect(() => {
    if (user) router.replace(destinationFor(user, next))
  }, [user, next, router])

  if (session.status === "loading" || user) {
    return <LoadingState label="Menyemak sesi…" />
  }

  function restart(message: string | null) {
    setStep({ kind: "credentials" })
    setCode("")
    setError(message)
    setBusy(false)
  }

  async function onCaptchaSolved(captchaToken: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await submitPassword(email.trim(), password, captchaToken)
      setPassword("")
      setStep({
        kind: "code",
        mfaToken: result.mfaToken,
        sentTo: result.sentTo,
      })
      setBusy(false)
    } catch (err) {
      // 401 (wrong), 423 (blocked) and 400 (captcha) carry BE's Malay message.
      restart(
        err instanceof ApiRequestError && [400, 401, 423].includes(err.status)
          ? err.message
          : errorMessage(err)
      )
    }
  }

  async function onCode(event: React.FormEvent, mfaToken: string) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim()))
      return setError("Kod mengandungi 6 digit.")
    setBusy(true)
    setError(null)
    try {
      const result = await submitLoginCode(mfaToken, code.trim())
      if ("passwordChangeRequired" in result) {
        setStep({ kind: "change", changeToken: result.changeToken })
        setBusy(false)
        return
      }
      session.signedIn(result)
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiRequestError && [401, 423].includes(err.status)
          ? err.message
          : errorMessage(err)
      )
    }
  }

  async function onChange(event: React.FormEvent, changeToken: string) {
    event.preventDefault()
    if (!meetsPasswordPolicy(newPassword)) {
      return setError("Kata laluan baharu belum memenuhi semua syarat.")
    }
    if (newPassword !== confirm) return setError("Kata laluan tidak sepadan.")
    setBusy(true)
    setError(null)
    try {
      session.signedIn(await changeExpiredPassword(changeToken, newPassword))
    } catch (err) {
      setBusy(false)
      if (err instanceof ApiRequestError && err.status === 401) {
        restart(err.message)
      } else {
        setError(
          err instanceof ApiRequestError && err.status === 422
            ? err.message
            : errorMessage(err)
        )
      }
    }
  }

  if (step.kind === "code") {
    return (
      <form
        onSubmit={(e) => void onCode(e, step.mfaToken)}
        noValidate
        className="flex flex-col gap-4"
      >
        <Notice tone="info">
          Kod pengesahan 6 digit telah dihantar ke{" "}
          <strong>{step.sentTo}</strong>. Kod sah selama 10 minit.
        </Notice>
        <FormField label="Kod pengesahan" required>
          <PasswordInput
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="text-center text-lg tracking-[0.4em]"
          />
        </FormField>
        {LOCAL_DEV && (
          <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Pembangunan tempatan:
            </span>{" "}
            tiada e-mel sebenar dihantar. Kod dicetak di terminal BE.
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
          {busy ? "Mengesahkan…" : "Sahkan dan log masuk"}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto"
          onClick={() => restart(null)}
        >
          Log masuk semula
        </Button>
      </form>
    )
  }

  if (step.kind === "change") {
    return (
      <form
        onSubmit={(e) => void onChange(e, step.changeToken)}
        noValidate
        className="flex flex-col gap-4"
      >
        <Notice tone="warning">
          Kata laluan anda telah luput atau ditetapkan oleh ADMIN. Tetapkan kata
          laluan baharu untuk meneruskan.
        </Notice>
        <FormField label="Kata laluan baharu" required>
          <PasswordInput
            autoFocus
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </FormField>
        <PasswordRequirements password={newPassword} />
        <FormField label="Sahkan kata laluan baharu" required>
          <PasswordInput
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Menyimpan…" : "Tukar kata laluan dan log masuk"}
        </Button>
      </form>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!email.trim() || !password) return
        setError(null)
        setStep({ kind: "captcha" })
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {next && step.kind === "credentials" && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Sila log masuk untuk meneruskan.
        </p>
      )}
      <FormField label="E-mel" required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (step.kind === "captcha") setStep({ kind: "credentials" })
          }}
          required
          autoFocus
        />
      </FormField>
      <FormField label="Kata laluan" required>
        <PasswordInput
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (step.kind === "captcha") setStep({ kind: "credentials" })
          }}
          required
        />
      </FormField>
      <div className="-mt-2 flex justify-end">
        <Link
          href="/lupa-kata-laluan"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Lupa kata laluan?
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {step.kind === "captcha" ? (
        busy ? (
          <LoadingState label="Menyemak kata laluan…" />
        ) : (
          <SliderCaptcha onSolved={(token) => void onCaptchaSolved(token)} />
        )
      ) : (
        <Button type="submit" size="lg" disabled={!email || !password}>
          Log masuk
        </Button>
      )}
      <p className="text-center text-sm text-muted-foreground">
        Belum ada akaun?{" "}
        <Link
          href={next ? `/daftar?next=${encodeURIComponent(next)}` : "/daftar"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Daftar
        </Link>
      </p>
      <Link
        href="/"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Kembali ke portal awam
      </Link>
    </form>
  )
}
