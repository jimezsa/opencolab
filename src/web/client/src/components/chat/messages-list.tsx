import { ScrollArea } from "@/components/ui/scroll-area"
import { MarkdownMessage } from "@/components/markdown/markdown-message"
import { AttachmentChip } from "./attachment-chip"
import type { WebChatAttachment, WebChatMessage } from "@shared/types"
import { useEffect, useRef } from "react"

interface MessagesListProps {
  agentId: string | null
  messages: WebChatMessage[]
  onSelectAttachment?: (attachment: WebChatAttachment) => void
  pendingAssistant?: boolean
}

export function MessagesList({
  agentId,
  messages,
  onSelectAttachment,
  pendingAssistant,
}: MessagesListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, pendingAssistant])

  return (
    <ScrollArea className="flex-1 min-h-0 pr-2">
      {messages.length === 0 && (
        <div className="text-muted-foreground flex h-full items-center justify-center px-4 py-12 text-center text-sm">
          {agentId
            ? `Send a message to ${agentId} to start this session.`
            : "Choose an agent to start chatting."}
        </div>
      )}
      <ul className="flex flex-col gap-3 py-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className={
              message.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={`max-w-[92%] rounded-lg border px-3 py-2 ${
                message.role === "user"
                  ? "bg-primary/5 border-primary/30"
                  : "bg-background"
              }`}
            >
              <div className="text-muted-foreground mb-1 text-[10px] tracking-wide uppercase">
                {message.role === "user" ? "you" : (agentId ?? "agent")}
              </div>
              {message.content && (
                <MarkdownMessage
                  content={message.content}
                  className="prose prose-sm max-w-none break-words dark:prose-invert"
                />
              )}
              {message.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {message.attachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      attachment={attachment}
                      onSelect={
                        onSelectAttachment
                          ? () => onSelectAttachment(attachment)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
        {pendingAssistant && (
          <li className="flex justify-start">
            <div className="bg-background border rounded-lg px-3 py-2 text-xs text-muted-foreground">
              {agentId ?? "agent"} is thinking…
            </div>
          </li>
        )}
      </ul>
      <div ref={bottomRef} />
    </ScrollArea>
  )
}
