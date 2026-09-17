"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCheckIcon,
  GavelIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { DecisionFormDialog } from "@/components/admin/jmm/decision-form"
import { MeetingStatusBadge } from "@/components/admin/jmm/meeting-list"
import { BackLink } from "@/components/ui/back-link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { ComplaintStatusSelect } from "@/components/ui/enum-select"
import { FormField } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Notice, Section } from "@/components/ui/section"
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
import type {
  AgendaItem,
  DecisionLogEntry,
  JmmMeetingDetail,
} from "@/types/entities"
import {
  COMPLAINT_STATUS,
  INTEGRITY_CATEGORY,
  JMM_OUTCOME,
  labelFor,
  SECTOR,
  type ComplaintStatus,
} from "@/types/enums"
import { errorMessage } from "@/lib/errors"

type Flash = { tone: "success" | "error"; text: string }

export function MeetingDetail({ id }: { id: string }) {
  const meeting = useApiData(`meeting:${id}`, () => adminApi.meetings.get(id))

  if (meeting.status === "error" && !meeting.data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink href="/jmm">Mesyuarat JMM</BackLink>
        <ErrorState
          error={meeting.error}
          onRetry={() => void meeting.reload()}
        />
      </div>
    )
  }
  if (!meeting.data) return <LoadingState />
  return (
    <MeetingView
      meeting={meeting.data}
      setMeeting={meeting.setData}
      reload={meeting.reload}
    />
  )
}

