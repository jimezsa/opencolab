import { Link } from "react-router-dom"
import { FolderIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { api } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import { useAsync } from "@/lib/state"
import type { WebProjectSummary } from "../../../shared/types"

export default function ProjectsRoute() {
  const projects = useAsync(() => api.projects(), [])
  if (projects.status === "loading") return <LoadingState rows={4} />
  if (projects.status === "error") return <ErrorState message={projects.error} />

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-medium">Projects</h2>
        <p className="text-muted-foreground text-sm">
          All OpenColab projects discovered in this runtime.
        </p>
      </div>
      {projects.data.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No projects found</EmptyTitle>
            <EmptyDescription>
              Use the CLI to create or import a project into this runtime.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: WebProjectSummary }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group/project-card focus-visible:outline-none"
    >
      <Card
        size="sm"
        className="h-full transition group-hover/project-card:ring-foreground/30 group-focus-visible/project-card:ring-2 group-focus-visible/project-card:ring-foreground/40"
      >
        <CardHeader>
          <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-md">
            <FolderIcon className="size-4" />
          </div>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="truncate">{project.id}</span>
            {project.active && (
              <Badge variant="secondary" className="shrink-0">
                active
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {project.path}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-xs">
          <Row label="Agents">{project.agentCount}</Row>
          <Row label="Artifacts">{project.artifactCount}</Row>
          <Row label="Runs">{project.runCount}</Row>
          <Row label="Activity">{formatRelativeTime(project.recentActivityAt)}</Row>
        </CardContent>
      </Card>
    </Link>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-wide text-[10px]">
        {label}
      </span>
      <span className="text-foreground/90 truncate">{children}</span>
    </div>
  )
}
