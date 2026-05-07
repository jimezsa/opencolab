# OpenColab Web Interface Implementation Spec

## 1. Purpose

OpenColab should add a local web interface for inspecting and controlling the existing research-lab runtime.

The web interface is not a replacement for the CLI or Telegram. It is a local control room that exposes the same project, agent, memory, artifact, workflow, provider, gateway, and experiment state in a clearer visual form.

Working product name:

- **OpenColab Studio**

Primary goal:

- let the user understand the state of the whole lab quickly
- let the user inspect projects, agents, conversations, documents, artifacts, workflows, and runs
- later, let the user control project/agent routing, send messages, stop runs, edit curated context, and launch workflows

## 2. Scope

### In Scope For First Web Milestone

- local web app served by the OpenColab gateway
- Vite + React frontend
- Tailwind CSS
- shadcn/ui components
- project dashboard
- agent roster
- agent detail read view
- conversation browser
- document and artifact browser
- GPU run read view
- provider/gateway health view
- initial JSON API layer under the existing local HTTP server

### Out Of Scope For First Web Milestone

- remote hosted SaaS mode
- multi-user accounts
- public internet exposure
- custom workflow visual graph builder
- replacing Telegram
- replacing CLI setup flows
- direct editing of every agent prompt file
- database migration unless the file-backed index becomes too slow or fragile

## 3. Placement In Source Tree

All web implementation should live under a dedicated folder inside `src/`:

```text
src/web/
  client/
  server/
  shared/
```

Recommended structure:

```text
src/web/
  client/
    index.html
    vite.config.ts
    tsconfig.json
    components.json
    src/
      main.tsx
      app.tsx
      routes/
        dashboard.tsx
        projects.tsx
        agents.tsx
        conversations.tsx
        artifacts.tsx
        workflows.tsx
        gpu-runs.tsx
        settings.tsx
      components/
        ui/
        layout/
        project/
        agent/
        conversation/
        artifact/
        workflow/
        gpu/
      lib/
        api.ts
        utils.ts
      styles/
        globals.css

  server/
    index.ts
    routes.ts
    static.ts
    projects.ts
    agents.ts
    conversations.ts
    artifacts.ts
    workflows.ts
    gpu-runs.ts
    health.ts

  shared/
    types.ts
```

The `client/` folder owns the React app.

The `server/` folder owns web API handlers and static asset serving.

The `shared/` folder owns DTOs used by both the web server and the client.

## 4. Frontend Stack

Use:

- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- lucide-react icons

Avoid Next.js for the first implementation. OpenColab is a local CLI and gateway product, so a static Vite bundle served by the existing gateway is simpler and easier to package.

The shadcn component output should live under:

```text
src/web/client/src/components/ui/
```

The shadcn helper should live under:

```text
src/web/client/src/lib/utils.ts
```

Global CSS should live under:

```text
src/web/client/src/styles/globals.css
```

## 5. Backend Integration

The current local HTTP entrypoint is:

```text
src/http.ts
```

`src/http.ts` should stay small. It should continue to own gateway startup, runtime creation, Telegram webhook ingestion, polling startup, heartbeat ticking, signal handling, and top-level HTTP server lifecycle.

Web-specific request handling should be delegated to:

```text
src/web/server/index.ts
```

Conceptual integration:

```ts
import { handleWebRequest } from "./web/server/index.js";
```

`src/http.ts` should keep direct support for:

- `GET /health`
- `GET /api/state`
- `POST /api/telegram/webhook`

Then it may delegate other web routes to `handleWebRequest(...)`.

## 6. Initial Routes

Recommended browser routes:

- `/`
- `/projects`
- `/projects/:projectId`
- `/projects/:projectId/agents`
- `/projects/:projectId/agents/:agentId`
- `/projects/:projectId/conversations`
- `/projects/:projectId/artifacts`
- `/projects/:projectId/workflows`
- `/projects/:projectId/gpu-runs`
- `/settings`

