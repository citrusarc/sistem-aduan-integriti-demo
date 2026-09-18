"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { CaseActions } from "@/components/admin/complaints/case-actions"
import { CaseDocuments } from "@/components/admin/complaints/case-documents"
import { DecisionCard } from "@/components/admin/complaints/decision-card"
import { DuplicatePanel } from "@/components/admin/complaints/duplicate-panel"
import { BackLink } from "@/components/ui/back-link"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { ConfirmDialog } from "@/components/ui/dialog"
import { PageHeader } from "@/components/ui/page-header"
import { DetailList, Notice, Section } from "@/components/ui/section"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StatusPill } from "@/components/ui/status-pill"
import { StatusTimeline } from "@/components/ui/status-timeline"
import { useApiData } from "@/hooks/use-api-data"
import { adminApi } from "@/lib/api"
import type { AdminComplaintDetail, Complainant } from "@/types/entities"
import {
  COMPLAINANT_CATEGORY,
  COMPLAINT_DIRECTED_TO,
  GENDER,
  NATIONALITY,
  GRADE_LEVEL_GROUP,
  INFO_CLASSIFICATION,
  INTEGRITY_CATEGORY,
  labelFor,
  RECEIVED_VIA,
  SECTOR,
  SOURCE_CHANNEL,
} from "@/types/enums"

const optional = <M extends Record<string, string>>(
  map: M,
  value: string | null
) => (value ? labelFor(map, value) : null)

/**
 * The full case file for the Integrity Unit: complaint, JMM decisions with
 * their signature blocks, case actions and referrals, and closing the case.
 * Everything here is internal (rules 2 and 9) — it only ever renders for
 * Integrity Unit roles, and BE refuses the data to anyone else.
 */
export function CaseFile({ id }: { id: string }) {
  const detail = useApiData(`complaint:${id}`, () =>
    adminApi.complaints.get(id)
  )
  const recipients = useApiData("assignees", () =>
    adminApi.caseActions.assignees()
  )

  if (detail.status === "error" && !detail.data) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink href="/complaints">Daftar aduan</BackLink>
        <ErrorState error={detail.error} onRetry={() => void detail.reload()} />
      </div>
    )
  }
  if (!detail.data) return <LoadingState />

  return (
    <CaseFileView
      complaint={detail.data}
      reload={detail.reload}
      recipients={recipients.data}
      recipientsError={recipients.status === "error" ? recipients.error : null}
    />
  )
}

