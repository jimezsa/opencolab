import { useParams } from "react-router-dom"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { AgentCard } from "@/components/layout/agent-card"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"

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
