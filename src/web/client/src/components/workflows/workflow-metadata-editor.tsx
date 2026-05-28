import { useEffect, useMemo, useState } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api"
import type {
  WebWorkflowDetail,
  WebWorkflowInputPatch,
} from "@shared/types"

interface WorkflowMetadataEditorProps {
  projectId: string
  workflow: WebWorkflowDetail
  onSaved: () => void
}

interface InputDraft extends WebWorkflowInputPatch {
  key: string
}

let nextDraftKey = 1
const draftKey = () => `input-${nextDraftKey++}`

export function WorkflowMetadataEditor({
  projectId,
  workflow,
  onSaved,
}: WorkflowMetadataEditorProps) {
  const [description, setDescription] = useState(workflow.description ?? "")
  const [version, setVersion] = useState(workflow.version)
  const [inputs, setInputs] = useState<InputDraft[]>(() =>
    workflow.inputs.map((input) => ({
      key: draftKey(),
      name: input.name,
      description: input.description ?? "",
      required: input.required,
    })),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDescription(workflow.description ?? "")
    setVersion(workflow.version)
    setInputs(
      workflow.inputs.map((input) => ({
        key: draftKey(),
        name: input.name,
        description: input.description ?? "",
        required: input.required,
      })),
    )
    setError(null)
  }, [workflow])

  const dirty = useMemo(() => {
    if (description.trim() !== (workflow.description ?? "")) return true
    if (version.trim() !== workflow.version) return true
    if (inputs.length !== workflow.inputs.length) return true
    for (let i = 0; i < inputs.length; i += 1) {
      const draft = inputs[i]!
      const original = workflow.inputs[i]
      if (!original) return true
      if (draft.name !== original.name) return true
      if ((draft.description ?? "") !== (original.description ?? "")) return true
      if (Boolean(draft.required) !== original.required) return true
    }
    return false
  }, [description, version, inputs, workflow])

  const inputErrors = useMemo(() => validateInputs(inputs), [inputs])
  const canSave = dirty && !submitting && inputErrors.length === 0 && version.trim().length > 0

  const handleAddInput = () =>
    setInputs((prev) => [
      ...prev,
      { key: draftKey(), name: "", description: "", required: true },
    ])

  const handleRemoveInput = (key: string) =>
    setInputs((prev) => prev.filter((input) => input.key !== key))

  const handleUpdateInput = (key: string, patch: Partial<InputDraft>) =>
    setInputs((prev) =>
      prev.map((input) => (input.key === key ? { ...input, ...patch } : input)),
    )

  const handleReset = () => {
    setDescription(workflow.description ?? "")
    setVersion(workflow.version)
    setInputs(
      workflow.inputs.map((input) => ({
        key: draftKey(),
        name: input.name,
        description: input.description ?? "",
        required: input.required,
      })),
    )
    setError(null)
  }

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (inputErrors.length > 0) {
      setError(inputErrors.join(" "))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.patchWorkflowMetadata(projectId, workflow.id, {
        description: description.trim() || null,
        version: version.trim(),
        inputs: inputs.map((input) => ({
          name: input.name.trim(),
          description: input.description ? input.description.trim() : null,
          required: input.required !== false,
        })),
      })
      toast.success("Workflow metadata saved")
      onSaved()
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status} · ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err)
      setError(message)
      toast.error(`Save failed: ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Metadata
        </h4>
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <label
            htmlFor="workflow-version"
            className="text-sm font-medium leading-9"
          >
            Version
          </label>
          <Input
            id="workflow-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            placeholder="1"
            className="font-mono"
          />
          <label
            htmlFor="workflow-description"
            className="text-sm font-medium leading-9"
          >
            Description
          </label>
          <Textarea
            id="workflow-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What does this workflow do?"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Inputs
          </h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddInput}
          >
            <PlusIcon className="size-3" /> Add input
          </Button>
        </div>
        {inputs.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No declared inputs. Add one to expose a field in the start-run
            dialog.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inputs.map((input) => (
              <li
                key={input.key}
                className="border-muted-foreground/30 rounded-md border p-3"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div className="flex flex-col gap-2">
                    <Input
                      value={input.name}
                      onChange={(event) =>
                        handleUpdateInput(input.key, {
                          name: event.target.value,
                        })
                      }
                      placeholder="input_name"
                      className="font-mono text-sm"
                    />
                    <Textarea
                      rows={2}
                      value={input.description ?? ""}
                      onChange={(event) =>
                        handleUpdateInput(input.key, {
                          description: event.target.value,
                        })
                      }
                      placeholder="Description (optional)"
                    />
                  </div>
                  <div className="flex flex-col items-end justify-between gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={input.required !== false}
                        onChange={(event) =>
                          handleUpdateInput(input.key, {
                            required: event.target.checked,
                          })
                        }
                      />
                      <Badge
                        variant={input.required !== false ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {input.required !== false ? "required" : "optional"}
                      </Badge>
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveInput(input.key)}
                      aria-label={`Remove input ${input.name || "(unnamed)"}`}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {inputErrors.length > 0 && (
          <p className="text-destructive text-xs">
            {inputErrors.join(" ")}
          </p>
        )}
      </section>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleReset}
          disabled={!dirty || submitting}
        >
          Reset
        </Button>
        <Button type="submit" disabled={!canSave}>
          {submitting ? "Saving…" : "Save metadata"}
        </Button>
      </div>
    </form>
  )
}

function validateInputs(inputs: InputDraft[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const input of inputs) {
    const name = input.name.trim()
    if (!name) {
      errors.push("All inputs need a name.")
      break
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) {
      errors.push(`Input '${name}' must start with a letter and use only letters, digits, underscore, or hyphen.`)
      break
    }
    if (seen.has(name)) {
      errors.push(`Input '${name}' is declared more than once.`)
      break
    }
    seen.add(name)
  }
  return errors
}
