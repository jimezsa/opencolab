import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { toast } from "sonner"
import {
  CircleAlertIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api, workflowRunEventsUrl, ApiError } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type {
  WebWorkflowApprovalRequest,
  WebWorkflowEvent,
  WebWorkflowPendingGate,
  WebWorkflowRunDetail,
  WebWorkflowRunStatusDto,
  WebWorkflowRunSummary,
} from "@shared/types"

interface WorkflowRunPanelProps {
  projectId: string
  run: WebWorkflowRunSummary | null
}

const TERMINAL_STATUSES = new Set(["complete", "failed", "stopped"])

export function WorkflowRunPanel({ projectId, run }: WorkflowRunPanelProps) {
  const [detail, setDetail] = useState<WebWorkflowRunDetail | null>(null)
  const [status, setStatus] = useState<WebWorkflowRunStatusDto | null>(null)
  const [events, setEvents] = useState<WebWorkflowEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<null | "pause" | "stop" | "resume">(null)

  const runId = run?.runId ?? null

  const refreshDetail = useCallback(async () => {
    if (!runId) return
    try {
      const [nextDetail, nextStatus] = await Promise.all([
        api.workflowRun(projectId, runId),
        api.workflowRunStatus(projectId, runId).catch(() => null),
      ])
      setDetail(nextDetail)
      setStatus(nextStatus)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projectId, runId])

  useEffect(() => {
    if (!runId) {
      setDetail(null)
      setStatus(null)
      setEvents([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setEvents([])
    Promise.all([
      api.workflowRun(projectId, runId),
      api.workflowRunStatus(projectId, runId).catch(() => null),
    ])
      .then(([nextDetail, nextStatus]) => {
        if (cancelled) return
        setDetail(nextDetail)
        setStatus(nextStatus)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, runId])

  useEffect(() => {
    if (!runId) return
    const source = new EventSource(workflowRunEventsUrl(projectId, runId))
    const onHistory = (event: MessageEvent<string>) => {
      pushEvent(setEvents, event.data)
    }
    const onProgress = (event: MessageEvent<string>) => {
      pushEvent(setEvents, event.data)
    }
    const onStatus = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as WebWorkflowRunStatusDto
        setStatus(parsed)
        if (TERMINAL_STATUSES.has(parsed.status) || parsed.status === "paused") {
          // Refresh full detail so pendingGate + stepHistory stay current.
          void refreshDetail()
        }
      } catch {
        // ignore malformed
      }
    }
    const onClose = () => source.close()
    source.addEventListener("history", onHistory)
    source.addEventListener("progress", onProgress)
    source.addEventListener("status", onStatus)
    source.addEventListener("completed", onClose)
    source.addEventListener("error", onClose)
    return () => {
      source.close()
    }
  }, [projectId, runId, refreshDetail])

  const handleAction = useCallback(
    async (action: "pause" | "stop" | "resume") => {
      if (!runId) return
      setActing(action)
      try {
        if (action === "pause") {
          await api.pauseWorkflowRun(projectId, runId)
          toast.success("Pause requested")
        } else if (action === "stop") {
          await api.stopWorkflowRun(projectId, runId)
          toast.success("Stop requested")
        } else if (action === "resume") {
          await api.resumeWorkflowRun(projectId, runId)
          toast.success("Resume requested")
        }
        await refreshDetail()
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `${err.status} · ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        toast.error(`Failed to ${action}: ${message}`)
      } finally {
        setActing(null)
      }
    },
    [projectId, runId, refreshDetail],
  )

  const handleApprove = useCallback(
    async (payload: WebWorkflowApprovalRequest) => {
      if (!runId) return
      try {
        await api.approveWorkflowRun(projectId, runId, payload)
        toast.success(`Decision '${payload.decision}' submitted`)
        await refreshDetail()
      } catch (err) {
        const message =
          err instanceof ApiError
            ? `${err.status} · ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        toast.error(`Approval failed: ${message}`)
        throw err
      }
    },
    [projectId, runId, refreshDetail],
  )

  if (!run) {
    return (
      <div className="text-muted-foreground text-sm">
        Select a run to inspect status and events.
      </div>
    )
  }

  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive flex items-center gap-2 text-sm">
        <CircleAlertIcon className="size-4" />
        <span>{error}</span>
      </div>
    )
  }

  if (!detail) return null

  const liveStatus = status ?? null
  const currentStatusKind = liveStatus?.status ?? detail.status
  const terminal = TERMINAL_STATUSES.has(currentStatusKind)
  const pendingGate = detail.pendingGate ?? liveStatus?.pendingGate ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{detail.runId}</span>
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {currentStatusKind}
        </Badge>
        {!terminal && liveStatus?.currentPhase && (
          <Badge variant="secondary" className="text-[10px]">
            phase · {liveStatus.currentPhase.replace(/_/g, " ")}
          </Badge>
        )}
        {liveStatus?.currentStepId && (
          <Badge variant="secondary" className="text-[10px]">
            step · {liveStatus.currentStepId}
          </Badge>
        )}
        {liveStatus?.iteration ? (
          <Badge variant="secondary" className="text-[10px]">
            iter · {liveStatus.iteration}
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAction("pause")}
            disabled={
              terminal ||
              currentStatusKind === "paused" ||
              acting !== null
            }
          >
            <PauseIcon className="size-3" /> Pause
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAction("resume")}
            disabled={
              terminal ||
              currentStatusKind !== "paused" ||
              !!pendingGate ||
              acting !== null
            }
          >
            <PlayIcon className="size-3" /> Resume
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAction("stop")}
            disabled={terminal || acting !== null}
          >
            <SquareIcon className="size-3" /> Stop
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void refreshDetail()}
            aria-label="Refresh run"
            title="Refresh run"
          >
            <RefreshCwIcon className="size-3" />
          </Button>
        </div>
      </div>

      {liveStatus?.lastEventMessage && (
        <p className="text-muted-foreground text-xs">
          {liveStatus.lastEventMessage}
        </p>
      )}

      {detail.error && (
        <p className="text-destructive text-xs">{detail.error}</p>
      )}

      {pendingGate && (
        <GateApprovalForm
          gate={pendingGate}
          onSubmit={handleApprove}
        />
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RunHistorySection detail={detail} />
        <RunEventsSection events={events} />
      </div>
    </div>
  )
}

function GateApprovalForm({
  gate,
  onSubmit,
}: {
  gate: WebWorkflowPendingGate
  onSubmit: (payload: WebWorkflowApprovalRequest) => Promise<void>
}) {
  const [editPairs, setEditPairs] = useState("")
  const [branchNext, setBranchNext] = useState("")
  const [submitting, setSubmitting] = useState<null | string>(null)

  const submit = async (decision: WebWorkflowApprovalRequest["decision"]) => {
    setSubmitting(decision)
    try {
      const payload: WebWorkflowApprovalRequest = { decision }
      if (decision === "edit") {
        payload.values = parseEditPairs(editPairs)
      }
      if (decision === "branch") {
        if (!branchNext.trim()) {
          toast.error("Specify a branch target step id")
          return
        }
        payload.next = branchNext.trim()
      }
      await onSubmit(payload)
      setEditPairs("")
      setBranchNext("")
    } catch {
      // toast handled in onSubmit
    } finally {
      setSubmitting(null)
    }
  }

  const allow = gate.allow

  return (
    <div className="border-amber-500/40 bg-amber-500/5 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-amber-500/20 text-amber-700">
          human gate
        </Badge>
        <span className="font-mono text-xs">{gate.stepId}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-xs">{gate.prompt}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {allow.includes("approve") && (
          <Button
            type="button"
            size="sm"
            onClick={() => submit("continue")}
            disabled={submitting !== null}
          >
            {submitting === "continue" ? "Submitting…" : "Approve"}
          </Button>
        )}
        {allow.includes("retry") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit("retry")}
            disabled={submitting !== null}
          >
            Retry
          </Button>
        )}
        {allow.includes("stop") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit("stop")}
            disabled={submitting !== null}
          >
            Stop
          </Button>
        )}
      </div>
      {allow.includes("edit") && (
        <div className="mt-3 flex flex-col gap-1">
          <label className="text-muted-foreground text-xs">
            Edit values (one <span className="font-mono">key=value</span> per line)
          </label>
          <Textarea
            rows={3}
            value={editPairs}
            onChange={(event) => setEditPairs(event.target.value)}
            placeholder="task=Updated task description"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit("edit")}
            disabled={submitting !== null || editPairs.trim().length === 0}
          >
            Submit edit
          </Button>
        </div>
      )}
      {allow.includes("branch") && (
        <div className="mt-3 flex flex-col gap-1">
          <label className="text-muted-foreground text-xs">
            Branch to a specific step id
          </label>
          <input
            type="text"
            value={branchNext}
            onChange={(event) => setBranchNext(event.target.value)}
            placeholder="step_id"
            className="border-input bg-background h-8 rounded-md border px-2 font-mono text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => submit("branch")}
            disabled={submitting !== null || branchNext.trim().length === 0}
          >
            Branch
          </Button>
        </div>
      )}
    </div>
  )
}

