import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthHeading } from "@/components/auth/auth-heading"
import { LoginForm } from "@/components/auth/login-form"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Log masuk" }

export default function LoginPage() {
  return (
    <>
      <AuthHeading
        title="Log masuk"
        description="Satu log masuk untuk pengadu dan kakitangan Unit Integriti."
      />
      {/* useSearchParams (for ?next=) needs a Suspense boundary to prerender. */}
      <Suspense fallback={<LoadingState />}>
        <LoginForm />
      </Suspense>
    </>
  )
}
