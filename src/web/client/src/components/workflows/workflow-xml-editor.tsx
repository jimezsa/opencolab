import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ErrorState } from "@/components/layout/page-state"
import { api, ApiError } from "@/lib/api"
import { formatRelativeTime } from "@/lib/format"
import type {
  WebWorkflowValidationIssue,
  WebWorkflowXmlResponse,
} from "@shared/types"

interface WorkflowXmlEditorProps {
  projectId: string
  workflowId: string
  onSaved: () => void
}

const VALIDATE_DEBOUNCE_MS = 500

export function WorkflowXmlEditor({
  projectId,
  workflowId,
  onSaved,
}: WorkflowXmlEditorProps) {
  const [data, setData] = useState<WebWorkflowXmlResponse | null>(null)
  const [draft, setDraft] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [issues, setIssues] = useState<WebWorkflowValidationIssue[] | null>(null)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const validateAbort = useRef<AbortController | null>(null)
  const reloadKey = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setIssues(null)
    api
      .workflowXml(projectId, workflowId)
      .then((next) => {
        if (cancelled) return
        setData(next)
        setDraft(next.xml)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(
          err instanceof ApiError
            ? `${err.status} · ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err),
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, workflowId])

  const dirty = useMemo(
    () => data !== null && draft !== data.xml,
    [data, draft],
  )

  useEffect(() => {
    if (!data) return
    if (validateTimer.current) clearTimeout(validateTimer.current)
    validateTimer.current = setTimeout(() => {
      validateDraft(projectId, draft).then(({ aborted, payload, error }) => {
        if (aborted) return
        if (error) {
          setIssues([
            {
              severity: "error",
              message: error,
              stepId: null,
              loopId: null,
            },
          ])
          setValidating(false)
          return
        }
        setIssues(payload.issues)
        setValidating(false)
      })
      setValidating(true)
    }, VALIDATE_DEBOUNCE_MS)

    return () => {
      if (validateTimer.current) {
        clearTimeout(validateTimer.current)
        validateTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, projectId])

  useEffect(() => {
    return () => {
      validateAbort.current?.abort()
    }
  }, [])

  if (loading && !data) return <Skeleton className="h-72 w-full" />
  if (loadError) return <ErrorState message={loadError} />
  if (!data) return null

  const errorCount = issues?.filter((issue) => issue.severity === "error").length ?? 0
  const warningCount = issues?.filter((issue) => issue.severity === "warning").length ?? 0
  const canSave = dirty && !saving && errorCount === 0 && draft.trim().length > 0

  const handleReset = () => {
    setDraft(data.xml)
    setIssues(null)
    setSaveError(null)
  }

  const handleReload = async () => {
    reloadKey.current += 1
    setLoading(true)
    setLoadError(null)
    try {
      const next = await api.workflowXml(projectId, workflowId)
      setData(next)
      setDraft(next.xml)
      setIssues(null)
      setSaveError(null)
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await api.updateWorkflowXml(projectId, workflowId, {
        xml: draft,
      })
      setData(result)
      setDraft(result.xml)
      setIssues([])
      toast.success("Workflow saved")
      onSaved()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status} · ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err)
      setSaveError(message)
      toast.error(`Save failed: ${message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-mono">{data.path}</span>
        <span>Updated {formatRelativeTime(data.updatedAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {validating ? (
          <Badge variant="outline" className="flex items-center gap-1">
            <Loader2Icon className="size-3 animate-spin" /> validating
          </Badge>
        ) : errorCount > 0 ? (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertTriangleIcon className="size-3" /> {errorCount} error
            {errorCount === 1 ? "" : "s"}
          </Badge>
        ) : (
          <Badge variant="secondary" className="flex items-center gap-1">
            <CheckCircle2Icon className="size-3 text-emerald-600" /> valid
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge variant="outline" className="text-amber-600">
            {warningCount} warning{warningCount === 1 ? "" : "s"}
          </Badge>
        )}
        {dirty && <Badge variant="outline">unsaved changes</Badge>}
      </div>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={16}
        className="bg-muted/20 font-mono text-xs"
        spellCheck={false}
      />
      {issues && issues.length > 0 && (
        <ScrollArea className="border-muted-foreground/30 max-h-32 rounded-md border p-2 text-xs">
          <ul className="flex flex-col gap-1">
            {issues.map((issue, index) => (
              <li
                key={index}
                className={
                  issue.severity === "error"
                    ? "text-destructive"
                    : "text-amber-600"
                }
              >
                <span className="font-mono">{issue.severity}</span> · {issue.message}
                {issue.stepId ? ` · step ${issue.stepId}` : ""}
                {issue.loopId ? ` · loop ${issue.loopId}` : ""}
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      {saveError && (
        <p className="text-destructive text-xs">{saveError}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={handleReload}>
          Reload from disk
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleReset}
          disabled={!dirty || saving}
        >
          Reset
        </Button>
        <Button type="button" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving…" : "Save XML"}
        </Button>
      </div>
    </div>
  )

  interface ValidateOutcome {
    aborted: boolean
    payload: { ok: boolean; issues: WebWorkflowValidationIssue[] }
    error: string | null
  }

  async function validateDraft(
    projectId: string,
    xml: string,
  ): Promise<ValidateOutcome> {
    validateAbort.current?.abort()
    const controller = new AbortController()
    validateAbort.current = controller
    try {
      const result = await fetch(
        `/api/web/projects/${encodeURIComponent(projectId)}/workflows/validate`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ xml }),
          signal: controller.signal,
        },
      )
      if (controller.signal.aborted) {
        return {
          aborted: true,
          payload: { ok: true, issues: [] },
          error: null,
        }
      }
      if (!result.ok) {
        const text = await result.text().catch(() => "")
        return {
          aborted: false,
          payload: { ok: false, issues: [] },
          error: `validate ${result.status}: ${text || result.statusText}`,
        }
      }
      const body = (await result.json()) as {
        ok: boolean
        issues: WebWorkflowValidationIssue[]
      }
      return { aborted: false, payload: body, error: null }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return {
          aborted: true,
          payload: { ok: true, issues: [] },
          error: null,
        }
      }
      return {
        aborted: false,
        payload: { ok: false, issues: [] },
        error: (err as Error).message,
      }
    }
  }
}
