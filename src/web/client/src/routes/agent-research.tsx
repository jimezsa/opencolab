import { useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { ResearchList } from "@/components/research/research-list"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"

export default function AgentResearchRoute() {
  const { projectId = "", agentId = "" } = useParams()
  const runs = useAsync(
    () => api.agentResearch(projectId, agentId),
    [projectId, agentId],
  )

  if (runs.status === "loading") return <LoadingState rows={6} />
  if (runs.status === "error") return <ErrorState message={runs.error} />

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Research — {agentId}</CardTitle>
          <CardDescription>
            Runs produced under this agent's <code>research/</code> folder.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResearchList
            projectId={projectId}
            runs={runs.data}
            showScopeBadge={false}
          />
        </CardContent>
      </Card>
    </div>
  )
}
