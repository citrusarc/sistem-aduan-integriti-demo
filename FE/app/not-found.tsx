import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-2xl font-semibold text-primary">
        Halaman tidak dijumpai
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Pautan mungkin salah atau halaman telah dialihkan.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Kembali ke laman utama
      </Link>
    </main>
  )
}
