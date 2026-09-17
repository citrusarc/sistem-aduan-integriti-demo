import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  title: {
    default: "Sistem Aduan Integriti",
    template: "%s · Sistem Aduan Integriti",
  },
  description:
    "Saluran aduan integriti Unit Integriti — hantar aduan, semak status dan mohon perlindungan pemberi maklumat.",
}

/**
 * Root layout shared by both route groups. Everything group-specific — the
 * portal chrome and complainant session, the console chrome and staff
 * session — lives in `(portal)/layout.tsx` and `(admin)/layout.tsx`.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ms"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
