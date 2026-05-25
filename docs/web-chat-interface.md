# OpenColab Studio Chat Interface Spec

## 1. Purpose

OpenColab Studio should add a first-class chat interface for talking to any agent in the active project from the local web UI.

The interface should behave like the Telegram route where that makes the workflow clearer:

- select the agent before sending a message
- see the final assistant answer in the conversation
- see a bounded live-status view of what the agent is doing while a turn is running
- send local uploads to the selected agent
- receive files from the agent and open them inside Studio when possible
- render Markdown, code, tables, and equations correctly
- reuse the existing research PDF renderer for PDFs shown beside the chat

This is a Studio feature, not a replacement for Telegram. Telegram remains the remote/mobile transport. Studio chat is the local, richer workspace transport.

## 2. Product Shape

Primary route:

```text
/projects/:projectId/chat
```

Optional deep links:

```text
/projects/:projectId/chat?agent=<agentId>
/projects/:projectId/chat?agent=<agentId>&session=<sessionId>
/projects/:projectId/chat?agent=<agentId>&artifact=<artifactId>
```

The route should be available from:

- project sidebar navigation
- project detail page
- agent detail page as "Chat"
- conversation list rows

The agent detail link should preselect that agent. The project-level link should default to the project's active agent.

## 3. Scope

### In scope

- shadcn/ui-based React implementation in `src/web/client`
- API routes under `/api/web`
- project-scoped agent picker
- existing session browser and active session support
- message composer with text and file attachments
- upload of local files into an OpenColab-managed inbound upload folder
- provider execution through the same prompt/memory/runtime path used by Telegram
- live-status panel driven by normalized `TaskProgressEvent` objects
- stop/cancel for an active web chat turn
- final answer rendering with Markdown and math
- agent file return through parsed outbound file directives
- inline preview for returned PDFs, Markdown, images, and plain text
- PDF preview on the right side of the chat using the existing PDF viewer foundation
- preservation of conversation memory in `memory/Session/`

### Out of scope for the first milestone

- internet-hosted multi-user Studio
- collaborative simultaneous editors
- arbitrary file deletion from the UI
- editing agent prompt files from chat
- token streaming of partial assistant prose
- voice/audio recording in the browser
- cross-project chat in one view
- deep PageIndex-aware PDF annotations

## 4. UX Requirements

### 4.1 Desktop layout

Use a three-region work surface:

```text
+----------------------+--------------------------------+----------------------+
| Session / agents     | Chat transcript + composer     | Live status / files |
+----------------------+--------------------------------+----------------------+
```

Left rail:

- project agent selector
- current session selector
- recent sessions for the selected agent
- new session action

Center:

- chronological transcript
- user messages
- assistant messages
- upload chips attached to user turns
- returned file chips attached to assistant turns
- composer pinned to the bottom

Right rail:

- during a run: live-status view, newest line marked like Telegram (`🟢`) and older visible lines marked (`⚪`)
- after a run: file/artifact viewer
- when a returned PDF is selected: PDF preview
- when no artifact is selected: last run status and returned files

The right rail must not be a separate page for PDFs. Selecting a PDF returned by an agent should open it immediately beside the conversation.

### 4.2 Mobile layout

Mobile should keep the chat as the primary surface:

- agent/session picker in a `Sheet`
- returned files and PDF viewer in a `Sheet`
- live status collapsed above the composer while running
- composer remains reachable without horizontal scrolling

PDF viewing on mobile may open full-screen within the same route.

### 4.3 Agent picker

The user must be able to choose which agent to talk to before sending.

Requirements:

- list all agents in the current project
- show active provider/model in compact form
- show whether the agent is currently busy
- disable sending to a busy agent unless the active turn belongs to this chat session
- persist selected agent in the URL query string
- default to `project.activeAgentId` if no `agent` query is present

Changing the selected agent changes the visible session list and composer target. It must not silently move messages between agent histories.

### 4.4 Live-status behavior

Studio chat should imitate Telegram live status at the semantic level, not by copying Telegram API behavior.

Requirements:

- consume normalized `TaskProgressEvent` values
- render only bounded recent meaningful activity
- keep final answer separate from live status
- never append progress events to normal conversation memory
- do not render raw provider event names such as `item.started`, `item.completed`, or `turn.completed`
- show warnings and `needs_input` events prominently
- allow the user to stop a running turn
- keep the last live-status summary visible after completion until the user selects a file or sends another message

