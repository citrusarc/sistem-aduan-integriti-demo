import type { Metadata } from "next"
import { Suspense } from "react"

import { AuthHeading } from "@/components/auth/auth-heading"
import { RegisterForm } from "@/components/auth/register-form"
import { LoadingState } from "@/components/ui/states"

export const metadata: Metadata = { title: "Daftar akaun" }

export default function RegisterPage() {
  return (
    <>
      <AuthHeading
        title="Daftar akaun"
        description="Untuk membuat dan menyemak aduan anda. Kakitangan juga mendaftar di sini — ADMIN akan menetapkan peranan anda."
      />
      <Suspense fallback={<LoadingState />}>
        <RegisterForm />
      </Suspense>
    </>
  )
}