The first version can use client-side routing only. Server fallback should return `index.html` for browser paths that are not API paths.

## 7. Initial API Surface

Use JSON endpoints under `/api/web/` to avoid conflict with existing gateway endpoints.

Recommended read endpoints:

```text
GET /api/web/overview
GET /api/web/projects
GET /api/web/projects/:projectId
GET /api/web/projects/:projectId/agents
GET /api/web/projects/:projectId/agents/:agentId
GET /api/web/projects/:projectId/conversations
GET /api/web/projects/:projectId/conversations/:sessionId
GET /api/web/projects/:projectId/artifacts
GET /api/web/projects/:projectId/gpu-runs
GET /api/web/health
```

Recommended later control endpoints:

```text
POST /api/web/active-project
POST /api/web/active-agent
POST /api/web/projects/:projectId/agents/:agentId/message
POST /api/web/projects/:projectId/agents/:agentId/session-reset
POST /api/web/projects/:projectId/agents/:agentId/stop
PUT /api/web/projects/:projectId/agents/:agentId/todo
PUT /api/web/projects/:projectId/agents/:agentId/memory
PUT /api/web/projects/:projectId/agents/:agentId/heartbeat
```

The first milestone should prioritize read endpoints. Write endpoints should be added only after the read model is stable.

## 8. Data Model Boundaries

The web layer should expose existing runtime objects without creating a separate source of truth.

Sources:

- `opencolab.json`
- `projects/<project_id>/PROJECT-AND-TEAM.md`
- `projects/<project_id>/AGENTS/<agent_id>/TODO.md`
- `projects/<project_id>/AGENTS/<agent_id>/MEMORY.md`
- `projects/<project_id>/AGENTS/<agent_id>/HEARTBEAT.md`
- `projects/<project_id>/AGENTS/<agent_id>/memory/Session/`
- `projects/<project_id>/AGENTS/<agent_id>/memory/Daily/`
- `projects/<project_id>/experiments/runs/`
- `projects/<project_id>/experiments/ssh-sessions/`
- local research and artifact folders

The web server should return compact DTOs rather than raw internal runtime state when practical.

Shared DTOs should live in:

```text
src/web/shared/types.ts
```

Recommended DTO groups:

- `WebOverview`
- `WebProjectSummary`
- `WebProjectDetail`
- `WebAgentSummary`
- `WebAgentDetail`
- `WebConversationSummary`
- `WebConversationDetail`
- `WebArtifactSummary`
- `WebGpuRunSummary`
- `WebHealthStatus`

## 9. UI Screens

### Dashboard

Shows:

- active project
- active agent
- project count
- agent count
- recent sessions
- recent artifacts
- active or recent GPU runs
- gateway status
- provider status summary

### Projects

Render the project list as a grid of cards, mirroring the agent roster card layout. Each project card shows:

- project id
- active marker
- agent count
- recent activity
- artifact count when indexed
- run count when available

Cards should be uniform in size, support keyboard focus, and link to the project detail route on click.

### Project Detail

Shows:

- project goal and current focus from `PROJECT-AND-TEAM.md`
- agent roster
- current priorities from agent TODO files
- recent conversations
- recent artifacts
- recent experiment runs
- workflow placeholders

### Agent Detail

Shows:

- agent id
- role/template type when known
- provider
- model
- auth mode
- reasoning effort when applicable
- TODO
- MEMORY summary or raw markdown view
- HEARTBEAT status
- recent sessions
- recent outputs

### Conversations

Shows:

- session list
- filter by agent
- filter by date
- current active session
- previous-day summaries
- message detail

The UI should hide raw provider protocol events by default.

### Artifacts

Shows:

- papers and PDFs
- downloaded Telegram files
- extracted figures
- diagrams
- `findings.md`
- LaTeX workspaces
- compiled PDFs
- experiment logs
- metrics
- Runpod artifacts
- future HuggingFace models and datasets

### GPU Runs

Shows:

