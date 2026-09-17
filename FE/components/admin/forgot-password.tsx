"use client"

import * as React from "react"
import Link from "next/link"

import { SliderCaptcha } from "@/components/admin/slider-captcha"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  PasswordInput,
  PasswordRequirements,
} from "@/components/ui/password-input"
import { Notice } from "@/components/ui/section"
import { ApiRequestError } from "@/lib/api"
import {
  meetsPasswordPolicy,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth"
import { errorMessage } from "@/lib/errors"

/** Locally, BE prints outgoing email (and so every code) to its terminal. */
const LOCAL_DEV = process.env.NODE_ENV !== "production"

/**
 * "Lupa kata laluan" — §8 decision 14 (l): email + captcha -> 6-digit code by
 * email -> new password. BE answers an unknown email exactly like a known one,
 * so this page never says whether the account exists. A reset also lifts a
 * block from 5 failed passwords and signs out every session.
 */
export function ForgotPassword() {
  const [step, setStep] = React.useState<
    "email" | "captcha" | "reset" | "done"
  >("email")
  const [email, setEmail] = React.useState("")
  const [resetToken, setResetToken] = React.useState("")
  const [sentMessage, setSentMessage] = React.useState("")
  const [code, setCode] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function onCaptchaSolved(captchaToken: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await requestPasswordReset(email.trim(), captchaToken)
      setResetToken(result.resetToken)
      setSentMessage(result.message)
      setStep("reset")
    } catch (err) {
      setStep("email")
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onReset(event: React.FormEvent) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) return setError("Kod mengandungi 6 digit.")
    if (!meetsPasswordPolicy(password)) {
      return setError("Kata laluan baharu belum memenuhi semua syarat.")
    }
    if (password !== confirm) return setError("Kata laluan tidak sepadan.")
    setBusy(true)
    setError(null)
    try {
      await resetPassword(resetToken, code, password)
      setStep("done")
    } catch (err) {
      setError(
        err instanceof ApiRequestError && [401, 422].includes(err.status)
          ? err.message
          : errorMessage(err)
      )
    } finally {
      setBusy(false)
    }
  }

  const header = (
    <div className="mb-6 flex flex-col gap-1">
      <p className="text-xs font-semibold tracking-wider text-accent uppercase">
        Unit Integriti
      </p>
      <h1 className="text-xl font-semibold text-primary">Lupa kata laluan</h1>
      <p className="text-sm text-muted-foreground">
        {step === "done"
          ? "Kata laluan anda telah ditetapkan semula."
          : "Tetapkan kata laluan baharu dengan kod yang dihantar ke e-mel akaun kakitangan anda."}
      </p>
    </div>
  )

  if (step === "done") {
    return (
      <>
        {header}
        <div className="flex flex-col gap-4">
          <Notice tone="success">
            Semua sesi akaun ini telah dilog keluar, dan sekatan (jika ada)
            telah dibuka. Log masuk dengan kata laluan baharu.
          </Notice>
          <Link href="/login" className={buttonVariants({ size: "lg" })}>
            Ke halaman log masuk
          </Link>
        </div>
      </>
    )
  }

  if (step === "reset") {
    return (
      <>
        {header}
        <form onSubmit={onReset} noValidate className="flex flex-col gap-4">
          <Notice tone="info">{sentMessage}</Notice>
          {LOCAL_DEV && (
            <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Pembangunan tempatan:
              </span>{" "}
              tiada e-mel sebenar dihantar. Kod dicetak di terminal BE.
            </p>
          )}
          <FormField label="Kod 6 digit" required>
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
          <FormField label="Kata laluan baharu" required>
            <PasswordInput
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <PasswordRequirements password={password} />
          <FormField label="Sahkan kata laluan baharu" required>
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </FormField>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? "Menyimpan…" : "Tetapkan kata laluan baharu"}
          </Button>
          <Button
            type="button"
            variant="link"
            className="h-auto"
            onClick={() => {
              setStep("email")
              setCode("")
              setError(null)
            }}
          >
            Minta kod baharu
          </Button>
        </form>
      </>
    )
  }

  return (
    <>
      {header}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return setError("Masukkan alamat e-mel yang sah.")
          }
          setError(null)
          setStep("captcha")
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField label="E-mel akaun kakitangan" required>
          <Input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (step === "captcha") setStep("email")
            }}
            autoFocus
          />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
        {step === "captcha" ? (
          busy ? (
            <p className="text-sm text-muted-foreground">Menghantar kod…</p>
          ) : (
            <SliderCaptcha onSolved={(t) => void onCaptchaSolved(t)} />
          )
        ) : (
          <Button type="submit" size="lg">
            Hantar kod
          </Button>
        )}
        <Link
          href="/login"
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Kembali ke log masuk
        </Link>
      </form>
    </>
  )
}
