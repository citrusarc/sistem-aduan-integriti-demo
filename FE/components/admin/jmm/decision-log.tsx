"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { JmmOutcomeSelect } from "@/components/ui/enum-select"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import {
  pageFromParam,
  pageQuery,
  Pagination,
  splitPage,
} from "@/components/ui/pagination"
import { Select } from "@/components/ui/select"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiData } from "@/hooks/use-api-data"
import { useSearchParamsUpdater } from "@/hooks/use-search-params-updater"
import { adminApi } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { JMM_OUTCOME, type JmmOutcome } from "@/types/enums"
import type { DecisionLogFilters } from "@/types/requests"

const PAGE_SIZE = 25
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function DecisionLog() {
  const searchParams = useSearchParams()
  const setParams = useSearchParamsUpdater()

  const outcomeParam = searchParams.get("keputusan")
  const outcome =
    outcomeParam && outcomeParam in JMM_OUTCOME
      ? (outcomeParam as JmmOutcome)
      : undefined
  const date = (v: string | null) => (v && DATE.test(v) ? v : undefined)
  const from = date(searchParams.get("dari"))
  const to = date(searchParams.get("hingga"))
  const meetingParam = searchParams.get("mesyuarat")
  const meetingId =
    meetingParam && /^\d+$/.test(meetingParam) ? meetingParam : undefined
  const page = pageFromParam(searchParams.get("halaman"))
  const inverted = Boolean(from && to && from > to)

  const filters: DecisionLogFilters = { outcome, from, to, meetingId }
  const query = { ...filters, ...pageQuery(page, PAGE_SIZE) }
  const log = useApiData(inverted ? null : JSON.stringify(query), () =>
    adminApi.decisions.log(query)
  )
  const meetings = useApiData("meetings:all", () =>
    adminApi.meetings.list({ limit: 200 })
  )

  const active = [outcome, from, to, meetingId].filter(Boolean).length
  const rows = log.data ? splitPage(log.data, PAGE_SIZE) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Log Keputusan"
        description="Semua keputusan JMM yang direkod, termasuk NFA. Maklumat dalaman Unit Integriti."
      />

      <div
        role="search"
        aria-label="Tapis keputusan"
        className="grid gap-3 surface-card border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <FormField label="Keputusan">
          <JmmOutcomeSelect
            value={outcome ?? null}
            onValueChange={(v) => setParams({ keputusan: v })}
            nullLabel="Semua keputusan"
            placeholder="Semua keputusan"
          />
        </FormField>
        <FormField label="Mesyuarat">
          <Select
            options={(meetings.data ?? []).map((m) => ({
              value: m.id,
              label: `${m.meetingNo} (${formatDate(m.meetingDate)})`,
            }))}
            value={meetingId ?? null}
            onValueChange={(v) => setParams({ mesyuarat: v })}
            nullLabel="Semua mesyuarat"
            placeholder={meetings.data ? "Semua mesyuarat" : "Memuatkan…"}
            disabled={!meetings.data}
          />
        </FormField>
        <FormField label="Tarikh keputusan dari">
          <Input
            type="date"
            value={from ?? ""}
            max={to}
            onChange={(e) => setParams({ dari: e.target.value || null })}
          />
        </FormField>
        <FormField
          label="Hingga"
          error={inverted ? "Tarikh akhir mesti selepas tarikh mula" : null}
        >
          <Input
            type="date"
            value={to ?? ""}
            min={from}
            onChange={(e) => setParams({ hingga: e.target.value || null })}
          />
        </FormField>
        {active > 0 && (
          <div className="flex justify-end sm:col-span-2 lg:col-span-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams({
                  keputusan: null,
                  mesyuarat: null,
                  dari: null,
                  hingga: null,
                })
              }
            >
              Kosongkan penapis
            </Button>
          </div>
        )}
      </div>

      {inverted ? null : log.status === "error" ? (
        <ErrorState error={log.error} onRetry={() => void log.reload()} />
      ) : !rows ? (
        <LoadingState />
      ) : rows.items.length === 0 ? (
        <EmptyState title="Tiada keputusan dijumpai" />
      ) : (
        <div
          className="flex flex-col gap-3"
          aria-busy={log.status === "loading"}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarikh</TableHead>
                <TableHead>No. rujukan</TableHead>
                <TableHead>Keputusan</TableHead>
                <TableHead>Mesyuarat</TableHead>
                <TableHead>Tandatangan</TableHead>
                <TableHead>Status aduan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.items.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <DateDisplay value={d.decisionDate} />
                  </TableCell>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link
                      href={`/complaints/${d.complaintId}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {d.complaintRefNo}
                    </Link>
                  </TableCell>
                  <TableCell>{JMM_OUTCOME[d.outcome]}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {d.meetingId ? (
                      <Link
                        href={`/jmm/${d.meetingId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {d.meetingNo}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={d.finalized ? "calm" : "accent"}>
                      {d.finalized ? "Muktamad" : "Belum muktamad"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusPill status={d.complaintStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            hasNextPage={rows.hasNextPage}
            onPageChange={(p) =>
              setParams({ halaman: p > 1 ? String(p) : null })
            }
          />
        </div>
      )}
    </div>
  )
}
