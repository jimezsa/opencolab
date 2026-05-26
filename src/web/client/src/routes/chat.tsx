import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Alert } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import {
  ApiError,
  api,
  chatTurnEventsUrl,
} from "@/lib/api"
import { useAsync } from "@/lib/state"
import { MessagesList } from "@/components/chat/messages-list"
import { Composer } from "@/components/chat/composer"
import { LiveStatus } from "@/components/chat/live-status"
import { FileRail } from "@/components/chat/file-rail"
import { AttachmentPreview } from "@/components/chat/attachment-preview"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { useRegisterChatSidebar } from "@/components/chat/chat-sidebar-context"
import type {
  WebChatAgentOption,
  WebChatAttachment,
  WebChatMessage,
  WebChatSessionDetail,
  WebChatSessionSummary,
  WebChatTurn,
} from "@shared/types"

type SendBlocker = string | null

function useSse(
  projectId: string,
  turnId: string | null,
  onTurn: (turn: WebChatTurn) => void,
  onMessage: (message: WebChatMessage) => void,
  onCompleted: () => void,
) {
  useEffect(() => {
    if (!turnId) return
    const source = new EventSource(chatTurnEventsUrl(projectId, turnId))
    const handleProgress = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as WebChatTurn
        onTurn(data)
      } catch {
        // ignore malformed
      }
    }
    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as WebChatMessage
        onMessage(data)
      } catch {
        // ignore
      }
    }
    const handleCompleted = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as WebChatTurn
        onTurn(data)
      } catch {
        // ignore
      }
      onCompleted()
      source.close()
    }
    const handleError = () => {
      onCompleted()
      source.close()
    }
    source.addEventListener("progress", handleProgress)
    source.addEventListener("message", handleMessage)
    source.addEventListener("completed", handleCompleted)
    source.addEventListener("error", handleError)
    source.addEventListener("closed", () => {
      onCompleted()
      source.close()
    })
    return () => {
      source.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, turnId])
}

export default function ChatRoute() {
  const params = useParams()
  const projectId = params.projectId
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  if (!projectId) {
    return (
      <Alert variant="destructive">
        Missing project id in URL.
      </Alert>
    )
  }

  return <ChatPage projectId={projectId} searchParams={searchParams} setSearchParams={setSearchParams} navigate={navigate} />
}

interface ChatPageProps {
  projectId: string
  searchParams: URLSearchParams
  setSearchParams: (params: URLSearchParams, options?: { replace?: boolean }) => void
  navigate: ReturnType<typeof useNavigate>
}

