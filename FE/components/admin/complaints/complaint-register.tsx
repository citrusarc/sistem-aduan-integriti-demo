"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { PlusIcon, XIcon } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import {
  ComplaintStatusSelect,
  IntegrityCategorySelect,
  SectorSelect,
  SourceChannelSelect,
} from "@/components/ui/enum-select"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import {
  pageFromParam,
  pageQuery,
  Pagination,
  splitPage,
} from "@/components/ui/pagination"
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
import {
  COMPLAINT_STATUS,
  INTEGRITY_CATEGORY,
  labelFor,
  SECTOR,
  SOURCE_CHANNEL,
} from "@/types/enums"
import type { ComplaintFilters } from "@/types/requests"

const PAGE_SIZE = 20
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** URL param -> filter key. Values in the URL are enum keys, as BE takes them. */
const PARAMS = {
  status: "status",
  kategori: "integrityCategory",
  sektor: "sector",
  saluran: "sourceChannel",
  dari: "from",
  hingga: "to",
} as const

type FilterKey = (typeof PARAMS)[keyof typeof PARAMS]

function oneOf<M extends Record<string, string>>(
  map: M,
  value: string | null
): Extract<keyof M, string> | undefined {
  return value && value in map ? (value as Extract<keyof M, string>) : undefined
}

/** Reads filters from the URL, dropping anything BE wouldn't accept. */
function filtersFrom(params: URLSearchParams): ComplaintFilters {
  const date = (v: string | null) => (v && DATE.test(v) ? v : undefined)
  return {
    status: oneOf(COMPLAINT_STATUS, params.get("status")),
    integrityCategory: oneOf(INTEGRITY_CATEGORY, params.get("kategori")),
    sector: oneOf(SECTOR, params.get("sektor")),
    sourceChannel: oneOf(SOURCE_CHANNEL, params.get("saluran")),
    from: date(params.get("dari")),
    to: date(params.get("hingga")),
  }
}

export function ComplaintRegister() {
  const searchParams = useSearchParams()
  const setParams = useSearchParamsUpdater()

  const filters = filtersFrom(searchParams)
  const page = pageFromParam(searchParams.get("halaman"))
  const invertedRange = Boolean(
    filters.from && filters.to && filters.from > filters.to
  )

  const query = { ...filters, ...pageQuery(page, PAGE_SIZE) }
  const key = invertedRange ? null : JSON.stringify(query)
  const list = useApiData(key, () => adminApi.complaints.list(query))

  /** Changing any filter goes back to page 1. */
  function setFilter(key: FilterKey, value: string | null) {
    const param = (Object.keys(PARAMS) as (keyof typeof PARAMS)[]).find(
      (p) => PARAMS[p] === key
    )!
    setParams({ [param]: value })
  }

  const activeCount = Object.values(filters).filter(Boolean).length
  const rows = list.data ? splitPage(list.data, PAGE_SIZE) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Daftar Aduan"
        description="Semua aduan yang diterima Unit Integriti, termasuk kes NFA."
        actions={
          <Link href="/complaints/new" className={buttonVariants()}>
            <PlusIcon data-icon="inline-start" />
            Daftar aduan
          </Link>
        }
      />

      <div
        role="search"
        aria-label="Tapis aduan"
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <FormField label="Status">
          <ComplaintStatusSelect
            value={filters.status ?? null}
            onValueChange={(v) => setFilter("status", v)}
            nullLabel="Semua status"
            placeholder="Semua status"
          />
        </FormField>
        <FormField label="Kategori integriti">
          <IntegrityCategorySelect
            value={filters.integrityCategory ?? null}
            onValueChange={(v) => setFilter("integrityCategory", v)}
            nullLabel="Semua kategori"
            placeholder="Semua kategori"
          />
        </FormField>
        <FormField label="Sektor">
          <SectorSelect
            value={filters.sector ?? null}
            onValueChange={(v) => setFilter("sector", v)}
            nullLabel="Semua sektor"
            placeholder="Semua sektor"
          />
        </FormField>
        <FormField label="Saluran">
          <SourceChannelSelect
            value={filters.sourceChannel ?? null}
            onValueChange={(v) => setFilter("sourceChannel", v)}
            nullLabel="Semua saluran"
            placeholder="Semua saluran"
          />
        </FormField>
        <FormField label="Diterima dari">
          <Input
            type="date"
            value={filters.from ?? ""}
            max={filters.to}
            onChange={(e) => setFilter("from", e.target.value || null)}
          />
        </FormField>
        <FormField
          label="Hingga"
          error={
            invertedRange ? "Tarikh akhir mesti selepas tarikh mula" : null
          }
        >
          <Input
            type="date"
            value={filters.to ?? ""}
            min={filters.from}
            onChange={(e) => setFilter("to", e.target.value || null)}
          />
        </FormField>
        {activeCount > 0 && (
          <div className="flex items-center justify-between gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
            <p className="text-xs text-muted-foreground">
              {activeCount} penapis aktif. Tempoh mengikut tarikh terima di UI
              (atau tarikh aduan jika tiada).
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setParams(
                  Object.fromEntries(Object.keys(PARAMS).map((p) => [p, null]))
                )
              }
            >
              <XIcon data-icon="inline-start" />
              Kosongkan penapis
            </Button>
          </div>
        )}
      </div>

      {invertedRange ? null : list.status === "error" ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : !rows ? (
        <LoadingState />
      ) : rows.items.length === 0 ? (
        <EmptyState
          title={page > 1 ? "Tiada lagi rekod" : "Tiada aduan dijumpai"}
          description={
            activeCount > 0 ? "Cuba kosongkan atau ubah penapis." : undefined
          }
        />
      ) : (
        <div
          className="flex flex-col gap-3"
          aria-busy={list.status === "loading"}
        >
          <Table className={list.status === "loading" ? "opacity-60" : ""}>
            <TableHeader>
              <TableRow>
                <TableHead>No. rujukan</TableHead>
                <TableHead>Diterima</TableHead>
                <TableHead>Penama / jabatan</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Sektor</TableHead>
                <TableHead>Saluran</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.items.map((c) => (
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
                  <TableCell className="max-w-64">
                    <p className="truncate">
                      {c.accusedParticulars ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </p>
                    {c.accusedDepartment && (
                      <p className="truncate text-xs text-muted-foreground">
                        {c.accusedDepartment}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {labelFor(INTEGRITY_CATEGORY, c.integrityCategory)}
                  </TableCell>
                  <TableCell>{labelFor(SECTOR, c.sector)}</TableCell>
                  <TableCell>
                    {labelFor(SOURCE_CHANNEL, c.sourceChannel)}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={c.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            hasNextPage={rows.hasNextPage}
            disabled={list.status === "loading"}
            onPageChange={(p) =>
              setParams({ halaman: p > 1 ? String(p) : null })
            }
          />
        </div>
      )}
    </div>
  )
}
