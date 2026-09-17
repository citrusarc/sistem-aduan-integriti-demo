"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CheckCircle2Icon } from "lucide-react"

import { latestRequestByRef } from "@/components/portal/my-complaints"
import { RequireComplainant } from "@/components/portal/complainant-login"
import { useComplainantSession } from "@/components/providers/complainant-session"
import { Button, buttonVariants } from "@/components/ui/button"
import { FieldControl, FormField } from "@/components/ui/field"
import { Textarea } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { useApiData } from "@/hooks/use-api-data"
import { ApiRequestError, complainantApi } from "@/lib/api"
import { refToSlug, slugToRef } from "@/lib/ref-slug"
import { errorMessage } from "@/lib/errors"
import { COMPLAINT_STATUS } from "@/types/enums"

const MIN_REASON = 10
const MAX_REASON = 5000

export function ProtectionRequestPage() {
  return (
    <RequireComplainant intro="Permohonan perlindungan dibuat untuk aduan anda sendiri. Log masuk dengan e-mel yang digunakan semasa membuat aduan.">
      <ProtectionRequestForm />
    </RequireComplainant>
  )
}

/**
 * §8 decision 6 — a signed-in complainant files for one of their own
 * disclosable complaints. The picker only offers what BE listed as theirs; BE
 * checks ownership again (404) and refuses a second pending request (409).
 */
function ProtectionRequestForm() {
  const session = useComplainantSession()
  const email = session.status === "authenticated" ? session.session.email : ""
  const preselect = slugToRef(useSearchParams().get("aduan") ?? "")
  const complaints = useApiData(`me:complaints:${email}`, () =>
    complainantApi.complaints()
  )
  const requests = useApiData(`me:protection:${email}`, () =>
    complainantApi.protectionRequests()
  )

  const [picked, setPicked] = React.useState<string | null>(null)
  const [reason, setReason] = React.useState("")
  const [touched, setTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)

  if (complaints.status === "error") {
    return (
      <ErrorState
        error={complaints.error}
        onRetry={() => void complaints.reload()}
      />
    )
  }
  if (requests.status === "error") {
    return (
      <ErrorState
        error={requests.error}
        onRetry={() => void requests.reload()}
      />
    )
  }
  if (!complaints.data || !requests.data) return <LoadingState />

  const latest = latestRequestByRef(requests.data)
  const pendingRefs = new Set(
    requests.data
      .filter((r) => r.status === "DITERIMA")
      .map((r) => r.complaintRefNo)
  )
  const available = complaints.data.filter(
    (c) => !pendingRefs.has(c.complaintRefNo)
  )
  // A ?aduan= that isn't one of theirs (or already pending) is simply not preselected.
  const selected =
    picked ??
    (preselect && available.some((c) => c.complaintRefNo === preselect)
      ? preselect
      : null)

  if (done) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center">
        <CheckCircle2Icon
          className="size-10 text-status-selesai-foreground"
          aria-hidden
        />
        <h2 className="text-xl font-semibold text-primary">
          Permohonan diterima
        </h2>
        <p className="max-w-md text-sm">
          Permohonan perlindungan untuk <strong>{done}</strong> akan disemak
          oleh Ketua Unit Integriti. Semak statusnya di halaman aduan anda.
        </p>
        <Link
          href={`/me/complaints/${refToSlug(done)}`}
          className={buttonVariants()}
        >
          Lihat aduan
        </Link>
      </section>
    )
  }

  if (complaints.data.length === 0) {
    return (
      <EmptyState
        title="Tiada aduan untuk dipilih"
        description="Tiada aduan yang boleh dipaparkan untuk e-mel ini."
      />
    )
  }

  const reasonError =
    touched && reason.trim().length < MIN_REASON
      ? `Nyatakan sebab (sekurang-kurangnya ${MIN_REASON} aksara)`
      : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (!selected) {
      setError("Pilih aduan.")
      return
    }
    if (reason.trim().length < MIN_REASON) return
    setSaving(true)
    setError(null)
    try {
      await complainantApi.createProtectionRequest({
        complaintRefNo: selected,
        reason: reason.trim(),
      })
      setDone(selected)
      await requests.reload()
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError("Aduan ini sudah mempunyai permohonan yang sedang disemak.")
        void requests.reload()
      } else if (err instanceof ApiRequestError && err.status === 404) {
        setError("Aduan tidak dijumpai dalam senarai aduan anda.")
      } else if (err instanceof ApiRequestError && err.status === 422) {
        setError(err.message)
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-5"
    >
      <p className="text-sm text-muted-foreground">
        Log masuk sebagai <strong className="text-foreground">{email}</strong>.
        Hanya aduan anda sendiri disenaraikan.
      </p>
      <FormField
        label="Aduan"
        required
        description={
          pendingRefs.size > 0
            ? "Aduan yang sudah mempunyai permohonan sedang disemak tidak disenaraikan."
            : undefined
        }
      >
        <Select
          options={available.map((c) => {
            const last = latest.get(c.complaintRefNo)
            return {
              value: c.complaintRefNo,
              label: `${c.complaintRefNo} — ${COMPLAINT_STATUS[c.status]}${last ? " (pernah dimohon)" : ""}`,
            }
          })}
          value={selected}
          onValueChange={(v) => {
            setPicked(v)
            setError(null)
          }}
          placeholder={
            available.length
              ? "Pilih aduan…"
              : "Semua aduan sudah mempunyai permohonan"
          }
          disabled={available.length === 0}
        />
      </FormField>
      <FormField
        label="Sebab memohon perlindungan"
        required
        error={reasonError}
        description="Terangkan kebimbangan anda, contohnya risiko tindakan balas di tempat kerja."
      >
        <FieldControl
          render={
            <Textarea
              rows={6}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          }
        />
      </FormField>
      <Notice tone="info">
        Permohonan disemak oleh Ketua Unit Integriti. Keputusan dipaparkan di
        halaman aduan anda dan tidak dihantar melalui e-mel.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href="/me"
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          Batal
        </Link>
        <Button
          type="submit"
          size="lg"
          disabled={saving || available.length === 0}
        >
          {saving ? "Menghantar…" : "Hantar permohonan"}
        </Button>
      </div>
    </form>
  )
}
