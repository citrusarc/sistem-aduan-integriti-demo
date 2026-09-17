"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { Dialog } from "@/components/ui/dialog"
import { MeetingStatusSelect } from "@/components/ui/enum-select"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import {
  pageFromParam,
  pageQuery,
  Pagination,
  splitPage,
} from "@/components/ui/pagination"
import { Notice } from "@/components/ui/section"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
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
import { todayIso } from "@/lib/format"
import { errorMessage } from "@/lib/errors"
import { JMM_MEETING_STATUS, type JmmMeetingStatus } from "@/types/enums"

const PAGE_SIZE = 20

export function MeetingStatusBadge({ status }: { status: JmmMeetingStatus }) {
  return (
    <Badge tone={status === "DIJADUALKAN" ? "primary" : "neutral"}>
      {JMM_MEETING_STATUS[status]}
    </Badge>
  )
}

export function MeetingList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const setParams = useSearchParamsUpdater()
  const [creating, setCreating] = React.useState(false)

  const statusParam = searchParams.get("status")
  const status =
    statusParam && statusParam in JMM_MEETING_STATUS
      ? (statusParam as JmmMeetingStatus)
      : null
  const page = pageFromParam(searchParams.get("halaman"))
  const query = { status: status ?? undefined, ...pageQuery(page, PAGE_SIZE) }
  const list = useApiData(JSON.stringify(query), () =>
    adminApi.meetings.list(query)
  )

  const rows = list.data ? splitPage(list.data, PAGE_SIZE) : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mesyuarat JMM"
        description="Mesyuarat Jawatankuasa Menangani Maklumat dan agenda aduan masing-masing."
        actions={
          <Button onClick={() => setCreating(true)}>Mesyuarat baharu</Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 surface-card border-border/70 bg-card p-4">
        <FormField label="Status" className="w-56">
          <MeetingStatusSelect
            value={status}
            onValueChange={(v) => setParams({ status: v, halaman: null })}
            nullLabel="Semua"
            placeholder="Semua"
          />
        </FormField>
      </div>

      {list.status === "error" ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : !rows ? (
        <LoadingState />
      ) : rows.items.length === 0 ? (
        <EmptyState
          title="Tiada mesyuarat"
          description="Cipta mesyuarat untuk mula menyusun agenda aduan."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bil. mesyuarat</TableHead>
                <TableHead>Tarikh</TableHead>
                <TableHead>Tempat</TableHead>
                <TableHead>Agenda</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.items.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    <Link
                      href={`/jmm/${m.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {m.meetingNo}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <DateDisplay value={m.meetingDate} />
                  </TableCell>
                  <TableCell>
                    {m.venue ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {m.decidedCount}/{m.itemCount} diputuskan
                  </TableCell>
                  <TableCell>
                    <MeetingStatusBadge status={m.status} />
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

      {creating && (
        <CreateMeetingDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/jmm/${id}`)}
        />
      )}
    </div>
  )
}

function CreateMeetingDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [meetingNo, setMeetingNo] = React.useState("")
  const [meetingDate, setMeetingDate] = React.useState(todayIso())
  const [venue, setVenue] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!meetingNo.trim() || !meetingDate) {
      setError("Nyatakan bil. mesyuarat dan tarikh.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await adminApi.meetings.create({
        meetingNo: meetingNo.trim(),
        meetingDate,
        venue: venue.trim() || null,
      })
      onCreated(created.id)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && onClose()}
      title="Mesyuarat baharu"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="create-meeting" disabled={saving}>
            {saving ? "Mencipta…" : "Cipta mesyuarat"}
          </Button>
        </>
      }
    >
      <form
        id="create-meeting"
        onSubmit={save}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField
          label="Bil. mesyuarat"
          required
          description="Unik, cth. JMM Bil. 3/2026."
        >
          <Input
            value={meetingNo}
            onChange={(e) => setMeetingNo(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Tarikh mesyuarat" required>
          <Input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
          />
        </FormField>
        <FormField label="Tempat">
          <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