Recommended rendering:

- heading: `<agentId> is working`
- 3 to 6 recent lines
- newest visible active line uses `🟢`
- older visible lines use `⚪`
- progress counts render as compact text, for example `8 / 20 papers`
- warnings use `Alert`
- completed state shows elapsed time and final status

### 4.5 Message rendering

Assistant and user messages should render:

- GitHub-flavored Markdown
- fenced code blocks with highlighting
- tables
- inline math with `$...$`
- display math with `$$...$$`
- Markdown links
- image references when they resolve to safe local returned files

Use `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex` or an equivalent maintained KaTeX pipeline. The renderer must not treat dollar signs inside fenced code blocks as math.

### 4.6 Composer

The composer should support:

- multi-line text
- file attach button
- selected upload list with size and remove controls
- send button
- stop button while the selected chat turn is running
- disabled state when provider auth/preflight is missing

Keyboard behavior:

- `Enter` sends when the composer is not empty and no modifier is held
- `Shift+Enter` inserts a newline
- `Escape` clears local draft only when no upload is pending

## 5. shadcn/ui Requirements

The chat UI must be built from shadcn components and existing Studio conventions.

Current project context:

- Vite React SPA
- shadcn style: `radix-nova`
- Tailwind CSS file: `src/web/client/src/index.css`
- aliases: `@/components`, `@/components/ui`, `@/lib`
- icon library: `lucide`

Reuse currently installed components where appropriate:

- `Button`
- `Badge`
- `Avatar`
- `ScrollArea`
- `Separator`
- `Tabs`
- `Tooltip`
- `Sheet`
- `DropdownMenu`
- `Alert`
- `Empty`
- `Skeleton`
- `sonner`

Add shadcn components before implementation if they are not present:

- `Textarea` for the composer
- `Select` or `Combobox`/`Command` for agent and session selection
- `Resizable` for desktop chat/artifact panes
- `Progress` for upload and run progress
- `Dialog` for destructive confirmations or oversized file details
- `Popover` for compact metadata and file menus

Composition rules:

- use lucide icons in icon buttons
- use `Tooltip` for icon-only actions
- use `Badge` for agent/provider/session states
- use `Alert` for warnings, auth blockers, and failed turns
- use `Skeleton` for transcript and file loading
- use `sonner` for upload and send failures
- avoid nested cards; the chat route should feel like a work surface, not a dashboard of cards

## 6. Backend Model

### 6.1 New DTOs

Add chat DTOs to `src/web/shared/types.ts`.

```ts
export type WebChatTurnStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "timed_out";

export interface WebChatAgentOption {
  id: string;
  projectId: string;
  active: boolean;
  busy: boolean;
  provider: WebProviderInfo;
  todoSummary: string | null;
}

export interface WebChatAttachment {
  id: string;
  name: string;
  kind: "pdf" | "markdown" | "image" | "text" | "archive" | "audio" | "video" | "other";
  mimeType: string | null;
  sizeBytes: number;
  relativePath: string;
  previewUrl: string | null;
}

export interface WebChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  attachments: WebChatAttachment[];
}

export interface WebChatSessionDetail {
  projectId: string;
  agentId: string;
  sessionId: string;
  active: boolean;
  messages: WebChatMessage[];
  runningTurn: WebChatTurn | null;
}

export interface WebChatTurn {
  turnId: string;
  projectId: string;
  agentId: string;
  sessionId: string;
  status: WebChatTurnStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastProgress: string | null;
  progress: TaskProgressEvent[];
  returnedFiles: WebChatAttachment[];
  error: string | null;
}
```

The DTOs can evolve during implementation, but the boundary should stay stable: browser code does not read raw `opencolab.json`, raw JSONL session files, or provider logs directly.

### 6.2 Upload storage

Uploads must be copied into an OpenColab-managed project path before provider execution.

Recommended location:

```text
projects/<project_id>/AGENTS/<agent_id>/uploads/<YYYY-MM-DD>/<upload_id>/<safe_filename>
```

Requirements:

- keep uploads inside the selected agent directory
- normalize filenames to safe ASCII when stored
- preserve original filename in metadata
- write `manifest.json` per upload batch
- reject path traversal and symlink escapes
- enforce a configurable max file size
- allow common research inputs: `.pdf`, `.md`, `.txt`, `.csv`, `.tsv`, `.json`, images, archives, and code files
- pass uploaded files to the provider as local paths and mention them in the user turn text

