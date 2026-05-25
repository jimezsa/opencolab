import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  BeakerIcon,
  CpuIcon,
  FlaskConicalIcon,
  GaugeIcon,
  GitBranchIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import type { WebActiveSelection } from "@shared/types"
import { useChatSidebarValue } from "@/components/chat/chat-sidebar-context"
import { AgentPicker } from "@/components/chat/agent-picker"
import { SessionList } from "@/components/chat/session-list"
import { Separator } from "@/components/ui/separator"

interface AppSidebarProps {
  active: WebActiveSelection | null
  status: "loading" | "ready" | "error"
}

type NavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboardIcon
  exact?: boolean
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: "/", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { to: "/projects", label: "Projects", icon: BeakerIcon },
]

const PROJECT_ITEMS = [
  { suffix: "/agents", label: "Agents", icon: UsersIcon },
  { suffix: "/chat", label: "Chat", icon: MessageSquareIcon },
  { suffix: "/research", label: "Research", icon: FlaskConicalIcon },
  { suffix: "/workflows", label: "Workflows", icon: GitBranchIcon },
  { suffix: "/gpu-runs", label: "GPU Runs", icon: CpuIcon },
] as const

export function AppSidebar({ active, status }: AppSidebarProps) {
  const location = useLocation()
  const projectBase = active ? `/projects/${active.projectId}` : null
  const chatSidebar = useChatSidebarValue()
  const showChatPanel =
    !!chatSidebar && /\/projects\/[^/]+\/chat(?:$|\/)/.test(location.pathname)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <GaugeIcon className="size-4 text-primary" />
          <div className="flex min-w-0 flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold">OpenColab Studio</span>
            <span className="text-muted-foreground truncate text-xs">
              {status === "loading"
                ? "loading…"
                : active
                  ? `${active.projectId} · ${active.agentId}`
                  : "no active project"}
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Lab</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to)
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {projectBase && (
          <SidebarGroup>
            <SidebarGroupLabel>Active Project</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PROJECT_ITEMS.map((item) => {
                  const to = `${projectBase}${item.suffix}`
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname.startsWith(to)}
                        tooltip={item.label}
                      >
                        <Link to={to}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {showChatPanel && chatSidebar && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Chat</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="flex flex-col gap-3 px-2 pb-2">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
                    Agent
                  </span>
                  <AgentPicker
                    agents={chatSidebar.agents}
                    selectedId={chatSidebar.selectedAgentId}
                    onSelect={chatSidebar.onSelectAgent}
                    loading={chatSidebar.agentsLoading}
                  />
                </div>
                <Separator />
                <div className="min-h-[12rem]">
                  <SessionList
                    sessions={chatSidebar.sessions}
                    selectedSessionId={chatSidebar.selectedSessionId}
                    onSelect={chatSidebar.onSelectSession}
                    onCreateNew={chatSidebar.onCreateNewSession}
                    loading={chatSidebar.sessionsLoading}
                    disabled={!chatSidebar.selectedAgentId}
                  />
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location.pathname === "/settings"}
              tooltip="Settings"
            >
              <Link to="/settings">
                <SettingsIcon />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
