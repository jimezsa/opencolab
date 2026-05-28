import { useMemo } from "react"
import * as dagre from "@dagrejs/dagre"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeMarkerType,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import {
  BotIcon,
  GitForkIcon,
  HandIcon,
  LogInIcon,
  MergeIcon,
  StopCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AgentAvatar } from "@/components/layout/agent-avatar"
import { cn } from "@/lib/utils"
import type {
  WebWorkflowGraph,
  WebWorkflowGraphAgent,
  WebWorkflowGraphLoop,
  WebWorkflowGraphNodeKind,
  WebWorkflowGraphNodeStatus,
} from "@shared/types"

interface WorkflowFlowDiagramProps {
  graph: WebWorkflowGraph
  height?: number
  activeStepId?: string | null
  onSelectStep?: (stepId: string) => void
}

const NODE_WIDTH = 240
const NODE_HEIGHT = 96
const LOOP_PADDING = 32
const LOOP_HEADER = 28

export function WorkflowFlowDiagram(props: WorkflowFlowDiagramProps) {
  return (
    <div
      className="bg-muted/10 border-muted-foreground/20 overflow-hidden rounded-md border"
      style={{ height: props.height ?? 480 }}
    >
      <ReactFlowProvider>
        <DiagramInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}

function DiagramInner({ graph, activeStepId, onSelectStep }: WorkflowFlowDiagramProps) {
  const layout = useMemo(
    () => buildLayout(graph, { activeStepId: activeStepId ?? null }),
    [graph, activeStepId],
  )

  return (
    <ReactFlow
      nodes={layout.nodes}
      edges={layout.edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={!!onSelectStep}
      onNodeClick={(_event, node) => {
        if (!onSelectStep) return
        const data = node.data as FlowNodeData | undefined
        if (data && data.kind !== "loop" && data.kind !== "input") {
          onSelectStep(node.id)
        }
      }}
      panOnScroll
      zoomOnScroll={false}
      minZoom={0.4}
      maxZoom={1.5}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls position="bottom-right" showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        position="top-right"
        maskColor="rgba(0,0,0,0.05)"
        nodeStrokeWidth={2}
      />
    </ReactFlow>
  )
}

interface FlowNodeData {
  kind: WebWorkflowGraphNodeKind | "loop"
  label: string
  subtitle: string | null
  status: WebWorkflowGraphNodeStatus
  agent: WebWorkflowGraphAgent | null
  loop?: WebWorkflowGraphLoop
  active: boolean
  [key: string]: unknown
}

interface LayoutResult {
  nodes: Node<FlowNodeData>[]
  edges: Edge[]
}

interface LayoutOptions {
  activeStepId: string | null
}

function buildLayout(graph: WebWorkflowGraph, options: LayoutOptions): LayoutResult {
  const dag = new dagre.graphlib.Graph({ compound: true, multigraph: true })
  dag.setGraph({
    rankdir: "LR",
    nodesep: 40,
    edgesep: 16,
    ranksep: 80,
    marginx: 16,
    marginy: 16,
  })
  dag.setDefaultEdgeLabel(() => ({}))

  for (const loop of graph.loops) {
    dag.setNode(`loop:${loop.id}`, { label: loop.id })
  }

  const stepNodeIds = new Set<string>()
  for (const node of graph.nodes) {
    stepNodeIds.add(node.id)
    dag.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      label: node.label,
    })
    if (node.loopId) {
      dag.setParent(node.id, `loop:${node.loopId}`)
    }
  }

  for (const edge of graph.edges) {
    if (!stepNodeIds.has(edge.source) || !stepNodeIds.has(edge.target)) continue
    if (edge.source === edge.target) continue
    dag.setEdge(edge.source, edge.target, {}, edge.id)
  }

  dagre.layout(dag)

  const flowNodes: Node<FlowNodeData>[] = []

  // Loop containers first (so step nodes paint on top).
  for (const loop of graph.loops) {
    const id = `loop:${loop.id}`
    const node = dag.node(id) as
      | { x: number; y: number; width: number; height: number }
      | undefined
    if (!node) continue
    const childIds = loop.childStepIds.filter((stepId) => stepNodeIds.has(stepId))
    const bbox = computeChildBoundingBox(dag, childIds)
    const width = (bbox?.width ?? node.width ?? NODE_WIDTH) + LOOP_PADDING * 2
    const height = (bbox?.height ?? node.height ?? NODE_HEIGHT) + LOOP_PADDING * 2 + LOOP_HEADER
    const x = (bbox ? bbox.x : node.x - width / 2) - LOOP_PADDING
    const y = (bbox ? bbox.y : node.y - height / 2) - LOOP_PADDING - LOOP_HEADER
    flowNodes.push({
      id,
      type: "loop",
      position: { x, y },
      data: {
        kind: "loop",
        label: loop.id,
        subtitle: loopBoundsLabel(loop),
        status: "idle",
        agent: null,
        loop,
        active: false,
      },
      style: { width, height, zIndex: 0 },
      draggable: false,
      selectable: false,
      focusable: false,
    })
  }

  for (const node of graph.nodes) {
    const layoutNode = dag.node(node.id) as
      | { x: number; y: number; width: number; height: number }
      | undefined
    if (!layoutNode) continue
    flowNodes.push({
      id: node.id,
      type: flowTypeForKind(node.kind),
      position: {
        x: layoutNode.x - layoutNode.width / 2,
        y: layoutNode.y - layoutNode.height / 2,
      },
      data: {
        kind: node.kind,
        label: node.label,
        subtitle: node.subtitle,
        status: node.status,
        agent: node.agent,
        active: options.activeStepId === node.id,
      },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })
  }

  const flowEdges: Edge[] = graph.edges
    .filter(
      (edge) => stepNodeIds.has(edge.source) && stepNodeIds.has(edge.target),
    )
    .map((edge) => {
      const isLoop = edge.kind === "loop"
      const isChoice = edge.kind === "choice"
      const isGate = edge.kind === "gate"
      const stroke = isLoop
        ? "#f59e0b"
        : isChoice
          ? "#0ea5e9"
          : isGate
            ? "#f97316"
            : "var(--foreground)"
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        label: edge.label ?? undefined,
        labelStyle: { fontSize: 11 },
        labelBgStyle: { fill: "var(--background)" },
        labelBgPadding: [4, 2],
        animated: isLoop,
        style: {
          stroke,
          strokeWidth: isChoice || isLoop ? 2 : 1.5,
          strokeDasharray: isGate ? "4 3" : undefined,
        },
        markerEnd: {
          type: "arrowclosed",
          color: stroke,
        } as EdgeMarkerType,
      }
    })

  return { nodes: flowNodes, edges: flowEdges }
}

