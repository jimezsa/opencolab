import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronDownIcon } from "lucide-react"
import type { WebChatAgentOption } from "@shared/types"

interface AgentPickerProps {
  agents: WebChatAgentOption[]
  selectedId: string | null
  onSelect: (agentId: string) => void
  loading?: boolean
}

export function AgentPicker({
  agents,
  selectedId,
  onSelect,
  loading,
}: AgentPickerProps) {
  const selected = agents.find((a) => a.id === selectedId) ?? null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between gap-2"
          disabled={loading || agents.length === 0}
          aria-label="Choose chat agent"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">
              {selected ? selected.id : loading ? "loading…" : "choose agent"}
            </span>
            {selected && selected.busy && (
              <Badge variant="secondary" className="shrink-0 text-[10px]">
                busy
              </Badge>
            )}
            {selected && selected.active && (
              <Badge variant="default" className="shrink-0 text-[10px]">
                active
              </Badge>
            )}
          </span>
          <ChevronDownIcon className="size-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Project agents</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {agents.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onSelect={() => onSelect(agent.id)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="flex w-full items-center gap-2">
              <span className="truncate font-medium">{agent.id}</span>
              {agent.busy && (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  busy
                </Badge>
              )}
              {!agent.busy && agent.active && (
                <Badge variant="default" className="ml-auto text-[10px]">
                  active
                </Badge>
              )}
            </span>
            <span className="text-muted-foreground text-xs">
              {agent.provider.name}/{agent.provider.model}
            </span>
          </DropdownMenuItem>
        ))}
        {agents.length === 0 && (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">
            no agents in this project
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
