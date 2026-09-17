import type { Metadata } from "next"

import { PageHeader, PagePlaceholder } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Permohonan Perlindungan" }

export default function ProtectionRequestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Permohonan Perlindungan"
        description="Permohonan perlindungan pemberi maklumat untuk semakan KUI."
      />
      <PagePlaceholder />
    </div>
  )
}
