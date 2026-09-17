import type { Metadata } from "next"
import { Suspense } from "react"

import { StaffSignIn } from "@/components/admin/staff-sign-in"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Log masuk kakitangan" }

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm surface-card border-border/70 bg-card p-6">
        {/* useSearchParams (for ?next=) needs a Suspense boundary to prerender. */}
        <Suspense fallback={<LoadingState />}>
          <StaffSignIn />
        </Suspense>
      </div>
    </main>
  )
}
