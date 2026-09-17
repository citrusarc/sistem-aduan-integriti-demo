/**
 * Complaint reference numbers (`UI/2026/00012`) contain slashes, so they can't
 * sit in one URL segment as they are. The complainant pages address a
 * complaint as `UI.2026.00012`: BE's reference-number charset is
 * `[A-Za-z0-9/_-]`, so `.` never occurs in a real one and the mapping is
 * exactly reversible.
 *
 * The complainant API is addressed by reference number, never by internal id,
 * and it answers someone else's complaint exactly like a missing one — the URL
 * is a handle, not an access check.
 */

const SLUG = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/

export function refToSlug(refNo: string): string {
  return refNo.replaceAll("/", ".")
}

/** `null` for anything that can't be a reference number. */
export function slugToRef(slug: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(slug)
    } catch {
      return null
    }
  })()
  if (!decoded || decoded.length > 64 || !SLUG.test(decoded)) return null
  return decoded.replaceAll(".", "/")
}
