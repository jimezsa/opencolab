import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { GitBranchIcon } from "lucide-react"

export default function WorkflowsRoute() {
  return (
    <Empty>
      <EmptyHeader>
        <GitBranchIcon className="text-muted-foreground size-6" />
        <EmptyTitle>Workflows are coming soon</EmptyTitle>
        <EmptyDescription>
          Visual workflow inspection lands after the read-only milestone is stable.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
