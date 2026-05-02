import { Link } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
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

export default function Dashboard() {
  const overview = useAsync(() => api.overview(), [])

  if (overview.status === "loading") return <LoadingState rows={6} />
  if (overview.status === "error") return <ErrorState message={overview.error} />
  const data = overview.data

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active project"
          value={data.active.projectId}
          hint={`agent ${data.active.agentId}`}
        />
        <StatCard label="Projects" value={String(data.projectCount)} />
        <StatCard label="Agents" value={String(data.agentCount)} />
        <StatCard
          label="Gateway"
          value={`:${data.health.gateway.port}`}
          hint={data.health.gateway.runtimeMode}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent sessions</CardTitle>
            <CardDescription>
              Most recent conversation activity in {data.active.projectId}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentSessions.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No sessions yet</EmptyTitle>
                  <EmptyDescription>
                    Start a chat with an agent to populate this list.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Last preview</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentSessions.map((session) => (
                    <TableRow key={`${session.agentId}-${session.sessionId}`}>
                      <TableCell className="font-mono text-xs">
                        <Link
                          className="hover:underline"
                          to={`/projects/${session.projectId}/agents/${session.agentId}`}
                        >
                          {session.agentId}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                        {session.lastMessagePreview ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        {formatRelativeTime(session.lastMessageAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent GPU runs</CardTitle>
            <CardDescription>
              Active or recent experiment runs in {data.active.projectId}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recentGpuRuns.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No runs yet</EmptyTitle>
                  <EmptyDescription>
                    Launch a GPU job from the CLI or workflow to populate this list.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentGpuRuns.map((run) => (
                    <TableRow key={run.runId}>
                      <TableCell className="font-mono text-xs">
                        {run.runId}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={run.state} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs">
                        {formatRelativeTime(run.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider status</CardTitle>
          <CardDescription>
            Whether OpenColab can reach the configured providers — credential values are never shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead className="text-right">Credential</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.health.providers.map((provider) => (
                <TableRow key={`${provider.name}-${provider.authMode}`}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {provider.authMode}
                  </TableCell>
                  <TableCell className="text-right">
                    {provider.hasCredential ? (
                      <Badge variant="secondary">present</Badge>
                    ) : (
                      <Badge variant="outline">missing</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Separator className="my-4" />
          <p className="text-muted-foreground text-xs">
            Generated {formatRelativeTime(data.generatedAt)}.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-xl">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <span className="text-muted-foreground text-xs">{hint}</span>
        </CardContent>
      )}
    </Card>
  )
}
