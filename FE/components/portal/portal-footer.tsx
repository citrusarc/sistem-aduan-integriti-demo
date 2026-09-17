import Link from "next/link"

export function PortalFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <p className="font-semibold">Unit Integriti</p>
          <p className="text-sm text-primary-foreground/75">
            Setiap aduan dikendalikan secara sulit. Identiti pengadu dilindungi,
            dan aduan tanpa nama diterima.
          </p>
        </div>
        <nav aria-label="Pautan kaki" className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Pautan</p>
          <Link href="/submit" className="hover:underline">
            Hantar aduan
          </Link>
          <Link href="/track" className="hover:underline">
            Semak status aduan
          </Link>
          <Link href="/submit/protection" className="hover:underline">
            Mohon perlindungan pemberi maklumat
          </Link>
          <Link href="/faq" className="hover:underline">
            Soalan lazim
          </Link>
        </nav>
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-semibold">Hubungan</p>
          <p className="text-primary-foreground/75">
            Semua makluman dihantar melalui e-mel sahaja. Kami tidak akan
            menghantar SMS atau meminta kod melalui telefon.
          </p>
          <Link
            href="/login"
            className="mt-2 text-primary-foreground/75 hover:underline"
          >
            Log masuk kakitangan
          </Link>
        </div>
      </div>
      <div className="border-t border-primary-foreground/15 py-4 text-center text-xs text-primary-foreground/60">
        © {new Date().getFullYear()} Unit Integriti. Sistem demo.
      </div>
    </footer>
  )
}
