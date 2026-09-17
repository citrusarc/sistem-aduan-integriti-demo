import type { Metadata } from "next"

import { ReferredActions } from "@/components/admin/referrals/referred-actions"

export const metadata: Metadata = { title: "Peti Masuk Ketua Jabatan" }

export default function KjInboxPage() {
  return (
    <ReferredActions
      title="Peti Masuk Ketua Jabatan"
      description="Tindakan kes yang dirujuk kepada anda oleh Unit Integriti."
    />
  )
}
