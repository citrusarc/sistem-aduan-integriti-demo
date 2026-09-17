import type { Metadata } from "next"
import { Suspense } from "react"

import { NoAccess } from "@/components/admin/no-access"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Tiada akses" }

export default function NoAccessPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <Suspense fallback={<LoadingState />}>
          <NoAccess />
        </Suspense>
      </div>
    </main>
  )
}
