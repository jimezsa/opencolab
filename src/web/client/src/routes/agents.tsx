import { Link, useParams } from "react-router-dom"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { AgentAvatar } from "@/components/layout/agent-avatar"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"
import { tintFor } from "@/lib/tint"
import type { WebAgentSummary } from "../../../shared/types"

export default function AgentsRoute() {
  const { projectId = "" } = useParams()
  const agents = useAsync(() => api.agents(projectId), [projectId])

  if (agents.status === "loading") return <LoadingState rows={4} />
  if (agents.status === "error") return <ErrorState message={agents.error} />

  return (
    <div className="flex flex-col gap-4 px-2 md:px-6 xl:px-10">
      <div>
        <h2 className="font-heading text-lg font-medium">Agents</h2>
        <p className="text-muted-foreground text-sm">
          Agents available in {projectId}.
        </p>
      </div>
      {agents.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No agents in this project</EmptyTitle>
            <EmptyDescription>
              Use the CLI to add an agent to this project.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {agents.data.map((agent) => (
            <AgentCard key={agent.id} agent={agent} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentCard({
  agent,
  projectId,
}: {
  agent: WebAgentSummary
  projectId: string
}) {
  const tint = tintFor(agent.id)
  const heartbeat = agent.heartbeat
    ? `wakes ${new Date(agent.heartbeat.wakeAt).toLocaleString()}`
    : "idle"
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
              className="mx-0 h-12 w-12"
            />
            {agent.active && (
              <Badge variant="secondary" className="shrink-0">
                active
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-heading line-clamp-2 text-lg font-medium leading-snug">
              {agent.id}
            </h3>
            <p className="text-muted-foreground truncate text-xs">
              {agent.provider.name} · {agent.provider.model}
            </p>
            <p className="text-muted-foreground truncate text-xs">{heartbeat}</p>
          </div>
        </div>
      </Card>
    </Link>
  )
}
