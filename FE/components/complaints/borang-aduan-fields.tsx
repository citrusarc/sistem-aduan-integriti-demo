"use client"

import * as React from "react"

import {
  ComplainantCategorySelect,
  GenderSelect,
  GradeLevelSelect,
} from "@/components/ui/enum-select"
import { FieldControl, FormField } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { NATIONALITY } from "@/types/enums"
import type {
  ComplainantCategory,
  Gender,
  GradeLevelGroup,
  Nationality,
} from "@/types/enums"

/**
 * Field groups of BORANG ADUAN/ MAKLUMAT (SPRM Tatacara Pengurusan Aduan 2022,
 * Lampiran 2), shared by the portal submission and staff registration so both
 * forms ask the same questions in the same order. Each form keeps its own
 * validation and request mapping; BE validates regardless.
 */

// ─── Butir-butir pengadu ─────────────────────────────────────────────────────

export type ComplainantDetails = {
  complainantCategory: ComplainantCategory | null
  particulars: string
  gradeLevel: GradeLevelGroup | null
  icNo: string
  /** Kept as typed; converted to a number on submit. */
  age: string
  passportNo: string
  gender: Gender | null
  race: string
  /** Decides the identity document: IC for WARGANEGARA, passport otherwise. */
  nationality: Nationality | null
  contactPhone: string
  contactPhone2: string
  contactEmail: string
  postalAddress: string
  occupation: string
  employer: string
}

export const EMPTY_COMPLAINANT: ComplainantDetails = {
  complainantCategory: null,
  particulars: "",
  gradeLevel: null,
  icNo: "",
  age: "",
  passportNo: "",
  gender: null,
  race: "",
  nationality: null,
  contactPhone: "",
  contactPhone2: "",
  contactEmail: "",
  postalAddress: "",
  occupation: "",
  employer: "",
}

export type ComplainantErrors = Partial<
  Record<keyof ComplainantDetails, string>
>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[0-9][0-9 -]{5,18}[0-9]$/
const IC_NO = /^\d{6}-?\d{2}-?\d{4}$/
const PASSPORT_NO = /^[A-Za-z0-9]{5,20}$/

/** Shape checks matching BE's validators. Required-ness is each form's call. */
export function complainantFormatErrors(
  value: ComplainantDetails,
  anonymous: boolean
): ComplainantErrors {
  const e: ComplainantErrors = {}
  // Anonymous sends no details, so none can be malformed.
  if (anonymous) return e
  const email = value.contactEmail.trim()
  if (email && !EMAIL.test(email)) e.contactEmail = "Alamat e-mel tidak sah"
  if (value.contactPhone.trim() && !PHONE.test(value.contactPhone.trim())) {
    e.contactPhone = "Nombor telefon tidak sah"
  }
  if (value.contactPhone2.trim() && !PHONE.test(value.contactPhone2.trim())) {
    e.contactPhone2 = "Nombor telefon tidak sah"
  }
  if (value.icNo.trim() && !IC_NO.test(value.icNo.trim())) {
    e.icNo = "No. kad pengenalan mesti 12 digit"
  }
  if (value.passportNo.trim() && !PASSPORT_NO.test(value.passportNo.trim())) {
    e.passportNo = "No. pasport tidak sah"
  }
  const age = value.age.trim()
  if (age && (!/^\d{1,3}$/.test(age) || Number(age) > 130)) {
    e.age = "Umur tidak sah"
  }
  return e
}

const text = (v: string) => (v.trim() ? v.trim() : null)

/**
 * §8 decision 12, for the portal: a named complainant states nationality and
 * gives the matching document — IC for a citizen, passport otherwise. Same
 * rule as BE's publicCreateComplaintSchema. Staff registration doesn't use it.
 */
export function identityDocumentErrors(
  value: ComplainantDetails
): ComplainantErrors {
  if (!value.nationality) return { nationality: "Pilih warganegara anda" }
  if (value.nationality === "WARGANEGARA" && !value.icNo.trim()) {
    return { icNo: "No. kad pengenalan wajib bagi warganegara" }
  }
  if (value.nationality === "BUKAN_WARGANEGARA" && !value.passportNo.trim()) {
    return { passportNo: "No. pasport wajib bagi bukan warganegara" }
  }
  return {}
}

/**
 * Request block for BE. Anonymous sends nothing about the person (§8 decision
 * 11) — BE refuses any detail (422), so nothing typed before switching leaks.
 */
