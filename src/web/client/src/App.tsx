import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/layout/app-shell"
import Dashboard from "@/routes/dashboard"
import ProjectsRoute from "@/routes/projects"
import ProjectDetailRoute from "@/routes/project-detail"
import AgentsRoute from "@/routes/agents"
import AgentDetailRoute from "@/routes/agent-detail"
import ChatRoute from "@/routes/chat"
import GpuRunsRoute from "@/routes/gpu-runs"
import ResearchRoute from "@/routes/research"
import ResearchRunRoute from "@/routes/research-run"
import AgentResearchRoute from "@/routes/agent-research"
import WorkflowsRoute from "@/routes/workflows"
import SettingsRoute from "@/routes/settings"

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectsRoute />} />
          <Route path="projects/:projectId" element={<ProjectDetailRoute />} />
          <Route
            path="projects/:projectId/agents"
            element={<AgentsRoute />}
          />
          <Route
            path="projects/:projectId/agents/:agentId"
            element={<AgentDetailRoute />}
          />
          <Route
            path="projects/:projectId/chat"
            element={<ChatRoute />}
          />
          <Route
            path="projects/:projectId/research"
            element={<ResearchRoute />}
          />
          <Route
            path="projects/:projectId/research/:runId"
            element={<ResearchRunRoute />}
          />
          <Route
            path="projects/:projectId/agents/:agentId/research"
            element={<AgentResearchRoute />}
          />
          <Route
            path="projects/:projectId/workflows"
            element={<WorkflowsRoute />}
          />
          <Route
            path="projects/:projectId/gpu-runs"
            element={<GpuRunsRoute />}
          />
          <Route path="settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