Uploads are user-provided context, so they may be appended to the conversation memory as concise attachment references. Large file contents should not be inlined automatically.

### 6.3 Returned file storage

Agents may already return files using `@telegram-file <json>` directives. Studio chat should reuse the parser concept but not the Telegram transport name in browser DTOs.

Requirements:

- parse returned file directives from the final provider response
- resolve relative paths against the active agent directory
- support absolute paths and `file://` URLs only when they resolve inside allowed OpenColab roots or explicit returned artifact locations
- copy or reference safe files through a web file endpoint
- attach returned files to the assistant message
- remove directive lines from rendered assistant prose

The normal conversation log should keep a compact assistant entry that includes returned file references, matching the existing Telegram behavior where the final human-facing answer is separate from delivery mechanics.

## 7. API Surface

All routes live under `/api/web`.

### 7.1 Read routes

```text
GET /api/web/projects/:projectId/chat/agents
GET /api/web/projects/:projectId/chat/sessions?agentId=<agentId>
GET /api/web/projects/:projectId/chat/sessions/:sessionId?agentId=<agentId>
GET /api/web/projects/:projectId/chat/turns/:turnId?agentId=<agentId>&sessionId=<sessionId>
GET /api/web/projects/:projectId/chat/files/:fileId
```

`/files/:fileId` should stream bytes with content type, size, ETag, and range support for PDFs where practical.

### 7.2 Write routes

```text
POST /api/web/projects/:projectId/chat/uploads
POST /api/web/projects/:projectId/chat/send
POST /api/web/projects/:projectId/chat/turns/:turnId/stop
POST /api/web/projects/:projectId/chat/sessions/new
POST /api/web/projects/:projectId/chat/sessions/:sessionId/reset
```

`send` request body:

```json
{
  "agentId": "professor",
  "sessionId": "optional-existing-session",
  "message": "user text",
  "uploadIds": ["upload_..."]
}
```

`send` response:

```json
{
  "turnId": "turn_...",
  "sessionId": "session_...",
  "status": "queued"
}
```

### 7.3 Live updates

Use Server-Sent Events for the first implementation:

```text
GET /api/web/projects/:projectId/chat/turns/:turnId/events
```

SSE events:

```text
event: progress
data: <WebChatTurn JSON subset>

event: message
data: <WebChatMessage JSON>

event: completed
data: <WebChatTurn JSON>

event: error
data: <WebError JSON>
```

SSE is preferred for the first milestone because Studio is a local one-user app and only needs server-to-browser updates. WebSockets can be revisited if bidirectional collaboration is added later.

## 8. Runtime Integration

The web chat send path should reuse the same core runtime behavior as Telegram without routing through Telegram-specific inbound parsing.

Recommended implementation:

1. add a runtime method for web chat turns, for example `runWebChatTurn(input, options)`
2. validate project, agent, session, and upload IDs
3. read prompt memory for the selected agent session
4. append the user message plus compact upload references to `memory/Session/`
5. call `ProviderAgent.respondFor(project, agent, input, { signal, onProgress })`
6. normalize progress through the existing `TaskProgressEvent` model
7. parse outbound file directives
8. append assistant message without transport-only labels
9. expose returned files through web file DTOs
10. complete or fail the turn and notify SSE clients

The Telegram `activeRequests` map is transport-specific today. Web chat should get a sibling turn registry owned by the web/runtime layer rather than pretending the browser is a Telegram chat.

Busy behavior:

- only one running turn per `projectId + agentId` by default
- sending to a busy agent returns `409` with the active turn summary
- stopping a turn aborts the provider process through `AbortController`
- stopped, timed-out, and failed turns append the same kind of compact recovery entry used by Telegram

## 9. File Preview Behavior

### 9.1 PDF

PDF files returned by the agent should open in the right rail.

Implementation requirements:

- reuse the existing `react-pdf` and `pdfjs-dist` setup from `src/web/client/src/components/research/pdf-viewer.tsx`
- extract a generic PDF viewer component if needed, instead of duplicating PDF logic
- support page navigation, page count, zoom, and open raw
- keep the existing large-file guard behavior
- use a chat file URL rather than a research run URL

Suggested component split:

```text
components/pdf/pdf-viewer.tsx        shared generic viewer
components/research/pdf-viewer.tsx   research adapter
components/chat/chat-pdf-viewer.tsx  chat adapter
```