function computeChildBoundingBox(
  dag: dagre.graphlib.Graph,
  childIds: string[],
): { x: number; y: number; width: number; height: number } | null {
  if (childIds.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const childId of childIds) {
    const node = dag.node(childId) as
      | { x: number; y: number; width: number; height: number }
      | undefined
    if (!node) continue
    const left = node.x - node.width / 2
    const top = node.y - node.height / 2
    const right = node.x + node.width / 2
    const bottom = node.y + node.height / 2
    if (left < minX) minX = left
    if (top < minY) minY = top
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function flowTypeForKind(kind: WebWorkflowGraphNodeKind): string {
  switch (kind) {
    case "agent":
      return "agent"
    case "decision":
      return "decision"
    case "human_gate":
      return "humanGate"
    case "merge":
      return "merge"
    case "terminate":
      return "terminate"
    case "input":
      return "input"
    default:
      return "agent"
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

const STATUS_RING: Record<string, string> = {
  running: "ring-2 ring-emerald-500",
  paused: "ring-2 ring-amber-500",
  failed: "ring-2 ring-red-500",
  stopped: "ring-2 ring-zinc-500",
  complete: "ring-1 ring-emerald-300",
}

function NodeShell({
  data,
  children,
  showSourceHandle = true,
  showTargetHandle = true,
  className,
}: {
  data: FlowNodeData
  children: React.ReactNode
  showSourceHandle?: boolean
  showTargetHandle?: boolean
  className?: string
}) {
  const ring = STATUS_RING[data.status] ?? ""
  return (
    <div
      className={cn(
        "bg-card text-card-foreground flex h-full w-full items-start gap-2 rounded-lg border p-2 shadow-sm transition",
        data.active && "border-foreground/40 bg-foreground/5",
        ring,
        className,
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {showTargetHandle && (
        <Handle
          type="target"
          position={Position.Left}
          className="h-2! w-2! bg-muted-foreground/50!"
        />
      )}
      {children}
      {showSourceHandle && (
        <Handle
          type="source"
          position={Position.Right}
          className="h-2! w-2! bg-muted-foreground/50!"
        />
      )}
    </div>
  )
}

function AgentNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <NodeShell data={d}>
      <div className="size-10 shrink-0">
        <AgentAvatar
          providerName={d.agent?.provider?.name ?? ""}
          className="h-10 w-10"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-xs">{d.label}</span>
          <Badge variant="outline" className="text-[9px] uppercase">
            agent
          </Badge>
        </div>
        {d.agent && (
          <p className="text-muted-foreground truncate text-[10px]">
            {d.agent.id}
            {d.agent.missing && (
              <span className="text-destructive ml-1">· missing</span>
            )}
            {d.agent.provider && !d.agent.missing && (
              <span className="opacity-70"> · {d.agent.provider.name}</span>
            )}
          </p>
        )}
        {d.status !== "idle" && (
          <Badge variant="secondary" className="mt-0.5 w-fit text-[9px]">
            {d.status}
          </Badge>
        )}
      </div>
    </NodeShell>
  )
}

function DecisionNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <NodeShell data={d}>
      <div className="relative size-10 shrink-0">
        <AgentAvatar
          providerName={d.agent?.provider?.name ?? ""}
          className="h-10 w-10"
        />
        <div className="bg-background absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border">
          <GitForkIcon className="size-2.5" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-xs">{d.label}</span>
          <Badge variant="outline" className="text-[9px] uppercase">
            decision
          </Badge>
        </div>
        <p className="text-muted-foreground truncate text-[10px]">
          {d.subtitle ?? ""}
        </p>
        {d.status !== "idle" && (
          <Badge variant="secondary" className="mt-0.5 w-fit text-[9px]">
            {d.status}
          </Badge>
        )}
      </div>
    </NodeShell>
  )
}

function IconNode({
  data,
  Icon,
  label,
  tint,
}: {
  data: FlowNodeData
  Icon: typeof BotIcon
  label: string
  tint?: string
}) {
  return (
    <NodeShell data={data}>
      <div
        className={cn(
          "bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-md",
          tint,
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-xs">{data.label}</span>
          <Badge variant="outline" className="text-[9px] uppercase">
            {label}
          </Badge>
        </div>
        {data.subtitle && (
          <p className="text-muted-foreground truncate text-[10px]">
            {data.subtitle}
          </p>
        )}
        {data.status !== "idle" && (
          <Badge variant="secondary" className="mt-0.5 w-fit text-[9px]">
            {data.status}
          </Badge>
        )}
      </div>
    </NodeShell>
  )
}

function HumanGateNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <IconNode
      data={d}
      Icon={HandIcon}
      label="human gate"
      tint="bg-amber-500/20 text-amber-700"
    />
  )
}

function MergeNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return <IconNode data={d} Icon={MergeIcon} label="merge" />
}

function TerminateNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <IconNode
      data={d}
      Icon={StopCircleIcon}
      label="terminate"
      tint="bg-red-500/15 text-red-700"
    />
  )
}

function InputNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <NodeShell data={d} showTargetHandle={false}>
      <div className="bg-foreground/10 flex size-10 shrink-0 items-center justify-center rounded-md">
        <LogInIcon className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-xs">{d.label}</span>
          <Badge variant="outline" className="text-[9px] uppercase">
            input
          </Badge>
        </div>
        {d.subtitle && (
          <p className="text-muted-foreground truncate text-[10px]">
            {d.subtitle}
          </p>
        )}
      </div>
    </NodeShell>
  )
}

function LoopContainerNode({ data }: NodeProps) {
  const d = data as FlowNodeData
  return (
    <div
      className="border-amber-500/40 bg-amber-500/5 relative h-full w-full rounded-lg border-2 border-dashed"
      style={{ pointerEvents: "none" }}
    >
      <div className="text-amber-700 absolute left-2 top-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide">
        <span>loop · {d.label}</span>
        {d.subtitle && (
          <span className="font-mono normal-case opacity-80">
            {d.subtitle}
          </span>
        )}
      </div>
    </div>
  )
}

const NODE_TYPES = {
  agent: AgentNode,
  decision: DecisionNode,
  humanGate: HumanGateNode,
  merge: MergeNode,
  terminate: TerminateNode,
  input: InputNode,
  loop: LoopContainerNode,
}
