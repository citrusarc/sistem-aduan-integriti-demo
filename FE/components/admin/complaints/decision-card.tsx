"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCircle2Icon, CircleDashedIcon, LockIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { ConfirmDialog } from "@/components/ui/dialog"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { DetailList } from "@/components/ui/section"
import { adminApi } from "@/lib/api"
import { UserFacingError } from "@/lib/errors"
import { malaysiaInputToIso, nowMalaysiaInput } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { JmmDecision, JmmSignatory, QuorumState } from "@/types/entities"
import {
  JMM_CLASSIFICATION,
  JMM_OUTCOME,
  JMM_SIGNATORY_CATEGORY,
  JMM_SOURCE,
  labelFor,
} from "@/types/enums"

const CATEGORY_ORDER = { PENGERUSI: 0, AHLI: 1, URUS_SETIA: 2 } as const

/**
 * One BORANG JMM decision: the form fields, its signature block, and quorum as
 * BE computes it (rule 1). Once finalized the decision is locked (rule 8) —
 * no more signing here, and corrections are a new decision row.
 */
export function DecisionCard({
  decision,
  meetingLabel,
  onSigned,
}: {
  decision: JmmDecision
  /** e.g. the meeting number, when known; otherwise the meeting id is linked. */
  meetingLabel?: string | null
  onSigned: () => Promise<void>
}) {
  const locked = decision.quorum.finalized
  const signatories = [...decision.signatories].sort(
    (a, b) =>
      CATEGORY_ORDER[a.roleCategory] - CATEGORY_ORDER[b.roleCategory] ||
      a.roleTitle.localeCompare(b.roleTitle)
  )

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border/70 bg-muted/30 p-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            Keputusan <DateDisplay value={decision.decisionDate} />
            {decision.meetingId && (
              <>
                {" · "}
                <Link
                  href={`/jmm/${decision.meetingId}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {meetingLabel ?? "Lihat mesyuarat"}
                </Link>
              </>
            )}
          </p>
          <h3 className="font-semibold">
            {labelFor(JMM_OUTCOME, decision.outcome)}
          </h3>
        </div>
        <QuorumBadge quorum={decision.quorum} />
      </header>

      <DetailList
        items={[
          { label: "No. fail agensi", value: decision.agencyFileNo },
          { label: "No. aduan pada borang", value: decision.complaintNoOnForm },
          {
            label: "Sumber (JMM)",
            value:
              decision.jmmSource && labelFor(JMM_SOURCE, decision.jmmSource),
          },
          {
            label: "Klasifikasi (JMM)",
            value:
              decision.jmmClassification &&
              labelFor(JMM_CLASSIFICATION, decision.jmmClassification),
          },
          { label: "Ringkasan", value: decision.summary, wide: true },
          {
            label: "Ulasan / tindakan lanjut",
            value: decision.remarksFurtherAction,
            wide: true,
          },
        ]}
      />

      <SignatureBlock
        decisionId={decision.id}
        signatories={signatories}
        quorum={decision.quorum}
        locked={locked}
        onSigned={onSigned}
      />
    </article>
  )
}

export function QuorumBadge({ quorum }: { quorum: QuorumState }) {
  if (quorum.finalized) {
    return (
      <Badge tone="calm">
        <LockIcon aria-hidden />
        Muktamad · dikunci
      </Badge>
    )
  }
  return (
    <Badge tone="accent">
      <CircleDashedIcon aria-hidden />
      Belum muktamad
    </Badge>
  )
}

function SignatureBlock({
  decisionId,
  signatories,
  quorum,
  locked,
  onSigned,
}: {
  decisionId: string
  signatories: JmmSignatory[]
  quorum: QuorumState
  locked: boolean
  onSigned: () => Promise<void>
}) {
  const [signing, setSigning] = React.useState<JmmSignatory | null>(null)
  const [signedAt, setSignedAt] = React.useState("")

  const checks = [
    { ok: quorum.hasChair, label: "Pengerusi telah menandatangani" },
    {
      ok: quorum.memberCount >= 1,
      label: `Sekurang-kurangnya seorang ahli (${quorum.memberCount} ditandatangani)`,
    },
    { ok: quorum.fullySigned, label: "Semua slot ditandatangani" },
  ]

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <h4 className="text-sm font-semibold">Blok tandatangan</h4>
        <ul aria-label="Keadaan kuorum" className="flex flex-col gap-1 text-xs">
          {checks.map((c) => (
            <li
              key={c.label}
              className={cn(
                "flex items-center gap-1.5",
                c.ok
                  ? "text-status-selesai-foreground"
                  : "text-muted-foreground"
              )}
            >
              {c.ok ? (
                <CheckCircle2Icon className="size-3.5" aria-hidden />
              ) : (
                <CircleDashedIcon className="size-3.5" aria-hidden />
              )}
              <span>
                <span className="sr-only">{c.ok ? "Ya: " : "Belum: "}</span>
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {signatories.map((s) => (
          <li
            key={s.id}
            className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{s.roleTitle}</span>
              <span className="text-xs text-muted-foreground">
                {labelFor(JMM_SIGNATORY_CATEGORY, s.roleCategory)}
              </span>
            </div>
            {s.signedAt ? (
              <span className="flex items-center gap-1.5 text-sm text-status-selesai-foreground">
                <CheckCircle2Icon className="size-4" aria-hidden />
                <span>
                  Ditandatangani{" "}
                  <DateDisplay value={s.signedAt} kind="datetime" />
                </span>
              </span>
            ) : locked ? (
              <span className="text-sm text-muted-foreground">
                Tidak ditandatangani
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSignedAt(nowMalaysiaInput())
                  setSigning(s)
                }}
              >
                Rekod tandatangan
              </Button>
            )}
          </li>
        ))}
      </ul>

      {locked && (
        <p className="text-xs text-muted-foreground">
          Keputusan yang ditandatangani sepenuhnya tidak boleh diubah.
          Pembetulan dibuat dengan merekod keputusan baharu.
        </p>
      )}

      <ConfirmDialog
        open={signing !== null}
        onOpenChange={(open) => !open && setSigning(null)}
        title="Rekod tandatangan"
        description={
          signing
            ? `${signing.roleTitle} — tandatangan tidak boleh ditarik balik atau diubah selepas direkod.`
            : undefined
        }
        confirmLabel="Rekod tandatangan"
        onConfirm={async () => {
          const iso = malaysiaInputToIso(signedAt)
          if (!iso)
            throw new UserFacingError("Nyatakan tarikh dan masa tandatangan")
          if (new Date(iso) > new Date()) {
            throw new UserFacingError(
              "Masa tandatangan tidak boleh pada masa hadapan"
            )
          }
          await adminApi.decisions.sign(decisionId, {
            signatoryId: signing!.id,
            signedAt: iso,
          })
          await onSigned()
        }}
      >
        <FormField
          label="Tarikh & masa ditandatangani"
          description="Waktu Malaysia. Seperti pada borang bertandatangan."
        >
          <Input
            type="datetime-local"
            value={signedAt}
            max={nowMalaysiaInput()}
            onChange={(e) => setSignedAt(e.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  )
}
