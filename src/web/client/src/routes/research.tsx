import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { ResearchList } from "@/components/research/research-list"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"
import type { WebResearchScope } from "@shared/types"

type ScopeFilter = "all" | WebResearchScope

export default function ResearchRoute() {
  const { projectId = "" } = useParams()
  const runs = useAsync(() => api.research(projectId), [projectId])
  const [scope, setScope] = useState<ScopeFilter>("all")
  const [skill, setSkill] = useState<string>("all")

  const skills = useMemo(() => {
    if (runs.status !== "ready") return []
    const set = new Set(runs.data.map((run) => run.skill))
    return Array.from(set).sort()
  }, [runs])

  const filtered = useMemo(() => {
    if (runs.status !== "ready") return []
    return runs.data.filter((run) => {
      if (scope !== "all" && run.scope !== scope) return false
      if (skill !== "all" && run.skill !== skill) return false
      return true
    })
  }, [runs, scope, skill])

  if (runs.status === "loading") return <LoadingState rows={6} />
  if (runs.status === "error") return <ErrorState message={runs.error} />

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Research</CardTitle>
          <CardDescription>
            Runs produced by research skills, grouped per topic. Project- and
            agent-scoped folders are shown together.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Scope">
            <FilterButton
              active={scope === "all"}
              onClick={() => setScope("all")}
            >
              All
            </FilterButton>
            <FilterButton
              active={scope === "project"}
              onClick={() => setScope("project")}
            >
              Project
            </FilterButton>
            <FilterButton
              active={scope === "agent"}
              onClick={() => setScope("agent")}
            >
              Agent
            </FilterButton>
          </FilterGroup>
          {skills.length > 0 && (
            <FilterGroup label="Skill">
              <FilterButton
                active={skill === "all"}
                onClick={() => setSkill("all")}
              >
                All
              </FilterButton>
              {skills.map((name) => (
                <FilterButton
                  key={name}
                  active={skill === name}
                  onClick={() => setSkill(name)}
                >
                  {name}
                </FilterButton>
              ))}
            </FilterGroup>
          )}
          <Badge variant="outline" className="ml-auto font-mono text-xs">
            {filtered.length} / {runs.data.length}
          </Badge>
        </CardContent>
      </Card>

      <ResearchList projectId={projectId} runs={filtered} />
    </div>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground mr-1 text-xs uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-7 px-2 text-xs"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
