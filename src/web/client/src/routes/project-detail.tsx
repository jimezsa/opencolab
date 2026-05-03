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
import { StateBadge } from "@/components/layout/state-badge"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"
import type { WebAgentSummary } from "../../../shared/types"

export default function ProjectDetailRoute() {
  const { projectId = "" } = useParams()
  const project = useAsync(() => api.project(projectId), [projectId])

  if (project.status === "loading") return <LoadingState rows={6} />
  if (project.status === "error") return <ErrorState message={project.error} />
  const data = project.data

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
        {(data.goal || data.focus) && (
          <CardContent className="flex flex-col gap-3 text-sm">
            {data.focus && (
              <div>
                <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Current focus
                </h3>
                <p className="mt-1 whitespace-pre-wrap">{data.focus}</p>
              </div>
            )}
            {data.goal && (
              <div>
                <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Goal
                </h3>
                <p className="mt-1 whitespace-pre-wrap">{data.goal}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="runs">GPU runs</TabsTrigger>
        </TabsList>

        <TabsContent value="agents">
          {data.agents.length === 0 ? (
            <EmptyAgents />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  projectId={data.id}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="conversations">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Session</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead className="text-right">Last</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentSessions.map((session) => (
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
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {formatRelativeTime(session.lastMessageAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="artifacts">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Path</TableHead>
                <TableHead className="text-right">Modified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentArtifacts.map((artifact) => (
                <TableRow key={artifact.id}>
                  <TableCell className="font-medium">{artifact.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{artifact.kind}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {artifact.relativePath}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {formatRelativeTime(artifact.modifiedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="runs">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentGpuRuns.map((run) => (
                <TableRow key={run.runId}>
                  <TableCell className="font-mono text-xs">{run.runId}</TableCell>
                  <TableCell>
                    <StateBadge state={run.state} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{run.targetId}</TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {formatRelativeTime(run.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EmptyAgents() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No agents in this project</EmptyTitle>
        <EmptyDescription>
          Use the CLI to add an agent to this project.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
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
          <AgentMetaRow label="Auth">
            {agent.provider.authMode}
            {agent.provider.reasoningEffort
              ? ` · ${agent.provider.reasoningEffort}`
              : ""}
          </AgentMetaRow>
          {agent.heartbeat && (
            <AgentMetaRow label="Wakes">
              {new Date(agent.heartbeat.wakeAt).toLocaleString()}
            </AgentMetaRow>
          )}
          {agent.todoSummary && (
            <p className="text-muted-foreground border-border/60 mt-1 line-clamp-2 border-t pt-2">
              {agent.todoSummary}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function AgentMetaRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-wide text-[10px]">
        {label}
      </span>
      <span className="text-foreground/90 truncate">{children}</span>
    </div>
  )
}
