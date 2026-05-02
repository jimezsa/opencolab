import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const RUN_STATE_VARIANTS: Record<
  string,
  { variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  completed: { variant: "secondary", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  running: { variant: "default" },
  running_unreachable: { variant: "outline" },
  bootstrapping: { variant: "default" },
  syncing: { variant: "default" },
  fetching: { variant: "default" },
  provisioning: { variant: "default" },
  waiting_for_ssh: { variant: "outline" },
  validating: { variant: "outline" },
  draft: { variant: "outline" },
  failed: { variant: "destructive" },
  timed_out: { variant: "destructive" },
  cancelled: { variant: "outline" },
  cleanup_failed: { variant: "destructive" },
}

export function StateBadge({ state }: { state: string }) {
  const config = RUN_STATE_VARIANTS[state] ?? { variant: "outline" as const }
  return (
    <Badge variant={config.variant} className={cn("font-mono text-[10px]", config.className)}>
      {state.replace(/_/g, " ")}
    </Badge>
  )
}
