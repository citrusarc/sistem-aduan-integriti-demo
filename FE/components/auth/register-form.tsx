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
import { meetsPasswordPolicy, register, verifyRegistration } from "@/lib/auth"
import { errorMessage } from "@/lib/errors"

/** Locally, BE prints outgoing email (and so every code) to its terminal. */
const LOCAL_DEV = process.env.NODE_ENV !== "production"

type Step =
  | { kind: "details" }
  | { kind: "captcha" }
  | { kind: "code"; verifyToken: string; sentTo: string; message: string }

/**
 * Registration — §8 decision 15, same password rules as sign-in (decision 14):
 *   name + email + password  ->  slider captcha  ->  6-digit code by email
 *   ->  signed in as PENGADU
 *
 * BE answers the same whether or not the address already has an account (the
 * owner is told by email instead), so this form never says so either: an
 * existing address simply never receives a code.
 */
export function RegisterForm() {
  const session = useSession()
  const router = useRouter()
  const next = useSearchParams().get("next")

  const [step, setStep] = React.useState<Step>({ kind: "details" })
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const user = session.status === "authenticated" ? session.user : null
  React.useEffect(() => {
    if (user) router.replace(destinationFor(user, next))
  }, [user, next, router])

  if (session.status === "loading" || user) {
    return <LoadingState label="Menyemak sesi…" />
  }

  function checkDetails(): string | null {
    if (fullName.trim().length < 2) return "Masukkan nama penuh anda."
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return "Masukkan alamat e-mel yang sah."
    }
    if (!meetsPasswordPolicy(password)) {
      return "Kata laluan belum memenuhi semua syarat."
    }
    if (password !== confirm) return "Kata laluan tidak sepadan."
    return null
  }

  async function onCaptchaSolved(captchaToken: string) {
    setBusy(true)
    setError(null)
    try {
      const result = await register({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        captchaToken,
      })
      setStep({ kind: "code", ...result })
    } catch (err) {
      setStep({ kind: "details" })
      setError(
        err instanceof ApiRequestError && [400, 422].includes(err.status)
          ? err.message
          : errorMessage(err)
      )
    } finally {
      setBusy(false)
    }
  }

  async function onCode(event: React.FormEvent, verifyToken: string) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code.trim()))
      return setError("Kod mengandungi 6 digit.")
    setBusy(true)
    setError(null)
    try {
      const signedIn = await verifyRegistration(verifyToken, code.trim())
      setPassword("")
      setConfirm("")
      session.signedIn(signedIn)
    } catch (err) {
      setBusy(false)
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? err.message
          : errorMessage(err)
      )
    }
  }

  if (step.kind === "code") {
    return (
      <form
        onSubmit={(e) => void onCode(e, step.verifyToken)}
        noValidate
        className="flex flex-col gap-4"
      >
        <Notice tone="info">{step.message}</Notice>
        <FormField
          label="Kod pengesahan"
          required
          description={`Dihantar ke ${step.sentTo}.`}
        >
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
          {busy ? "Mengesahkan…" : "Sahkan dan daftar"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Tiada kod? Semak folder spam. Jika e-mel ini sudah berdaftar, kami
          menghantar makluman ke e-mel itu dan bukan kod — log masuk atau guna{" "}
          <Link href="/lupa-kata-laluan" className="underline">
            Lupa kata laluan
          </Link>
          .
        </p>
        <Button
          type="button"
          variant="link"
          className="h-auto"
          onClick={() => {
            setStep({ kind: "details" })
            setCode("")
            setError(null)
          }}
        >
          Tukar butiran
        </Button>
      </form>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const problem = checkDetails()
        setError(problem)
        if (!problem) setStep({ kind: "captcha" })
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <FormField label="Nama penuh" required>
        <Input
          autoComplete="name"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value)
            setStep({ kind: "details" })
          }}
          autoFocus
        />
      </FormField>
      <FormField label="E-mel" required>
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setStep({ kind: "details" })
          }}
        />
      </FormField>
      <FormField label="Kata laluan" required>
        <PasswordInput
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setStep({ kind: "details" })
          }}
        />
      </FormField>
      <PasswordRequirements password={password} />
      <FormField label="Sahkan kata laluan" required>
        <PasswordInput
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value)
            setStep({ kind: "details" })
          }}
        />
      </FormField>
      {error && <Notice tone="error">{error}</Notice>}
      {step.kind === "captcha" ? (
        busy ? (
          <LoadingState label="Mendaftar…" />
        ) : (
          <SliderCaptcha onSolved={(token) => void onCaptchaSolved(token)} />
        )
      ) : (
        <Button type="submit" size="lg">
          Daftar
        </Button>
      )}
      <p className="text-center text-sm text-muted-foreground">
        Sudah ada akaun?{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Log masuk
        </Link>
      </p>
    </form>
  )
}
