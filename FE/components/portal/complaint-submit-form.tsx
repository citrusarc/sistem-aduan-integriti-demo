"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2Icon, EyeOffIcon, UserIcon } from "lucide-react"

import {
  AccusedPersonFields,
  ComplainantDetailsFields,
  EMPTY_ACCUSED,
  EMPTY_COMPLAINANT,
  complainantBody,
  complainantFormatErrors,
  identityDocumentErrors,
  type AccusedPerson,
  type ComplainantDetails,
} from "@/components/complaints/borang-aduan-fields"
import { DocumentPicker } from "@/components/complaints/document-picker"
import { useSession } from "@/components/providers/session"
import { Button, buttonVariants } from "@/components/ui/button"
import { IntegrityCategorySelect } from "@/components/ui/enum-select"
import { CheckboxField, FieldControl, FormField } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { Notice } from "@/components/ui/section"
import { ApiRequestError, possibleDuplicateCountOf, publicApi } from "@/lib/api"
import { scrollIntoViewCenteredOnMount, scrollIntoViewOnMount } from "@/lib/dom"
import { todayIso } from "@/lib/format"
import { cn } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"
import type { PublicComplaint } from "@/types/entities"
import type { IntegrityCategory } from "@/types/enums"

type FormState = {
  isAnonymous: boolean
  complainant: ComplainantDetails
  accused1: AccusedPerson
  accused2: AccusedPerson
  incidentDate: string
  incidentTime: string
  integrityCategory: IntegrityCategory | null
  caseDescription: string
  /** DOKUMEN SOKONGAN, optional. BE records ADA from whether any are sent. */
  files: File[]
  disclaimer: boolean
}

const INITIAL: FormState = {
  isAnonymous: false,
  complainant: EMPTY_COMPLAINANT,
  accused1: EMPTY_ACCUSED,
  accused2: EMPTY_ACCUSED,
  incidentDate: "",
  incidentTime: "",
  integrityCategory: null,
  caseDescription: "",
  files: [],
  disclaimer: false,
}

type Errors = Partial<
  Record<
    | keyof ComplainantDetails
    | "incidentDate"
    | "caseDescription"
    | "disclaimer",
    string
  >
>

function validate(form: FormState): Errors {
  // Anonymous sends no complainant details, so there is nothing to check.
  const e: Errors = form.isAnonymous
    ? {}
    : {
        ...identityDocumentErrors(form.complainant),
        ...complainantFormatErrors(form.complainant, false),
      }
  if (!form.isAnonymous && !form.complainant.particulars.trim()) {
    e.particulars = "Nyatakan nama anda, atau pilih aduan tanpa nama"
  }
  if (!form.isAnonymous && !form.complainant.contactEmail.trim()) {
    e.contactEmail = "E-mel diperlukan supaya kami boleh menghubungi anda"
  }
  if (form.incidentDate && form.incidentDate > todayIso()) {
    e.incidentDate = "Tarikh tidak boleh pada masa hadapan"
  }
  if (form.caseDescription.trim().length < 20) {
    e.caseDescription = "Terangkan aduan anda (sekurang-kurangnya 20 aksara)"
  }
  if (!form.disclaimer) {
    e.disclaimer =
      "Anda perlu membaca dan bersetuju dengan penafian sebelum menghantar"
  }
  return e
}

const text = (v: string) => (v.trim() ? v.trim() : null)

/**
 * Public portal submission (§8 decision 3, rules 5, 6, 10), laid out as
 * BORANG ADUAN/ MAKLUMAT (Lampiran 2): butir-butir pengadu, maklumat aduan,
 * then the disclaimer. The receiver's section of the form is BE's to fill.
 *
 *   - Named needs a name and an email. Phones are optional and only for staff
 *     to call by hand; nothing is sent to them.
 *   - Anonymous asks for nothing at all, not even an email (§8 decision 11),
 *     and says plainly what that costs: no acknowledgement, no follow-up, no
 *     login — only the reference number shown after sending.
 *   - Supporting documents are an optional upload; there is no ADA/TIADA
 *     question (BE records ADA when files are attached).
 *   - Everything else on the form is optional.
 *   - The handling disclaimer must be acknowledged, every time.
 *   - A possible repeat comes back as 409 with only a count (no other
 *     complaints are disclosed); the complainant must confirm to send anyway.
 */
