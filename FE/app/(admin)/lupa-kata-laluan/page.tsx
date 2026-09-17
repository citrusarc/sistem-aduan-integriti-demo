import type { Metadata } from "next"

import { ForgotPassword } from "@/components/admin/forgot-password"

export const metadata: Metadata = { title: "Lupa kata laluan" }

/** Not gated: staff who can't sign in come here (§8 decision 14 (l)). */
export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm surface-card border-border/70 bg-card p-6">
        <ForgotPassword />
      </div>
    </main>
  )
}
