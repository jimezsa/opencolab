import { Button } from "@/components/ui/button"
import { MarkdownMessage } from "@/components/markdown/markdown-message"
import { AttachmentChip } from "./attachment-chip"
import type { WebChatAttachment, WebChatMessage } from "@shared/types"
import { ArrowUpToLineIcon, XIcon } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEvent,
} from "react"
import { createPortal } from "react-dom"

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

interface ImageLightboxProps {
  attachment: WebChatAttachment
  onClose: () => void
}

function ImageLightbox({ attachment, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.name}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        aria-label="Close image preview"
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <XIcon className="size-5" />
      </button>
      <img
        src={attachment.previewUrl}
        alt={attachment.name}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92vh] max-w-[92vw] cursor-default rounded-md object-contain shadow-2xl"
      />
    </div>,
    document.body,
  )
}

function AttachmentsRow({ attachments, onSelect }: AttachmentsRowProps) {
  const [lightbox, setLightbox] = useState<WebChatAttachment | null>(null)
  if (attachments.length === 0) return null
  const images = attachments.filter((a) => a.kind === "image")
  const others = attachments.filter((a) => a.kind !== "image")
  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.map((attachment) => (
        <button
          key={attachment.id}
          type="button"
          onClick={() => setLightbox(attachment)}
          title={attachment.name}
          className="block w-full overflow-hidden rounded-lg bg-background transition-shadow hover:shadow-sm"
        >
          <img
            src={attachment.previewUrl}
            alt={attachment.name}
            loading="lazy"
            className="max-h-[28rem] w-full object-contain"
          />
        </button>
      ))}
      {others.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {others.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onSelect={
                onSelect ? () => onSelect(attachment) : undefined
              }
            />
          ))}
        </div>
      )}
      {lightbox && (
        <ImageLightbox
          attachment={lightbox}
          onClose={() => setLightbox(null)}
        />
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
