import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"

export default function ProjectsRoute() {
  const projects = useAsync(() => api.projects(), [])
  if (projects.status === "loading") return <LoadingState rows={4} />
  if (projects.status === "error") return <ErrorState message={projects.error} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects</CardTitle>
        <CardDescription>
          All OpenColab projects discovered in this runtime.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Agents</TableHead>
              <TableHead>Artifacts</TableHead>
              <TableHead>Runs</TableHead>
              <TableHead className="text-right">Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.data.map((project) => (
              <TableRow key={project.id}>
                <TableCell>
                  <Link
                    to={`/projects/${project.id}`}
                    className="font-medium hover:underline"
                  >
                    {project.id}
                  </Link>{" "}
                  {project.active && (
                    <Badge variant="secondary" className="ml-2">
                      active
                    </Badge>
                  )}
                  <div className="text-muted-foreground font-mono text-xs">
                    {project.path}
                  </div>
                </TableCell>
                <TableCell>{project.agentCount}</TableCell>
                <TableCell>{project.artifactCount}</TableCell>
                <TableCell>{project.runCount}</TableCell>
                <TableCell className="text-muted-foreground text-right text-xs">
                  {formatRelativeTime(project.recentActivityAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
