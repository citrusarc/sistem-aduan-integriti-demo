"use client"

import * as React from "react"
import { SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { PUBLIC_STATUS_MEANING } from "@/components/portal/public-status"
import { StatusPill } from "@/components/ui/status-pill"
import { ApiRequestError, publicApi } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import type { PublicComplaint } from "@/types/entities"
import { COMPLAINT_STATUS, INTEGRITY_CATEGORY, labelFor } from "@/types/enums"

type Result =
  | { kind: "found"; complaint: PublicComplaint }
  | { kind: "not-found" }
  | { kind: "error"; message: string }

/**
 * Public lookup by reference number. Business rule 2: an NFA case is answered
 * by BE exactly like an unknown number, and this renders both the same way —
 * one message, no hint of why. A malformed number (400) gets that same message
 * too, so the three can't be told apart from the page.
 */
export function TrackLookup() {
  const [refNo, setRefNo] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<
    (Result & { asked: string }) | null
  >(null)

  async function lookup(event: React.FormEvent) {
    event.preventDefault()
    const asked = refNo.trim().toUpperCase()
    if (!asked) return
    setLoading(true)
    setResult(null)
    try {
      const complaint = await publicApi.trackComplaint(asked)
      setResult({ kind: "found", complaint, asked })
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 404 || err.status === 400)
      ) {
        setResult({ kind: "not-found", asked })
      } else {
        setResult({
          kind: "error",
          asked,
          message: errorMessage(err),
        })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={lookup}
        role="search"
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 sm:flex-row sm:items-end"
      >
        <FormField
          label="No. rujukan aduan"
          description="Seperti dalam e-mel pengesahan, cth. UI/2026/00012."
          className="flex-1"
        >
          <Input
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="UI/2026/00000"
            maxLength={64}
          />
        </FormField>
        <Button
          type="submit"
          size="lg"
          disabled={loading || !refNo.trim()}
          className="sm:mb-5"
        >
          <SearchIcon data-icon="inline-start" />
          {loading ? "Menyemak…" : "Semak status"}
        </Button>
      </form>

      <div aria-live="polite" data-testid="track-result">
        {result?.kind === "found" && (
          <section
            aria-label="Status aduan"
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">No. rujukan</p>
                <p className="text-lg font-semibold text-primary">
                  {result.complaint.complaintRefNo}
                </p>
              </div>
              <StatusPill status={result.complaint.status} />
            </div>
            <p className="text-sm">
              {PUBLIC_STATUS_MEANING[result.complaint.status] ??
                COMPLAINT_STATUS[result.complaint.status]}
            </p>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Tarikh aduan</dt>
                <dd>
                  <DateDisplay value={result.complaint.complaintDate} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Diterima</dt>
                <dd>
                  <DateDisplay value={result.complaint.receivedDateUi} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Kategori</dt>
                <dd>
                  {labelFor(
                    INTEGRITY_CATEGORY,
                    result.complaint.integrityCategory
                  )}
                </dd>
              </div>
            </dl>
          </section>
        )}
        {result?.kind === "not-found" && (
          <Notice tone="info">
            Tiada aduan dijumpai untuk no. rujukan{" "}
            <strong>{result.asked}</strong>. Semak semula nombor seperti dalam
            e-mel pengesahan anda.
          </Notice>
        )}
        {result?.kind === "error" && (
          <Notice tone="error">{result.message}</Notice>
        )}
      </div>
    </div>
  )
}
