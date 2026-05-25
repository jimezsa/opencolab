import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  FileIcon,
  FileTextIcon,
  ImageIcon,
  XIcon,
} from "lucide-react"
import type { WebChatAttachment, WebChatAttachmentKind } from "@shared/types"

interface AttachmentChipProps {
  attachment: WebChatAttachment
  onRemove?: () => void
  onSelect?: () => void
  selected?: boolean
  uploading?: boolean
}

const KIND_ICON: Record<WebChatAttachmentKind, typeof FileIcon> = {
  pdf: FileTextIcon,
  markdown: FileTextIcon,
  text: FileTextIcon,
  image: ImageIcon,
  archive: FileIcon,
  audio: FileIcon,
  video: FileIcon,
  other: FileIcon,
}

export function AttachmentChip({
  attachment,
  onRemove,
  onSelect,
  selected,
  uploading,
}: AttachmentChipProps) {
  const Icon = KIND_ICON[attachment.kind] ?? FileIcon
  const sizeKb = Math.max(1, Math.round(attachment.sizeBytes / 1024))
  return (
    <div
      className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-input hover:bg-accent"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!onSelect}
        className="flex min-w-0 items-center gap-1.5 disabled:cursor-default"
        title={attachment.name}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="max-w-[180px] truncate">{attachment.name}</span>
      </button>
      <Badge variant="secondary" className="text-[10px]">
        {uploading ? "…" : `${sizeKb}KB`}
      </Badge>
      {onRemove && (
        <Button
          size="icon"
          variant="ghost"
          className="size-5"
          onClick={onRemove}
          aria-label={`remove ${attachment.name}`}
        >
          <XIcon className="size-3" />
        </Button>
      )}
    </div>
  )
}
