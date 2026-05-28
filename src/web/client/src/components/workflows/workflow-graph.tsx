import { Fragment } from "react"
import {
  BotIcon,
  GitForkIcon,
  HandIcon,
  LogInIcon,
  MergeIcon,
  StopCircleIcon,
} from "lucide-react"
import { AgentAvatar } from "@/components/layout/agent-avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type {
  WebWorkflowGraph,
  WebWorkflowGraphEdge,
  WebWorkflowGraphLoop,
  WebWorkflowGraphNode,
  WebWorkflowGraphNodeKind,
} from "@shared/types"

interface WorkflowGraphProps {
  graph: WebWorkflowGraph
  activeStepId?: string | null
  onSelectStep?: (stepId: string) => void
}

const KIND_LABEL: Record<WebWorkflowGraphNodeKind, string> = {
  input: "input",
  agent: "agent",
  decision: "decision",
  human_gate: "human gate",
  merge: "merge",
  terminate: "terminate",
}

const STATUS_RING: Record<string, string> = {
  running: "ring-2 ring-emerald-500",
  paused: "ring-2 ring-amber-500",
  failed: "ring-2 ring-red-500",
  stopped: "ring-2 ring-zinc-500",
  complete: "ring-2 ring-emerald-300",
}

export function WorkflowGraph({
  graph,
  activeStepId,
  onSelectStep,
}: WorkflowGraphProps) {
  if (graph.nodes.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        Workflow has no steps yet.
      </div>
    )
  }

  const loopOrder = orderedLoops(graph.loops)
  const loopMap = new Map(loopOrder.map((loop) => [loop.id, loop]))
  const nodesByLoop = groupNodesByLoop(graph.nodes)
  const edgesBySource = groupEdgesBySource(graph.edges)

  const ungrouped = nodesByLoop.get(null) ?? []

  return (
    <div className="flex flex-col gap-3">
      {ungrouped.map((node) => (
        <NodeRow
          key={node.id}
          node={node}
          isActive={node.id === activeStepId}
          edges={edgesBySource.get(node.id) ?? []}
          onSelect={onSelectStep}
        />
      ))}
      {loopOrder.map((loop) => (
        <LoopBlock
          key={loop.id}
          loop={loop}
          nodes={nodesByLoop.get(loop.id) ?? []}
          edgesBySource={edgesBySource}
          loopMap={loopMap}
          activeStepId={activeStepId}
          onSelect={onSelectStep}
        />
      ))}
    </div>
  )
}

