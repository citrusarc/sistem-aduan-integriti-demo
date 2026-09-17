import type { Metadata } from "next"

import { RegistrationForm } from "@/components/admin/complaints/registration-form"

export const metadata: Metadata = { title: "Daftar aduan baharu" }

export default function NewComplaintPage() {
  return <RegistrationForm />
}
