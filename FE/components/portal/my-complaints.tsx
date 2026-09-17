"use client"

import Link from "next/link"
import { ChevronRightIcon, ShieldCheckIcon } from "lucide-react"

import {
  PROTECTION_STATUS_TEXT,
  PUBLIC_STATUS_MEANING,
} from "@/components/portal/public-status"
import { RequireComplainant } from "@/components/portal/complainant-login"
import { useComplainantSession } from "@/components/providers/complainant-session"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StatusPill } from "@/components/ui/status-pill"
import { useApiData } from "@/hooks/use-api-data"
import { complainantApi } from "@/lib/api"
import { refToSlug } from "@/lib/ref-slug"
import type { ComplainantProtectionRequest } from "@/types/entities"
import { INTEGRITY_CATEGORY, labelFor } from "@/types/enums"

export function MyComplaintsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Aduan Saya"
        description="Status aduan yang dikaitkan dengan e-mel anda."
      />
      <RequireComplainant>
        <MyComplaints />
      </RequireComplainant>
    </div>
  )
}

/** The newest request per complaint — what "its protection status" means. */
export function latestRequestByRef(requests: ComplainantProtectionRequest[]) {
  const map = new Map<string, ComplainantProtectionRequest>()
  for (const r of requests) {
    const seen = map.get(r.complaintRefNo)
    if (!seen || r.createdAt > seen.createdAt) map.set(r.complaintRefNo, r)
  }
  return map
}

/**
 * Only complaints whose complainant record carries this session's email, and
 * only disclosable ones (rule 2) — BE decides both; this lists what it returns.
 */
function MyComplaints() {
  const session = useComplainantSession()
  const email = session.status === "authenticated" ? session.session.email : ""
  const complaints = useApiData(`me:complaints:${email}`, () =>
    complainantApi.complaints()
  )
  const requests = useApiData(`me:protection:${email}`, () =>
    complainantApi.protectionRequests()
  )

  const latest = latestRequestByRef(requests.data ?? [])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 surface-card border-border/70 bg-card px-4 py-3">
        <p className="text-sm">
          Log masuk sebagai <strong>{email}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/submit/protection"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Mohon perlindungan
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void session.logout()}
          >
            Log keluar
          </Button>
        </div>
      </div>

      {complaints.status === "error" ? (
        <ErrorState
          error={complaints.error}
          onRetry={() => void complaints.reload()}
        />
      ) : !complaints.data ? (
        <LoadingState />
      ) : complaints.data.length === 0 ? (
        <EmptyState
          title="Tiada aduan untuk dipaparkan"
          description="Tiada aduan yang boleh dipaparkan untuk e-mel ini."
        />
      ) : (
        <ul aria-label="Senarai aduan saya" className="flex flex-col gap-3">
          {complaints.data.map((c) => {
            const request = latest.get(c.complaintRefNo)
            return (
              <li key={c.complaintRefNo}>
                <Link
                  href={`/me/complaints/${refToSlug(c.complaintRefNo)}`}
                  className="group flex surface-card-interactive items-center gap-4 surface-card border-border/70 bg-card p-4 hover:border-primary/30 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-primary">
                        {c.complaintRefNo}
                      </span>
                      <StatusPill status={c.status} />
                      {request && (
                        <Badge
                          tone={
                            request.status === "DITERIMA" ? "accent" : "neutral"
                          }
                        >
                          <ShieldCheckIcon aria-hidden />
                          Perlindungan: {PROTECTION_STATUS_TEXT[request.status]}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {PUBLIC_STATUS_MEANING[c.status]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {labelFor(INTEGRITY_CATEGORY, c.integrityCategory)} ·
                      Diterima{" "}
                      <DateDisplay
                        value={c.receivedDateUi ?? c.complaintDate}
                      />
                    </p>
                  </div>
                  <ChevronRightIcon
                    className="size-5 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