function CaseFileView({
  complaint,
  reload,
  recipients,
  recipientsError,
}: {
  complaint: AdminComplaintDetail
  reload: () => Promise<void>
  recipients: React.ComponentProps<typeof CaseActions>["recipients"]
  recipientsError: unknown
}) {
  const [closing, setClosing] = React.useState(false)
  const justRegistered = useSearchParams().get("didaftar") === "1"
  const router = useRouter()
  const pathname = usePathname()

  const everNfa =
    complaint.status === "NFA" ||
    complaint.decisions.some((d) => d.outcome === "NFA")
  const canClose = complaint.status === "DALAM_TINDAKAN"

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/complaints">Daftar aduan</BackLink>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {complaint.complaintRefNo}
            <StatusPill status={complaint.status} />
          </span>
        }
        description={
          <>
            Status sejak{" "}
            <DateDisplay value={complaint.statusChangedAt} kind="datetime" />
            {" · "}Didaftarkan{" "}
            <DateDisplay value={complaint.createdAt} kind="datetime" />
          </>
        }
        actions={
          canClose ? (
            <Button onClick={() => setClosing(true)}>Tutup kes</Button>
          ) : undefined
        }
      />

      {justRegistered && (
        <Notice
          tone="success"
          className="flex flex-wrap items-center justify-between gap-2"
        >
          <span>
            Aduan didaftarkan dengan no. rujukan{" "}
            <strong>{complaint.complaintRefNo}</strong>.
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => router.replace(pathname, { scroll: false })}
          >
            Tutup
          </Button>
        </Notice>
      )}

      <DuplicatePanel complaint={complaint} reload={reload} />

      {complaint.status === "NFA" && (
        <Notice tone="info">
          Kes NFA adalah sulit kepada Unit Integriti dan tidak didedahkan kepada
          pengadu, orang awam atau penerima rujukan.
        </Notice>
      )}

      <Section title="Butiran aduan">
        <DetailList
          items={[
            {
              label: "Tarikh terima di UI",
              value: complaint.receivedDateUi && (
                <DateDisplay value={complaint.receivedDateUi} />
              ),
            },
            {
              label: "Tarikh aduan",
              value: complaint.complaintDate && (
                <DateDisplay value={complaint.complaintDate} />
              ),
            },
            {
              label: "Bulan laporan",
              value:
                [complaint.reportMonth, complaint.reportYear]
                  .filter(Boolean)
                  .join(" ") || null,
            },
            {
              label: "Cara diterima (Lampiran 2)",
              value: optional(RECEIVED_VIA, complaint.receivedVia),
            },
            {
              label: "Saluran (Masterlist)",
              value: optional(SOURCE_CHANNEL, complaint.sourceChannel),
            },
            {
              label: "Aduan terhadap",
              value: optional(COMPLAINT_DIRECTED_TO, complaint.directedTo),
            },
            {
              label: "Klasifikasi maklumat",
              value: optional(
                INFO_CLASSIFICATION,
                complaint.infoClassification
              ),
            },
            {
              label: "Kategori integriti",
              value: optional(INTEGRITY_CATEGORY, complaint.integrityCategory),
            },
            { label: "Sektor", value: optional(SECTOR, complaint.sector) },
            {
              label: "Tarikh kejadian",
              value: complaint.incidentDate && (
                <>
                  <DateDisplay value={complaint.incidentDate} />
                  {complaint.incidentTime && `, ${complaint.incidentTime}`}
                </>
              ),
            },
            {
              label: "Dokumen sokongan",
              value:
                complaint.hasSupportingDocuments === null
                  ? null
                  : complaint.hasSupportingDocuments
                    ? "Ada"
                    : "Tiada",
            },
            {
              label: "Keterangan aduan",
              value: complaint.caseDescription,
              wide: true,
            },
          ]}
        />
      </Section>

      <Section title="Butir-butir pengadu">
        <ComplainantDetails complainant={complaint.complainant} />
      </Section>

      <Section title="Orang yang ditohmah">
        <DetailList
          items={[
            { label: "Nama (1)", value: complaint.accusedParticulars },
            {
              label: "Agensi / syarikat (1)",
              value: complaint.accusedDepartment,
            },
            { label: "Jawatan (1)", value: complaint.accusedPosition },
            {
              label: "Kumpulan gred (1)",
              value: optional(GRADE_LEVEL_GROUP, complaint.accusedGradeLevel),
            },
            ...(complaint.accused2Particulars ||
            complaint.accused2Department ||
            complaint.accused2Position
              ? [
                  { label: "Nama (2)", value: complaint.accused2Particulars },
                  {
                    label: "Agensi / syarikat (2)",
                    value: complaint.accused2Department,
                  },
                  { label: "Jawatan (2)", value: complaint.accused2Position },
                ]
              : []),
          ]}
        />
      </Section>

      <Section
        title="Sejarah status"
        description="Setiap perubahan status, terkini di atas. Pengadu melihat garis masa yang sama di portal (kecuali kes NFA, yang tidak didedahkan)."
      >
        <StatusTimeline entries={complaint.timeline} />
      </Section>

      <Section
        title="Dokumen sokongan"
        description="Muat turun sahaja — fail tidak dibuka dalam pelayar. Dilihat oleh Unit Integriti sahaja."
      >
        <CaseDocuments
          complaintId={complaint.id}
          attachments={complaint.attachments}
          onChanged={reload}
        />
      </Section>

      <Section
        title="Keputusan JMM"
        description="Keputusan dimuktamadkan apabila Pengerusi dan sekurang-kurangnya seorang Ahli menandatangani, dan semua slot ditandatangani."
      >
        {complaint.decisions.length === 0 ? (
          <EmptyState
            title="Belum ada keputusan"
            description={
              complaint.status === "MENUNGGU_JMM"
                ? "Aduan ini dalam agenda mesyuarat JMM. Keputusan direkod dari agenda mesyuarat."
                : "Masukkan aduan ke agenda mesyuarat JMM untuk diputuskan."
            }
            action={
              <Link
                href="/jmm"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Mesyuarat JMM
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {complaint.decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                onSigned={reload}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Tindakan kes"
        description="Tindakan susulan dan rujukan kepada Ketua Jabatan atau sub-unit."
      >
        <CaseActions
          actions={complaint.caseActions}
          decisions={complaint.decisions}
          recipients={recipients}
          recipientsError={recipientsError}
          referralBlocked={everNfa}
          complaintId={complaint.id}
          onChanged={reload}
        />
      </Section>

      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={`Tutup kes ${complaint.complaintRefNo}?`}
        description="Status akan menjadi Selesai. Kes yang ditutup tidak boleh dibuka semula, dimasukkan ke agenda atau diputuskan lagi."
        confirmLabel="Tutup kes"
        onConfirm={async () => {
          await adminApi.complaints.close(complaint.id)
          await reload()
        }}
      />
    </div>
  )
}

/** BUTIR-BUTIR PENGADU (Lampiran 2). Internal to the Integrity Unit. */
function ComplainantDetails({
  complainant: p,
}: {
  complainant: Complainant | null
}) {
  if (!p) {
    return (
      <p className="text-sm text-muted-foreground">
        Tiada maklumat pengadu direkodkan.
      </p>
    )
  }
  const contact = [
    { label: "E-mel", value: p.contactEmail },
    { label: "No. telefon (1)", value: p.contactPhone },
    { label: "No. telefon (2)", value: p.contactPhone2 },
  ]
  const category = {
    label: "Kategori pengadu",
    value: optional(COMPLAINANT_CATEGORY, p.complainantCategory),
  }
  if (p.isAnonymous) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="info">
          Pengadu tanpa nama — nama dan butiran peribadi tidak disimpan.
        </Notice>
        <DetailList items={[category, ...contact]} />
      </div>
    )
  }
  return (
    <DetailList
      items={[
        category,
        { label: "Nama", value: p.particulars },
        { label: "No. kad pengenalan", value: p.icNo },
        { label: "No. pasport", value: p.passportNo },
        { label: "Umur", value: p.age === null ? null : String(p.age) },
        { label: "Jantina", value: optional(GENDER, p.gender) },
        { label: "Bangsa", value: p.race },
        { label: "Warganegara", value: optional(NATIONALITY, p.nationality) },
        ...contact,
        { label: "Pekerjaan", value: p.occupation },
        { label: "Agensi / syarikat majikan", value: p.employer },
        {
          label: "Kumpulan gred",
          value: optional(GRADE_LEVEL_GROUP, p.gradeLevel),
        },
        { label: "Alamat surat-menyurat", value: p.postalAddress, wide: true },
      ]}
    />
  )
}
