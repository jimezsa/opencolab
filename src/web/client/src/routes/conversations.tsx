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
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"

export default function ConversationsRoute() {
  const { projectId = "" } = useParams()
  const sessions = useAsync(
    () => api.conversations(projectId, undefined, 50),
    [projectId],
  )

  if (sessions.status === "loading") return <LoadingState rows={6} />
  if (sessions.status === "error") return <ErrorState message={sessions.error} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversations</CardTitle>
        <CardDescription>
          Recorded sessions across all agents in {projectId}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Last preview</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.data.map((session) => (
              <TableRow key={`${session.agentId}-${session.sessionId}`}>
                <TableCell className="font-mono text-xs">
                  {session.agentId}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {session.sessionId}
                  {session.active && (
                    <Badge variant="secondary" className="ml-2">
                      active
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs">{session.messageCount}</TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                  {session.lastMessagePreview ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground text-right text-xs">
                  {formatRelativeTime(session.lastMessageAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
