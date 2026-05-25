import { useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"

export default function AgentDetailRoute() {
  const { projectId = "", agentId = "" } = useParams()
  const agent = useAsync(
    () => api.agent(projectId, agentId),
    [projectId, agentId],
  )

  if (agent.status === "loading") return <LoadingState rows={6} />
  if (agent.status === "error") return <ErrorState message={agent.error} />
  const data = agent.data

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {data.id}
            {data.active && <Badge variant="secondary">active</Badge>}
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            {data.path}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
            <Field label="Provider" value={data.provider.name} />
            <Field label="Model" value={data.provider.model} />
            <Field label="Auth" value={data.provider.authMode} />
            <Field
              label="Reasoning"
              value={data.provider.reasoningEffort ?? "—"}
            />
            <Field
              label="Heartbeat"
              value={
                data.heartbeat
                  ? `wakes ${new Date(data.heartbeat.wakeAt).toLocaleString()}`
                  : "idle"
              }
            />
            <Field
              label="Sessions"
              value={String(data.recentSessions.length)}
            />
          </dl>
        </CardContent>
      </Card>

      <Tabs defaultValue="todo">
        <TabsList>
          <TabsTrigger value="todo">TODO</TabsTrigger>
          <TabsTrigger value="memory">Memory</TabsTrigger>
          <TabsTrigger value="heartbeat">Heartbeat</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="todo">
          <MarkdownPanel
            title="TODO.md"
            content={data.todo}
            emptyTitle="No TODO yet"
            emptyDescription="The agent's TODO.md file is empty."
          />
        </TabsContent>
        <TabsContent value="memory">
          <MarkdownPanel
            title="MEMORY.md"
            content={data.memory}
            emptyTitle="No long-term memory"
            emptyDescription="The agent has not recorded any long-term memory."
          />
        </TabsContent>
        <TabsContent value="heartbeat">
          <MarkdownPanel
            title="HEARTBEAT.md"
            content={data.heartbeatRaw}
            emptyTitle="Heartbeat disabled"
            emptyDescription="No HEARTBEAT.md schedule configured for this agent."
          />
        </TabsContent>
        <TabsContent value="sessions">
          {data.recentSessions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No sessions</EmptyTitle>
                <EmptyDescription>
                  This agent has no recorded sessions.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead className="text-right">Last</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSessions.map((session) => (
                  <TableRow key={session.sessionId}>
                    <TableCell className="font-mono text-xs">
                      {session.sessionId}
                      {session.active && (
                        <Badge variant="secondary" className="ml-2">
                          active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {session.messageCount}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs">
                      {formatRelativeTime(session.lastMessageAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  )
}

function MarkdownPanel({
  title,
  content,
  emptyTitle,
  emptyDescription,
}: {
  title: string
  content: string
  emptyTitle: string
  emptyDescription: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {content.trim() ? (
          <ScrollArea className="h-[420px]">
            <pre className="text-muted-foreground whitespace-pre-wrap break-words font-mono text-xs">
              {content}
            </pre>
          </ScrollArea>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              <EmptyDescription>{emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}
