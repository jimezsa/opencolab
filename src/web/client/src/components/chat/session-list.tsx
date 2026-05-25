import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PlusIcon } from "lucide-react"
import type { WebChatSessionSummary } from "@shared/types"

interface SessionListProps {
  sessions: WebChatSessionSummary[]
  selectedSessionId: string | null
  onSelect: (sessionId: string) => void
  onCreateNew: () => void
  loading?: boolean
  disabled?: boolean
}

export function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  onCreateNew,
  loading,
  disabled,
}: SessionListProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onCreateNew}
        disabled={disabled || loading}
        className="justify-start"
      >
        <PlusIcon className="size-4" />
        New session
      </Button>
      <ScrollArea className="flex-1 min-h-0">
        {loading && (
          <p className="text-muted-foreground px-2 py-1 text-xs">loading…</p>
        )}
        {!loading && sessions.length === 0 && (
          <p className="text-muted-foreground px-2 py-1 text-xs">no sessions</p>
        )}
        <ul className="flex flex-col gap-1">
          {sessions.map((session) => {
            const isSelected = session.sessionId === selectedSessionId
            return (
              <li key={session.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(session.sessionId)}
                  className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:bg-accent"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[11px]">
                      {session.sessionId.replace(/^session-/, "")}
                    </span>
                    {session.active && (
                      <Badge variant="default" className="ml-auto text-[10px]">
                        active
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">
                    {session.lastMessagePreview ?? "no messages yet"}
                  </p>
                  <p className="text-muted-foreground/70 mt-0.5 text-[10px]">
                    {session.messageCount} message{session.messageCount === 1 ? "" : "s"}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </ScrollArea>
    </div>
  )
}
