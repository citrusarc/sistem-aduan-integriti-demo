import type { Metadata } from "next"

import { ReferredActions } from "@/components/admin/referrals/referred-actions"

export const metadata: Metadata = { title: "Tugasan Sub-unit" }

export default function SubunitTasksPage() {
  return (
    <ReferredActions
      title="Tugasan Sub-unit"
      description="Tindakan kes yang dirujuk kepada anda oleh Unit Integriti."
    />
  )
}