function LoopBlock({
  loop,
  nodes,
  edgesBySource,
  activeStepId,
  onSelect,
}: {
  loop: WebWorkflowGraphLoop
  nodes: WebWorkflowGraphNode[]
  edgesBySource: Map<string, WebWorkflowGraphEdge[]>
  loopMap: Map<string, WebWorkflowGraphLoop>
  activeStepId?: string | null
  onSelect?: (stepId: string) => void
}) {
  return (
    <div className="border-muted-foreground/30 rounded-md border border-dashed p-3">
      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs uppercase tracking-wide">
        <span>loop · {loop.id}</span>
        <span className="font-mono normal-case">
          {loopBoundsLabel(loop)}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {nodes.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            isActive={node.id === activeStepId}
            edges={edgesBySource.get(node.id) ?? []}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function NodeRow({
  node,
  isActive,
  edges,
  onSelect,
}: {
  node: WebWorkflowGraphNode
  isActive: boolean
  edges: WebWorkflowGraphEdge[]
  onSelect?: (stepId: string) => void
}) {
  const ring = STATUS_RING[node.status]
  const isInput = node.kind === "input"
  const buttonClass = cn(
    "bg-card text-card-foreground flex w-full items-start gap-3 rounded-md border p-3 text-left transition",
    isActive && "border-foreground/40 bg-foreground/5",
    !isInput && "hover:border-foreground/30 hover:bg-foreground/5",
    ring,
  )
  const content = (
    <div className={buttonClass}>
      <NodeIcon node={node} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{node.label}</span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {KIND_LABEL[node.kind]}
          </Badge>
          {node.status !== "idle" && (
            <Badge variant="secondary" className="text-[10px]">
              {node.status}
            </Badge>
          )}
        </div>
        {node.subtitle && (
          <p className="text-muted-foreground truncate text-xs">
            {node.subtitle}
          </p>
        )}
        {node.agent && (
          <p className="text-muted-foreground flex items-center gap-1 truncate text-xs">
            <span>{node.agent.id}</span>
            {node.agent.missing && (
              <Badge variant="destructive" className="text-[10px]">
                missing
              </Badge>
            )}
            {node.agent.provider && !node.agent.missing && (
              <span className="opacity-60">
                · {node.agent.provider.name} · {node.agent.provider.model}
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  )

  const buttonOrDiv = isInput || !onSelect ? (
    content
  ) : (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className="w-full focus-visible:outline-none"
    >
      {content}
    </button>
  )

  return (
    <div className="flex flex-col gap-1">
      {buttonOrDiv}
      {edges.length > 0 && (
        <div className="text-muted-foreground ml-3 flex flex-wrap items-center gap-2 pl-3 text-[11px]">
          {edges.map((edge) => (
            <Fragment key={edge.id}>
              <EdgeChip edge={edge} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function EdgeChip({ edge }: { edge: WebWorkflowGraphEdge }) {
  const labelMap: Record<WebWorkflowGraphEdge["kind"], string> = {
    sequence: "→",
    choice: "choice",
    loop: "loop ↺",
    gate: "human gate",
  }
  const prefix = labelMap[edge.kind]
  return (
    <span className="border-muted-foreground/30 rounded-sm border px-1.5 py-0.5">
      {prefix}
      {edge.label ? ` · ${edge.label}` : ""}
      {" · "}
      <span className="font-mono">{edge.target}</span>
    </span>
  )
}

function NodeIcon({ node }: { node: WebWorkflowGraphNode }) {
  if (node.kind === "agent" || node.kind === "decision") {
    return (
      <div className="size-12 shrink-0">
        <AgentAvatar
          providerName={node.agent?.provider?.name ?? ""}
          className="h-12 w-12"
        />
      </div>
    )
  }
  const Icon = iconForNode(node.kind)
  return (
    <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
      <Icon className="size-4" />
    </div>
  )
}

function iconForNode(kind: WebWorkflowGraphNodeKind) {
  switch (kind) {
    case "input":
      return LogInIcon
    case "human_gate":
      return HandIcon
    case "merge":
      return MergeIcon
    case "terminate":
      return StopCircleIcon
    case "decision":
      return GitForkIcon
    default:
      return BotIcon
  }
}

function loopBoundsLabel(loop: WebWorkflowGraphLoop): string {
  const parts: string[] = []
  if (loop.maxIterations != null) parts.push(`maxIterations=${loop.maxIterations}`)
  if (loop.maxSteps != null) parts.push(`maxSteps=${loop.maxSteps}`)
  if (loop.maxRuntimeMinutes != null)
    parts.push(`maxRuntimeMinutes=${loop.maxRuntimeMinutes}`)
  return parts.join(" · ")
}

function orderedLoops(loops: WebWorkflowGraphLoop[]): WebWorkflowGraphLoop[] {
  return [...loops].sort((a, b) => a.id.localeCompare(b.id))
}

function groupNodesByLoop(
  nodes: WebWorkflowGraphNode[],
): Map<string | null, WebWorkflowGraphNode[]> {
  const map = new Map<string | null, WebWorkflowGraphNode[]>()
  for (const node of nodes) {
    const key = node.loopId ?? null
    const list = map.get(key)
    if (list) {
      list.push(node)
    } else {
      map.set(key, [node])
    }
  }
  return map
}

function groupEdgesBySource(
  edges: WebWorkflowGraphEdge[],
): Map<string, WebWorkflowGraphEdge[]> {
  const map = new Map<string, WebWorkflowGraphEdge[]>()
  for (const edge of edges) {
    const list = map.get(edge.source)
    if (list) {
      list.push(edge)
    } else {
      map.set(edge.source, [edge])
    }
  }
  return map
}
