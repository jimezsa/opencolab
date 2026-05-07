import { Link } from "react-router-dom"
import { HeartIcon, HeartPulseIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AgentAvatar } from "./agent-avatar"
import { formatTimeUntil } from "@/lib/format"
import { tintFor } from "@/lib/tint"
import type { WebAgentSummary } from "../../../../shared/types"

export function AgentCard({
  agent,
  projectId,
}: {
  agent: WebAgentSummary
  projectId: string
}) {
  const tint = tintFor(agent.id)
  return (
    <Link
      to={`/projects/${projectId}/agents/${agent.id}`}
      className="group/agent-card focus-visible:outline-none"
    >
      <Card
        className={`h-44 ring-0 border-0 transition group-hover/agent-card:shadow-md group-focus-visible/agent-card:ring-2 group-focus-visible/agent-card:ring-foreground/40 ${tint}`}
      >
        <div className="flex h-full flex-col justify-between px-5 py-5">
          <div className="flex items-start justify-between">
            <AgentAvatar
              providerName={agent.provider.name}
              className="mx-0 h-16 w-16"
            />
            {agent.active && (
              <Badge variant="secondary" className="shrink-0">
                active
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="font-heading line-clamp-2 text-lg font-medium leading-snug">
              {agent.id}
            </h3>
            <p className="text-muted-foreground truncate text-xs">
              {agent.provider.name} · {agent.provider.model}
            </p>
            <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
              {agent.heartbeat ? (
                <HeartPulseIcon className="size-3 text-rose-500" aria-hidden="true" />
              ) : (
                <HeartIcon className="size-3 opacity-60" aria-hidden="true" />
              )}
              <span className="truncate">
                {agent.heartbeat ? formatTimeUntil(agent.heartbeat.wakeAt) : "idle"}
              </span>
            </p>
          </div>
        </div>
      </Card>
    </Link>
  )
}