### 9.2 Markdown and text

Markdown returned as a file should use the same math-capable renderer as chat messages. Relative links should resolve against the returned file's directory when safe.

Plain text should render in a scrollable monospace block with a download/open-raw action.

### 9.3 Images

Images should preview inline in the right rail with fit-to-pane sizing and an open-raw action.

### 9.4 Other files

Unknown or unsafe preview types should render metadata plus actions:

- open raw
- download
- copy path

Do not try to execute or render arbitrary HTML.

## 10. Security

The chat interface is local but still needs strict file boundaries.

Requirements:

- reject uploads outside configured size and extension limits
- never trust browser-provided filenames as paths
- assign server-side IDs for uploads and returned files
- stream files only after resolving them to an allowed root
- reject `..`, absolute browser paths, and symlink escapes
- set conservative `Content-Type`
- set `Content-Disposition: inline` only for safe preview types
- set `Content-Disposition: attachment` for unknown binary files
- do not expose secrets from `.env.local`, `.opencolab/`, SSH keys, or provider config files
- do not persist raw progress streams in normal conversation memory

## 11. Accessibility

Requirements:

- keyboard reachable agent selector, session selector, upload action, send, stop, and file list
- visible focus states from shadcn defaults
- `aria-live="polite"` for live-status updates
- `aria-live="assertive"` for failures and `needs_input`
- icon-only buttons require tooltips and accessible labels
- dialogs and sheets require titles
- transcript should preserve message order for screen readers

## 12. Implementation Plan

### Milestone 1: Readable chat shell

- add `/projects/:projectId/chat` route
- add sidebar/nav entry
- build shadcn-based chat layout
- agent picker from existing agent DTOs
- session list from existing conversation DTOs
- transcript viewer for existing session messages
- Markdown/math renderer shared by chat and file previews

### Milestone 2: Sending text

- add web chat runtime method
- add `POST /chat/send`
- add turn registry and busy checks
- append user and assistant messages to the selected agent session
- render final assistant answer in the transcript
- add stop endpoint wired to `AbortController`

### Milestone 3: Live status

- add SSE endpoint for active turns
- pipe `TaskProgressEvent` into web turn registry
- build right-rail live-status renderer
- reuse Telegram live-status semantics: bounded lines, current marker, warnings, needs-input
- verify progress events do not enter conversation memory

### Milestone 4: Uploads

- add upload endpoint and storage manifest
- attach uploaded files to user turns
- pass uploaded local paths into provider input
- render upload chips and server-side validation errors

### Milestone 5: Returned files and previews

- parse outbound file directives
- expose returned files through web file endpoint
- attach returned files to assistant messages
- preview PDFs in the right rail using the generic PDF viewer
- preview Markdown, text, and images

### Milestone 6: Polish and tests

- mobile sheets for agent/session picker and artifact viewer
- loading and empty states
- auth/preflight blockers
- failed, stopped, and timed-out run states
- e2e screenshots for desktop and mobile
- tests for path safety, upload metadata, file directive parsing, and conversation memory boundaries

## 13. Testing Plan

Backend tests:

- chat agent list returns all project agents and busy flags
- send rejects unknown project, unknown agent, unknown session, and busy agent
- send appends user and assistant messages to the correct agent session
- progress events are exposed through turn state but not written as conversation messages
- stop aborts an active provider run and appends recovery entry
- upload rejects traversal filenames and stores safe metadata
- file endpoint rejects escapes and disallowed paths
- returned file directives become `WebChatAttachment` records

Frontend tests where practical:

- route defaults to active project agent
- switching agent changes session list
- send disabled for empty composer
- uploads render as removable chips
- live-status newest line is visually current
- math renders inline and block equations
- returned PDF selection opens the right-side viewer

Manual verification:

- `pnpm run check`
- `pnpm run build`
- `pnpm test`
- run Studio locally and test a text turn, a stopped turn, an upload turn, and a returned PDF turn

## 14. Open Questions

- Should Studio chat change `project.activeAgentId`, or should selection remain web-local until the user explicitly chooses "Set active agent"?
- What upload size limit should be the default for local Studio?
- Should uploads be garbage-collected when a session is reset?
- Should returned files be copied into a chat-owned artifact folder, or referenced in place when already inside the agent directory?
- Should the first milestone support old sessions only, or create a new session automatically on first send?
