import { Link } from "react-router-dom"
import { FolderIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

const TINTS = [
  "bg-sky-50 dark:bg-sky-950/30",
  "bg-rose-50 dark:bg-rose-950/30",
  "bg-violet-50 dark:bg-violet-950/30",
  "bg-amber-50 dark:bg-amber-950/30",
  "bg-emerald-50 dark:bg-emerald-950/30",
  "bg-fuchsia-50 dark:bg-fuchsia-950/30",
]

function tintFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return TINTS[hash % TINTS.length]
}

function ProjectCard({ project }: { project: WebProjectSummary }) {
  const title = project.name && project.name.length > 0 ? project.name : project.id
  const tint = tintFor(project.id)
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group/project-card focus-visible:outline-none"
      title={project.description ?? undefined}
    >
      <Card
        className={`h-44 ring-0 border-0 transition group-hover/project-card:shadow-md group-focus-visible/project-card:ring-2 group-focus-visible/project-card:ring-foreground/40 ${tint}`}
      >
        <div className="flex h-full flex-col justify-between px-5 py-5">
          <div className="flex items-start justify-between">
            {project.emoji ? (
              <span className="text-3xl leading-none" aria-hidden="true">
                {project.emoji}
              </span>
            ) : (
              <div className="bg-background/60 text-muted-foreground flex size-9 items-center justify-center rounded-md">
                <FolderIcon className="size-4" />
              </div>
            )}
            {project.active && (
              <Badge variant="secondary" className="shrink-0">
                active
              </Badge>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-heading line-clamp-2 text-lg font-medium leading-snug">
              {title}
            </h3>
            <p className="text-muted-foreground text-xs">
              {formatRelativeTime(project.recentActivityAt)}
              {" · "}
              {project.agentCount} {project.agentCount === 1 ? "agent" : "agents"}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  )
}
