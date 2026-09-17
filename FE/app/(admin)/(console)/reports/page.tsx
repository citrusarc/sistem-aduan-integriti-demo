import type { Metadata } from "next"
import { Suspense } from "react"

import { Reports } from "@/components/admin/stats/reports"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Laporan" }

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Reports />
    </Suspense>
  )
}
