import { AdminShell } from "@/components/admin/admin-shell"

/**
 * Every console page sits under this gate: signed out -> /login, wrong role ->
 * /tiada-akses. Per-path role rules are in `lib/access.ts`.
 */
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AdminShell>{children}</AdminShell>
}
