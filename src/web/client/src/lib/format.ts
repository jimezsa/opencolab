export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function formatRelativeTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—"
  const target = new Date(isoTimestamp).getTime()
  if (!Number.isFinite(target)) return "—"
  const diffSeconds = Math.round((Date.now() - target) / 1000)
  const abs = Math.abs(diffSeconds)
  if (abs < 60) return `${diffSeconds}s ago`
  if (abs < 3600) return `${Math.round(diffSeconds / 60)}m ago`
  if (abs < 86_400) return `${Math.round(diffSeconds / 3600)}h ago`
  if (abs < 604_800) return `${Math.round(diffSeconds / 86_400)}d ago`
  return new Date(isoTimestamp).toLocaleDateString()
}

export function formatTimeUntil(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—"
  const target = new Date(isoTimestamp).getTime()
  if (!Number.isFinite(target)) return "—"
  const diffSeconds = Math.round((target - Date.now()) / 1000)
  if (diffSeconds <= 0) return "due"
  if (diffSeconds < 60) return `in ${diffSeconds}s`
  if (diffSeconds < 3600) return `in ${Math.round(diffSeconds / 60)}m`
  if (diffSeconds < 86_400) return `in ${Math.round(diffSeconds / 3600)}h`
  if (diffSeconds < 604_800) return `in ${Math.round(diffSeconds / 86_400)}d`
  return `on ${new Date(isoTimestamp).toLocaleDateString()}`
}

export function formatDateTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return "—"
  const date = new Date(isoTimestamp)
  if (!Number.isFinite(date.getTime())) return "—"
  return date.toLocaleString()
}
