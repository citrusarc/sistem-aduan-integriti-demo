import type { Metadata } from "next"
import Link from "next/link"
import { ChevronDownIcon } from "lucide-react"

import { PageHeader } from "@/components/ui/page-header"

export const metadata: Metadata = { title: "Soalan Lazim" }

const link = "text-primary underline-offset-4 hover:underline"

/**
 * Answers stay general on purpose. Nothing here explains why a reference
 * number might not be found beyond a typo: rule 2 requires a closed-with-no-
 * further-action case to look exactly like an unknown one.
 */
const FAQ: { group: string; items: { q: string; a: React.ReactNode }[] }[] = [
  {
    group: "Membuat aduan",
    items: [
      {
        q: "Apakah yang boleh saya adukan?",
        a: "Salah laku, salah guna kuasa, rasuah, jenayah, atau pelanggaran arahan, SOP dan etika organisasi oleh penjawat atau pihak berkaitan agensi.",
      },
      {
        q: "Maklumat apa yang perlu saya sediakan?",
        a: "Terangkan apa yang berlaku, bila, di mana, dan siapa yang terlibat — sekurang-kurangnya nama atau jawatan dan bahagian pihak yang diadu, jika diketahui. Semakin jelas butiran, semakin mudah aduan dinilai.",
      },
      {
        q: "Bolehkah saya membuat aduan tanpa nama?",
        a: (
          <>
            Boleh. Pilih <em>Tanpa nama</em> dalam{" "}
            <Link href="/submit" className={link}>
              borang aduan
            </Link>
            ; nama dan butiran peribadi anda tidak disimpan. Anda tetap perlu
            memberikan alamat e-mel, kerana itulah satu-satunya cara kami boleh
            memaklumkan status atau meminta maklumat lanjut. Alamat e-mel
            berasingan dibenarkan.
          </>
        ),
      },
      {
        q: "Mengapa borang meminta saya mengesahkan aduan baharu?",
        a: "Setiap aduan disemak untuk mengelakkan aduan yang sama didaftarkan dua kali. Jika maklumat anda menyerupai aduan yang telah diterima, anda diminta mengesahkan bahawa ini perkara baharu atau mengandungi maklumat tambahan. Butiran aduan lain tidak didedahkan.",
      },
    ],
  },
  {
    group: "Selepas menghantar",
    items: [
      {
        q: "Apa yang berlaku kepada aduan saya?",
        a: "Unit Integriti menilai aduan, kemudian membentangkannya kepada jawatankuasa yang memutuskan tindakan — contohnya dirujuk kepada bahagian atau agensi berkaitan, atau disiasat. Tindakan susulan dipantau sehingga selesai.",
      },
      {
        q: "Bagaimana saya menyemak status aduan?",
        a: (
          <>
            Gunakan no. rujukan dalam e-mel pengesahan di halaman{" "}
            <Link href="/track" className={link}>
              Semak Status
            </Link>
            , atau{" "}
            <Link href="/me" className={link}>
              log masuk dengan e-mel
            </Link>{" "}
            untuk melihat semua aduan anda.
          </>
        ),
      },
      {
        q: "No. rujukan saya tidak dijumpai.",
        a: "Pastikan nombor dimasukkan tepat seperti dalam e-mel pengesahan, termasuk tanda garis miring (/). Anda juga boleh log masuk dengan e-mel yang digunakan semasa membuat aduan.",
      },
      {
        q: "Apakah maksud setiap status?",
        a: (
          <dl className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <dt className="font-medium">Baru</dt>
            <dd>Aduan diterima dan sedang dinilai.</dd>
            <dt className="font-medium">Menunggu JMM</dt>
            <dd>Aduan akan dibentangkan dalam mesyuarat jawatankuasa.</dd>
            <dt className="font-medium">Dalam Tindakan</dt>
            <dd>
              Keputusan telah dibuat dan tindakan susulan sedang dijalankan.
            </dd>
            <dt className="font-medium">Selesai</dt>
            <dd>Tindakan ke atas aduan telah selesai.</dd>
          </dl>
        ),
      },
    ],
  },
  {
    group: "Privasi dan perlindungan",
    items: [
      {
        q: "Siapa yang boleh melihat aduan saya?",
        a: "Aduan dikendalikan secara sulit oleh Unit Integriti. Jika sesuatu tindakan dirujuk kepada bahagian lain, hanya maklumat yang diperlukan untuk tindakan itu dikongsi — bukan identiti anda.",
      },
      {
        q: "Bagaimana saya memohon perlindungan sebagai pemberi maklumat?",
        a: (
          <>
            Log masuk di{" "}
            <Link href="/me" className={link}>
              Aduan Saya
            </Link>{" "}
            dengan e-mel yang digunakan semasa membuat aduan, kemudian hantar
            permohonan untuk aduan tersebut. Permohonan dinilai oleh Ketua Unit
            Integriti.
          </>
        ),
      },
      {
        q: "Adakah saya akan menerima SMS?",
        a: "Tidak. Semua makluman dan kod log masuk dihantar melalui e-mel sahaja. Nombor telefon, jika diberikan, hanya digunakan oleh pegawai untuk menghubungi anda secara manual. Abaikan sebarang SMS yang mendakwa daripada sistem ini.",
      },
    ],
  },
]

export default function PortalFaqPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        title="Soalan Lazim"
        description="Jawapan kepada soalan biasa tentang membuat dan menyemak aduan."
      />
      {FAQ.map((section) => (
        <section key={section.group} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-primary">
            {section.group}
          </h2>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {section.items.map((item) => (
              <details key={item.q} className="group px-5 py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDownIcon
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="pb-4 text-sm leading-relaxed text-foreground/85">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="text-sm text-muted-foreground">
        Bersedia?{" "}
        <Link href="/submit" className={link}>
          Hantar aduan
        </Link>
      </p>
    </div>
  )
}
