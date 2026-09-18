/**
 * Text similarity for the duplicate check — CLAUDE.md §8 decision 16.
 *
 * Pure functions, no I/O. The problem they solve: two unrelated complaints
 * share words like "rasuah", "belanja", "pegawai", "jabatan" because they are
 * the same KIND of complaint, not the same case. Plain keyword or trigram
 * overlap therefore flags every bribery complaint as a repeat of every other.
 *
 * So similarity is measured only on words that identify a case:
 *   - function words (dan, yang, the, …) are dropped
 *   - TOPIC_WORDS — what kind of complaint it is — are dropped; the complaint's
 *     integrity_category already records that
 *   - what remains is weighted by rarity (IDF over recent complaints), so a
 *     word that appears in most complaints counts for little and a place, a
 *     company name or a project name counts for a lot
 *   - identifiers (amounts, plate numbers, file numbers, dates) are compared
 *     separately: sharing "RM5000" and "WXY1234" is strong evidence
 *
 * Words are reduced by a deliberately conservative Malay affix stripper, so
 * "membelanjakan" and "perbelanjaan" meet "belanja". It errs on stripping too
 * little: a missed match only costs recall, and staff still see the candidate
 * list from the recall-biased SQL check (rule 5).
 */

// Malay and English function words. Kept short and obvious on purpose.
const STOPWORDS = new Set(
  `adalah ada akan aku anda apa apabila atas atau bagi bahawa bahkan banyak
  beliau belum berapa bersama boleh bukan dah dalam dan dapat dari daripada
  dengan dia di hanya hendak ia ialah iaitu ini itu jadi jika juga kali kami
  kamu kan kata ke kepada kerana ketika kita lagi lain lalu maka masih mereka
  mungkin namun oleh pada para pula saja sahaja saya sebab sebagai sebelum
  sedang sejak selepas semasa semua sendiri seorang seperti serta setiap sila
  supaya tanpa telah tentang tetapi tersebut tidak turut untuk walaupun yang
  sudah pun lah tu ni nak tak dgn utk yg dlm kpd drp
  a an and are as at be been but by for from had has have he her his i in is it
  its of on or she that the their them they this to was were which who will with`.split(
    /\s+/,
  ),
);

/**
 * Words that describe the kind of complaint, not which case it is. Stored as
 * stems (see stem()). Add to this list when a word keeps showing up in
 * unrelated complaints; never add names, places or organisations.
 */
const TOPIC_WORDS = new Set(
  `rasuah suap sogok salah laku guna kuasa integriti adu maklum lapor
  belanja duit wang bayar kos harga ringgit rm juta ribu
  pegawai kakitangan staf ketua pengarah pengurus penyelia jawatan gred
  jabatan bahagian unit cawangan agensi kementerian kerajaan pejabat
  projek kontrak tender sebut perolehan beli bekal syarikat kontraktor
  pihak orang individu awam rakyat
  minta terima beri ambil guna buat kena tindak siasat
  tahun bulan hari minggu masa tarikh
  corruption bribe bribery officer department complaint report money payment`.split(
    /\s+/,
  ),
);

const PREFIXES = [
  "memper",
  "diper",
  "meng",
  "meny",
  "peng",
  "peny",
  "mem",
  "men",
  "pem",
  "pen",
  "ber",
  "per",
  "ter",
  "me",
  "di",
  "pe",
  "ke",
  "se",
];
const SUFFIXES = ["kan", "an", "nya", "lah", "kah", "i"];
const MIN_STEM = 4;

/** Lower-case, accents removed, anything but letters and digits is a space. */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Conservative Malay stemmer: at most one suffix and one prefix, and only when
 * at least MIN_STEM letters remain. Words with digits are left alone.
 */
export function stem(word: string): string {
  if (/\d/.test(word)) return word;
  let w = word;
  for (const suffix of SUFFIXES) {
    if (w.endsWith(suffix) && w.length - suffix.length >= MIN_STEM) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  for (const prefix of PREFIXES) {
    if (w.startsWith(prefix) && w.length - prefix.length >= MIN_STEM) {
      w = w.slice(prefix.length);
      break;
    }
  }
  return w;
}

/**
 * The words that can tell one case from another, in order. Numbers are left
 * to identifiers(). Capitalised words (names, places) are not stemmed:
 * "Seremban" must not lose "se-".
 */
export function contentTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const word of text.split(/\s+/)) {
    const properNoun = /^[^a-z0-9]*[A-Z]/.test(word);
    for (const raw of normalize(word).split(" ")) {
      if (raw.length < 3 || /\d/.test(raw)) continue;
      if (STOPWORDS.has(raw)) continue;
      const s = properNoun ? raw : stem(raw);
      if (TOPIC_WORDS.has(s) || TOPIC_WORDS.has(raw)) continue;
      out.push(s);
    }
  }
  return out;
}

/**
 * Identifiers: amounts ("RM 5,000" -> "rm5000"), plate and file numbers, dates.
 * Anything with a digit, after joining a currency prefix to its amount and
 * dropping thousands separators. Bare 1-2 digit numbers are too common to
 * identify anything.
 */
export function identifiers(text: string | null | undefined): Set<string> {
  const found = new Set<string>();
  if (!text) return found;
  const joined = text
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/\brm\s+(?=\d)/g, "rm");
  for (const token of joined.split(/[^a-z0-9/.-]+/)) {
    const t = token.replace(/^[/.-]+|[/.-]+$/g, "");
    if (!/\d/.test(t)) continue;
    if (/^\d{1,2}$/.test(t)) continue;
    found.add(t);
  }
  return found;
}

/**
 * Inverse document frequency from a corpus of token lists, smoothed so a
 * token nobody has seen gets the highest weight rather than infinity.
 */
export function idfFrom(corpus: readonly (readonly string[])[]) {
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const n = corpus.length;
  return (token: string) => Math.log((n + 1) / ((df.get(token) ?? 0) + 1)) + 1;
}

/** TF-IDF cosine similarity, 0..1. */
export function cosine(
  a: readonly string[],
  b: readonly string[],
  idf: (token: string) => number,
): number {
  if (!a.length || !b.length) return 0;
  const weights = (tokens: readonly string[]) => {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    const w = new Map<string, number>();
    for (const [t, n] of tf) w.set(t, n * idf(t));
    return w;
  };
  const wa = weights(a);
  const wb = weights(b);
  let dot = 0;
  for (const [t, v] of wa) dot += v * (wb.get(t) ?? 0);
  const norm = (w: Map<string, number>) =>
    Math.sqrt([...w.values()].reduce((sum, v) => sum + v * v, 0));
  const denominator = norm(wa) * norm(wb);
  return denominator ? dot / denominator : 0;
}

/**
 * Name or organisation similarity, 0..1: Dice coefficient over character
 * bigrams, after normalising and dropping honorifics. Tolerates spelling
 * variants ("Mohd" / "Mohamad" less so) and word order.
 */
const HONORIFICS = new Set(
  "encik en puan pn cik tuan dato datuk datin tan sri dr ir haji hj hajah hjh bin binti bt bn mr mrs ms".split(
    " ",
  ),
);

export function nameSimilarity(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const clean = (s: string) =>
    normalize(s)
      .split(" ")
      .filter((w) => w && !HONORIFICS.has(w))
      .sort()
      .join(" ");
  if (!a || !b) return 0;
  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0);
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * overlap) / total : 0;
}
