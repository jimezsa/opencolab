import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import type { WebHealthStatus } from "@shared/types"

interface TopBarProps {
  title: string
  subtitle?: string
  health: WebHealthStatus | null
}

export function TopBar({ title, subtitle, health }: TopBarProps) {
  const gatewayLabel = health
    ? health.gateway.runtimeMode === "mock"
      ? "mock"
      : `:${health.gateway.port}`
    : "…"

  return (
    <header className="bg-background sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {subtitle && (
          <span className="text-muted-foreground truncate text-xs">
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {health?.telegram.paired ? (
          <Badge variant="secondary">tg paired</Badge>
        ) : (
          <Badge variant="outline">tg unpaired</Badge>
        )}
        <Badge variant="outline">gateway {gatewayLabel}</Badge>
      </div>
    </header>
  )
}
