"use client"

import * as React from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  JmmClassificationSelect,
  JmmOutcomeSelect,
  JmmSignatoryCategorySelect,
  JmmSourceSelect,
} from "@/components/ui/enum-select"
import { FieldControl, FormField } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { adminApi } from "@/lib/api"
import { scrollIntoViewNearestOnMount } from "@/lib/dom"
import { todayIso } from "@/lib/format"
import type { RecordedDecision } from "@/types/entities"
import type {
  JmmClassification,
  JmmOutcome,
  JmmSignatoryCategory,
  JmmSource,
} from "@/types/enums"
import { errorMessage } from "@/lib/errors"

type Slot = {
  key: number
  roleCategory: JmmSignatoryCategory | null
  roleTitle: string
}

/** The block printed on BORANG JMM; titles stay editable per sitting. */
const DEFAULT_SLOTS: Omit<Slot, "key">[] = [
  { roleCategory: "PENGERUSI", roleTitle: "KUI (Pengerusi)" },
  { roleCategory: "AHLI", roleTitle: "PI (Ahli 1)" },
  { roleCategory: "URUS_SETIA", roleTitle: "PSU (PA) (Urus Setia)" },
]

type FormState = {
  decisionDate: string
  outcome: JmmOutcome | null
  jmmSource: JmmSource | null
  jmmClassification: JmmClassification | null
  agencyFileNo: string
  complaintNoOnForm: string
  summary: string
  remarksFurtherAction: string
  slots: Slot[]
}

/**
 * The browser-side mirror of `createDecisionSchema`: rule 1's signature block
 * shape (a PENGERUSI and at least one AHLI) and unique titles. BE checks all of
 * it again; this just says so before the round trip.
 */
function problems(form: FormState): string[] {
  const out: string[] = []
  if (!form.decisionDate) out.push("Nyatakan tarikh keputusan.")
  if (!form.outcome) out.push("Pilih keputusan JMM.")
  const slots = form.slots
  if (slots.some((s) => !s.roleCategory || s.roleTitle.trim().length < 2)) {
    out.push(
      "Setiap penandatangan memerlukan kategori dan jawatan (sekurang-kurangnya 2 aksara)."
    )
  }
  if (
    !slots.some((s) => s.roleCategory === "PENGERUSI") ||
    !slots.some((s) => s.roleCategory === "AHLI")
  ) {
    out.push(
      "Blok tandatangan mesti ada seorang Pengerusi dan sekurang-kurangnya seorang Ahli."
    )
  }
  const titles = slots.map((s) => s.roleTitle.trim())
  if (new Set(titles).size !== titles.length) {
    out.push("Jawatan penandatangan tidak boleh berulang.")
  }
  return out
}

/**
 * Records a BORANG JMM decision for one complaint. Status moves as BE decides
 * (NFA -> NFA, anything else -> Dalam Tindakan); the result is handed back so
 * the caller can show it. Signatures are recorded afterwards, slot by slot, on
 * the case file.
 */
