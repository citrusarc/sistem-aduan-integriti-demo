import { PortalFooter } from "@/components/portal/portal-footer"
import { PortalHeader } from "@/components/portal/portal-header"
import { ComplainantSessionProvider } from "@/components/providers/complainant-session"

/**
 * Public portal chrome. No staff navigation and no staff session here: the
 * only session is the complainant's (aduan_csid), which the header reflects.
 * Pages are public by default; `/me` is where a complainant signs in.
 */
export default function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ComplainantSessionProvider>
      <div className="flex min-h-svh flex-col">
        <PortalHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:py-12">
          {children}
        </main>
        <PortalFooter />
      </div>
    </ComplainantSessionProvider>
  )
}
