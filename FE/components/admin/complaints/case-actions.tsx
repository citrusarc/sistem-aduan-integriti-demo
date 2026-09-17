"use client"

import * as React from "react"
import { PencilIcon, PlusIcon, SendIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { Dialog } from "@/components/ui/dialog"
import { CaseActionTypeSelect } from "@/components/ui/enum-select"
import { FieldControl, FormField } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { DetailList, Notice } from "@/components/ui/section"
import { Select } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/states"
import { adminApi } from "@/lib/api"
import { formatDate } from "@/lib/format"
import type {
  CaseAction,
  JmmDecision,
  ReferralRecipient,
} from "@/types/entities"
import {
  CASE_ACTION_TYPE,
  JMM_OUTCOME,
  labelFor,
  STAFF_ROLE,
  type CaseActionType,
} from "@/types/enums"
import { errorMessage } from "@/lib/errors"
import type { CaseActionBody } from "@/types/requests"

function decisionLabel(d: JmmDecision) {
  return `${formatDate(d.decisionDate)} — ${JMM_OUTCOME[d.outcome]}`
}

/**
 * Post-decision tracking. `actionTaken` is the masterlist vocabulary, never a
 * JMM outcome (rule 4); linking an action to a decision records which decision
 * it follows, it doesn't copy the outcome.
 */
export function CaseActions({
  actions,
  decisions,
  recipients,
  recipientsError,
  referralBlocked,
  complaintId,
  onChanged,
}: {
  actions: CaseAction[]
  decisions: JmmDecision[]
  recipients: ReferralRecipient[] | null
  recipientsError: unknown
  /** Rule 2: NFA, or ever decided NFA — nothing is referred outside the unit. */
  referralBlocked: boolean
  complaintId: string
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = React.useState<CaseAction | "new" | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          Tambah tindakan
        </Button>
      </div>

      {referralBlocked && actions.length > 0 && (
        <Notice tone="info">
          Kes ini pernah diputuskan NFA. Tindakannya tidak boleh dirujuk kepada
          Ketua Jabatan atau sub-unit.
        </Notice>
      )}

      {actions.length === 0 ? (
        <EmptyState
          title="Tiada tindakan direkod"
          description="Tindakan susulan selepas keputusan JMM direkod di sini."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action) => (
            <li key={action.id}>
              <ActionCard
                action={action}
                decision={decisions.find((d) => d.id === action.jmmDecisionId)}
                recipients={recipients}
                recipientsError={recipientsError}
                referralBlocked={referralBlocked}
                onEdit={() => setEditing(action)}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ul>
      )}

      <ActionFormDialog
        key={
          editing === null ? "closed" : editing === "new" ? "new" : editing.id
        }
        editing={editing}
        decisions={decisions}
        complaintId={complaintId}
        onClose={() => setEditing(null)}
        onSaved={onChanged}
      />
    </div>
  )
}

function ActionCard({
  action,
  decision,
  recipients,
  recipientsError,
  referralBlocked,
  onEdit,
  onChanged,
}: {
  action: CaseAction
  decision: JmmDecision | undefined
  recipients: ReferralRecipient[] | null
  recipientsError: unknown
  referralBlocked: boolean
  onEdit: () => void
  onChanged: () => Promise<void>
}) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Tarikh tindakan <DateDisplay value={action.actionDate} />
            {action.fileRefNo && <> · Fail {action.fileRefNo}</>}
          </p>
          <h3 className="font-semibold">
            {action.actionTaken
              ? labelFor(CASE_ACTION_TYPE, action.actionTaken)
              : "Tindakan belum ditetapkan"}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <PencilIcon data-icon="inline-start" />
          Kemas kini
        </Button>
      </header>

      <DetailList
        items={[
          {
            label: "Susulan keputusan JMM",
            value: decision ? decisionLabel(decision) : null,
          },
          {
            label: "Maklum balas diterima",
            value: action.responseReceivedDate ? (
              <DateDisplay value={action.responseReceivedDate} />
            ) : null,
          },
          {
            label: "Status maklum balas",
            value: action.feedbackStatus,
            wide: true,
          },
          {
            label: "Nota tindakan PSU (dalaman)",
            value: action.psuActionNotes,
            wide: true,
          },
          {
            label: "Catatan UI (dalaman)",
            value: action.uiRemarks,
            wide: true,
          },
          ...(action.miscNotes
            ? [{ label: "Lain-lain", value: action.miscNotes, wide: true }]
            : []),
        ]}
      />

      <Referral
        key={`${action.assignedToStaffId}:${recipients ? "loaded" : "loading"}`}
        action={action}
        recipients={recipients}
        recipientsError={recipientsError}
        blocked={referralBlocked}
        onChanged={onChanged}
      />
    </article>
  )
}

