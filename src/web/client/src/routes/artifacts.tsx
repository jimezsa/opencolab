import { useParams } from "react-router-dom"
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
import { formatBytes, formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"

export default function ArtifactsRoute() {
  const { projectId = "" } = useParams()
  const artifacts = useAsync(
    () => api.artifacts(projectId, 200),
    [projectId],
  )

  if (artifacts.status === "loading") return <LoadingState rows={6} />
  if (artifacts.status === "error") return <ErrorState message={artifacts.error} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
        <CardDescription>
          Files discovered under this project, classified by kind.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Size</TableHead>
              <TableHead className="text-right">Modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {artifacts.data.map((artifact) => (
              <TableRow key={artifact.id}>
                <TableCell className="font-medium">{artifact.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{artifact.kind}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {artifact.relativePath}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {formatBytes(artifact.sizeBytes)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-xs">
                  {formatRelativeTime(artifact.modifiedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
