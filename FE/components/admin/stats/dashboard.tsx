"use client"

import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"

import { DateDisplay } from "@/components/ui/date-display"
import { PageHeader } from "@/components/ui/page-header"
import { Section } from "@/components/ui/section"
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
import { adminApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  COMPLAINT_STATUS,
  INTEGRITY_CATEGORY,
  labelFor,
  type ComplaintStatus,
} from "@/types/enums"

const nf = new Intl.NumberFormat("ms-MY")

const STATUS_ACCENT: Record<ComplaintStatus, string> = {
  BARU: "bg-status-baru-foreground",
  MENUNGGU_JMM: "bg-status-menunggu-jmm-foreground",
  DALAM_TINDAKAN: "bg-status-dalam-tindakan-foreground",
  SELESAI: "bg-status-selesai-foreground",
  NFA: "bg-status-nfa-foreground",
}

/**
 * Counts by stored status (§4, reliable for reporting) and the most recently
 * received cases. Status is current state, so the counts are all-time; period
 * breakdowns live in Laporan.
 */
export function Dashboard() {
  const stats = useApiData("stats:all", () => adminApi.stats.get())
  const recent = useApiData("complaints:recent", () =>
    adminApi.complaints.list({ limit: 8 })
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Papan Pemuka"
        description="Kedudukan semasa aduan Unit Integriti."
        actions={
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            Laporan terperinci
            <ArrowRightIcon className="size-4" aria-hidden />
          </Link>
        }
      />

      {stats.status === "error" ? (
        <ErrorState error={stats.error} onRetry={() => void stats.reload()} />
      ) : !stats.data ? (
        <LoadingState />
      ) : (
        <section
          aria-label="Bilangan aduan mengikut status"
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
        >
          <div className="flex flex-col justify-between gap-2 rounded-xl border border-border bg-primary p-4 text-primary-foreground sm:col-span-3 lg:col-span-1">
            <p className="text-sm text-primary-foreground/80">Jumlah aduan</p>
            <p className="text-5xl font-semibold tracking-tight">
              {nf.format(stats.data.total)}
            </p>
          </div>
          {stats.data.byStatus.map((b) =>
            b.value ? (
              <Link
                key={b.value}
                href={`/complaints?status=${b.value}`}
                className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
              >
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      STATUS_ACCENT[b.value]
                    )}
                  />
                  {COMPLAINT_STATUS[b.value]}
                </span>
                <span className="text-3xl font-semibold text-foreground">
                  {nf.format(b.count)}
                </span>
                <span className="text-xs text-muted-foreground group-hover:text-primary">
                  Lihat senarai
                </span>
              </Link>
            ) : null
          )}
        </section>
      )}

      <Section
        title="Aduan terkini"
        description="Mengikut tarikh terima di UI."
        actions={
          <Link
            href="/complaints"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Daftar aduan
          </Link>
        }
      >
        {recent.status === "error" ? (
          <ErrorState
            error={recent.error}
            onRetry={() => void recent.reload()}
          />
        ) : !recent.data ? (
          <LoadingState />
        ) : recent.data.length === 0 ? (
          <EmptyState title="Belum ada aduan" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. rujukan</TableHead>
                <TableHead>Diterima</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Penama</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link
                      href={`/complaints/${c.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {c.complaintRefNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DateDisplay value={c.receivedDateUi ?? c.complaintDate} />
                  </TableCell>
                  <TableCell>
                    {labelFor(INTEGRITY_CATEGORY, c.integrityCategory)}
                  </TableCell>
                  <TableCell className="max-w-56 truncate">
                    {c.accusedParticulars ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={c.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
