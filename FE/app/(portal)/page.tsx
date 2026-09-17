import Link from "next/link"
import {
  FileTextIcon,
  MailIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
      <section className="flex flex-col gap-5 rounded-2xl bg-primary px-6 py-10 text-primary-foreground md:px-10 md:py-14">
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          Unit Integriti
        </p>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
          Laporkan salah laku, rasuah atau salah guna kuasa dengan selamat.
        </h1>
        <p className="max-w-xl text-primary-foreground/80">
          Setiap aduan dinilai oleh Unit Integriti dan dibawa ke JMM untuk
          keputusan tindakan.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/submit"
            // cva concatenates; cn() is what resolves the conflicting colours.
            className={cn(
              buttonVariants({ size: "lg" }),
              "bg-accent text-accent-foreground hover:bg-accent/85"
            )}
          >
            <FileTextIcon data-icon="inline-start" />
            Hantar aduan
          </Link>
          <Link
            href="/track"
            className={cn(
              buttonVariants({ size: "lg", variant: "outline" }),
              "border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            )}
          >
            <SearchIcon data-icon="inline-start" />
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
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5"
            >
              <Icon className="size-5 text-secondary" aria-hidden />
              <h2 className="font-medium">{title}</h2>
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
              className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5"
            >
              <span
                className="flex size-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
                aria-hidden
              >
                {index + 1}
              </span>
              <h3 className="font-medium">{stepItem.title}</h3>
              <p className="text-sm text-muted-foreground">{stepItem.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-primary">Sudah membuat aduan?</h2>
          <p className="text-sm text-muted-foreground">
            Semak status dengan no. rujukan, atau lihat{" "}
            <Link
              href="/faq"
              className="text-primary underline-offset-4 hover:underline"
            >
              soalan lazim
            </Link>
            .
          </p>
        </div>
        <Link
          href="/track"
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          <SearchIcon data-icon="inline-start" />
          Semak status aduan
        </Link>
      </section>
    </div>
  )
}
