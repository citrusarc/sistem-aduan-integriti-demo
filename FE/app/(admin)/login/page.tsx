import type { Metadata } from "next"
import { Suspense } from "react"

import { LoginForm } from "@/components/admin/login-form"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Log masuk kakitangan" }

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-1">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            Unit Integriti
          </p>
          <h1 className="text-xl font-semibold text-primary">
            Log masuk kakitangan
          </h1>
          <p className="text-sm text-muted-foreground">
            Untuk pengadu, gunakan{" "}
            <a href="/me" className="underline underline-offset-4">
              log masuk pengadu
            </a>
            .
          </p>
        </div>
        {/* useSearchParams (for ?next=) needs a Suspense boundary to prerender. */}
        <Suspense fallback={<LoadingState />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
