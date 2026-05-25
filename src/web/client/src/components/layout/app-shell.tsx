import { Outlet, useLocation, useParams } from "react-router-dom"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { AppSidebar } from "./app-sidebar"
import { TopBar } from "./top-bar"
import { ChatSidebarHost } from "@/components/chat/chat-sidebar-context"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/state"

export function AppShell() {
  const location = useLocation()
  const params = useParams()
  const overview = useAsync(() => api.overview(), [])

  const active = overview.status === "ready" ? overview.data.active : null
  const health = overview.status === "ready" ? overview.data.health : null
  const { title, subtitle } = describeRoute(location.pathname, params)

  return (
    <TooltipProvider>
      <SidebarProvider>
        <ChatSidebarHost>
          <AppSidebar active={active} status={overview.status} />
          <SidebarInset>
            <TopBar title={title} subtitle={subtitle} health={health} />
            <div className="flex flex-1 flex-col gap-4 p-4">
              <Outlet />
            </div>
          </SidebarInset>
        </ChatSidebarHost>
      </SidebarProvider>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  )
}

function describeRoute(
  pathname: string,
  params: Record<string, string | undefined>,
): { title: string; subtitle?: string } {
  if (pathname === "/" || pathname === "") {
    return { title: "Dashboard" }
  }
  if (pathname === "/projects") {
    return { title: "Projects" }
  }
  if (pathname === "/settings") {
    return { title: "Settings" }
  }
  if (params.projectId) {
    const subtitle = params.agentId
      ? `${params.projectId} · ${params.agentId}`
      : params.projectId
    if (pathname.endsWith("/agents")) return { title: "Agents", subtitle }
    if (pathname.includes("/agents/"))
      return { title: "Agent", subtitle }
    if (pathname.endsWith("/chat")) return { title: "Chat", subtitle }
    if (pathname.endsWith("/artifacts")) return { title: "Artifacts", subtitle }
    if (pathname.endsWith("/workflows")) return { title: "Workflows", subtitle }
    if (pathname.endsWith("/gpu-runs")) return { title: "GPU Runs", subtitle }
    return { title: "Project", subtitle: params.projectId }
  }
  return { title: "OpenColab Studio" }
}
