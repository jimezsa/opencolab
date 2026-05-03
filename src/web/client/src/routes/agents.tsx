import { Link, useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { AgentAvatar } from "@/components/layout/agent-avatar"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"
import type { WebAgentSummary } from "../../../shared/types"

export default function AgentsRoute() {
  const { projectId = "" } = useParams()
  const agents = useAsync(() => api.agents(projectId), [projectId])

  if (agents.status === "loading") return <LoadingState rows={4} />
  if (agents.status === "error") return <ErrorState message={agents.error} />

  return (
    <div className="flex flex-col gap-4">
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
  return (
    <Link
      to={`/projects/${projectId}/agents/${agent.id}`}
      className="group/agent-card focus-visible:outline-none"
    >
      <Card
        size="sm"
        className="h-full transition group-hover/agent-card:ring-foreground/30 group-focus-visible/agent-card:ring-2 group-focus-visible/agent-card:ring-foreground/40"
      >
        <CardHeader>
          <AgentAvatar providerName={agent.provider.name} />
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{agent.id}</span>
            {agent.active && (
              <Badge variant="secondary" className="shrink-0">
                active
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {agent.provider.name} · {agent.provider.model}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-xs">
          <Row label="Auth">
            {agent.provider.authMode}
            {agent.provider.reasoningEffort
              ? ` · ${agent.provider.reasoningEffort}`
              : ""}
          </Row>
          <Row label="Heartbeat">
            {agent.heartbeat
              ? `wakes ${new Date(agent.heartbeat.wakeAt).toLocaleString()}`
              : "idle"}
          </Row>
        </CardContent>
      </Card>
    </Link>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-wide text-[10px]">
        {label}
      </span>
      <span className="text-foreground/90 truncate">{children}</span>
    </div>
  )
}
