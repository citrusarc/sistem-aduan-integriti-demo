/**
 * The Integrity Unit's public contact details, shown on /hubungi and in the
 * portal footer.
 *
 * PLACEHOLDERS: every value below is demo data. Replace them with the unit's
 * real email, phone, address and hours before anyone outside the team sees
 * the portal.
 */
export const CONTACT = {
  email: "integriti@contoh.gov.my",
  phone: "03-8000 8000",
  /** E.164, for tel: links. */
  phoneHref: "+60380008000",
  addressLines: [
    "Unit Integriti",
    "Aras 5, Blok Pentadbiran",
    "Presint 2",
    "62100 Putrajaya",
  ],
  hours: [
    { days: "Isnin – Khamis", time: "8.00 pagi – 5.00 petang" },
    { days: "Jumaat", time: "8.00 pagi – 12.15 tgh, 2.45 – 5.00 petang" },
    { days: "Sabtu, Ahad & cuti umum", time: "Tutup" },
  ],
  map: { lat: 2.9264, lon: 101.6964 },
} as const

export function mapEmbedUrl({ lat, lon }: { lat: number; lon: number }) {
  const d = 0.008
  const bbox = [lon - d, lat - d / 2, lon + d, lat + d / 2].join(",")
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`
}

export function googleMapsUrl({ lat, lon }: { lat: number; lon: number }) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
}

export function wazeUrl({ lat, lon }: { lat: number; lon: number }) {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`
}