export function ComplaintSubmitForm() {
  const [form, setForm] = React.useState<FormState>(INITIAL)
  const [touched, setTouched] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [duplicates, setDuplicates] = React.useState<number | null>(null)
  const [confirmNew, setConfirmNew] = React.useState(false)
  const [submitted, setSubmitted] = React.useState<PublicComplaint | null>(null)
  /** Bumped on each refused attempt, to move focus to the first invalid field. */
  const [invalidAttempt, setInvalidAttempt] = React.useState(0)

  const errors = touched ? validate(form) : {}

  // A signed-in account (§8 decisions 13 and 15): start the named form with their
  // account's name and email, once. Complaints link to accounts by email, so
  // keeping it lets the complaint appear under "Aduan saya".
  const complainantSession = useSession()
  const signedIn =
    complainantSession.status === "authenticated"
      ? complainantSession.user
      : null
  const prefilled = React.useRef(false)
  React.useEffect(() => {
    if (!signedIn || prefilled.current) return
    prefilled.current = true
    setForm((prev) => ({
      ...prev,
      complainant: {
        ...prev.complainant,
        particulars: prev.complainant.particulars || signedIn.fullName,
        contactEmail: prev.complainant.contactEmail || signedIn.email,
      },
    }))
  }, [signedIn])

  React.useEffect(() => {
    if (invalidAttempt === 0) return
    document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus()
  }, [invalidAttempt])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    // A confirmation covers what was reviewed, not later edits.
    setDuplicates(null)
    setConfirmNew(false)
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
    setTouched(true)
    const found = validate(form)
    if (Object.keys(found).length) {
      setInvalidAttempt((n) => n + 1)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const created = await publicApi.submitComplaint(
        {
          accusedParticulars: text(form.accused1.particulars),
          accusedDepartment: text(form.accused1.department),
          accusedPosition: text(form.accused1.position),
          accused2Particulars: text(form.accused2.particulars),
          accused2Department: text(form.accused2.department),
          accused2Position: text(form.accused2.position),
          incidentDate: form.incidentDate || null,
          incidentTime: form.incidentTime || null,
          integrityCategory: form.integrityCategory,
          caseDescription: text(form.caseDescription),
          // Anonymous sends nothing about the complainant, whatever was typed
          // into the named fields before switching.
          complainant: form.isAnonymous
            ? { isAnonymous: true }
            : complainantBody(form.complainant, false),
          disclaimerAcknowledged: true,
          duplicateCheckAcknowledged,
        },
        form.files
      )
      setSubmitted(created)
    } catch (err) {
      const count = possibleDuplicateCountOf(err)
      if (count !== null) {
        setDuplicates(count)
      } else if (err instanceof ApiRequestError && err.status === 422) {
        setError(err.message)
      } else {
        setError(
          `Aduan belum dihantar. ${errorMessage(err)} Maklumat anda masih di borang ini.`
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div ref={scrollIntoViewOnMount} className="scroll-mt-24">
        <Success
          complaint={submitted}
          email={form.isAnonymous ? "" : form.complainant.contactEmail.trim()}
          documentCount={form.files.length}
        />
      </div>
    )
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="flex flex-col gap-4 surface-card border-border/70 bg-card p-5">
        <legend className="sr-only">Butir-butir pengadu</legend>
        <h2 className="text-base font-semibold text-primary" aria-hidden>
          1. Butir-butir pengadu
        </h2>
        <div
          role="radiogroup"
          aria-label="Cara membuat aduan"
          className="grid gap-3 sm:grid-cols-2"
        >
          {(
            [
              [
                false,
                UserIcon,
                "Dengan nama",
                "Butiran anda hanya diketahui oleh Unit Integriti.",
              ],
              [
                true,
                EyeOffIcon,
                "Tanpa nama",
                "Tiada sebarang butiran diminta, termasuk e-mel.",
              ],
            ] as const
          ).map(([anonymous, Icon, title, body]) => (
            <label
              key={title}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border border-border p-4 has-checked:border-primary has-checked:bg-status-menunggu-jmm/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
              )}
            >
              <input
                type="radio"
                name="anonymity"
                className="mt-1 accent-primary"
                checked={form.isAnonymous === anonymous}
                onChange={() => update("isAnonymous", anonymous)}
              />
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 text-secondary" aria-hidden />
                  {title}
                </span>
                <span className="text-sm text-muted-foreground">{body}</span>
              </span>
            </label>
          ))}
        </div>

        {form.isAnonymous ? (
          <AnonymousNotice />
        ) : (
          <>
            {signedIn && (
              <Notice tone="info">
                Anda log masuk sebagai <strong>{signedIn.email}</strong>. Aduan
                dengan e-mel ini dipaparkan di Aduan saya.
              </Notice>
            )}
            <p className="text-sm text-muted-foreground">
              Nama, warganegara, no. kad pengenalan (atau no. pasport bagi bukan
              warganegara) dan e-mel diwajibkan. Butiran lain membantu pegawai
              mengesahkan dan menghubungi anda, dan dirahsiakan oleh Unit
              Integriti.
            </p>
            <ComplainantDetailsFields
              value={form.complainant}
              onChange={updateComplainant}
              errors={errors}
              audience="portal"
              nameRequired
              identityRequired
              emailRequired
              emailDescription="Pengesahan, no. rujukan dan makluman status dihantar ke sini."
            />
          </>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-5 surface-card border-border/70 bg-card p-5">
        <legend className="sr-only">Maklumat aduan</legend>
        <h2 className="text-base font-semibold text-primary" aria-hidden>
          2. Maklumat aduan
        </h2>
        <AccusedPersonFields
          index={1}
          value={form.accused1}
          onChange={updateAccused("accused1")}
        />
        <AccusedPersonFields
          index={2}
          value={form.accused2}
          onChange={updateAccused("accused2")}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Tarikh kejadian" error={errors.incidentDate}>
            <Input
              type="date"
              max={todayIso()}
              value={form.incidentDate}
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
          <FormField label="Jenis salah laku">
            <IntegrityCategorySelect
              value={form.integrityCategory}
              onValueChange={(v) => update("integrityCategory", v)}
              nullLabel="Tidak pasti"
              placeholder="Tidak pasti"
            />
          </FormField>
          <FormField
            label="Keterangan aduan / maklumat"
            required
            error={errors.caseDescription}
            description="Nyatakan apa yang berlaku, bila, di mana, siapa yang terlibat atau boleh membantu, bagaimana dan mengapa ia dilakukan."
            className="sm:col-span-2 lg:col-span-3"
          >
            <FieldControl
              render={
                <Textarea
                  rows={8}
                  maxLength={20000}
                  value={form.caseDescription}
                  onChange={(e) => update("caseDescription", e.target.value)}
                />
              }
            />
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            Dokumen sokongan{" "}
            <span className="font-normal text-muted-foreground">(pilihan)</span>
          </legend>
          <DocumentPicker
            files={form.files}
            onChange={(files) => update("files", files)}
            disabled={submitting}
            note={
              form.isAnonymous
                ? "Maklumat tersembunyi dalam gambar (lokasi, kamera, masa) dibuang secara automatik. Nama pengarang dalam PDF atau DOCX tidak dibuang — semak sifat dokumen sebelum memuat naik."
                : "Dokumen, gambar atau tangkapan layar yang menyokong aduan. Tidak dapat memuat naik sekarang? Hantar aduan dahulu; pegawai akan menghubungi anda melalui e-mel."
            }
          />
        </fieldset>
      </fieldset>

      <section
        aria-labelledby="disclaimer-heading"
        className="flex flex-col gap-3 surface-card border-accent/50 bg-card p-5"
      >
        <h2
          id="disclaimer-heading"
          className="text-base font-semibold text-primary"
        >
          3. Penafian pengendalian aduan
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/90">
          <li>
            Aduan dikendalikan secara sulit oleh Unit Integriti dan dinilai oleh
            jawatankuasa sebelum sebarang tindakan diambil.
          </li>
          <li>
            Membuat aduan tidak menjamin siasatan atau tindakan tertentu.
            Keputusan bergantung pada maklumat yang diberikan.
          </li>
          <li>
            Aduan tanpa nama diterima tanpa sebarang butiran pengadu. Kami tidak
            dapat menghubungi anda, jadi aduan mungkin tidak dapat diteruskan
            jika maklumat tidak mencukupi.
          </li>
          <li>
            Makluman dihantar melalui e-mel sahaja. Kami tidak akan menghantar
            SMS atau meminta kod melalui telefon.
          </li>
        </ul>
        <CheckboxField
          checked={form.disclaimer}
          onChange={(e) => update("disclaimer", e.target.checked)}
          error={errors.disclaimer}
          label="Saya telah membaca dan memahami penafian di atas, dan maklumat yang saya berikan adalah benar setakat pengetahuan saya."
        />
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      {duplicates !== null ? (
        <div
          ref={scrollIntoViewCenteredOnMount}
          className="flex flex-col gap-3 surface-card border-accent/60 bg-status-dalam-tindakan/40 p-5"
        >
          <h2 className="font-semibold text-status-dalam-tindakan-foreground">
            Aduan ini mungkin sudah pernah dibuat
          </h2>
          <p className="text-sm">
            Aduan anda belum dihantar. Maklumat yang anda berikan menyerupai
            aduan yang telah diterima. Jika anda sudah pernah menghantar aduan
            ini, anda boleh{" "}
            <Link
              href="/track"
              className="text-primary underline-offset-4 hover:underline"
            >
              menyemak statusnya
            </Link>{" "}
            menggunakan no. rujukan. Jika ini perkara baharu atau maklumat
            tambahan, sahkan untuk menghantar.
          </p>
          <CheckboxField
            checked={confirmNew}
            onChange={(e) => setConfirmNew(e.target.checked)}
            label="Ini aduan baharu atau mengandungi maklumat baharu. Hantar juga."
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="lg"
              disabled={!confirmNew || submitting}
              onClick={() => void submit(true)}
            >
              {submitting ? "Menghantar…" : "Hantar aduan"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Menghantar…" : "Hantar aduan"}
          </Button>
        </div>
      )}
    </form>
  )
}

/**
 * Anonymous (§8 decision 11): nothing about the complainant is asked or
 * stored — not even an email, like a surat layang. The complainant should
 * choose that knowingly, so the cost is spelled out before sending.
 */
function AnonymousNotice() {
  return (
    <Notice tone="warning" className="flex flex-col gap-1.5 px-4 py-3">
      <strong>Tiada sebarang butiran anda disimpan — termasuk e-mel.</strong>
      <span>
        Oleh itu, kami tidak dapat menghantar pengesahan, memaklumkan
        perkembangan atau meminta maklumat lanjut, dan anda tidak boleh log
        masuk. No. rujukan hanya dipaparkan sekali selepas aduan dihantar —
        simpan nombor itu untuk menyemak status.
      </span>
    </Notice>
  )
}

function Success({
  complaint,
  email,
  documentCount,
}: {
  complaint: PublicComplaint
  email: string
  documentCount: number
}) {
  const [copied, setCopied] = React.useState(false)
  return (
    <section
      aria-labelledby="submitted-heading"
      className="flex flex-col items-center gap-4 surface-card border-border/70 bg-card px-6 py-10 text-center"
    >
      <CheckCircle2Icon
        className="size-10 text-status-selesai-foreground"
        aria-hidden
      />
      <h2 id="submitted-heading" className="text-xl font-semibold text-primary">
        Aduan anda telah diterima
      </h2>
      <p className="text-sm text-muted-foreground">No. rujukan aduan anda</p>
      <p
        className="rounded-lg bg-muted px-5 py-3 text-2xl font-semibold tracking-wide text-foreground"
        data-testid="ref-no"
      >
        {complaint.complaintRefNo}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(complaint.complaintRefNo)
            .then(() => setCopied(true))
        }}
      >
        {copied ? "Disalin" : "Salin no. rujukan"}
      </Button>
      {email ? (
        <p className="max-w-md text-sm">
          Simpan nombor ini — ia diperlukan untuk menyemak status. Pengesahan
          dihantar ke <strong>{email}</strong>, kecuali jika aduan yang serupa
          baru dihantar dari e-mel yang sama.
        </p>
      ) : (
        <Notice tone="warning" className="max-w-md text-left">
          <strong>Simpan nombor ini sekarang.</strong> Tiada e-mel pengesahan
          dihantar, dan nombor ini tidak boleh dipaparkan semula — ia
          satu-satunya cara untuk menyemak status aduan anda.
        </Notice>
      )}
      {documentCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {documentCount} dokumen sokongan diterima bersama aduan.
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Link href="/track" className={buttonVariants()}>
          Semak status
        </Link>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Kembali ke laman utama
        </Link>
      </div>
    </section>
  )
}
