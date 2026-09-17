"use client"

import Link from "next/link"
import { ShieldCheckIcon } from "lucide-react"

import { RequireComplainant } from "@/components/portal/complainant-login"
import {
  PROTECTION_STATUS_TEXT,
  PUBLIC_STATUS_MEANING,
} from "@/components/portal/public-status"
import { useComplainantSession } from "@/components/providers/complainant-session"
import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { DetailList, Notice, Section } from "@/components/ui/section"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { StatusPill } from "@/components/ui/status-pill"
import { useApiData } from "@/hooks/use-api-data"
import { ApiRequestError, complainantApi } from "@/lib/api"
import { refToSlug } from "@/lib/ref-slug"
import { INTEGRITY_CATEGORY, labelFor } from "@/types/enums"

/** One message for a malformed number, someone else's complaint, NFA, and missing. */
function NotFound() {
  return (
    <Notice tone="info">
      Aduan tidak dijumpai dalam senarai aduan anda.{" "}
      <Link
        href="/me"
        className="text-primary underline-offset-4 hover:underline"
      >
        Lihat semua aduan saya
      </Link>
      .
    </Notice>
  )
}

export function MyComplaintDetailPage({ refNo }: { refNo: string | null }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <BackLink href="/me">Aduan saya</BackLink>
      <RequireComplainant>
        {refNo ? <Detail refNo={refNo} /> : <NotFound />}
      </RequireComplainant>
    </div>
  )
}

/**
 * The public-safe shape only (toPublicComplaint): reference number, dates,
 * category, status. BE answers anything not this complainant's — including
 * NFA — with the same 404, and this page shows that the same way.
 */
function Detail({ refNo }: { refNo: string }) {
  const session = useComplainantSession()
  const email = session.status === "authenticated" ? session.session.email : ""
  const complaint = useApiData(`me:complaint:${email}:${refNo}`, () =>
    complainantApi.complaint(refNo)
  )
  const requests = useApiData(`me:protection:${email}`, () =>
    complainantApi.protectionRequests()
  )

  if (complaint.status === "error") {
    const err = complaint.error
    if (
      err instanceof ApiRequestError &&
      (err.status === 404 || err.status === 400)
    ) {
      return <NotFound />
    }
    return <ErrorState error={err} onRetry={() => void complaint.reload()} />
  }
  if (!complaint.data) return <LoadingState />

  const c = complaint.data
  const mine = (requests.data ?? [])
    .filter((r) => r.complaintRefNo === c.complaintRefNo)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const pending = mine.some((r) => r.status === "DITERIMA")

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">No. rujukan aduan</p>
        <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold text-primary">
          {c.complaintRefNo}
          <StatusPill status={c.status} />
        </h1>
        <p className="text-sm">{PUBLIC_STATUS_MEANING[c.status]}</p>
      </header>

      <Section title="Butiran">
        <DetailList
          items={[
            {
              label: "Tarikh aduan",
              value: c.complaintDate && <DateDisplay value={c.complaintDate} />,
            },
            {
              label: "Diterima oleh Unit Integriti",
              value: c.receivedDateUi && (
                <DateDisplay value={c.receivedDateUi} />
              ),
            },
            {
              label: "Kategori",
              value:
                c.integrityCategory &&
                labelFor(INTEGRITY_CATEGORY, c.integrityCategory),
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Butiran siasatan dan keputusan dalaman tidak dipaparkan di portal.
        </p>
      </Section>

      <Section
        title="Permohonan perlindungan"
        actions={
          !pending ? (
            <Link
              href={`/submit/protection?aduan=${refToSlug(c.complaintRefNo)}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ShieldCheckIcon data-icon="inline-start" />
              Mohon perlindungan
            </Link>
          ) : undefined
        }
      >
        {requests.status === "error" ? (
          <ErrorState
            error={requests.error}
            onRetry={() => void requests.reload()}
          />
        ) : !requests.data ? (
          <LoadingState />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tiada permohonan perlindungan untuk aduan ini.
          </p>
        ) : (
          <ul
            aria-label="Permohonan perlindungan"
            className="flex flex-col gap-3"
          >
            {mine.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    tone={
                      r.status === "DITERIMA"
                        ? "accent"
                        : r.status === "DILULUSKAN"
                          ? "calm"
                          : "neutral"
                    }
                  >
                    {PROTECTION_STATUS_TEXT[r.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Dihantar <DateDisplay value={r.createdAt} kind="datetime" />
                    {r.reviewedAt && (
                      <>
                        {" · "}Disemak{" "}
                        <DateDisplay value={r.reviewedAt} kind="datetime" />
                      </>
                    )}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-line">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}
        {pending && (
          <p className="text-xs text-muted-foreground">
            Satu permohonan sedang disemak. Keputusan dipaparkan di sini; ia
            tidak dihantar melalui e-mel.
          </p>
        )}
      </Section>
    </div>
  )
}