function parseEditPairs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

function RunHistorySection({ detail }: { detail: WebWorkflowRunDetail }) {
  return (
    <div className="border-muted-foreground/30 rounded-md border p-3">
      <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
        Step history
      </h4>
      {detail.stepHistory.length === 0 ? (
        <p className="text-muted-foreground text-xs">No steps yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-xs">
          {detail.stepHistory.map((record, index) => (
            <li
              key={`${record.stepId}-${record.iteration}-${index}`}
              className="flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono">{record.stepId}</span>
                <Badge variant="outline" className="text-[10px]">
                  {record.kind}
                </Badge>
                {record.agentId && (
                  <span className="text-muted-foreground">
                    {record.agentId}
                  </span>
                )}
                {record.decisionChoice && (
                  <Badge variant="secondary" className="text-[10px]">
                    {record.decisionChoice}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                <span>iter {record.iteration}</span>
                {record.durationMs != null && (
                  <span>{record.durationMs} ms</span>
                )}
                {record.outputName && <span>→ {record.outputName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RunEventsSection({ events }: { events: WebWorkflowEvent[] }) {
  const reversed = useMemo(() => [...events].reverse(), [events])
  return (
    <div className="border-muted-foreground/30 rounded-md border p-3">
      <h4 className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
        Events
      </h4>
      {reversed.length === 0 ? (
        <p className="text-muted-foreground text-xs">No events.</p>
      ) : (
        <ScrollArea className="h-48 pr-1">
          <ul className="flex flex-col gap-2 text-xs">
            {reversed.map((event, index) => (
              <li
                key={`${event.at}-${event.kind}-${index}`}
                className="flex flex-col"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono">{event.kind.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground">
                    {formatRelativeTime(event.at)}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {event.message}
                  {event.stepId ? ` · ${event.stepId}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  )
}

function pushEvent(
  setEvents: React.Dispatch<React.SetStateAction<WebWorkflowEvent[]>>,
  data: string,
): void {
  try {
    const parsed = JSON.parse(data) as WebWorkflowEvent
    setEvents((prev) => {
      const next = [...prev, parsed]
      if (next.length > 500) {
        next.splice(0, next.length - 500)
      }
      return next
    })
  } catch {
    // ignore malformed
  }
}
