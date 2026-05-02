import { useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { StateBadge } from "@/components/layout/state-badge"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"

export default function GpuRunsRoute() {
  const { projectId = "" } = useParams()
  const runs = useAsync(() => api.gpuRuns(projectId, 50), [projectId])

  if (runs.status === "loading") return <LoadingState rows={6} />
  if (runs.status === "error") return <ErrorState message={runs.error} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPU runs</CardTitle>
        <CardDescription>
          Experiment runs in this project, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Artifacts</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.data.map((run) => (
              <TableRow key={run.runId}>
                <TableCell className="font-mono text-xs">{run.runId}</TableCell>
                <TableCell className="font-mono text-xs">{run.targetId}</TableCell>
                <TableCell>
                  <StateBadge state={run.state} />
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs truncate font-mono text-xs">
                  {run.command}
                </TableCell>
                <TableCell className="text-xs">
                  {run.fetchedArtifacts.length}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-xs">
                  {formatRelativeTime(run.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
