import { Outlet, useLocation, useParams } from "react-router-dom"
import { useEffect } from "react"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
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
      <SidebarProvider defaultOpen={false}>
        <ChatSidebarHost>
          <SidebarHoverGuard />
          <AppSidebar active={active} status={overview.status} />
          <SidebarInset className="h-svh overflow-hidden">
            <TopBar title={title} subtitle={subtitle} health={health} />
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
              <Outlet />
            </div>
          </SidebarInset>
        </ChatSidebarHost>
      </SidebarProvider>
      <Toaster richColors position="bottom-right" />
    </TooltipProvider>
  )
}

function SidebarHoverGuard() {
  const { setOpen, isMobile } = useSidebar()

  useEffect(() => {
    if (isMobile) return
    const SHOW_WITHIN = 12
    const HIDE_AFTER = 320
    let openState: boolean | null = null
    const handler = (event: MouseEvent) => {
      if (event.clientX <= SHOW_WITHIN) {
        if (openState !== true) {
          setOpen(true)
          openState = true
        }
      } else if (event.clientX > HIDE_AFTER) {
        if (openState !== false) {
          setOpen(false)
          openState = false
        }
      }
    }
    window.addEventListener("mousemove", handler, { passive: true })
    return () => window.removeEventListener("mousemove", handler)
  }, [setOpen, isMobile])

  return null
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
    if (pathname.endsWith("/workflows")) return { title: "Workflows", subtitle }
    if (pathname.endsWith("/gpu-runs")) return { title: "GPU Runs", subtitle }
    return { title: "Project", subtitle: params.projectId }
  }
  return { title: "OpenColab Studio" }
}
