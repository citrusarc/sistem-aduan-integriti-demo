import type { Metadata } from "next"

import { ForgotPassword } from "@/components/auth/forgot-password"

export const metadata: Metadata = { title: "Lupa kata laluan" }

/** Not gated: anyone who can't sign in comes here (§8 decision 14 (l)). */
export default function ForgotPasswordPage() {
  return <ForgotPassword />
}
