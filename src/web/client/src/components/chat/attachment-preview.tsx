import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { PdfViewer } from "@/components/pdf/pdf-viewer"
import { MarkdownMessage } from "@/components/markdown/markdown-message"
import type { WebChatAttachment } from "@shared/types"

interface AttachmentPreviewProps {
  attachment: WebChatAttachment
}

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
  if (attachment.kind === "pdf") {
    return (
      <PdfViewer
        fileUrl={attachment.previewUrl}
        rawUrl={attachment.rawUrl}
        sizeBytes={attachment.sizeBytes}
      />
    )
  }
  if (attachment.kind === "image") {
    return (
      <div className="flex flex-col items-start gap-2">
        <img
          src={attachment.previewUrl}
          alt={attachment.name}
          className="max-h-[70vh] max-w-full rounded-md border object-contain"
        />
        <Button asChild size="sm" variant="ghost">
          <a href={attachment.rawUrl} target="_blank" rel="noreferrer noopener">
            Open raw
          </a>
        </Button>
      </div>
    )
  }
  if (attachment.kind === "markdown" || attachment.kind === "text") {
    return <TextOrMarkdownPreview attachment={attachment} />
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="text-muted-foreground">
        Preview not available for {attachment.kind} files.
      </div>
      <div className="font-mono text-[11px] break-all">
        {attachment.relativePath || attachment.name}
      </div>
      <div className="flex gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={attachment.rawUrl} target="_blank" rel="noreferrer noopener">
            Open raw
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={attachment.rawUrl} download={attachment.name}>
            Download
          </a>
        </Button>
      </div>
    </div>
  )
}

function TextOrMarkdownPreview({ attachment }: AttachmentPreviewProps) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error"
    content: string
    error: string | null
  }>({ status: "loading", content: "", error: null })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading", content: "", error: null })
    fetch(attachment.previewUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((content) => {
        if (cancelled) return
        setState({ status: "ready", content, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: "error",
          content: "",
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [attachment.previewUrl])

  if (state.status === "loading")
    return <p className="text-muted-foreground text-xs">loading…</p>
  if (state.status === "error")
    return (
      <p className="text-destructive text-xs">
        failed to load: {state.error}
      </p>
    )

  if (attachment.kind === "markdown") {
    return <MarkdownMessage content={state.content} />
  }
  return (
    <pre className="overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] whitespace-pre-wrap break-words">
      {state.content}
    </pre>
  )
}