export function DecisionFormDialog({
  open,
  onOpenChange,
  complaintId,
  complaintRefNo,
  meetingId,
  defaultDate,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  complaintId: string
  complaintRefNo: string
  /** Required while the complaint is on an open agenda. */
  meetingId: string | null
  defaultDate?: string
  onRecorded: (decision: RecordedDecision) => Promise<void> | void
}) {
  const nextKey = React.useRef(DEFAULT_SLOTS.length)
  const [form, setForm] = React.useState<FormState>(() => ({
    decisionDate:
      defaultDate && defaultDate <= todayIso() ? defaultDate : todayIso(),
    outcome: null,
    jmmSource: null,
    jmmClassification: null,
    agencyFileNo: "",
    complaintNoOnForm: complaintRefNo,
    summary: "",
    remarksFurtherAction: "",
    slots: DEFAULT_SLOTS.map((s, key) => ({ ...s, key })),
  }))
  const [showProblems, setShowProblems] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /**
   * Messages render below the signature block, out of view in a long form.
   * Bumping this remounts them, which scrolls them into view.
   */
  const [messageAttempt, setMessageAttempt] = React.useState(0)
  const revealMessages = () => setMessageAttempt((n) => n + 1)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))
  const setSlot = (key: number, change: Partial<Slot>) =>
    setForm((prev) => ({
      ...prev,
      slots: prev.slots.map((s) => (s.key === key ? { ...s, ...change } : s)),
    }))

  const found = showProblems ? problems(form) : []

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setShowProblems(true)
    if (problems(form).length) {
      revealMessages()
      return
    }
    setSaving(true)
    setError(null)
    const text = (v: string) => (v.trim() ? v.trim() : null)
    try {
      const recorded = await adminApi.complaints.recordDecision(complaintId, {
        decisionDate: form.decisionDate,
        outcome: form.outcome!,
        jmmSource: form.jmmSource,
        jmmClassification: form.jmmClassification,
        agencyFileNo: text(form.agencyFileNo),
        complaintNoOnForm: text(form.complaintNoOnForm),
        summary: text(form.summary),
        remarksFurtherAction: text(form.remarksFurtherAction),
        meetingId,
        signatories: form.slots.map((s) => ({
          roleCategory: s.roleCategory!,
          roleTitle: s.roleTitle.trim(),
        })),
      })
      await onRecorded(recorded)
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
      revealMessages()
    }
  }

  const formId = `decision-form-${complaintId}`

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !saving && onOpenChange(next)}
      title={`Rekod keputusan JMM — ${complaintRefNo}`}
      description="Keputusan tidak boleh diedit selepas direkod; pembetulan dibuat dengan keputusan baharu."
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button type="submit" form={formId} disabled={saving}>
            {saving ? "Merekod…" : "Rekod keputusan"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={save}
        noValidate
        className="flex flex-col gap-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Keputusan JMM" required>
            <JmmOutcomeSelect
              value={form.outcome}
              onValueChange={(v) => set("outcome", v)}
              placeholder="Pilih keputusan…"
            />
          </FormField>
          <FormField label="Tarikh keputusan" required>
            <Input
              type="date"
              value={form.decisionDate}
              max={todayIso()}
              onChange={(e) => set("decisionDate", e.target.value)}
            />
          </FormField>
          {form.outcome === "NFA" && (
            <Notice tone="warning" className="sm:col-span-2">
              NFA menjadikan kes ini sulit kepada Unit Integriti secara kekal —
              termasuk kepada pengadu sendiri — walaupun dibentangkan semula
              kemudian. Tindakannya juga tidak boleh dirujuk kepada KJ atau
              sub-unit.
            </Notice>
          )}
          <FormField label="Sumber (JMM)">
            <JmmSourceSelect
              value={form.jmmSource}
              onValueChange={(v) => set("jmmSource", v)}
              nullLabel="Tidak dinyatakan"
            />
          </FormField>
          <FormField label="Klasifikasi (JMM)">
            <JmmClassificationSelect
              value={form.jmmClassification}
              onValueChange={(v) => set("jmmClassification", v)}
              nullLabel="Tidak dinyatakan"
            />
          </FormField>
          <FormField label="No. fail agensi">
            <Input
              value={form.agencyFileNo}
              onChange={(e) => set("agencyFileNo", e.target.value)}
            />
          </FormField>
          <FormField label="No. aduan pada borang">
            <Input
              value={form.complaintNoOnForm}
              onChange={(e) => set("complaintNoOnForm", e.target.value)}
            />
          </FormField>
          <FormField label="Ringkasan" className="sm:col-span-2">
            <FieldControl
              render={
                <Textarea
                  rows={3}
                  value={form.summary}
                  onChange={(e) => set("summary", e.target.value)}
                />
              }
            />
          </FormField>
          <FormField label="Ulasan / tindakan lanjut" className="sm:col-span-2">
            <FieldControl
              render={
                <Textarea
                  rows={3}
                  value={form.remarksFurtherAction}
                  onChange={(e) => set("remarksFurtherAction", e.target.value)}
                />
              }
            />
          </FormField>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <legend className="sr-only">Blok tandatangan</legend>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold" aria-hidden>
              Blok tandatangan
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={form.slots.length >= 10}
              onClick={() =>
                set("slots", [
                  ...form.slots,
                  {
                    key: nextKey.current++,
                    roleCategory: "AHLI",
                    roleTitle: "",
                  },
                ])
              }
            >
              <PlusIcon data-icon="inline-start" />
              Tambah penandatangan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Seorang Pengerusi dan sekurang-kurangnya seorang Ahli. Tandatangan
            direkod kemudian pada fail kes.
          </p>
          <ul className="flex flex-col gap-2">
            {form.slots.map((slot, index) => (
              <li
                key={slot.key}
                className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
              >
                <FormField label={`Kategori ${index + 1}`}>
                  <JmmSignatoryCategorySelect
                    value={slot.roleCategory}
                    onValueChange={(v) =>
                      setSlot(slot.key, { roleCategory: v })
                    }
                  />
                </FormField>
                <FormField label={`Jawatan ${index + 1}`}>
                  <Input
                    value={slot.roleTitle}
                    placeholder="cth. KPSU (TU) UI (Ahli 2)"
                    onChange={(e) =>
                      setSlot(slot.key, { roleTitle: e.target.value })
                    }
                  />
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Buang penandatangan ${index + 1}`}
                  disabled={form.slots.length <= 1}
                  onClick={() =>
                    set(
                      "slots",
                      form.slots.filter((s) => s.key !== slot.key)
                    )
                  }
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </fieldset>

        <div
          key={messageAttempt}
          ref={messageAttempt ? scrollIntoViewNearestOnMount : undefined}
          className="flex flex-col gap-2 empty:hidden"
        >
          {found.length > 0 && (
            <Notice tone="error">
              <ul className="list-disc pl-4">
                {found.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      </form>
    </Dialog>
  )
}
