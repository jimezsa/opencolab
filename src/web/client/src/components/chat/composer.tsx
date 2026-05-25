import { useCallback, useRef, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  PaperclipIcon,
  SendIcon,
  StopCircleIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api, ApiError } from "@/lib/api"
import { AttachmentChip } from "./attachment-chip"
import type { WebChatAttachment } from "@shared/types"

interface ComposerProps {
  projectId: string
  agentId: string | null
  disabled?: boolean
  running?: boolean
  onSend: (message: string, uploadIds: string[]) => void | Promise<void>
  onStop?: () => void
  blockedReason?: string | null
}

export function Composer({
  projectId,
  agentId,
  disabled,
  running,
  onSend,
  onStop,
  blockedReason,
}: ComposerProps) {
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<WebChatAttachment[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const sendDisabled =
    disabled || running || (!draft.trim() && attachments.length === 0)

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !agentId) return
      const fileArray = Array.from(files)
      if (fileArray.length === 0) return
      setUploadingCount((n) => n + fileArray.length)
      try {
        const result = await api.chatUpload(projectId, agentId, fileArray)
        setAttachments((prev) => [...prev, ...result.uploads])
      } catch (error) {
        const message =
          error instanceof ApiError
            ? `${error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error)
        toast.error("Upload failed", { description: message })
      } finally {
        setUploadingCount((n) => Math.max(0, n - fileArray.length))
        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
      }
    },
    [projectId, agentId],
  )

  const handleSend = useCallback(async () => {
    if (sendDisabled) return
    const message = draft.trim()
    const uploadIds = attachments.map((a) => a.id)
    try {
      await onSend(message, uploadIds)
      setDraft("")
      setAttachments([])
    } catch (error) {
      // The caller is expected to surface errors; we only handle the input state.
      void error
    }
  }, [draft, attachments, sendDisabled, onSend])

  return (
    <div className="border-input bg-background flex flex-col gap-2 rounded-lg border px-2 pb-2 pt-0">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() =>
                setAttachments((prev) =>
                  prev.filter((a) => a.id !== attachment.id),
                )
              }
            />
          ))}
          {uploadingCount > 0 && (
            <div className="text-muted-foreground self-center text-xs">
              uploading {uploadingCount}…
            </div>
          )}
        </div>
      )}
      {blockedReason && (
        <p className="text-destructive text-xs">{blockedReason}</p>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <Button
          size="icon"
          variant="ghost"
          disabled={disabled || !agentId}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach files"
          title="Attach files"
        >
          <PaperclipIcon className="size-4" />
        </Button>
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            agentId ? `Message ${agentId}…` : "Choose an agent to start"
          }
          rows={1}
          disabled={disabled}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.metaKey &&
              !event.ctrlKey
            ) {
              event.preventDefault()
              void handleSend()
            } else if (event.key === "Escape" && attachments.length === 0) {
              setDraft("")
            }
          }}
          aria-label="Chat message"
          className="flex-1 min-h-0 max-h-48 resize-none border-0 bg-transparent px-1 pb-2 pt-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        {running ? (
          <Button
            size="icon"
            variant="destructive"
            onClick={onStop}
            aria-label="Stop"
            title="Stop"
          >
            <StopCircleIcon className="size-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={sendDisabled}
            aria-label="Send"
            title="Send"
          >
            <SendIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
