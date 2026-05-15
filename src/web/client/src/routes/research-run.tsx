import { useEffect, useMemo, useState } from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { AlertTriangleIcon, ChevronLeftIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ErrorState, LoadingState } from "@/components/layout/page-state"
import { FileTree } from "@/components/research/file-tree"
import { MarkdownViewer } from "@/components/research/markdown-viewer"
import { PdfViewer } from "@/components/research/pdf-viewer"
import { api, researchFileUrl } from "@/lib/api"
import { formatBytes, formatRelativeTime } from "@/lib/format"
import type {
  WebResearchFile,
  WebResearchRunDetail,
  WebResearchStatus,
} from "@shared/types"

const POLL_INTERVAL_MS = 5000

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

export default function ResearchRunRoute() {
  const { projectId = "", runId = "" } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [detail, setDetail] = useState<{
    status: "loading" | "ready" | "error"
    data: WebResearchRunDetail | null
    error: string | null
  }>({ status: "loading", data: null, error: null })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const fetchOnce = async () => {
      try {
        const data = await api.researchRun(projectId, runId)
        if (cancelled) return
        setDetail({ status: "ready", data, error: null })
        if (data.status === "running") {
          timer = setTimeout(fetchOnce, POLL_INTERVAL_MS)
        }
      } catch (error) {
        if (cancelled) return
        setDetail({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    setDetail({ status: "loading", data: null, error: null })
    void fetchOnce()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [projectId, runId])

  if (detail.status === "loading") return <LoadingState rows={6} />
  if (detail.status === "error") return <ErrorState message={detail.error ?? "unknown error"} />
  const data = detail.data
  if (!data) return <ErrorState message="no run" />

  const selectedPath = searchParams.get("file") ?? data.findingsPath ?? data.tree[0]?.path ?? null

  const setSelectedPath = (path: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set("file", path)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <RunHeader projectId={projectId} run={data} />
      {data.warnings.length > 0 && (
        <Alert>
          <AlertTriangleIcon className="size-4" />
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {data.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-[260px_1fr_280px]">
        <Card className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Files</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[60vh] lg:h-[calc(100vh-12rem)]">
              {data.tree.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Empty</EmptyTitle>
                    <EmptyDescription>
                      Run folder has no readable files yet.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <FileTree
                  files={data.tree}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                />
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="font-mono text-sm">
              {selectedPath ?? "—"}
            </CardTitle>
            {selectedPath && (
              <Button asChild variant="ghost" size="sm">
                <a
                  href={researchFileUrl(projectId, runId, selectedPath)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Open raw
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {selectedPath ? (
              <ViewerPane
                projectId={projectId}
                runId={runId}
                filePath={selectedPath}
                files={data.tree}
              />
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>Pick a file</EmptyTitle>
                  <EmptyDescription>
                    Select a file from the left to preview it here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Run metadata</CardTitle>
            <CardDescription className="text-xs">
              Parsed from <code>RUN.md</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MetadataPanel run={data} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function RunHeader({
  projectId,
  run,
}: {
  projectId: string
  run: WebResearchRunDetail
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to={`/projects/${encodeURIComponent(projectId)}/research`}>
              <ChevronLeftIcon className="size-4" />
              Research
            </Link>
          </Button>
          <Badge variant="outline" className="font-mono text-xs">
            {run.skill}
          </Badge>
          <Badge variant={STATUS_VARIANT[run.status]} className="capitalize">
            {run.status}
          </Badge>
          <Badge variant="secondary" className="font-mono text-xs">
            {run.scope === "agent" && run.agentId
              ? `agent: ${run.agentId}`
              : "project"}
          </Badge>
          {run.created && (
            <span className="text-muted-foreground text-xs">
              created {formatRelativeTime(run.created)}
            </span>
          )}
          {run.updated && (
            <span className="text-muted-foreground text-xs">
              · updated {formatRelativeTime(run.updated)}
            </span>
          )}
        </div>
        <CardTitle className="mt-2 text-lg">{run.topic}</CardTitle>
        <CardDescription className="font-mono text-xs">
          {run.folder}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

function ViewerPane({
  projectId,
  runId,
  filePath,
  files,
}: {
  projectId: string
  runId: string
  filePath: string
  files: WebResearchFile[]
}) {
  const file = useMemo(
    () => files.find((entry) => entry.path === filePath) ?? null,
    [files, filePath],
  )
  if (!file) {
    return (
      <p className="text-muted-foreground text-xs">file not in current tree</p>
    )
  }
  switch (file.kind) {
    case "markdown":
      return (
        <ScrollArea className="h-[70vh]">
          <MarkdownViewer
            projectId={projectId}
            runId={runId}
            filePath={filePath}
          />
        </ScrollArea>
      )
    case "pdf":
      return (
        <ScrollArea className="h-[70vh]">
          <PdfViewer
            projectId={projectId}
            runId={runId}
            filePath={filePath}
            sizeBytes={file.size}
          />
        </ScrollArea>
      )
    case "image-png":
    case "image-svg":
    case "image-other":
      return (
        <ScrollArea className="h-[70vh]">
          <img
            src={researchFileUrl(projectId, runId, filePath)}
            alt={file.name}
            className="max-w-full"
          />
        </ScrollArea>
      )
    case "json":
    case "text":
      return (
        <RawTextViewer
          projectId={projectId}
          runId={runId}
          filePath={filePath}
        />
      )
    default:
      return (
        <p className="text-muted-foreground text-xs">
          Inline preview not available for this file type.{" "}
          <a
            className="underline"
            href={researchFileUrl(projectId, runId, filePath)}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open raw
          </a>
        </p>
      )
  }
}

function RawTextViewer({
  projectId,
  runId,
  filePath,
}: {
  projectId: string
  runId: string
  filePath: string
}) {
  const [content, setContent] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setContent("")
    setError(null)
    fetch(researchFileUrl(projectId, runId, filePath))
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        setContent(text)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, runId, filePath])

  if (error) {
    return <p className="text-destructive text-xs">{error}</p>
  }
  return (
    <ScrollArea className="h-[70vh]">
      <pre className="text-muted-foreground whitespace-pre-wrap break-words font-mono text-xs">
        {content}
      </pre>
    </ScrollArea>
  )
}

function MetadataPanel({ run }: { run: WebResearchRunDetail }) {
  return (
    <div className="flex flex-col gap-3 text-xs">
      <dl className="grid grid-cols-2 gap-2">
        <Field label="Skill" value={run.skill} />
        <Field label="Status" value={run.status} />
        <Field label="Scope" value={run.scope} />
        <Field label="Agent" value={run.agentId ?? "—"} />
        <Field label="Papers" value={String(run.corpus.papers)} />
        <Field label="Summaries" value={String(run.corpus.summaries)} />
        <Field label="Diagrams" value={String(run.corpus.diagrams)} />
        <Field
          label="RUN.md"
          value={run.hasRunMd ? "present" : "missing"}
        />
      </dl>
      {run.question && (
        <div>
          <p className="text-muted-foreground uppercase tracking-wide">
            Question
          </p>
          <p className="mt-1">{run.question}</p>
        </div>
      )}
      {run.deliverables.length > 0 && (
        <div>
          <p className="text-muted-foreground uppercase tracking-wide">
            Deliverables
          </p>
          <ul className="mt-1 list-disc pl-4 font-mono">
            {run.deliverables.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-muted-foreground uppercase tracking-wide">
          Created
        </p>
        <p className="mt-1 font-mono">{run.created ?? "—"}</p>
      </div>
      <div>
        <p className="text-muted-foreground uppercase tracking-wide">
          Updated
        </p>
        <p className="mt-1 font-mono">{run.updated ?? "—"}</p>
      </div>
      {run.runMd.body && (
        <div>
          <p className="text-muted-foreground uppercase tracking-wide">
            Notes
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
            {run.runMd.body}
          </pre>
        </div>
      )}
      <div>
        <p className="text-muted-foreground uppercase tracking-wide">
          Total bytes
        </p>
        <p className="mt-1 font-mono">{formatBytes(totalBytes(run))}</p>
      </div>
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

function totalBytes(run: WebResearchRunDetail): number {
  return run.tree.reduce((sum, entry) => sum + entry.size, 0)
}
