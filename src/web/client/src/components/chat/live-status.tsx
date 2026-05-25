import { Alert } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { WebChatTurn } from "@shared/types"

interface LiveStatusProps {
  agentId: string
  turn: WebChatTurn
}

const VISIBLE_LINES = 6

export function LiveStatus({ agentId, turn }: LiveStatusProps) {
  const events = turn.progress.slice(-VISIBLE_LINES)
  const latest = events[events.length - 1]
  const isFinal =
    turn.status === "completed" ||
    turn.status === "failed" ||
    turn.status === "stopped" ||
    turn.status === "timed_out"

  const heading =
    turn.status === "completed"
      ? `${agentId} finished`
      : turn.status === "failed"
        ? `${agentId} failed`
        : turn.status === "timed_out"
          ? `${agentId} timed out`
          : turn.status === "stopped"
            ? `${agentId} stopped`
            : `${agentId} is working`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">{heading}</h3>
        <Badge variant="outline" className="text-[10px] uppercase">
          {turn.status}
        </Badge>
      </div>
      {turn.error && (
        <Alert variant="destructive" className="py-2 text-xs">
          {turn.error}
        </Alert>
      )}
      <ScrollArea
        aria-live={
          latest?.kind === "warning" || latest?.kind === "needs_input"
            ? "assertive"
            : "polite"
        }
        className="max-h-36 overflow-auto rounded-md border bg-muted/30 p-2 text-xs"
      >
        {events.length === 0 && (
          <p className="text-muted-foreground">no activity yet</p>
        )}
        <ul className="flex flex-col gap-1">
          {events.map((event, index) => {
            const isNewest = index === events.length - 1 && !isFinal
            const marker = isNewest ? "🟢" : "⚪"
            const counter =
              event.current != null && event.total != null
                ? ` (${event.current} / ${event.total})`
                : ""
            return (
              <li
                key={`${event.at}-${index}`}
                className={
                  event.kind === "warning"
                    ? "text-destructive"
                    : event.kind === "needs_input"
                      ? "text-amber-600 dark:text-amber-400"
                      : undefined
                }
              >
                <span className="mr-1.5">{marker}</span>
                {event.message}
                {counter}
              </li>
            )
          })}
        </ul>
      </ScrollArea>
      {isFinal && turn.completedAt && (
        <p className="text-muted-foreground text-[11px]">
          finished {formatDuration(turn.durationMs)}
        </p>
      )}
    </div>
  )
}

function formatDuration(durationMs: number | null): string {
  if (durationMs == null) return ""
  if (durationMs < 1000) return `in ${durationMs}ms`
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `in ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `in ${minutes}m${remainder ? ` ${remainder}s` : ""}`
}
