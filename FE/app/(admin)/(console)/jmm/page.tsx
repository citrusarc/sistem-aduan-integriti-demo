import type { Metadata } from "next"
import { Suspense } from "react"

import { MeetingList } from "@/components/admin/jmm/meeting-list"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Mesyuarat JMM" }

export default function JmmPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MeetingList />
    </Suspense>
  )
}
