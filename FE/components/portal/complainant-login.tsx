"use client"

import * as React from "react"
import { MailIcon } from "lucide-react"

import { useComplainantSession } from "@/components/providers/complainant-session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { ApiRequestError, complainantApi } from "@/lib/api"
import { errorMessage } from "@/lib/errors"

/** Matches BE's OTP_COOLDOWN_SECONDS default; a code asked for sooner is silently not sent. */
const RESEND_AFTER_SECONDS = 60

/**
 * Renders `children` for a signed-in complainant, the email-OTP sign-in
 * otherwise. The same wrapper guards /me, a complaint's page and the protection
 * request form, so a session that expires mid-visit falls back to sign-in in
 * place instead of losing the page.
 */
export function RequireComplainant({
  children,
  intro,
}: {
  children: React.ReactNode
  intro?: React.ReactNode
}) {
  const session = useComplainantSession()

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
  if (session.status === "anonymous") {
    return <ComplainantLogin intro={intro} />
  }
  return <>{children}</>
}

/**
 * §8 decision 4 — email OTP only. BE answers every code request with the same
 * message whether or not the address has complaints (or is throttled), and
 * every bad code with the same 401; this form repeats those messages rather
 * than guessing at a reason, so it can't reveal who has filed a complaint.
 */
export function ComplainantLogin({ intro }: { intro?: React.ReactNode }) {
  const session = useComplainantSession()
  const [step, setStep] = React.useState<"email" | "code">("email")
  const [email, setEmail] = React.useState("")
  const [code, setCode] = React.useState("")
  const [sentMessage, setSentMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [resendIn, setResendIn] = React.useState(0)

  React.useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Masukkan alamat e-mel yang sah.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await complainantApi.requestCode(address)
      setSentMessage(result.message)
      setStep("code")
      setCode("")
      setResendIn(RESEND_AFTER_SECONDS)
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 422
          ? "Masukkan alamat e-mel yang sah."
          : errorMessage(err)
      )
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Kod log masuk mengandungi 6 digit.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await session.verify(email.trim(), code.trim())
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? err.message
          : errorMessage(err)
      )
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col gap-1">
        <span className="flex size-10 items-center justify-center rounded-full bg-status-menunggu-jmm text-primary">
          <MailIcon className="size-5" aria-hidden />
        </span>
        <h2 className="mt-2 text-lg font-semibold text-primary">
          Log masuk pengadu
        </h2>
        <p className="text-sm text-muted-foreground">
          {intro ??
            "Gunakan e-mel yang anda berikan semasa membuat aduan. Kami akan menghantar kod 6 digit ke e-mel tersebut."}
        </p>
      </div>

      {step === "email" ? (
        <form onSubmit={requestCode} noValidate className="flex flex-col gap-4">
          <FormField label="E-mel" required>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </FormField>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Meminta kod…" : "Hantar kod log masuk"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate className="flex flex-col gap-4">
          {sentMessage && <Notice tone="info">{sentMessage}</Notice>}
          <FormField
            label="Kod log masuk"
            required
            description={`Dihantar ke ${email.trim()}.`}
          >
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em]"
            />
          </FormField>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Mengesahkan…" : "Log masuk"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={() => {
                setStep("email")
                setError(null)
              }}
            >
              Tukar e-mel
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              disabled={busy || resendIn > 0}
              onClick={() => void requestCode()}
            >
              {resendIn > 0
                ? `Minta kod baharu (${resendIn}s)`
                : "Minta kod baharu"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Kod sah selama 10 minit. Kami tidak akan menghantar kod melalui SMS.
          </p>
        </form>
      )}
    </div>
  )
}
