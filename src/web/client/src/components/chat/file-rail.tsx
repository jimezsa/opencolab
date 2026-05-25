import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon } from "lucide-react"
import { AttachmentChip } from "./attachment-chip"
import { AttachmentPreview } from "./attachment-preview"
import type { WebChatAttachment } from "@shared/types"

interface FileRailProps {
  attachments: WebChatAttachment[]
  selected: WebChatAttachment | null
  onSelect: (attachment: WebChatAttachment | null) => void
}

export function FileRail({ attachments, selected, onSelect }: FileRailProps) {
  if (selected) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSelect(null)}
            aria-label="Back to files"
          >
            <ChevronLeftIcon className="size-4" />
            Files
          </Button>
          <span className="ml-2 truncate text-sm font-medium">
            {selected.name}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border p-2">
          <AttachmentPreview attachment={selected} />
        </div>
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <h3 className="text-sm font-medium">Returned files</h3>
      <ScrollArea className="flex-1 min-h-0 rounded-md border p-2 text-xs">
        {attachments.length === 0 && (
          <p className="text-muted-foreground">
            no files returned yet
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentChip
                attachment={attachment}
                onSelect={() => onSelect(attachment)}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}
