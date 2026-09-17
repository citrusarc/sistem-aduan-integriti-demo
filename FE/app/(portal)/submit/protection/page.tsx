import type { Metadata } from "next"
import { Suspense } from "react"

import { ProtectionRequestPage } from "@/components/portal/protection-request-form"
import { PageHeader } from "@/components/ui/page-header"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Perlindungan Pemberi Maklumat" }

export default function PortalSubmitProtectionPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Perlindungan Pemberi Maklumat"
        description="Mohon perlindungan untuk aduan yang telah anda hantar."
      />
      {/* ?aduan= preselects a complaint (useSearchParams). */}
      <Suspense fallback={<LoadingState />}>
        <ProtectionRequestPage />
      </Suspense>
    </div>
  )
}