function ChatPage({ projectId, searchParams, setSearchParams }: ChatPageProps) {
  const agentParam = searchParams.get("agent")
  const sessionParam = searchParams.get("session")
  const artifactParam = searchParams.get("artifact")

  const agentsState = useAsync(
    () => api.chatAgents(projectId),
    [projectId],
  )
  const agents: WebChatAgentOption[] =
    agentsState.status === "ready" ? agentsState.data : []
  const selectedAgentId = useMemo(() => {
    if (agentParam && agents.some((a) => a.id === agentParam)) {
      return agentParam
    }
    const activeAgent = agents.find((a) => a.active)
    return activeAgent?.id ?? agents[0]?.id ?? null
  }, [agentParam, agents])

  const updateQuery = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(next)) {
        if (value == null) {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const [sessions, setSessions] = useState<WebChatSessionSummary[]>([])
  const [sessionDetail, setSessionDetail] =
    useState<WebChatSessionDetail | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [optimisticMessages, setOptimisticMessages] = useState<WebChatMessage[]>([])
  const [activeTurn, setActiveTurn] = useState<WebChatTurn | null>(null)
  const [selectedAttachment, setSelectedAttachment] =
    useState<WebChatAttachment | null>(null)
  const [sendBlocker, setSendBlocker] = useState<SendBlocker>(null)
  const [transcriptAtBottom, setTranscriptAtBottom] = useState(true)
  const messageRefreshKey = useRef(0)

  const selectedSessionId =
    sessionParam ?? sessionDetail?.sessionId ?? null

  useEffect(() => {
    if (!selectedAgentId) return
    let cancelled = false
    setSessionsLoading(true)
    api
      .chatSessions(projectId, selectedAgentId)
      .then((list) => {
        if (cancelled) return
        setSessions(list)
        if (!sessionParam && list.length > 0) {
          const fallback = list.find((s) => s.active) ?? list[0]
          updateQuery({ session: fallback.sessionId })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        toast.error(
          error instanceof Error ? error.message : "failed to load sessions",
        )
      })
      .finally(() => {
        if (cancelled) return
        setSessionsLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedAgentId])

  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) return
    let cancelled = false
    api
      .chatSession(projectId, selectedAgentId, selectedSessionId)
      .then((detail) => {
        if (cancelled) return
        setSessionDetail(detail)
        setOptimisticMessages([])
        if (detail.runningTurn) {
          setActiveTurn(detail.runningTurn)
        } else {
          setActiveTurn(null)
        }
        if (artifactParam) {
          const lastAssistant = [...detail.messages].reverse().find(
            (message) => message.role === "assistant",
          )
          const match = lastAssistant?.attachments.find(
            (attachment) => attachment.id === artifactParam,
          )
          if (match) {
            setSelectedAttachment(match)
          }
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 404) {
          setSessionDetail(null)
          updateQuery({ session: null })
        } else {
          toast.error(
            error instanceof Error ? error.message : "failed to load session",
          )
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedAgentId, selectedSessionId, messageRefreshKey.current])

  useSse(
    projectId,
    activeTurn?.turnId ?? null,
    (turn) => setActiveTurn(turn),
    (message) => setOptimisticMessages((prev) => [...prev, message]),
    () => {
      // Refresh session detail to pick up returned files and persisted assistant
      messageRefreshKey.current += 1
      setOptimisticMessages([])
      if (selectedAgentId && selectedSessionId) {
        api
          .chatSession(projectId, selectedAgentId, selectedSessionId)
          .then((detail) => {
            setSessionDetail(detail)
            // Keep the terminal live-status summary visible until the user
            // sends another message or switches sessions; only override when
            // the server reports a fresh running turn.
            if (detail.runningTurn) {
              setActiveTurn(detail.runningTurn)
            }
          })
          .catch(() => {
            /* swallow */
          })
      }
    },
  )

  const handleNewSession = useCallback(async () => {
    if (!selectedAgentId) return
    try {
      const result = await api.chatNewSession(projectId, selectedAgentId)
      const list = await api.chatSessions(projectId, selectedAgentId)
      setSessions(list)
      updateQuery({ session: result.sessionId })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "failed to start a new session",
      )
    }
  }, [projectId, selectedAgentId, updateQuery])

  const handleSend = useCallback(
    async (message: string, uploadIds: string[]) => {
      if (!selectedAgentId) return
      setSendBlocker(null)
      const optimisticUser: WebChatMessage = {
        id: `local_${Date.now()}`,
        role: "user",
        content: message,
        at: new Date().toISOString(),
        attachments: [],
      }
      setOptimisticMessages((prev) => [...prev, optimisticUser])
      try {
        const response = await api.chatSend(projectId, {
          agentId: selectedAgentId,
          sessionId: selectedSessionId ?? undefined,
          message,
          uploadIds,
        })
        if (!sessionParam || sessionParam !== response.sessionId) {
          updateQuery({ session: response.sessionId })
        }
        setActiveTurn({
          turnId: response.turnId,
          projectId,
          agentId: selectedAgentId,
          sessionId: response.sessionId,
          status: response.status,
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
          lastProgress: null,
          progress: [],
          returnedFiles: [],
          error: null,
          durationMs: null,
        })
      } catch (error) {
        setOptimisticMessages((prev) =>
          prev.filter((entry) => entry !== optimisticUser),
        )
        if (error instanceof ApiError) {
          if (error.status === 409) {
            setSendBlocker(
              `${selectedAgentId} is currently busy with another turn.`,
            )
          } else {
            setSendBlocker(error.message)
          }
        } else {
          setSendBlocker(
            error instanceof Error ? error.message : "send failed",
          )
        }
        throw error
      }
    },
    [projectId, selectedAgentId, sessionParam, selectedSessionId, updateQuery],
  )

  const handleStop = useCallback(async () => {
    if (!activeTurn) return
    try {
      await api.chatStop(projectId, activeTurn.turnId)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "failed to stop the turn",
      )
    }
  }, [activeTurn, projectId])

  const transcript = useMemo(() => {
    const base = sessionDetail?.messages ?? []
    return [...base, ...optimisticMessages]
  }, [sessionDetail, optimisticMessages])

  const lastAssistantAttachments = useMemo(() => {
    const fromTurn = activeTurn?.returnedFiles ?? []
    if (fromTurn.length > 0) return fromTurn
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      if (transcript[i].role === "assistant" && transcript[i].attachments.length > 0) {
        return transcript[i].attachments
      }
    }
    return []
  }, [activeTurn, transcript])

  const running =
    !!activeTurn &&
    (activeTurn.status === "queued" || activeTurn.status === "running")

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null
  const composerDisabled = !selectedAgentId
  const composerBlocker =
    sendBlocker ??
    (selectedAgent && selectedAgent.busy && !running
      ? `${selectedAgent.id} is busy elsewhere.`
      : null)

  const onSelectAgent = useCallback(
    (agentId: string) => updateQuery({ agent: agentId, session: null }),
    [updateQuery],
  )
  const onSelectSession = useCallback(
    (id: string) => updateQuery({ session: id }),
    [updateQuery],
  )
  const onCreateNewSession = useCallback(() => {
    void handleNewSession()
  }, [handleNewSession])

  const sidebarValue = useMemo(
    () => ({
      agents,
      agentsLoading: agentsState.status === "loading",
      selectedAgentId,
      onSelectAgent,
      sessions,
      sessionsLoading,
      selectedSessionId,
      onSelectSession,
      onCreateNewSession,
    }),
    [
      agents,
      agentsState.status,
      selectedAgentId,
      onSelectAgent,
      sessions,
      sessionsLoading,
      selectedSessionId,
      onSelectSession,
      onCreateNewSession,
    ],
  )
  useRegisterChatSidebar(sidebarValue)

  return (
    <div className="flex min-h-0 w-full flex-1 gap-3 overflow-hidden">
      <aside className="hidden w-72 shrink-0 lg:flex min-h-0 flex-col gap-3 rounded-lg bg-background p-3">
        <FileRail
          projectId={projectId}
          attachments={lastAssistantAttachments}
          selectedId={selectedAttachment?.id ?? null}
          onSelect={setSelectedAttachment}
        />
      </aside>

      <div className="flex min-w-0 flex-1 justify-center">
        <section className="flex w-full max-w-3xl min-h-0 flex-col gap-2 rounded-lg bg-background p-3">
        {sessionDetail || optimisticMessages.length > 0 ? (
          <MessagesList
            agentId={selectedAgentId}
            messages={transcript}
            onSelectAttachment={(attachment) =>
              setSelectedAttachment(attachment)
            }
            pendingAssistant={running}
            onIsAtBottomChange={setTranscriptAtBottom}
          />
        ) : agentsState.status === "loading" || sessionsLoading ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : (
          <Empty className="m-auto">
            {selectedAgentId
              ? `Send a message to ${selectedAgentId} to start.`
              : "Choose an agent to start chatting."}
          </Empty>
        )}
        <div
          className={
            transcriptAtBottom
              ? "flex shrink-0 flex-col gap-2"
              : "hidden"
          }
          aria-hidden={!transcriptAtBottom}
        >
          {activeTurn && selectedAgentId && (
            <LiveStatus agentId={selectedAgentId} turn={activeTurn} />
          )}
          <Composer
            projectId={projectId}
            agentId={selectedAgentId}
            disabled={composerDisabled}
            running={running}
            onSend={handleSend}
            onStop={() => void handleStop()}
            blockedReason={composerBlocker}
          />
        </div>
      </section>
      </div>

      <aside className="hidden w-96 xl:w-md 2xl:w-lg shrink-0 lg:flex min-h-0 flex-col gap-2 rounded-lg bg-background p-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
            Preview
          </span>
          {selectedAttachment && (
            <span
              className="ml-1 min-w-0 truncate text-xs font-medium"
              title={selectedAttachment.name}
            >
              {selectedAttachment.name}
            </span>
          )}
          {selectedAttachment && (
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto size-7"
              onClick={() => setSelectedAttachment(null)}
              aria-label="Close preview"
              title="Close preview"
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {selectedAttachment ? (
            <AttachmentPreview attachment={selectedAttachment} />
          ) : (
            <p className="text-muted-foreground px-1 py-2 text-xs">
              Select a file from the left rail to preview it here.
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
