const TINTS = [
  "bg-sky-50 dark:bg-sky-950/30",
  "bg-rose-50 dark:bg-rose-950/30",
  "bg-violet-50 dark:bg-violet-950/30",
  "bg-amber-50 dark:bg-amber-950/30",
  "bg-emerald-50 dark:bg-emerald-950/30",
  "bg-fuchsia-50 dark:bg-fuchsia-950/30",
]

export function tintFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return TINTS[hash % TINTS.length]
}
