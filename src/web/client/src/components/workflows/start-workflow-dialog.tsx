import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import type { WebWorkflowDetail } from "@shared/types"

interface StartWorkflowDialogProps {
  projectId: string
  workflow: WebWorkflowDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: (runId: string) => void
}

export function StartWorkflowDialog({
  projectId,
  workflow,
  open,
  onOpenChange,
  onStarted,
}: StartWorkflowDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const seed: Record<string, string> = {}
    for (const input of workflow.inputs) {
      seed[input.name] = ""
    }
    setValues(seed)
    setError(null)
  }, [open, workflow.inputs])

  const missingRequired = useMemo(
    () =>
      workflow.inputs
        .filter((input) => input.required && !values[input.name]?.trim())
        .map((input) => input.name),
    [workflow.inputs, values],
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (missingRequired.length > 0) {
      setError(`Missing required inputs: ${missingRequired.join(", ")}`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload: { input?: Record<string, string>; initiator?: string } = {
        initiator: "studio",
      }
      const trimmed: Record<string, string> = {}
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) trimmed[key] = value
      }
      if (Object.keys(trimmed).length > 0) {
        payload.input = trimmed
      }
      const result = await api.startWorkflow(projectId, workflow.id, payload)
      toast.success(`Run ${result.runId} queued`)
      onStarted(result.runId)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(`Failed to start workflow: ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <form
          onSubmit={handleSubmit}
          className="flex h-full flex-col"
          noValidate
        >
          <SheetHeader>
            <SheetTitle>Start {workflow.id}</SheetTitle>
            <SheetDescription>
              Provide inputs for this workflow run.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {workflow.inputs.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                This workflow declares no inputs. You can start the run with no
                values.
              </p>
            ) : (
              workflow.inputs.map((input) => (
                <div key={input.name} className="flex flex-col gap-1">
                  <label
                    htmlFor={`input-${input.name}`}
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    <span className="font-mono">{input.name}</span>
                    <Badge
                      variant={input.required ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {input.required ? "required" : "optional"}
                    </Badge>
                  </label>
                  {input.description && (
                    <p className="text-muted-foreground text-xs">
                      {input.description}
                    </p>
                  )}
                  <Textarea
                    id={`input-${input.name}`}
                    rows={3}
                    value={values[input.name] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({
                        ...prev,
                        [input.name]: event.target.value,
                      }))
                    }
                    placeholder={input.required ? "required" : "optional"}
                  />
                </div>
              ))
            )}
            {error && (
              <p className="text-destructive text-xs">{error}</p>
            )}
          </div>
          <SheetFooter className="border-t">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Starting…" : "Start run"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
