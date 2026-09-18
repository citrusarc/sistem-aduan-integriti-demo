"use client"

import * as React from "react"
import Link from "next/link"
import { CopyIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/dialog"
import { Notice } from "@/components/ui/section"
import { StatusPill } from "@/components/ui/status-pill"
import { adminApi } from "@/lib/api"
import type { AdminComplaintDetail } from "@/types/entities"

type Pending = "confirm" | "dismiss" | "undo" | null

/**
 * §8 decision 16 on the case file. The system only suggests; staff decide:
 *
 *   suspected   "Tandakan Pendua" (BARU -> PENDUA, pointing at the suggested
 *               case) or "Bukan pendua" (drops the suggestion)
 *   PENDUA      shows the original, and "Batal Pendua" (-> BARU)
 *
 * Only a BARU complaint can be confirmed — BE answers 409 otherwise, and the
 * button is offered only then. A repeat is never tabled or decided.
 */
export function DuplicatePanel({
  complaint,
  reload,
}: {
  complaint: AdminComplaintDetail
  reload: () => Promise<void>
}) {
  const [pending, setPending] = React.useState<Pending>(null)
  const suspected = complaint.suspectedDuplicate
  const original = complaint.duplicateOf

  if (complaint.status === "PENDUA" && original) {
    return (
      <>
        <Notice
          tone="info"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="flex flex-wrap items-center gap-2">
            <CopyIcon className="size-4" aria-hidden />
            Pendua kepada
            <Link
              href={`/complaints/${original.id}`}
              className="font-semibold underline underline-offset-4"
            >
              {original.complaintRefNo}
            </Link>
            <StatusPill status={original.status} />
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPending("undo")}
          >
            Batal Pendua
          </Button>
        </Notice>
        <ConfirmDialog
          open={pending === "undo"}
          onOpenChange={(o) => !o && setPending(null)}
          title="Batal status Pendua?"
          description="Aduan ini kembali berstatus Baru dan boleh diproses seperti aduan lain."
          confirmLabel="Batal Pendua"
          onConfirm={async () => {
            await adminApi.complaints.undoDuplicate(complaint.id)
            await reload()
          }}
        />
      </>
    )
  }

  if (!suspected) return null

  const canConfirm = complaint.status === "BARU"
  return (
    <>
      <Notice tone="warning" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <strong>Mungkin pendua kepada</strong>
          <Link
            href={`/complaints/${suspected.id}`}
            className="font-semibold underline underline-offset-4"
          >
            {suspected.complaintRefNo}
          </Link>
          <StatusPill status={suspected.status} />
          <span className="text-xs">
            skor {Math.round(suspected.score * 100)}%
          </span>
        </div>
        <ul className="list-disc pl-5 text-sm">
          {suspected.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="text-xs">
          Dikesan secara automatik semasa pendaftaran. Perkataan umum seperti
          “rasuah” atau “belanja” tidak dikira — hanya nama, tempat, amaun dan
          butiran khusus. Semak kedua-dua aduan sebelum memutuskan.
          {!canConfirm &&
            " Hanya aduan berstatus Baru boleh ditandakan Pendua; keluarkan dari agenda JMM dahulu jika perlu."}
        </p>
        <div className="flex flex-wrap gap-2">
          {canConfirm && (
            <Button size="sm" onClick={() => setPending("confirm")}>
              Tandakan Pendua
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPending("dismiss")}
          >
            Bukan pendua
          </Button>
        </div>
      </Notice>
      <ConfirmDialog
        open={pending === "confirm"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Tandakan sebagai Pendua kepada ${suspected.complaintRefNo}?`}
        description="Aduan ini berstatus Pendua dan tidak dibawa ke JMM. Pengadu melihat status Pendua semasa menyemak. Boleh dibatalkan kemudian."
        confirmLabel="Tandakan Pendua"
        onConfirm={async () => {
          await adminApi.complaints.confirmDuplicate(complaint.id, suspected.id)
          await reload()
        }}
      />
      <ConfirmDialog
        open={pending === "dismiss"}
        onOpenChange={(o) => !o && setPending(null)}
        title="Bukan pendua?"
        description="Cadangan ini dibuang. Status aduan tidak berubah."
        confirmLabel="Bukan pendua"
        onConfirm={async () => {
          await adminApi.complaints.dismissDuplicateSuspicion(complaint.id)
          await reload()
        }}
      />
    </>
  )
}
