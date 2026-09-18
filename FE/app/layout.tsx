import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { SessionProvider } from "@/components/providers/session"
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
 * Root layout shared by every route group. The one session (§8 decision 15)
 * lives here, so the portal, the sign-in pages and the console agree on who is
 * signed in; each group's chrome lives in its own layout.
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
        "light",
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
        >
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
