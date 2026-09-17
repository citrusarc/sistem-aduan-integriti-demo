"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, ExternalLinkIcon } from "lucide-react"

import {
  AccusedPersonFields,
  ComplainantDetailsFields,
  EMPTY_ACCUSED,
  EMPTY_COMPLAINANT,
  SupportingDocumentsField,
  complainantBody,
  complainantFormatErrors,
  type AccusedPerson,
  type ComplainantDetails,
} from "@/components/complaints/borang-aduan-fields"
import { Button, buttonVariants } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import {
  DirectedToSelect,
  GradeLevelSelect,
  InfoClassificationSelect,
  IntegrityCategorySelect,
  ReceivedViaSelect,
  SectorSelect,
  SourceChannelSelect,
} from "@/components/ui/enum-select"
import { CheckboxField, FieldControl, FormField } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Notice, Section } from "@/components/ui/section"
import { StatusPill } from "@/components/ui/status-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { adminApi, duplicateCandidatesOf } from "@/lib/api"
import { scrollIntoViewOnMount } from "@/lib/dom"
import { todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AdminComplaint } from "@/types/entities"
import {
  INTEGRITY_CATEGORY,
  labelFor,
  type ComplaintDirectedTo,
  type GradeLevelGroup,
  type InfoClassification,
  type IntegrityCategory,
  type ReceivedVia,
  type Sector,
  type SourceChannel,
} from "@/types/enums"
import { errorMessage } from "@/lib/errors"
import type { CreateComplaintBody } from "@/types/requests"

/** The masterlist's month sheets, as the seed writes `report_month`. */
const MONTHS = [
  "JANUARI",
  "FEBRUARI",
  "MAC",
  "APRIL",
  "MEI",
  "JUN",
  "JULAI",
  "OGOS",
  "SEPTEMBER",
  "OKTOBER",
  "NOVEMBER",
  "DISEMBER",
]

type ComplainantMode = "NONE" | "NAMED" | "ANONYMOUS"

type FormState = {
  // Butir-butir pengadu
  complainantMode: ComplainantMode
  complainant: ComplainantDetails
  // Maklumat aduan
  accused1: AccusedPerson
  accusedGradeLevel: GradeLevelGroup | null
  accused2: AccusedPerson
  incidentDate: string
  incidentTime: string
  caseDescription: string
  hasSupportingDocuments: boolean | null
  // Ruangan penerima (Lampiran 2) + the Masterlist's own columns
  receivedDateUi: string
  complaintDate: string
  receivedVia: ReceivedVia | null
  sourceChannel: SourceChannel | null
  directedTo: ComplaintDirectedTo | null
  infoClassification: InfoClassification | null
  integrityCategory: IntegrityCategory | null
  sector: Sector | null
}

const INITIAL: FormState = {
  complainantMode: "NONE",
  complainant: EMPTY_COMPLAINANT,
  accused1: EMPTY_ACCUSED,
  accusedGradeLevel: null,
  accused2: EMPTY_ACCUSED,
  incidentDate: "",
  incidentTime: "",
  caseDescription: "",
  hasSupportingDocuments: null,
  receivedDateUi: "",
  complaintDate: "",
  receivedVia: null,
  sourceChannel: null,
  directedTo: null,
  infoClassification: null,
  integrityCategory: null,
  sector: null,
}

const text = (v: string) => (v.trim() ? v.trim() : null)

function toBody(form: FormState): CreateComplaintBody {
  // The masterlist files a case under the month it reached the unit.
  const received = form.receivedDateUi || todayIso()
  const [year, month] = received.split("-").map(Number)

  return {
    reportYear: year,
    reportMonth: MONTHS[month! - 1],
    receivedDateUi: form.receivedDateUi || null,
    complaintDate: form.complaintDate || null,
    receivedVia: form.receivedVia,
    sourceChannel: form.sourceChannel,
    directedTo: form.directedTo,
    infoClassification: form.infoClassification,
    integrityCategory: form.integrityCategory,
    sector: form.sector,
    caseDescription: text(form.caseDescription),
    accusedParticulars: text(form.accused1.particulars),
    accusedGradeLevel: form.accusedGradeLevel,
    accusedDepartment: text(form.accused1.department),
    accusedPosition: text(form.accused1.position),
    accused2Particulars: text(form.accused2.particulars),
    accused2Department: text(form.accused2.department),
    accused2Position: text(form.accused2.position),
    incidentDate: form.incidentDate || null,
    incidentTime: form.incidentTime || null,
    hasSupportingDocuments: form.hasSupportingDocuments,
    complainant:
      form.complainantMode === "NONE"
        ? null
        : complainantBody(
            form.complainant,
            form.complainantMode === "ANONYMOUS"
          ),
  }
}

