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
              label="Telegram"
              value={data.telegram.paired ? "paired" : "unpaired"}
              hint={
                data.telegram.pendingPairing
                  ? "pairing pending"
                  : data.telegram.chatPresent
                    ? "chat configured"
                    : "no chat"
              }
            />
          </dl>
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
