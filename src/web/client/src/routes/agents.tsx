import { Link, useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"

export default function AgentsRoute() {
  const { projectId = "" } = useParams()
  const agents = useAsync(() => api.agents(projectId), [projectId])

  if (agents.status === "loading") return <LoadingState rows={4} />
  if (agents.status === "error") return <ErrorState message={agents.error} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          Agents available in {projectId}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Auth</TableHead>
              <TableHead>Heartbeat</TableHead>
              <TableHead>TODO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.data.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <Link
                    to={`/projects/${projectId}/agents/${agent.id}`}
                    className="font-medium hover:underline"
                  >
                    {agent.id}
                  </Link>
                  {agent.active && (
                    <Badge variant="secondary" className="ml-2">
                      active
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {agent.provider.name} · {agent.provider.model}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {agent.provider.authMode}
                  {agent.provider.reasoningEffort
                    ? ` · ${agent.provider.reasoningEffort}`
                    : ""}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {agent.heartbeat
                    ? `wakes ${new Date(agent.heartbeat.wakeAt).toLocaleString()}`
                    : "idle"}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                  {agent.todoSummary ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
