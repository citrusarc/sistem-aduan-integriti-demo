import type { Metadata } from "next"

import { ComplaintSubmitForm } from "@/components/portal/complaint-submit-form"
import { PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Hantar Aduan" }

export default function PortalSubmitPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Hantar Aduan"
        description="Laporkan salah laku, rasuah atau salah guna kuasa. Anda boleh membuat aduan tanpa nama."
      />
      <ComplaintSubmitForm />
    </div>
  )
}