export function complainantBody(value: ComplainantDetails, anonymous: boolean) {
  if (anonymous) return { isAnonymous: true }
  return {
    isAnonymous: false,
    complainantCategory: value.complainantCategory,
    contactEmail: text(value.contactEmail),
    contactPhone: text(value.contactPhone),
    contactPhone2: text(value.contactPhone2),
    particulars: text(value.particulars),
    gradeLevel: value.gradeLevel,
    // A non-citizen isn't asked for an IC number; the field is hidden, so
    // anything typed before switching isn't sent.
    icNo: value.nationality === "BUKAN_WARGANEGARA" ? null : text(value.icNo),
    passportNo: text(value.passportNo),
    age: value.age.trim() ? Number(value.age.trim()) : null,
    gender: value.gender,
    race: text(value.race),
    nationality: value.nationality,
    postalAddress: text(value.postalAddress),
    occupation: text(value.occupation),
    employer: text(value.employer),
  }
}

export function ComplainantDetailsFields({
  value,
  onChange,
  errors = {},
  audience,
  nameRequired,
  identityRequired,
  emailRequired,
  emailDescription,
}: {
  value: ComplainantDetails
  onChange: <K extends keyof ComplainantDetails>(
    key: K,
    next: ComplainantDetails[K]
  ) => void
  errors?: ComplainantErrors
  /** Wording: the complainant filling it in, or an officer on their behalf. */
  audience: "portal" | "staff"
  nameRequired?: boolean
  /** Portal: nationality and its matching document are required (decision 12). */
  identityRequired?: boolean
  emailRequired?: boolean
  emailDescription?: React.ReactNode
}) {
  const portal = audience === "portal"
  const input = (key: keyof ComplainantDetails) => ({
    value: value[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange(key, e.target.value),
  })
  const phoneNote = portal
    ? "Hanya untuk pegawai menghubungi anda secara manual. Sistem tidak menghantar SMS atau mesej ke nombor ini."
    : "Untuk kakitangan menghubungi secara manual sahaja. Sistem tidak menghantar SMS."

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Kategori pengadu">
        <ComplainantCategorySelect
          value={value.complainantCategory}
          onValueChange={(v) => onChange("complainantCategory", v)}
          nullLabel="Tidak dinyatakan"
          placeholder="Warga agensi / orang awam"
        />
      </FormField>

      <FormField
        label="Nama"
        required={nameRequired}
        error={errors.particulars}
      >
        <Input
          autoComplete={portal ? "name" : "off"}
          {...input("particulars")}
        />
      </FormField>
      <NationalityField
        value={value.nationality}
        onChange={(next) => onChange("nationality", next)}
        required={identityRequired}
        clearable={!portal}
        error={errors.nationality}
      />
      {value.nationality !== "BUKAN_WARGANEGARA" && (
        <FormField
          label="No. kad pengenalan"
          required={identityRequired && value.nationality === "WARGANEGARA"}
          error={errors.icNo}
        >
          <Input
            inputMode="numeric"
            placeholder="YYMMDD-PB-###G"
            autoComplete="off"
            {...input("icNo")}
          />
        </FormField>
      )}
      <FormField
        label={
          value.nationality === "WARGANEGARA" ? (
            <>
              No. pasport{" "}
              <span className="font-normal text-muted-foreground">
                (pilihan)
              </span>
            </>
          ) : (
            "No. pasport"
          )
        }
        required={identityRequired && value.nationality === "BUKAN_WARGANEGARA"}
        error={errors.passportNo}
      >
        <Input autoComplete="off" {...input("passportNo")} />
      </FormField>
      <FormField label="Umur" error={errors.age}>
        <Input inputMode="numeric" maxLength={3} {...input("age")} />
      </FormField>
      <FormField label="Jantina">
        <GenderSelect
          value={value.gender}
          onValueChange={(v) => onChange("gender", v)}
          nullLabel="Tidak dinyatakan"
          placeholder="Tidak dinyatakan"
        />
      </FormField>
      <FormField label="Bangsa">
        <Input {...input("race")} />
      </FormField>

      <FormField
        label="No. telefon (1)"
        error={errors.contactPhone}
        description={phoneNote}
      >
        <Input
          type="tel"
          autoComplete={portal ? "tel" : "off"}
          {...input("contactPhone")}
        />
      </FormField>
      <FormField label="No. telefon (2)" error={errors.contactPhone2}>
        <Input type="tel" autoComplete="off" {...input("contactPhone2")} />
      </FormField>
      <FormField
        label="Alamat e-mel"
        required={emailRequired}
        error={errors.contactEmail}
        description={emailDescription}
      >
        <Input
          type="email"
          autoComplete={portal ? "email" : "off"}
          {...input("contactEmail")}
        />
      </FormField>

      <FormField label="Alamat surat-menyurat" className="sm:col-span-2">
        <FieldControl
          render={
            <Textarea
              rows={3}
              autoComplete={portal ? "street-address" : "off"}
              value={value.postalAddress}
              onChange={(e) => onChange("postalAddress", e.target.value)}
            />
          }
        />
      </FormField>
      <FormField label="Pekerjaan">
        <Input {...input("occupation")} />
      </FormField>
      <FormField label="Agensi / syarikat majikan">
        <Input {...input("employer")} />
      </FormField>
      {value.complainantCategory !== "ORANG_AWAM" && (
        <FormField
          label={
            portal
              ? "Kumpulan gred (jika penjawat awam)"
              : "Kumpulan gred pengadu"
          }
        >
          <GradeLevelSelect
            value={value.gradeLevel}
            onValueChange={(v) => onChange("gradeLevel", v)}
            nullLabel="Tidak berkaitan"
            placeholder="Tidak berkaitan"
          />
        </FormField>
      )}
    </div>
  )
}

