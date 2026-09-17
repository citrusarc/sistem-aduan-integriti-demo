import type { Metadata } from "next"
import { Suspense } from "react"

import { DecisionLog } from "@/components/admin/jmm/decision-log"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Log Keputusan" }

export default function DecisionLogPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DecisionLog />
    </Suspense>
  )
}
