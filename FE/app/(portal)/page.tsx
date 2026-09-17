import Image from "next/image"
import Link from "next/link"
import { MailIcon, SearchIcon, ShieldCheckIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"

const POINTS = [
  {
    icon: ShieldCheckIcon,
    title: "Sulit dan dilindungi",
    body: "Identiti anda hanya diketahui oleh Unit Integriti. Anda boleh membuat aduan tanpa nama.",
  },
  {
    icon: SearchIcon,
    title: "Semak status bila-bila masa",
    body: "Gunakan nombor rujukan aduan untuk melihat perkembangan terkini.",
  },
  {
    icon: MailIcon,
    title: "Makluman melalui e-mel",
    body: "Pengesahan dan kod log masuk dihantar ke e-mel anda — tidak sekali-kali melalui SMS.",
  },
]

const STEPS = [
  {
    title: "Hantar aduan",
    body: "Isi borang, dengan atau tanpa nama. No. rujukan dipaparkan dan dihantar ke e-mel anda.",
  },
  {
    title: "Penilaian awal",
    body: "Unit Integriti menilai maklumat dan menyemak sama ada aduan pernah diterima.",
  },
  {
    title: "Keputusan jawatankuasa",
    body: "Aduan dibentangkan dalam mesyuarat jawatankuasa yang memutuskan tindakan.",
  },
  {
    title: "Tindakan susulan",
    body: "Tindakan dipantau oleh Unit Integriti sehingga selesai.",
  },
]

export default function PortalHomePage() {
  return (
    <div className="flex flex-col gap-12">
      {/* Text sits on a photo, so its colours are fixed white/navy rather than
          theme tokens (dark-mode --primary is a light blue). */}
      <section className="relative isolate flex flex-col gap-5 overflow-hidden surface-card border-transparent bg-[#1E3A5F] px-6 py-12 text-white md:min-h-104 md:justify-center md:px-12 md:py-16">
        <Image
          src="/images/hero-putrajaya.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1152px) 1120px, 100vw"
          className="-z-30 object-cover object-center"
        />
        {/* 15% dark layer over the whole photo. */}
        <div aria-hidden className="absolute inset-0 -z-20 bg-black/15" />
        {/* The photo is bright; this navy fade behind the copy keeps white text
            readable while the right side of the photo stays visible. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-linear-to-t from-[#1E3A5F]/90 via-[#1E3A5F]/60 to-[#1E3A5F]/20 md:bg-linear-to-r md:from-[#1E3A5F]/90 md:via-[#1E3A5F]/55 md:to-transparent"
        />
        <p className="w-fit rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wider text-[#E3C48F] uppercase backdrop-blur-sm">
          Unit Integriti
        </p>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
          Laporkan salah laku, rasuah atau salah guna kuasa dengan selamat.
        </h1>
        <p className="max-w-xl text-white/85">
          Setiap aduan dinilai oleh Unit Integriti dan dibawa ke JMM untuk
          keputusan tindakan.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/submit" className={buttonVariants({ size: "lg" })}>
            Hantar aduan
          </Link>
          <Link
            href="/track"
            className={buttonVariants({ size: "lg", variant: "glass" })}
          >
            Semak status
          </Link>
        </div>
      </section>

      <section aria-labelledby="points-heading" className="flex flex-col gap-4">
        <h2 id="points-heading" className="sr-only">
          Mengapa menggunakan saluran ini
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex surface-card-interactive flex-col gap-3 surface-card border-border/70 bg-card p-6"
            >
              <span
                aria-hidden
                className="flex size-11 items-center justify-center rounded-xl bg-linear-to-br from-secondary/15 to-primary/10 text-secondary ring-1 ring-secondary/15"
              >
                <Icon className="size-5" />
              </span>
              <h3 className="font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="steps-heading" className="text-xl font-semibold text-primary">
            Bagaimana aduan dikendalikan
          </h2>
          <p className="text-sm text-muted-foreground">
            Status aduan anda boleh disemak pada setiap peringkat.
          </p>
        </div>
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((stepItem, index) => (
            <li
              key={stepItem.title}
              className="relative flex flex-col gap-3 overflow-hidden surface-card border-border/70 bg-card p-6"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-accent to-accent/30"
              />
              <span
                className="flex size-9 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent ring-1 ring-accent/30"
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="font-semibold text-foreground">
                {stepItem.title}
              </h3>
              <p className="text-sm text-muted-foreground">{stepItem.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="track-cta-heading"
        className="relative isolate overflow-hidden surface-card border-border/70 bg-card p-6 md:p-8"
      >
        <div
          aria-hidden
          className="absolute -top-24 -right-16 -z-10 size-72 rounded-full bg-accent/15 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-28 left-1/4 -z-10 size-64 rounded-full bg-secondary/10 blur-3xl"
        />
        <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
          <span
            aria-hidden
            className="flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-secondary text-primary-foreground shadow-md"
          >
            <SearchIcon className="size-6" />
          </span>
          <div className="flex flex-col gap-2">
            <h2
              id="track-cta-heading"
              className="text-xl font-semibold tracking-tight text-primary"
            >
              Sudah membuat aduan?
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              Masukkan no. rujukan daripada e-mel pengesahan untuk melihat
              perkembangan terkini aduan anda. Contoh:{" "}
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                UI/2026/00012
              </span>
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link
                href="/hubungi#soalan-lazim"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Soalan lazim
              </Link>
              <Link
                href="/hubungi"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Hubungi kami
              </Link>
            </p>
          </div>
          <Link
            href="/track"
            className={buttonVariants({ size: "lg", variant: "outline-cta" })}
          >
            Semak status
          </Link>
        </div>
      </section>
    </div>
  )
}