type Errors = Partial<
  Record<
    | keyof ComplainantDetails
    | "receivedDateUi"
    | "complaintDate"
    | "incidentDate"
    | "caseDescription",
    string
  >
>

/** Checks the browser can do before BE's own validation (which still runs). */
function localErrors(form: FormState): Errors {
  const anonymous = form.complainantMode === "ANONYMOUS"
  const errors: Errors =
    form.complainantMode === "NONE"
      ? {}
      : complainantFormatErrors(form.complainant, anonymous)
  if (!form.receivedDateUi) errors.receivedDateUi = "Nyatakan tarikh terima"
  if (!form.caseDescription.trim()) {
    errors.caseDescription = "Nyatakan keterangan aduan"
  }
  if (form.complaintDate && form.complaintDate > todayIso()) {
    errors.complaintDate = "Tarikh aduan tidak boleh pada masa hadapan"
  }
  if (form.incidentDate && form.incidentDate > todayIso()) {
    errors.incidentDate = "Tarikh kejadian tidak boleh pada masa hadapan"
  }
  if (anonymous && !form.complainant.contactEmail.trim()) {
    errors.contactEmail =
      "Aduan tanpa nama memerlukan e-mel supaya pengadu boleh dihubungi"
  }
  return errors
}

export function RegistrationForm() {
  const router = useRouter()
  const [form, setForm] = React.useState<FormState>(() => ({
    ...INITIAL,
    receivedDateUi: todayIso(),
  }))
  const [showErrors, setShowErrors] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  /** Set by a 409: the possible repeats BE found for exactly this input. */
  const [candidates, setCandidates] = React.useState<AdminComplaint[] | null>(
    null
  )
  const [acknowledged, setAcknowledged] = React.useState(false)

  const errors = showErrors ? localErrors(form) : {}

  /**
   * Any edit invalidates a duplicate review: the officer acknowledged the
   * candidates for the input they saw, not for whatever it became afterwards.
   */
  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setCandidates(null)
    setAcknowledged(false)
    setError(null)
  }

  function updateComplainant<K extends keyof ComplainantDetails>(
    key: K,
    value: ComplainantDetails[K]
  ) {
    update("complainant", { ...form.complainant, [key]: value })
  }

  function updateAccused(slot: "accused1" | "accused2") {
    return (key: keyof AccusedPerson, value: string) =>
      update(slot, { ...form[slot], [key]: value })
  }

  async function submit(duplicateCheckAcknowledged: boolean) {
    setShowErrors(true)
    if (Object.keys(localErrors(form)).length > 0) return

    setSubmitting(true)
    setError(null)
    try {
      const created = await adminApi.complaints.create({
        ...toBody(form),
        duplicateCheckAcknowledged,
      })
      router.push(`/complaints/${created.id}?didaftar=1`)
    } catch (err) {
      const found = duplicateCandidatesOf(err)
      if (found) {
        setCandidates(found)
        setAcknowledged(false)
      } else {
        setError(errorMessage(err))
      }
      setSubmitting(false)
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Daftar aduan baharu"
        description="Semakan pertindihan dijalankan sebelum aduan didaftarkan. No. rujukan dikeluarkan oleh sistem dan tidak boleh diubah."
      />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Section
          title="Butir-butir pengadu"
          description="Mengikut Borang Aduan/ Maklumat (Lampiran 2). Semua butiran pilihan, dan hanya untuk Unit Integriti."
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">
              Maklumat pengadu
            </legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["NONE", "Tiada maklumat"],
                  ["NAMED", "Bernama"],
                  ["ANONYMOUS", "Tanpa nama"],
                ] as const
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-status-menunggu-jmm has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
                  )}
                >
                  <input
                    type="radio"
                    name="complainantMode"
                    value={mode}
                    checked={form.complainantMode === mode}
                    onChange={() => update("complainantMode", mode)}
                    className="accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {form.complainantMode !== "NONE" && (
            <ComplainantDetailsFields
              value={form.complainant}
              onChange={updateComplainant}
              errors={errors}
              anonymous={form.complainantMode === "ANONYMOUS"}
              audience="staff"
              emailRequired={form.complainantMode === "ANONYMOUS"}
              emailDescription={
                form.complainantMode === "ANONYMOUS"
                  ? "Satu-satunya saluran untuk menghubungi pengadu tanpa nama. Nama dan butiran peribadi tidak disimpan."
                  : "Untuk makluman status melalui e-mel."
              }
            />
          )}
        </Section>

        <Section
          title="Maklumat aduan"
          description="Nama, agensi dan keterangan digunakan dalam semakan pertindihan."
        >
          <div className="flex flex-col gap-5">
            <AccusedPersonFields
              index={1}
              value={form.accused1}
              onChange={updateAccused("accused1")}
            >
              <FormField label="Kumpulan gred">
                <GradeLevelSelect
                  value={form.accusedGradeLevel}
                  onValueChange={(v) => update("accusedGradeLevel", v)}
                  nullLabel="Tidak dinyatakan"
                />
              </FormField>
            </AccusedPersonFields>
            <AccusedPersonFields
              index={2}
              value={form.accused2}
              onChange={updateAccused("accused2")}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Tarikh kejadian" error={errors.incidentDate}>
                <Input
                  type="date"
                  value={form.incidentDate}
                  max={todayIso()}
                  onChange={(e) => update("incidentDate", e.target.value)}
                />
              </FormField>
              <FormField label="Masa kejadian">
                <Input
                  type="time"
                  value={form.incidentTime}
                  onChange={(e) => update("incidentTime", e.target.value)}
                />
              </FormField>
              <FormField
                label="Keterangan aduan / maklumat"
                required
                error={errors.caseDescription}
                className="sm:col-span-2 lg:col-span-3"
              >
                <FieldControl
                  render={
                    <Textarea
                      rows={6}
                      value={form.caseDescription}
                      onChange={(e) =>
                        update("caseDescription", e.target.value)
                      }
                    />
                  }
                />
              </FormField>
            </div>
            <SupportingDocumentsField
              value={form.hasSupportingDocuments}
              onChange={(v) => update("hasSupportingDocuments", v)}
            />
          </div>
        </Section>

        <Section
          title="Ruangan penerima aduan"
          description="Diisi oleh penerima aduan. Cara diterima mengikut Lampiran 2; saluran, klasifikasi dan sektor mengikut Masterlist."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              label="Tarikh terima di UI"
              required
              error={errors.receivedDateUi}
              description="Menentukan bulan laporan dan tahun no. rujukan."
            >
              <Input
                type="date"
                value={form.receivedDateUi}
                max={todayIso()}
                onChange={(e) => update("receivedDateUi", e.target.value)}
              />
            </FormField>
            <FormField label="Tarikh aduan" error={errors.complaintDate}>
              <Input
                type="date"
                value={form.complaintDate}
                max={todayIso()}
                onChange={(e) => update("complaintDate", e.target.value)}
              />
            </FormField>
            <FormField label="Cara aduan / maklumat diterima">
              <ReceivedViaSelect
                value={form.receivedVia}
                onValueChange={(v) => update("receivedVia", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
            <FormField label="Saluran aduan (Masterlist)">
              <SourceChannelSelect
                value={form.sourceChannel}
                onValueChange={(v) => update("sourceChannel", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
            <FormField label="Aduan terhadap">
              <DirectedToSelect
                value={form.directedTo}
                onValueChange={(v) => update("directedTo", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
            <FormField label="Klasifikasi maklumat">
              <InfoClassificationSelect
                value={form.infoClassification}
                onValueChange={(v) => update("infoClassification", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
            <FormField label="Kategori integriti">
              <IntegrityCategorySelect
                value={form.integrityCategory}
                onValueChange={(v) => update("integrityCategory", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
            <FormField label="Sektor">
              <SectorSelect
                value={form.sector}
                onValueChange={(v) => update("sector", v)}
                nullLabel="Tidak dinyatakan"
              />
            </FormField>
          </div>
        </Section>

        {error && <Notice tone="error">{error}</Notice>}

        {candidates ? (
          <div ref={scrollIntoViewOnMount} className="scroll-mt-4">
            <DuplicateReview
              candidates={candidates}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
              submitting={submitting}
              onConfirm={() => void submit(true)}
            />
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href="/complaints"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Batal
            </Link>
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "Menyemak pertindihan…" : "Semak & daftar aduan"}
            </Button>
          </div>
        )}
      </form>
    </div>
  )
}

/**
 * Business rule 5: BE refused (409) because the input matches existing cases.
 * The officer reviews them and must explicitly confirm this is a new case;
 * the confirmation is only offered for the input as it is now.
 */
function DuplicateReview({
  candidates,
  acknowledged,
  onAcknowledge,
  submitting,
  onConfirm,
}: {
  candidates: AdminComplaint[]
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
  submitting: boolean
  onConfirm: () => void
}) {
  return (
    <section
      aria-labelledby="duplicate-heading"
      className="flex flex-col gap-4 rounded-xl border border-accent/60 bg-status-dalam-tindakan/40 p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <AlertTriangleIcon
          className="mt-0.5 size-5 shrink-0 text-status-dalam-tindakan-foreground"
          aria-hidden
        />
        <div className="flex flex-col gap-1">
          <h2
            id="duplicate-heading"
            className="font-semibold text-status-dalam-tindakan-foreground"
          >
            Semakan pertindihan menemui {candidates.length} aduan berkaitan
          </h2>
          <p className="text-sm">
            Aduan belum didaftarkan. Semak setiap aduan di bawah (dibuka dalam
            tab baharu). Jika ini aduan berulang, batalkan dan kemas kini fail
            kes sedia ada.
          </p>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. rujukan</TableHead>
            <TableHead>Diterima</TableHead>
            <TableHead>Penama / jabatan</TableHead>
            <TableHead>Kategori</TableHead>
            <TableHead>Perihal</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium whitespace-nowrap">
                <a
                  href={`/complaints/${c.id}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {c.complaintRefNo}
                  <ExternalLinkIcon className="size-3.5" aria-hidden />
                  <span className="sr-only">(tab baharu)</span>
                </a>
              </TableCell>
              <TableCell>
                <DateDisplay value={c.receivedDateUi ?? c.complaintDate} />
              </TableCell>
              <TableCell className="max-w-48">
                <p className="truncate">{c.accusedParticulars ?? "—"}</p>
                {c.accusedDepartment && (
                  <p className="truncate text-xs text-muted-foreground">
                    {c.accusedDepartment}
                  </p>
                )}
              </TableCell>
              <TableCell>
                {labelFor(INTEGRITY_CATEGORY, c.integrityCategory)}
              </TableCell>
              <TableCell className="max-w-72">
                <p className="line-clamp-2 text-xs">
                  {c.caseDescription ?? "—"}
                </p>
              </TableCell>
              <TableCell>
                <StatusPill status={c.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <CheckboxField
        checked={acknowledged}
        onChange={(e) => onAcknowledge(e.target.checked)}
        label="Saya telah menyemak aduan di atas dan mengesahkan ini bukan aduan berulang."
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href="/complaints"
          className={buttonVariants({ variant: "outline", size: "lg" })}
        >
          Batal pendaftaran
        </Link>
        <Button
          type="button"
          size="lg"
          disabled={!acknowledged || submitting}
          onClick={onConfirm}
        >
          {submitting ? "Mendaftar…" : "Daftar sebagai aduan baharu"}
        </Button>
      </div>
    </section>
  )
}
