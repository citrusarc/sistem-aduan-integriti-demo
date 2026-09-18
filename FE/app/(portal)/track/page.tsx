import type { Metadata } from "next"
import Link from "next/link"

import { TrackLookup } from "@/components/portal/track-lookup"
import { PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Semak Status" }

export default function PortalTrackPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader
        title="Semak Status"
        description="Masukkan nombor rujukan untuk melihat status aduan."
      />
      <TrackLookup />
      <p className="text-sm text-muted-foreground">
        Mempunyai lebih daripada satu aduan?{" "}
        <Link
          href="/me"
          className="text-primary underline-offset-4 hover:underline"
        >
          Log masuk atau daftar
        </Link>{" "}
        dengan e-mel yang sama untuk melihat semuanya.
      </p>
    </div>
  )
}