- run id
- target/server id
- status
- command
- started/updated times
- declared artifacts
- log stream links
- failure summary when available

### Settings

Shows:

- runtime root
- gateway port
- Telegram pairing state
- provider setup summary
- package/source install mode when available
- web build/version information

## 10. shadcn/UI Design Direction

Use a quiet, dense, operational UI.

Prefer:

- sidebar navigation
- compact top bar
- card grids for projects and agents
- tables for artifacts and runs
- detail panes for selected objects
- cards for summary widgets and repeated objects
- tabs for detail pages
- badges for status
- icon buttons for common actions
- tooltips for less obvious icons

Avoid:

- marketing hero sections
- decorative gradients
- oversized cards
- nested cards
- flashy one-note color themes
- UI text explaining obvious controls

The first screen should be the actual dashboard, not a landing page.

## 11. Build And Packaging

The current root TypeScript build only compiles `.ts` files.

The web client should have its own Vite build under:

```text
src/web/client/
```

Recommended package scripts eventually:

```json
{
  "scripts": {
    "web:dev": "vite --config src/web/client/vite.config.ts",
    "web:build": "vite build --config src/web/client/vite.config.ts",
    "build": "rm -rf dist && tsc -p tsconfig.json && pnpm run web:build && cp -R src/agent-templates dist/src/"
  }
}
```

The built web assets should be copied to a package-shipped location, likely:

```text
dist/web/
```

`package.json` should eventually include the built web output:

```json
{
  "files": [
    "dist/src",
    "dist/web",
    "projects/SKILLS"
  ]
}
```

The server should serve static assets from the installed runtime location, not from source-only paths.

## 12. Development Mode

Recommended dev setup:

- `opencolab gateway start --foreground true --port 4646`
- Vite dev server for frontend iteration
- Vite proxy from frontend dev server to `http://127.0.0.1:4646/api/web`

The production package should not require the Vite dev server.

In packaged mode, the gateway should serve the built static web assets directly.

## 13. Security And Localhost Boundaries

The web server should bind to localhost by default:

```text
127.0.0.1
```

The first implementation should not expose the UI on the public network.

The UI must not print secrets such as:

- API keys
- Telegram bot token
- Runpod API key
- private SSH key paths beyond what is already expected in local config views

Provider and gateway health should show whether a credential exists, not the credential value.

Write endpoints should include basic same-origin protections before they are enabled.

## 14. Testing

Recommended tests:

- API DTO generation for projects
- API DTO generation for agents
- conversation listing from `memory/Session/`
- artifact index discovery
- GPU run summary generation
- static asset path resolution in source and packaged modes
- route fallback behavior for browser paths
- no secret leakage in health/settings DTOs

The first implementation should run:

```bash
pnpm run check
pnpm run build
pnpm test
```

When frontend tests are added, include a lightweight component or route smoke test.

## 15. Implementation Order

Recommended first implementation sequence:

1. Add web client scaffold under `src/web/client/`.
2. Add Tailwind and shadcn setup.
3. Add web shared DTO types under `src/web/shared/types.ts`.
4. Add web server route delegation under `src/web/server/`.
5. Add read-only `/api/web/overview`.
6. Add dashboard UI.
7. Add projects and agents read APIs.
8. Add projects and agents UI.
9. Add conversation read APIs and UI.
10. Add artifact discovery read APIs and UI.
11. Add GPU run read APIs and UI.
12. Add packaged static asset serving.
13. Update README and docs with the web command flow.

## 16. Success Criteria

The first web implementation is successful when:

- `opencolab gateway start --port 4646` serves a usable local web UI
- the dashboard loads without requiring Telegram
- the UI shows active project and active agent
- the UI lists projects
- the UI lists agents for the active project
- the UI can inspect recent sessions
- the UI can inspect project artifacts at a basic level
- the UI can inspect recent GPU runs when present
- the package build includes the web assets
- the existing CLI and Telegram behavior remains unchanged
