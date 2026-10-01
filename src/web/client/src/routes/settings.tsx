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
import type { WebHealthStatus } from "@shared/types"

export default function SettingsRoute() {
  const health = useAsync(() => api.health(), [])
  if (health.status === "loading") return <LoadingState rows={4} />
  if (health.status === "error") return <ErrorState message={health.error} />
  const data = health.data

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Runtime</CardTitle>
          <CardDescription>
            Where this OpenColab gateway is running.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-3">
            <Field label="Root" value={data.gateway.rootDir} mono />
            <Field label="Port" value={String(data.gateway.port)} mono />
            <Field label="Mode" value={data.gateway.runtimeMode} />
            <Field
              label="Build"
              value={data.build.version ?? "dev"}
              hint={data.build.packaged ? "packaged" : "source"}
            />
            <Field
              label="Telegram bots"
              value={String(data.telegramBots.length)}
              hint={
                data.telegramBots.length === 0
                  ? "none configured"
                  : `${String(
                      data.telegramBots.filter(
                        (bot) => bot.enabled && bot.paired && bot.tokenPresent,
                      ).length,
                    )} ready`
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Telegram bots</CardTitle>
          <CardDescription>
            One bot per project. A message to a bot is answered by that project's
            target agent. Chat ids and tokens are never shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.telegramBots.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No bots configured. Add one with{" "}
              <code className="font-mono">
                opencolab telegram bot add --token &lt;botfather_token&gt;
                --project &lt;project_id&gt;
              </code>
              .
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bot</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.telegramBots.map((bot) => (
                  <TableRow key={bot.id}>
                    <TableCell className="font-mono text-xs">
                      {bot.username ? `@${bot.username}` : bot.id}
                    </TableCell>
                    <TableCell className="text-xs">
                      {bot.scope === "floating"
                        ? `${bot.projectId ?? "none"} (follows active)`
                        : (bot.projectId ?? "unbound")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {bot.agentId ?? "none"}
                    </TableCell>
                    <TableCell className="text-right">
                      <BotStatusBadge bot={bot} />
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
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Whether OpenColab can reach each configured provider. Credential
            values are never shown.
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
              {data.providers.map((provider) => (
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
        </CardContent>
      </Card>
    </div>
  )
}

/** Reports the first thing that would stop this bot from answering. */
function BotStatusBadge({
  bot,
}: {
  bot: WebHealthStatus["telegramBots"][number]
}) {
  if (!bot.enabled) return <Badge variant="outline">disabled</Badge>
  if (bot.orphaned) return <Badge variant="destructive">orphaned</Badge>
  if (!bot.tokenPresent) return <Badge variant="destructive">no token</Badge>
  if (bot.pendingPairing) return <Badge variant="outline">pairing</Badge>
  if (!bot.paired) return <Badge variant="outline">unpaired</Badge>
  return <Badge variant="secondary">ready</Badge>
}

function Field({
  label,
  value,
  hint,
  mono,
}: {
  label: string
  value: string
  hint?: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className={mono ? "font-mono" : ""}>{value}</dd>
      {hint && (
        <dd className="text-muted-foreground text-[11px]">{hint}</dd>
      )}
    </div>
  )
}
