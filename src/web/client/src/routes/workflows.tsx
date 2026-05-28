import { useCallback, useState } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  GitBranchIcon,
  PlayIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { StartWorkflowDialog } from "@/components/workflows/start-workflow-dialog"
import { WorkflowFlowDiagram } from "@/components/workflows/workflow-flow-diagram"
import { WorkflowMetadataEditor } from "@/components/workflows/workflow-metadata-editor"
import { WorkflowRunPanel } from "@/components/workflows/workflow-run-panel"
import { WorkflowXmlEditor } from "@/components/workflows/workflow-xml-editor"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  WebWorkflowRunSummary,
  WebWorkflowSummary,
  WebWorkflowValidationIssue,
} from "@shared/types"

export default function WorkflowsRoute() {
  const { projectId = "" } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedWorkflowId = searchParams.get("workflow")
  const selectedRunId = searchParams.get("run")

  const workflows = useAsync(() => api.workflows(projectId), [projectId])

  const selectWorkflow = useCallback(
    (workflowId: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (workflowId) {
        next.set("workflow", workflowId)
      } else {
        next.delete("workflow")
      }
      next.delete("run")
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  const selectRun = useCallback(
    (runId: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (runId) {
        next.set("run", runId)
      } else {
        next.delete("run")
      }
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  if (!projectId) {
    return (
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Missing project</AlertTitle>
        <AlertDescription>Select a project from the sidebar.</AlertDescription>
      </Alert>
    )
  }

  if (workflows.status === "loading") return <LoadingState rows={5} />
  if (workflows.status === "error")
    return <ErrorState message={workflows.error} />

  const list = workflows.data
  const active = list.find((wf) => wf.id === selectedWorkflowId) ?? null

  return (
    <div className="flex flex-col gap-4 px-2 md:px-6 xl:px-10">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-medium">Workflows</h2>
        <p className="text-muted-foreground text-sm">
          Project workflows under{" "}
          <span className="font-mono">projects/{projectId}/workflows/</span>.
        </p>
      </div>

      {list.length === 0 ? (
        <EmptyWorkflows />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
          <WorkflowList
            workflows={list}
            selectedId={selectedWorkflowId}
            onSelect={selectWorkflow}
          />
          {active ? (
            <WorkflowWorkspace
              projectId={projectId}
              workflow={active}
              selectedRunId={selectedRunId}
              onSelectRun={selectRun}
            />
          ) : (
            <EmptySelection />
          )}
        </div>
      )}
    </div>
  )
}

function EmptyWorkflows() {
  return (
    <Empty>
      <EmptyHeader>
        <GitBranchIcon className="text-muted-foreground size-6" />
        <EmptyTitle>No workflows yet</EmptyTitle>
        <EmptyDescription>
          Use the CLI (<span className="font-mono">opencolab workflow create</span>)
          or the API to scaffold a workflow from a template.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function EmptySelection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Select a workflow</CardTitle>
        <CardDescription>
          Pick a workflow from the list to view its diagram, runs, and XML.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

interface WorkflowListProps {
  workflows: WebWorkflowSummary[]
  selectedId: string | null
  onSelect: (workflowId: string) => void
}

function WorkflowList({ workflows, selectedId, onSelect }: WorkflowListProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {workflows.length} workflow{workflows.length === 1 ? "" : "s"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[60vh]">
          <ul className="flex flex-col">
            {workflows.map((wf) => (
              <li key={wf.id}>
                <button
                  type="button"
                  onClick={() => onSelect(wf.id)}
                  className={cn(
                    "hover:bg-foreground/5 flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm focus-visible:outline-none",
                    wf.id === selectedId && "bg-foreground/5",
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{wf.id}</span>
                      <Badge variant="outline" className="text-[10px]">
                        v{wf.version}
                      </Badge>
                    </div>
                    {wf.description && (
                      <p className="text-muted-foreground truncate text-xs">
                        {wf.description}
                      </p>
                    )}
                    <p className="text-muted-foreground text-[11px]">
                      {wf.stepCount} step{wf.stepCount === 1 ? "" : "s"}
                      {wf.inputs.length > 0 &&
                        ` · inputs: ${wf.inputs.map((i) => i.name).join(", ")}`}
                      {wf.updatedAt && ` · ${formatRelativeTime(wf.updatedAt)}`}
                    </p>
                  </div>
                  <ChevronRightIcon className="text-muted-foreground mt-1 size-4 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

interface WorkflowWorkspaceProps {
  projectId: string
  workflow: WebWorkflowSummary
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
}

function WorkflowWorkspace({
  projectId,
  workflow,
  selectedRunId,
  onSelectRun,
}: WorkflowWorkspaceProps) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [startOpen, setStartOpen] = useState(false)
  const detail = useAsync(
    () => api.workflow(projectId, workflow.id),
    [projectId, workflow.id, refreshKey],
  )
  const graph = useAsync(
    () => api.workflowGraph(projectId, workflow.id),
    [projectId, workflow.id, refreshKey],
  )

  if (detail.status === "loading" || graph.status === "loading") {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (detail.status === "error") {
    return <ErrorState message={detail.error} />
  }
  if (graph.status === "error") {
    return <ErrorState message={graph.error} />
  }

  const detailData = detail.data
  const graphData = graph.data
  const runs = detailData.runs
  const activeRun = runs.find((run) => run.runId === selectedRunId) ?? null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="font-mono text-lg">
              {detailData.id}
            </CardTitle>
            {detailData.description && (
              <CardDescription>{detailData.description}</CardDescription>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="font-mono text-[10px]">
              v{detailData.version}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {detailData.stepCount} step
              {detailData.stepCount === 1 ? "" : "s"}
            </Badge>
            {detailData.inputs.length > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {detailData.inputs.length} input
                {detailData.inputs.length === 1 ? "" : "s"}
              </Badge>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setStartOpen(true)}
              className="ml-1"
            >
              <PlayIcon className="size-3" /> Start run
            </Button>
          </div>
        </div>
        <ValidationIssues issues={graphData.validation} />
      </CardHeader>
      <StartWorkflowDialog
        projectId={projectId}
        workflow={detailData}
        open={startOpen}
        onOpenChange={setStartOpen}
        onStarted={(runId) => {
          onSelectRun(runId)
          setRefreshKey((value) => value + 1)
        }}
      />
      <CardContent>
        <Tabs defaultValue="definition">
          <TabsList>
            <TabsTrigger value="definition">Definition</TabsTrigger>
            <TabsTrigger value="runs">
              Runs
              {runs.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 px-1.5 text-[10px]"
                >
                  {runs.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="xml">XML</TabsTrigger>
          </TabsList>

          <TabsContent value="definition" className="pt-3">
            <div className="flex flex-col gap-4">
              <WorkflowMetadataEditor
                projectId={projectId}
                workflow={detailData}
                onSaved={() => setRefreshKey((value) => value + 1)}
              />
              <WorkflowFlowDiagram graph={graphData} />
            </div>
          </TabsContent>

          <TabsContent value="runs" className="pt-3">
            <RunsTab
              projectId={projectId}
              runs={runs}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              activeRun={activeRun}
            />
          </TabsContent>

          <TabsContent value="xml" className="pt-3">
            <WorkflowXmlEditor
              projectId={projectId}
              workflowId={detailData.id}
              onSaved={() => setRefreshKey((value) => value + 1)}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

function ValidationIssues({
  issues,
}: {
  issues: WebWorkflowValidationIssue[]
}) {
  if (issues.length === 0) return null
  const errors = issues.filter((issue) => issue.severity === "error")
  const warnings = issues.filter((issue) => issue.severity === "warning")
  return (
    <Alert
      variant={errors.length > 0 ? "destructive" : "default"}
      className="mt-3"
    >
      <AlertTriangleIcon />
      <AlertTitle>
        {errors.length > 0
          ? `${errors.length} validation error${errors.length === 1 ? "" : "s"}`
          : `${warnings.length} validation warning${warnings.length === 1 ? "" : "s"}`}
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4 text-xs">
          {issues.map((issue, index) => (
            <li key={index}>
              <span className="font-mono">{issue.severity}</span> · {issue.message}
              {issue.stepId ? ` · step ${issue.stepId}` : ""}
              {issue.loopId ? ` · loop ${issue.loopId}` : ""}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

interface RunsTabProps {
  projectId: string
  runs: WebWorkflowRunSummary[]
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
  activeRun: WebWorkflowRunSummary | null
}

function RunsTab({
  projectId,
  runs,
  selectedRunId,
  onSelectRun,
  activeRun,
}: RunsTabProps) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No runs yet</EmptyTitle>
          <EmptyDescription>
            Start a workflow run from the CLI or API to populate the run
            history.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <RunsList
        runs={runs}
        selectedRunId={selectedRunId}
        onSelectRun={onSelectRun}
      />
      <WorkflowRunPanel projectId={projectId} run={activeRun} />
    </div>
  )
}

function RunsList({
  runs,
  selectedRunId,
  onSelectRun,
}: {
  runs: WebWorkflowRunSummary[]
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
}) {
  return (
    <div className="border-muted-foreground/30 rounded-md border">
      <ScrollArea className="max-h-72">
        <ul className="flex flex-col text-xs">
          {runs.map((run) => (
            <li key={run.runId}>
              <button
                type="button"
                onClick={() =>
                  onSelectRun(run.runId === selectedRunId ? null : run.runId)
                }
                className={cn(
                  "hover:bg-foreground/5 flex w-full items-center gap-2 border-b px-3 py-2 text-left focus-visible:outline-none",
                  run.runId === selectedRunId && "bg-foreground/5",
                )}
              >
                <span className="flex-1 font-mono">{run.runId}</span>
                <Badge variant="outline" className="text-[10px]">
                  {run.status}
                </Badge>
                <span className="text-muted-foreground">
                  {formatRelativeTime(run.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

