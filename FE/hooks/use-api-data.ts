"use client"

import * as React from "react"

export type ApiData<T> =
  | { status: "loading"; data: T | null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: T | null; error: unknown }

/**
 * Loads data from BE in the browser (the session cookie never reaches Next's
 * server, so console data can't be fetched there).
 *
 * `key` identifies the request: when it changes, the data is fetched again and
 * a slower response for an older key is discarded. `reload()` refetches
 * without clearing what's on screen, so a write followed by a reload doesn't
 * flash a spinner. `setData` replaces the data with a write's response.
 */
export function useApiData<T>(
  key: string | null,
  fetcher: () => Promise<T>
): ApiData<T> & {
  reload: () => Promise<void>
  setData: (data: T) => void
} {
  const [state, setState] = React.useState<ApiData<T>>({
    status: "loading",
    data: null,
    error: null,
  })
  const fetcherRef = React.useRef(fetcher)
  const requestId = React.useRef(0)

  React.useEffect(() => {
    fetcherRef.current = fetcher
  })

  const run = React.useCallback(async (clear: boolean) => {
    const id = ++requestId.current
    if (clear) {
      setState((prev) => ({ status: "loading", data: prev.data, error: null }))
    }
    try {
      const data = await fetcherRef.current()
      if (id === requestId.current) {
        setState({ status: "success", data, error: null })
      }
    } catch (error) {
      if (id === requestId.current) {
        setState((prev) => ({ status: "error", data: prev.data, error }))
      }
    }
  }, [])

  React.useEffect(() => {
    if (key === null) return
    // Fetch on mount and whenever the request changes; results land async.
    void run(true)
  }, [key, run])

  const reload = React.useCallback(() => run(false), [run])
  const setData = React.useCallback((data: T) => {
    requestId.current++
    setState({ status: "success", data, error: null })
  }, [])

  return { ...state, reload, setData }
}
