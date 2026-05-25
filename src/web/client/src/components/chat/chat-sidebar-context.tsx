import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type {
  WebChatAgentOption,
  WebChatSessionSummary,
} from "@shared/types"

export interface ChatSidebarValue {
  agents: WebChatAgentOption[]
  agentsLoading: boolean
  selectedAgentId: string | null
  onSelectAgent: (agentId: string) => void
  sessions: WebChatSessionSummary[]
  sessionsLoading: boolean
  selectedSessionId: string | null
  onSelectSession: (sessionId: string) => void
  onCreateNewSession: () => void
}

type Setter = (value: ChatSidebarValue | null) => void

const ValueContext = createContext<ChatSidebarValue | null>(null)
const SetterContext = createContext<Setter | null>(null)

export function ChatSidebarHost({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<ChatSidebarValue | null>(null)
  return (
    <SetterContext.Provider value={setValue}>
      <ValueContext.Provider value={value}>{children}</ValueContext.Provider>
    </SetterContext.Provider>
  )
}

export function useChatSidebarValue(): ChatSidebarValue | null {
  return useContext(ValueContext)
}

export function useRegisterChatSidebar(value: ChatSidebarValue): void {
  const setter = useContext(SetterContext)
  useEffect(() => {
    if (!setter) return
    setter(value)
    return () => setter(null)
  }, [setter, value])
}
