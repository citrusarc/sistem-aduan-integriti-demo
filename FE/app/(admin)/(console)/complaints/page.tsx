import type { Metadata } from "next"
import { Suspense } from "react"

import { ComplaintRegister } from "@/components/admin/complaints/complaint-register"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Daftar Aduan" }

export default function ComplaintsPage() {
  return (
    // Filters live in the URL (useSearchParams), which needs a Suspense boundary.
    <Suspense fallback={<LoadingState />}>
      <ComplaintRegister />
    </Suspense>
  )
}
