import { Link } from "react-router-dom"
import { AlertTriangleIcon, FileTextIcon, ImageIcon, BookOpenIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { formatRelativeTime } from "@/lib/format"
import type { WebResearchRun, WebResearchStatus } from "@shared/types"

interface ResearchListProps {
  projectId: string
  runs: WebResearchRun[]
  scopeLabel?: string
  showScopeBadge?: boolean
}

const STATUS_VARIANT: Record<
  WebResearchStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  running: "default",
  complete: "secondary",
  failed: "destructive",
  abandoned: "outline",
  unknown: "outline",
}

export function ResearchList({
  projectId,
  runs,
  scopeLabel,
  showScopeBadge = true,
}: ResearchListProps) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No research yet</EmptyTitle>
          <EmptyDescription>
            Runs from <code>fast-research</code>, <code>pro-research</code>,{" "}
            <code>deep-research</code>, and related skills appear here once they
            write to <code>research/&lt;date&gt;-&lt;topic&gt;/</code>.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {scopeLabel && (
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          {scopeLabel}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {runs.map((run) => (
          <ResearchCard
            key={run.id}
            projectId={projectId}
            run={run}
            showScopeBadge={showScopeBadge}
          />
        ))}
      </div>
    </div>
  )
}

function ResearchCard({
  projectId,
  run,
  showScopeBadge,
}: {
  projectId: string
  run: WebResearchRun
  showScopeBadge: boolean
}) {
  const to = `/projects/${encodeURIComponent(projectId)}/research/${encodeURIComponent(run.id)}`
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {run.skill}
            </Badge>
            <Badge variant={STATUS_VARIANT[run.status]} className="capitalize">
              {run.status}
            </Badge>
            {showScopeBadge && (
              <Badge variant="secondary" className="font-mono text-xs">
                {run.scope === "agent" && run.agentId
                  ? `agent: ${run.agentId}`
                  : "project"}
              </Badge>
            )}
            {run.warnings.length > 0 && (
              <span
                className="text-amber-500"
                title={run.warnings.join("\n")}
              >
                <AlertTriangleIcon className="size-4" />
              </span>
            )}
          </div>
          <CardTitle className="text-base leading-tight">{run.topic}</CardTitle>
          <CardDescription className="font-mono text-xs">
            {run.folder}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1" title="papers">
              <BookOpenIcon className="size-3.5" />
              {run.corpus.papers}
            </span>
            <span className="flex items-center gap-1" title="summaries">
              <FileTextIcon className="size-3.5" />
              {run.corpus.summaries}
            </span>
            <span className="flex items-center gap-1" title="diagrams">
              <ImageIcon className="size-3.5" />
              {run.corpus.diagrams}
            </span>
            <span className="ml-auto">
              {run.updated
                ? `updated ${formatRelativeTime(run.updated)}`
                : run.created
                  ? `created ${formatRelativeTime(run.created)}`
                  : "—"}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
