import type { Metadata } from "next"
import Link from "next/link"
import {
  ClockIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { CONTACT, googleMapsUrl, mapEmbedUrl, wazeUrl } from "@/lib/contact"

export const metadata: Metadata = { title: "Hubungi Kami" }

const link = "text-primary underline-offset-4 hover:underline"

/**
 * Answers stay general on purpose. Nothing here explains why a reference
 * number might not be found beyond a typo: rule 2 requires a closed-with-no-
 * further-action case to look exactly like an unknown one.
 */
const FAQ: {
  id: string
  group: string
  items: { q: string; a: React.ReactNode }[]
}[] = [
  {
    id: "membuat-aduan",
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
    id: "selepas-menghantar",
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
    id: "privasi",
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

export default function PortalContactPage() {
  return (
    <div className="flex flex-col gap-16">
      <ContactSection />
      <FaqSection />
    </div>
  )
}

function ContactSection() {
  return (
    <section aria-labelledby="hubungi-heading" className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          Hubungi Kami
        </p>
        <h1
          id="hubungi-heading"
          className="text-3xl font-semibold tracking-tight text-primary md:text-4xl"
        >
          Kami sedia membantu
        </h1>
        <p className="text-muted-foreground">
          Ada pertanyaan tentang aduan atau proses kami? Hubungi Unit Integriti
          melalui saluran di bawah pada waktu pejabat.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
          <ContactCard icon={MailIcon} title="E-mel">
            <a
              href={`mailto:${CONTACT.email}`}
              className="font-medium break-all text-primary underline-offset-4 hover:underline"
            >
              {CONTACT.email}
            </a>
            <p className="text-sm text-muted-foreground">
              Sertakan no. rujukan jika berkaitan aduan sedia ada.
            </p>
          </ContactCard>
          <ContactCard icon={PhoneIcon} title="Telefon">
            <a
              href={`tel:${CONTACT.phoneHref}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {CONTACT.phone}
            </a>
            <p className="text-sm text-muted-foreground">
              Untuk pertanyaan sahaja. Kami tidak menghantar SMS.
            </p>
          </ContactCard>
          <ContactCard icon={MapPinIcon} title="Alamat">
            <address className="text-sm leading-relaxed not-italic">
              {CONTACT.addressLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </ContactCard>
          <ContactCard icon={ClockIcon} title="Waktu operasi">
            <dl className="flex flex-col gap-1.5 text-sm">
              {CONTACT.hours.map((h) => (
                <div
                  key={h.days}
                  className="flex flex-col gap-x-3 sm:flex-row sm:justify-between"
                >
                  <dt className="text-muted-foreground">{h.days}</dt>
                  <dd className="font-medium">{h.time}</dd>
                </div>
              ))}
            </dl>
          </ContactCard>
        </div>

        <div className="flex min-h-80 flex-col overflow-hidden surface-card border-border/70 bg-card lg:col-span-3">
          <iframe
            title="Peta lokasi Unit Integriti"
            src={mapEmbedUrl(CONTACT.map)}
            loading="lazy"
            className="min-h-80 w-full flex-1 border-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-5 py-4">
            <p className="text-sm text-muted-foreground">
              {CONTACT.addressLines.slice(1).join(", ")}
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={googleMapsUrl(CONTACT.map)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                Buka di Google Maps
              </a>
              <a
                href={wazeUrl(CONTACT.map)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline" })}
              >
                Buka di Waze
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-start gap-4 surface-card border-transparent bg-linear-to-br from-[#1E3A5F] to-[#3F6B6E] p-6 text-white md:flex-row md:items-center md:justify-between md:p-8">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Ingin membuat aduan?</h2>
          <p className="max-w-xl text-sm text-white/80">
            Gunakan borang dalam talian supaya aduan anda direkodkan dan
            menerima no. rujukan untuk disemak kemudian.
          </p>
        </div>
        <Link
          href="/submit"
          className={buttonVariants({ size: "lg", variant: "glass" })}
        >
          Hantar aduan
        </Link>
      </div>
    </section>
  )
}

function ContactCard({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-4 surface-card border-border/70 bg-card p-5">
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-secondary/15 to-primary/10 text-secondary ring-1 ring-secondary/15"
      >
        <Icon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}

function FaqSection() {
  return (
    <section
      id="soalan-lazim"
      aria-labelledby="faq-heading"
      className="grid scroll-mt-24 gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12"
    >
      <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wider text-accent uppercase">
            Soalan Lazim
          </p>
          <h2
            id="faq-heading"
            className="text-2xl font-semibold tracking-tight text-primary"
          >
            Jawapan kepada soalan biasa
          </h2>
          <p className="text-sm text-muted-foreground">
            Tentang membuat aduan, menyemak status dan perlindungan identiti
            anda.
          </p>
        </div>
        <nav
          aria-label="Kategori soalan"
          className="flex flex-wrap gap-2 lg:flex-col"
        >
          {FAQ.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full border border-border/70 bg-card px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:border-primary/30 hover:text-primary lg:rounded-lg"
            >
              {section.group}
            </a>
          ))}
        </nav>
      </div>

      <div className="flex flex-col gap-8">
        {FAQ.map((section) => (
          <div
            key={section.id}
            id={section.id}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <h3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
              {section.group}
            </h3>
            <div className="flex flex-col gap-3">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group surface-card border-border/70 bg-card transition-colors open:border-primary/25"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all group-open:rotate-45 group-open:bg-accent group-open:text-accent-foreground"
                    >
                      <PlusIcon className="size-4" />
                    </span>
                  </summary>
                  <div className="px-5 pb-5 text-sm leading-relaxed text-foreground/85">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
