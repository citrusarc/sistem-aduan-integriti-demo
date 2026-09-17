"use client"

import * as React from "react"
import { MailIcon } from "lucide-react"

import { useComplainantSession } from "@/components/providers/complainant-session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Notice } from "@/components/ui/section"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { ApiRequestError, complainantApi } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import { cn } from "@/lib/utils"

/** Matches BE's OTP_COOLDOWN_SECONDS default; a code asked for sooner is silently not sent. */
const RESEND_AFTER_SECONDS = 60

/** Locally, BE prints outgoing email (and so every code) to its terminal. */
const LOCAL_DEV = process.env.NODE_ENV !== "production"

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
 * §8 decisions 4 and 13 — email OTP only, with two ways in:
 *
 *   Log masuk  email -> code. BE answers every request with the same message
 *              whether or not the address is registered or has complaints
 *              (or is throttled), so this form can't reveal who has an account.
 *   Daftar     name + email -> code. Entering the code creates the account and
 *              signs in; afterwards the address can log in with no complaint.
 *
 * Every bad code gets BE's single 401 message.
 */
export function ComplainantLogin({ intro }: { intro?: React.ReactNode }) {
  const session = useComplainantSession()
  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [step, setStep] = React.useState<"details" | "code">("details")
  const [fullName, setFullName] = React.useState("")
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

  function switchMode(next: "login" | "register") {
    setMode(next)
    setStep("details")
    setError(null)
    setCode("")
  }

  async function requestCode(event?: React.FormEvent) {
    event?.preventDefault()
    const address = email.trim()
    if (mode === "register" && fullName.trim().length < 2) {
      setError("Masukkan nama penuh anda.")
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Masukkan alamat e-mel yang sah.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result =
        mode === "register"
          ? await complainantApi.register(address, fullName.trim())
          : await complainantApi.requestCode(address)
      setSentMessage(result.message)
      setStep("code")
      setCode("")
      setResendIn(RESEND_AFTER_SECONDS)
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 422
          ? mode === "register"
            ? "Semak nama dan alamat e-mel anda."
            : "Masukkan alamat e-mel yang sah."
          : errorMessage(err)
      )
    } finally {
      setBusy(false)
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Kod mengandungi 6 digit.")
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

  const registering = mode === "register"

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 surface-card border-border/70 bg-card p-6">
      <div className="flex flex-col gap-1">
        <span className="flex size-10 items-center justify-center rounded-full bg-status-menunggu-jmm text-primary">
          <MailIcon className="size-5" aria-hidden />
        </span>
        <h2 className="mt-2 text-lg font-semibold text-primary">
          {registering ? "Daftar akaun pengadu" : "Log masuk pengadu"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {registering
            ? "Daftar dengan nama dan e-mel. Kami akan menghantar kod 6 digit untuk mengesahkan e-mel anda."
            : (intro ??
              "Masukkan e-mel akaun anda, atau e-mel yang anda berikan semasa membuat aduan. Kami akan menghantar kod 6 digit.")}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Log masuk atau daftar"
        className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
      >
        {(
          [
            ["login", "Log masuk"],
            ["register", "Daftar"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              mode === value && "bg-card text-foreground shadow-sm"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {step === "details" ? (
        <form onSubmit={requestCode} noValidate className="flex flex-col gap-4">
          {registering && (
            <FormField label="Nama penuh" required>
              <Input
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoFocus
              />
            </FormField>
          )}
          <FormField label="E-mel" required>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={!registering}
            />
          </FormField>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy
              ? "Meminta kod…"
              : registering
                ? "Daftar dan hantar kod"
                : "Hantar kod log masuk"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {registering ? "Sudah ada akaun? " : "Belum ada akaun? "}
            <button
              type="button"
              onClick={() => switchMode(registering ? "login" : "register")}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {registering ? "Log masuk" : "Daftar"}
            </button>
          </p>
        </form>
      ) : (
        <form onSubmit={verify} noValidate className="flex flex-col gap-4">
          {sentMessage && <Notice tone="info">{sentMessage}</Notice>}
          <FormField
            label={registering ? "Kod pengesahan" : "Kod log masuk"}
            required
            description={`Dihantar ke ${email.trim()}.`}
          >
            <PasswordInput
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
          {LOCAL_DEV && (
            <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Pembangunan tempatan:
              </span>{" "}
              tiada e-mel sebenar dihantar. Kod dicetak di terminal BE (
              <code>npm run dev</code> dalam <code>BE/</code>).
            </p>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy
              ? "Mengesahkan…"
              : registering
                ? "Sahkan dan daftar"
                : "Log masuk"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={() => {
                setStep("details")
                setError(null)
              }}
            >
              {registering ? "Tukar butiran" : "Tukar e-mel"}
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
