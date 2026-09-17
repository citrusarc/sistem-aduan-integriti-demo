"use client"

import { useSearchParams } from "next/navigation"

import {
  bucketsToBars,
  monthsToColumns,
} from "@/components/admin/stats/buckets"
import { ColumnChart, HorizontalBarChart } from "@/components/ui/bar-chart"
import { FormField } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Section } from "@/components/ui/section"
import { Select } from "@/components/ui/select"
import { ErrorState, LoadingState } from "@/components/ui/states"
import { useApiData } from "@/hooks/use-api-data"
import { useSearchParamsUpdater } from "@/hooks/use-search-params-updater"
import { adminApi } from "@/lib/api"
import { todayIso } from "@/lib/format"
import {
  COMPLAINT_STATUS,
  INTEGRITY_CATEGORY,
  SECTOR,
  SOURCE_CHANNEL,
} from "@/types/enums"

const MONTH_NAMES = new Intl.DateTimeFormat("ms-MY", {
  month: "long",
  timeZone: "UTC",
})
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: MONTH_NAMES.format(new Date(Date.UTC(2026, i, 1))),
}))

const nf = new Intl.NumberFormat("ms-MY")

/**
 * Breakdowns from GET /admin/stats. The period is a complaint's received date
 * (else complaint date, else registration day) — the same date the register's
 * period filter uses, so a bar here and its list there agree.
 */
export function Reports() {
  const searchParams = useSearchParams()
  const setParams = useSearchParamsUpdater()

  const currentYear = Number(todayIso().slice(0, 4))
  const yearOptions = Array.from({ length: 6 }, (_, i) =>
    String(currentYear - i)
  )
  const yearParam = searchParams.get("tahun")
  const year = yearParam && yearOptions.includes(yearParam) ? yearParam : null
  const monthParam = searchParams.get("bulan")
  const month =
    year && monthParam && /^(?:[1-9]|1[0-2])$/.test(monthParam)
      ? monthParam
      : null

  const filters = {
    year: year ? Number(year) : undefined,
    month: month ? Number(month) : undefined,
  }
  const stats = useApiData(JSON.stringify(filters), () =>
    adminApi.stats.get(filters)
  )

  const period = year
    ? month
      ? `${MONTH_OPTIONS[Number(month) - 1]!.label} ${year}`
      : `Tahun ${year}`
    : "Semua tempoh"

  const data = stats.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Laporan"
        description="Pecahan aduan mengikut status, kategori, sektor, saluran dan bulan terima."
      />

      <div
        role="search"
        aria-label="Tempoh laporan"
        className="flex flex-wrap items-end gap-3 surface-card border-border/70 bg-card p-4"
      >
        <FormField label="Tahun" className="w-44">
          <Select
            options={yearOptions.map((y) => ({ value: y, label: y }))}
            value={year}
            onValueChange={(v) =>
              setParams({ tahun: v, bulan: v ? month : null })
            }
            nullLabel="Semua tahun"
            placeholder="Semua tahun"
          />
        </FormField>
        <FormField
          label="Bulan"
          className="w-44"
          description={year ? undefined : "Pilih tahun dahulu"}
        >
          <Select
            options={MONTH_OPTIONS}
            value={month}
            onValueChange={(v) => setParams({ bulan: v })}
            nullLabel="Semua bulan"
            placeholder="Semua bulan"
            disabled={!year}
          />
        </FormField>
      </div>

      {stats.status === "error" ? (
        <ErrorState error={stats.error} onRetry={() => void stats.reload()} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div
          className="flex flex-col gap-4"
          aria-busy={stats.status === "loading"}
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {period}:{" "}
            <span className="font-semibold text-foreground">
              {nf.format(data.total)} aduan
            </span>
          </p>

          <Section
            title="Aduan mengikut bulan terima"
            description={
              year ? undefined : "Hanya bulan yang mempunyai aduan dipaparkan."
            }
          >
            {data.byMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tiada aduan dalam tempoh ini.
              </p>
            ) : (
              <ColumnChart
                data={monthsToColumns(data.byMonth)}
                labelHeading="Bulan"
              />
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Mengikut status">
              <HorizontalBarChart
                data={bucketsToBars(data.byStatus, COMPLAINT_STATUS)}
                labelHeading="Status"
              />
            </Section>
            <Section title="Mengikut kategori integriti">
              <HorizontalBarChart
                data={bucketsToBars(
                  data.byIntegrityCategory,
                  INTEGRITY_CATEGORY
                )}
                labelHeading="Kategori"
              />
            </Section>
            <Section title="Mengikut sektor">
              <HorizontalBarChart
                data={bucketsToBars(data.bySector, SECTOR)}
                labelHeading="Sektor"
              />
            </Section>
            <Section title="Mengikut saluran aduan">
              <HorizontalBarChart
                data={bucketsToBars(data.bySourceChannel, SOURCE_CHANNEL)}
                labelHeading="Saluran"
              />
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
