/**
 * Callback refs that act when their element mounts — so a scroll or focus
 * happens after React has rendered the element, not on a guess at timing.
 * Module-level on purpose: a stable ref function runs once per mount, where an
 * inline one would run again on every render.
 *
 * To act again for the same element, remount it (change its `key`).
 */

export function scrollIntoViewOnMount(node: HTMLElement | null) {
  node?.scrollIntoView({ behavior: "smooth", block: "start" })
}

export function scrollIntoViewCenteredOnMount(node: HTMLElement | null) {
  node?.scrollIntoView({ behavior: "smooth", block: "center" })
}

export function scrollIntoViewNearestOnMount(node: HTMLElement | null) {
  node?.scrollIntoView({ behavior: "smooth", block: "nearest" })
}
