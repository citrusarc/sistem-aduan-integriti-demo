"use client"

import * as React from "react"
import Link from "next/link"
import { UsersIcon } from "lucide-react"

import { useStaffSession } from "@/components/providers/staff-session"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { DetailList, Notice, Section } from "@/components/ui/section"
import { ApiRequestError } from "@/lib/api"
import { changePassword, meetsPasswordPolicy } from "@/lib/auth"
import {
  PasswordInput,
  PasswordRequirements,
} from "@/components/ui/password-input"
import { errorMessage } from "@/lib/errors"
import { STAFF_ROLE } from "@/types/enums"

export function AccountSettings() {
  const session = useStaffSession()
  const staff = session.status === "authenticated" ? session.staff : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tetapan Akaun"
        description="Maklumat akaun dan kata laluan anda."
      />

      {staff && (
        <Section title="Akaun">
          <DetailList
            items={[
              { label: "Nama", value: staff.fullName },
              { label: "E-mel", value: staff.email },
              { label: "Peranan", value: STAFF_ROLE[staff.role] },
            ]}
          />
        </Section>
      )}

      <Section
        title="Tukar kata laluan"
        description="Kata laluan luput selepas tempoh yang ditetapkan oleh ADMIN (asal 180 hari). Sesi anda di peranti lain akan dilog keluar."
      >
        <PasswordForm />
      </Section>

      {staff?.role === "ADMIN" && (
        <Section
          title="Pengurusan staf"
          description="Cipta akaun, tetapkan peranan, set semula kata laluan dan nyahaktif akaun."
        >
          <Link
            href="/settings/staff"
            className="inline-flex w-fit items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
          >
            <UsersIcon className="size-4" aria-hidden />
            Buka pengurusan staf
          </Link>
        </Section>
      )}
    </div>
  )
}

function PasswordForm() {
  const [current, setCurrent] = React.useState("")
  const [next, setNext] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState<{
    tone: "error" | "success"
    text: string
  } | null>(null)

  const mismatch = confirm.length > 0 && confirm !== next

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!current || !meetsPasswordPolicy(next) || next !== confirm) {
      setMessage({
        tone: "error",
        text: !meetsPasswordPolicy(next)
          ? "Kata laluan baharu belum memenuhi semua syarat."
          : "Lengkapkan semua medan dengan betul.",
      })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await changePassword(current, next)
      setCurrent("")
      setNext("")
      setConfirm("")
      setMessage({
        tone: "success",
        text: "Kata laluan ditukar. Sesi lain telah dilog keluar.",
      })
    } catch (err) {
      setMessage({
        tone: "error",
        // 401 here is a wrong current password (BE's own message), not an
        // expired session — lib/api.ts doesn't sign the user out for it either.
        text:
          err instanceof ApiRequestError && err.status === 401
            ? err.message
            : errorMessage(err),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} noValidate className="flex max-w-md flex-col gap-4">
      <FormField label="Kata laluan semasa" required>
        <PasswordInput
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </FormField>
      <FormField label="Kata laluan baharu" required>
        <PasswordInput
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </FormField>
      <PasswordRequirements password={next} />
      <FormField
        label="Sahkan kata laluan baharu"
        required
        error={mismatch ? "Kata laluan tidak sepadan" : null}
      >
        <PasswordInput
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </FormField>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Button type="submit" className="w-fit" disabled={saving}>
        {saving ? "Menyimpan…" : "Tukar kata laluan"}
      </Button>
    </form>
  )
}