function MeetingView({
  meeting,
  setMeeting,
  reload,
}: {
  meeting: JmmMeetingDetail
  setMeeting: (m: JmmMeetingDetail) => void
  reload: () => Promise<void>
}) {
  const open = meeting.status === "DIJADUALKAN"
  const [adding, setAdding] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  const [removing, setRemoving] = React.useState<AgendaItem | null>(null)
  const [deciding, setDeciding] = React.useState<AgendaItem | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [flash, setFlash] = React.useState<Flash | null>(null)

  const items = [...meeting.items].sort((a, b) => a.agendaOrder - b.agendaOrder)
  const undecided = items.filter((i) => !i.hasDecision).length

  /**
   * Every agenda write returns the whole meeting; show that, not a refetch.
   * Errors are rethrown for the dialog that asked to show them.
   */
  async function write(
    request: () => Promise<JmmMeetingDetail>,
    success?: string
  ) {
    setBusy(true)
    setFlash(null)
    try {
      setMeeting(await request())
      if (success) setFlash({ tone: "success", text: success })
    } finally {
      setBusy(false)
    }
  }

  function move(index: number, delta: -1 | 1) {
    const order = items.map((i) => i.complaint.id)
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved!)
    write(() => adminApi.meetings.reorder(meeting.id, order)).catch((err) =>
      setFlash({
        tone: "error",
        text: errorMessage(err),
      })
    )
  }

  const decisionsByComplaint = new Map<string, DecisionLogEntry[]>()
  for (const d of meeting.decisions) {
    decisionsByComplaint.set(d.complaintId, [
      ...(decisionsByComplaint.get(d.complaintId) ?? []),
      d,
    ])
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/jmm">Mesyuarat JMM</BackLink>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {meeting.meetingNo}
            <MeetingStatusBadge status={meeting.status} />
          </span>
        }
        description={
          <>
            <DateDisplay value={meeting.meetingDate} />
            {meeting.venue && <> · {meeting.venue}</>}
          </>
        }
        actions={
          open ? (
            <>
              <Button variant="outline" onClick={() => setAdding(true)}>
                <PlusIcon data-icon="inline-start" />
                Tambah ke agenda
              </Button>
              <Button
                onClick={() => setClosing(true)}
                disabled={undecided > 0 || items.length === 0}
                title={
                  undecided > 0
                    ? "Setiap item agenda perlu keputusan, atau dikeluarkan dahulu"
                    : undefined
                }
              >
                <CheckCheckIcon data-icon="inline-start" />
                Tandakan selesai
              </Button>
            </>
          ) : undefined
        }
      />

      {open ? (
        undecided > 0 && (
          <Notice tone="info">
            {undecided} item belum diputuskan. Mesyuarat boleh ditandakan
            selesai setelah setiap item mempunyai keputusan — item yang
            ditangguhkan dikeluarkan dari agenda dan dibentangkan pada mesyuarat
            lain.
          </Notice>
        )
      ) : (
        <Notice tone="info">
          Mesyuarat ini telah selesai dan hanya boleh dibaca.
        </Notice>
      )}

      {flash && (
        <Notice
          tone={flash.tone}
          className="flex items-start justify-between gap-2"
        >
          <span>{flash.text}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Tutup mesej"
            onClick={() => setFlash(null)}
          >
            <XIcon />
          </Button>
        </Notice>
      )}

      <Section
        title="Agenda"
        description={`${items.length} aduan · ${items.length - undecided} diputuskan`}
      >
        {items.length === 0 ? (
          <EmptyState
            title="Agenda kosong"
            description={
              open
                ? "Tambah aduan untuk dibentangkan dalam mesyuarat ini."
                : undefined
            }
          />
        ) : (
          <Table aria-busy={busy}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Bil.</TableHead>
                <TableHead>No. rujukan</TableHead>
                <TableHead>Kategori / sektor</TableHead>
                <TableHead>Status aduan</TableHead>
                <TableHead>Keputusan</TableHead>
                {open && <TableHead className="text-right">Tindakan</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => {
                const decisions =
                  decisionsByComplaint.get(item.complaint.id) ?? []
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.agendaOrder}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      <Link
                        href={`/complaints/${item.complaint.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {item.complaint.complaintRefNo}
                      </Link>
                      <p className="text-xs font-normal text-muted-foreground">
                        Diterima{" "}
                        <DateDisplay value={item.complaint.receivedDateUi} />
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>
                        {labelFor(
                          INTEGRITY_CATEGORY,
                          item.complaint.integrityCategory
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {labelFor(SECTOR, item.complaint.sector)}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusPill status={item.complaint.status} />
                    </TableCell>
                    <TableCell>
                      {decisions.length ? (
                        <ul className="flex flex-col gap-1">
                          {decisions.map((d) => (
                            <li
                              key={d.id}
                              className="flex flex-wrap items-center gap-1.5"
                            >
                              <span className="text-sm">
                                {JMM_OUTCOME[d.outcome]}
                              </span>
                              <Badge tone={d.finalized ? "calm" : "accent"}>
                                {d.finalized
                                  ? "Muktamad"
                                  : "Belum ditandatangani"}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Belum diputuskan
                        </span>
                      )}
                    </TableCell>
                    {open && (
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {!item.hasDecision && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => setDeciding(item)}
                            >
                              <GavelIcon data-icon="inline-start" />
                              Rekod keputusan
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Naikkan ${item.complaint.complaintRefNo}`}
                            disabled={busy || index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Turunkan ${item.complaint.complaintRefNo}`}
                            disabled={busy || index === items.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDownIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Keluarkan ${item.complaint.complaintRefNo} dari agenda`}
                            title={
                              item.hasDecision
                                ? "Sudah diputuskan dalam mesyuarat ini"
                                : undefined
                            }
                            disabled={busy || item.hasDecision}
                            onClick={() => setRemoving(item)}
                          >
                            <XIcon />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      {meeting.decisions.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Tandatangan direkod pada fail kes setiap aduan.{" "}
          <Link
            href={`/jmm/decisions?mesyuarat=${meeting.id}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            Log keputusan mesyuarat ini
          </Link>
        </p>
      )}

      {adding && (
        <AddItemDialog
          meeting={meeting}
          onClose={() => setAdding(false)}
          onAdd={(complaintId, refNo) =>
            write(
              () => adminApi.meetings.addItem(meeting.id, { complaintId }),
              `${refNo} ditambah ke agenda — status kini Menunggu JMM.`
            )
          }
        />
      )}

      {deciding && (
        <DecisionFormDialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          complaintId={deciding.complaint.id}
          complaintRefNo={deciding.complaint.complaintRefNo}
          meetingId={meeting.id}
          defaultDate={meeting.meetingDate}
          onRecorded={async (recorded) => {
            await reload()
            setFlash({
              tone: "success",
              text: `Keputusan "${JMM_OUTCOME[recorded.outcome]}" direkod untuk ${deciding.complaint.complaintRefNo} — status kini ${COMPLAINT_STATUS[recorded.complaintStatus]}.`,
            })
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Keluarkan ${removing?.complaint.complaintRefNo ?? ""} dari agenda?`}
        description="Status aduan kembali kepada status sebelum dimasukkan ke agenda."
        confirmLabel="Keluarkan"
        destructive
        onConfirm={async () => {
          const item = removing!
          await write(
            () => adminApi.meetings.removeItem(meeting.id, item.complaint.id),
            `${item.complaint.complaintRefNo} dikeluarkan dari agenda.`
          )
        }}
      />

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Tandakan ${meeting.meetingNo} selesai?`}
        description="Mesyuarat yang selesai tidak boleh dibuka semula; butiran dan agendanya tidak boleh diubah."
        confirmLabel="Tandakan selesai"
        onConfirm={() =>
          write(
            () => adminApi.meetings.close(meeting.id),
            "Mesyuarat ditandakan selesai."
          )
        }
      />
    </div>
  )
}

/** Statuses the transition table lets onto an agenda (CLAUDE.md §4). */
const ELIGIBLE: ComplaintStatus[] = ["BARU", "DALAM_TINDAKAN", "NFA"]

function AddItemDialog({
  meeting,
  onClose,
  onAdd,
}: {
  meeting: JmmMeetingDetail
  onClose: () => void
  onAdd: (complaintId: string, refNo: string) => Promise<void>
}) {
  const [status, setStatus] = React.useState<ComplaintStatus>("BARU")
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const list = useApiData(`eligible:${status}`, () =>
    adminApi.complaints.list({ status, limit: 100 })
  )
  const onAgenda = new Set(meeting.items.map((i) => i.complaint.id))

  async function add(id: string, refNo: string) {
    setPending(id)
    setError(null)
    try {
      await onAdd(id, refNo)
      await list.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(null)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && onClose()}
      title={`Tambah ke agenda ${meeting.meetingNo}`}
      description="Aduan Baru, Dalam Tindakan (dibentangkan semula) atau NFA. Aduan yang sudah dalam agenda mesyuarat terbuka tidak disenaraikan."
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose} disabled={pending !== null}>
          Selesai
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label="Status aduan" className="sm:w-64">
          <ComplaintStatusSelect
            value={status}
            only={ELIGIBLE}
            onValueChange={(v) => v && setStatus(v)}
          />
        </FormField>
        {error && <Notice tone="error">{error}</Notice>}
        {list.status === "error" ? (
          <ErrorState error={list.error} onRetry={() => void list.reload()} />
        ) : !list.data ? (
          <LoadingState />
        ) : list.data.filter((c) => !onAgenda.has(c.id)).length === 0 ? (
          <EmptyState title="Tiada aduan untuk ditambah" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. rujukan</TableHead>
                <TableHead>Diterima</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data
                .filter((c) => !onAgenda.has(c.id))
                .map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {c.complaintRefNo}
                    </TableCell>
                    <TableCell>
                      <DateDisplay
                        value={c.receivedDateUi ?? c.complaintDate}
                      />
                    </TableCell>
                    <TableCell>
                      {labelFor(INTEGRITY_CATEGORY, c.integrityCategory)}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={c.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending !== null}
                        onClick={() => void add(c.id, c.complaintRefNo)}
                      >
                        {pending === c.id ? "Menambah…" : "Tambah"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Dialog>
  )
}