/**
 * §8 decision 5: refer the action to one active KJ / SUB_UNIT account. They
 * then see only its five tracking fields and the reference number. Keyed by
 * the current assignee, so the picker resets after every change.
 */
function Referral({
  action,
  recipients,
  recipientsError,
  blocked,
  onChanged,
}: {
  action: CaseAction
  recipients: ReferralRecipient[] | null
  recipientsError: unknown
  blocked: boolean
  onChanged: () => Promise<void>
}) {
  const assigned = action.assignedToStaffId
  const current = recipients?.find((r) => r.id === assigned)
  const active = (recipients ?? []).filter((r) => r.isActive)
  // An inactive assignee can't be re-picked, so the picker starts empty.
  const [draft, setDraft] = React.useState<string | null>(
    current?.isActive ? current.id : null
  )
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(staffId: string | null) {
    setSaving(true)
    setError(null)
    try {
      await adminApi.caseActions.setAssignee(action.id, staffId)
      await onChanged()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Rujukan KJ / sub-unit:</span>
        {assigned ? (
          <Badge tone="primary">
            <SendIcon aria-hidden />
            {current
              ? `${current.fullName} (${STAFF_ROLE[current.role]})${current.isActive ? "" : " — akaun tidak aktif"}`
              : "Memuatkan…"}
          </Badge>
        ) : (
          <span className="text-muted-foreground">Tidak dirujuk</span>
        )}
      </div>

      {recipientsError ? (
        <p className="text-xs text-destructive">
          Senarai Ketua Jabatan / sub-unit tidak dapat dimuatkan.
        </p>
      ) : blocked ? (
        assigned && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Kes NFA — rujukan ini tidak lagi kelihatan kepada penerima.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => void save(null)}
            >
              Kosongkan rujukan
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <FormField label="Rujuk kepada" className="sm:w-80">
            <Select
              options={active.map((r) => ({
                value: r.id,
                label: `${r.fullName} — ${STAFF_ROLE[r.role]}`,
              }))}
              value={draft}
              onValueChange={setDraft}
              nullLabel="Tiada rujukan"
              placeholder="Tiada rujukan"
              disabled={!recipients || saving}
            />
          </FormField>
          <Button
            variant="secondary"
            disabled={!recipients || saving || draft === assigned}
            onClick={() => void save(draft)}
          >
            {saving ? "Menyimpan…" : "Simpan rujukan"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

type ActionForm = {
  actionTaken: CaseActionType | null
  actionDate: string
  fileRefNo: string
  jmmDecisionId: string | null
  responseReceivedDate: string
  feedbackStatus: string
  psuActionNotes: string
  uiRemarks: string
  miscNotes: string
}

function formFrom(
  action: CaseAction | null,
  decisions: JmmDecision[]
): ActionForm {
  return {
    actionTaken: action?.actionTaken ?? null,
    actionDate: action?.actionDate ?? "",
    fileRefNo: action?.fileRefNo ?? "",
    // A new action most often follows the latest decision.
    jmmDecisionId: action ? action.jmmDecisionId : (decisions[0]?.id ?? null),
    responseReceivedDate: action?.responseReceivedDate ?? "",
    feedbackStatus: action?.feedbackStatus ?? "",
    psuActionNotes: action?.psuActionNotes ?? "",
    uiRemarks: action?.uiRemarks ?? "",
    miscNotes: action?.miscNotes ?? "",
  }
}

function bodyFrom(form: ActionForm): CaseActionBody {
  const text = (v: string) => (v.trim() ? v.trim() : null)
  return {
    actionTaken: form.actionTaken,
    actionDate: form.actionDate || null,
    fileRefNo: text(form.fileRefNo),
    jmmDecisionId: form.jmmDecisionId,
    responseReceivedDate: form.responseReceivedDate || null,
    feedbackStatus: text(form.feedbackStatus),
    psuActionNotes: text(form.psuActionNotes),
    uiRemarks: text(form.uiRemarks),
    miscNotes: text(form.miscNotes),
  }
}

function ActionFormDialog({
  editing,
  decisions,
  complaintId,
  onClose,
  onSaved,
}: {
  editing: CaseAction | "new" | null
  decisions: JmmDecision[]
  complaintId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const existing = editing && editing !== "new" ? editing : null
  const [form, setForm] = React.useState(() => formFrom(existing, decisions))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const set = <K extends keyof ActionForm>(key: K, value: ActionForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await adminApi.caseActions.update(existing.id, bodyFrom(form))
      } else {
        await adminApi.complaints.addCaseAction(complaintId, bodyFrom(form))
      }
      await onSaved()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const formId = "case-action-form"

  return (
    <Dialog
      open={editing !== null}
      onOpenChange={(open) => !open && !saving && onClose()}
      title={existing ? "Kemas kini tindakan" : "Tambah tindakan"}
      description="Nota PSU dan catatan UI adalah dalaman dan tidak dikongsi dengan penerima rujukan atau pengadu."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tindakan diambil">
          <CaseActionTypeSelect
            value={form.actionTaken}
            onValueChange={(v) => set("actionTaken", v)}
            nullLabel="Belum ditetapkan"
          />
        </FormField>
        <FormField label="Tarikh tindakan">
          <Input
            type="date"
            value={form.actionDate}
            onChange={(e) => set("actionDate", e.target.value)}
          />
        </FormField>
        <FormField label="No. rujukan fail">
          <Input
            value={form.fileRefNo}
            onChange={(e) => set("fileRefNo", e.target.value)}
          />
        </FormField>
        <FormField label="Susulan keputusan JMM">
          <Select
            options={decisions.map((d) => ({
              value: d.id,
              label: decisionLabel(d),
            }))}
            value={form.jmmDecisionId}
            onValueChange={(v) => set("jmmDecisionId", v)}
            nullLabel="Tiada"
          />
        </FormField>
        <FormField label="Tarikh maklum balas diterima">
          <Input
            type="date"
            value={form.responseReceivedDate}
            onChange={(e) => set("responseReceivedDate", e.target.value)}
          />
        </FormField>
        <FormField label="Status maklum balas">
          <Input
            value={form.feedbackStatus}
            onChange={(e) => set("feedbackStatus", e.target.value)}
          />
        </FormField>
        <FormField
          label="Nota tindakan PSU (dalaman)"
          className="sm:col-span-2"
        >
          <FieldControl
            render={
              <Textarea
                rows={3}
                value={form.psuActionNotes}
                onChange={(e) => set("psuActionNotes", e.target.value)}
              />
            }
          />
        </FormField>
        <FormField label="Catatan UI (dalaman)" className="sm:col-span-2">
          <FieldControl
            render={
              <Textarea
                rows={3}
                value={form.uiRemarks}
                onChange={(e) => set("uiRemarks", e.target.value)}
              />
            }
          />
        </FormField>
        <FormField label="Lain-lain" className="sm:col-span-2">
          <FieldControl
            render={
              <Textarea
                rows={2}
                value={form.miscNotes}
                onChange={(e) => set("miscNotes", e.target.value)}
              />
            }
          />
        </FormField>
        {error && (
          <Notice tone="error" className="sm:col-span-2">
            {error}
          </Notice>
        )}
      </form>
    </Dialog>
  )
}
