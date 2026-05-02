import { useEffect, useState } from "react"

export type AsyncState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string }

export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    status: "loading",
    data: null,
    error: null,
  })
  useEffect(() => {
    let cancelled = false
    setState({ status: "loading", data: null, error: null })
    fetcher()
      .then((data) => {
        if (cancelled) return
        setState({ status: "ready", data, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}