/** WARGANEGARA: exactly two options. */
function NationalityField({
  value,
  onChange,
  required,
  clearable,
  error,
}: {
  value: Nationality | null
  onChange: (next: Nationality | null) => void
  required?: boolean
  clearable?: boolean
  error?: string
}) {
  const name = React.useId()
  const errorId = React.useId()
  return (
    <fieldset
      className="flex flex-col gap-1.5 sm:col-span-2"
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-1.5 text-sm font-medium">
        Warganegara
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(NATIONALITY) as Nationality[]).map((option, index) => (
          <label
            key={option}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-status-menunggu-jmm has-focus-visible:ring-3 has-focus-visible:ring-ring/30",
              error && "border-destructive"
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              required={required}
              aria-invalid={index === 0 && error ? true : undefined}
              className="accent-primary"
            />
            {NATIONALITY[option]}
          </label>
        ))}
        {clearable && value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Kosongkan
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

// ─── Maklumat aduan: orang yang ditohmah ─────────────────────────────────────

export type AccusedPerson = {
  particulars: string
  department: string
  position: string
}

export const EMPTY_ACCUSED: AccusedPerson = {
  particulars: "",
  department: "",
  position: "",
}

/** NAMA ORANG YANG DITOHMAH (n), NAMA AGENSI/ SYARIKAT, JAWATAN. */
export function AccusedPersonFields({
  index,
  value,
  onChange,
  children,
}: {
  index: 1 | 2
  value: AccusedPerson
  onChange: <K extends keyof AccusedPerson>(key: K, next: string) => void
  /** Extra fields for this person, e.g. the Masterlist grade on the staff form. */
  children?: React.ReactNode
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-sm font-medium text-secondary">
        Orang yang ditohmah ({index})
        {index === 2 && (
          <span className="font-normal text-muted-foreground"> — jika ada</span>
        )}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Nama">
          <Input
            value={value.particulars}
            onChange={(e) => onChange("particulars", e.target.value)}
          />
        </FormField>
        <FormField label="Nama agensi / syarikat">
          <Input
            value={value.department}
            onChange={(e) => onChange("department", e.target.value)}
          />
        </FormField>
        <FormField label="Jawatan">
          <Input
            value={value.position}
            onChange={(e) => onChange("position", e.target.value)}
          />
        </FormField>
        {children}
      </div>
    </fieldset>
  )
}

// ─── Dokumen sokongan: ADA / TIADA ───────────────────────────────────────────

export function SupportingDocumentsField({
  value,
  onChange,
  description,
}: {
  value: boolean | null
  onChange: (next: boolean | null) => void
  description?: React.ReactNode
}) {
  const name = React.useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Dokumen sokongan</legend>
      <div className="flex flex-wrap gap-2">
        {(
          [
            [true, "Ada"],
            [false, "Tiada"],
          ] as const
        ).map(([option, label]) => (
          <label
            key={label}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-status-menunggu-jmm has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="accent-primary"
            />
            {label}
          </label>
        ))}
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Kosongkan
          </button>
        )}
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </fieldset>
  )
}
