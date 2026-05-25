import { Button } from "@/components/ui/button"
import { MarkdownMessage } from "@/components/markdown/markdown-message"
import { AttachmentChip } from "./attachment-chip"
import type { WebChatAttachment, WebChatMessage } from "@shared/types"
import { ArrowUpToLineIcon } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from "react"

interface MessagesListProps {
  agentId: string | null
  messages: WebChatMessage[]
  onSelectAttachment?: (attachment: WebChatAttachment) => void
  pendingAssistant?: boolean
  onIsAtBottomChange?: (isAtBottom: boolean) => void
}

const NEAR_BOTTOM_PX = 80

interface AttachmentsRowProps {
  attachments: WebChatAttachment[]
  onSelect?: (attachment: WebChatAttachment) => void
}

function AttachmentsRow({ attachments, onSelect }: AttachmentsRowProps) {
  if (attachments.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      {attachments.map((attachment) =>
        attachment.kind === "image" ? (
          <button
            key={attachment.id}
            type="button"
            onClick={onSelect ? () => onSelect(attachment) : undefined}
            disabled={!onSelect}
            title={attachment.name}
            className="block max-w-full overflow-hidden rounded-lg border bg-background transition-shadow hover:shadow-sm disabled:cursor-default"
          >
            <img
              src={attachment.previewUrl}
              alt={attachment.name}
              loading="lazy"
              className="max-h-72 max-w-xs object-contain"
            />
          </button>
        ) : (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            onSelect={
              onSelect ? () => onSelect(attachment) : undefined
            }
          />
        ),
      )}
    </div>
  )
}

export function MessagesList({
  agentId,
  messages,
  onSelectAttachment,
  pendingAssistant,
  onIsAtBottomChange,
}: MessagesListProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  useEffect(() => {
    onIsAtBottomChange?.(isAtBottom)
  }, [isAtBottom, onIsAtBottomChange])

  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ block: "end" })
    }
  }, [messages.length, pendingAssistant, isAtBottom])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const distance = target.scrollHeight - target.scrollTop - target.clientHeight
    setIsAtBottom(distance < NEAR_BOTTOM_PX)
  }, [])

  const scrollToTop = useCallback(() => {
    viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {messages.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-1 z-10 flex justify-center">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={scrollToTop}
            className="pointer-events-auto rounded-full shadow-sm"
          >
            <ArrowUpToLineIcon className="size-4" />
            View full session
          </Button>
        </div>
      )}
      <div
        ref={viewportRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto pr-2"
      >
        {messages.length === 0 && (
          <div className="text-muted-foreground flex h-full items-center justify-center px-4 py-12 text-center text-sm">
            {agentId
              ? `Send a message to ${agentId} to start this session.`
              : "Choose an agent to start chatting."}
          </div>
        )}
        <ul className="flex flex-col gap-5 py-2">
        {messages.map((message) =>
          message.role === "user" ? (
            <li key={message.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-orange-100 px-4 py-2 text-foreground dark:bg-orange-500/15">
                <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                  you
                </div>
                {message.content && (
                  <MarkdownMessage
                    content={message.content}
                    className="prose prose-sm max-w-none break-words dark:prose-invert"
                  />
                )}
                <AttachmentsRow
                  attachments={message.attachments}
                  onSelect={onSelectAttachment}
                />
              </div>
            </li>
          ) : (
            <li key={message.id} className="w-full">
              {message.content && (
                <MarkdownMessage
                  content={message.content}
                  className="prose prose-sm max-w-none break-words dark:prose-invert"
                />
              )}
              <AttachmentsRow
                attachments={message.attachments}
                onSelect={onSelectAttachment}
              />
            </li>
          ),
        )}
        {pendingAssistant && (
          <li className="text-muted-foreground w-full text-xs">thinking…</li>
        )}
        </ul>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
