import { useEffect, useState } from "react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import {
  BookOpenIcon,
  BracesIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
} from "lucide-react"
import { api, researchFileUrl, ApiError } from "@/lib/api"
import type {
  WebChatAttachment,
  WebChatAttachmentKind,
  WebResearchFile,
  WebResearchFileKind,
  WebResearchRun,
  WebResearchRunDetail,
} from "@shared/types"

interface FileRailProps {
  projectId: string
  attachments: WebChatAttachment[]
  selectedId: string | null
  onSelect: (attachment: WebChatAttachment | null) => void
}

export function FileRail({
  projectId,
  attachments,
  selectedId,
  onSelect,
}: FileRailProps) {
  const sortedAttachments = [...attachments].sort(compareAttachments)
  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <Accordion
        type="multiple"
        defaultValue={["returned", "research"]}
        className="w-full"
      >
        <AccordionItem value="returned">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              Returned files
              <Badge variant="secondary" className="text-[10px]">
                {attachments.length}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            {attachments.length === 0 ? (
              <p className="text-muted-foreground px-1 py-1">
                no files returned yet
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto pr-1">
                <ul className="flex flex-col gap-0.5">
                  {sortedAttachments.map((attachment) => (
                    <li key={attachment.id}>
                      <FileRow
                        name={attachment.name}
                        kind={attachment.kind}
                        sizeBytes={attachment.sizeBytes}
                        selected={selectedId === attachment.id}
                        onClick={() => onSelect(attachment)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="research">
          <AccordionTrigger>Research</AccordionTrigger>
          <AccordionContent>
            <ResearchSection
              projectId={projectId}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function ResearchSection({
  projectId,
  selectedId,
  onSelect,
}: {
  projectId: string
  selectedId: string | null
  onSelect: (attachment: WebChatAttachment) => void
}) {
  const [runs, setRuns] = useState<WebResearchRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRuns(null)
    setError(null)
    api
      .research(projectId)
      .then((list) => {
        if (cancelled) return
        setRuns(list)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : "failed to load research",
        )
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (error) {
    return <p className="text-destructive px-1 py-1">{error}</p>
  }
  if (runs == null) {
    return <p className="text-muted-foreground px-1 py-1">loading…</p>
  }
  if (runs.length === 0) {
    return <p className="text-muted-foreground px-1 py-1">no research runs</p>
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto pr-1">
      <Accordion type="multiple" className="w-full">
        {runs.map((run) => (
          <ResearchRunSection
            key={run.id}
            run={run}
            projectId={projectId}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </Accordion>
    </div>
  )
}

function ResearchRunSection({
  run,
  projectId,
  selectedId,
  onSelect,
}: {
  run: WebResearchRun
  projectId: string
  selectedId: string | null
  onSelect: (attachment: WebChatAttachment) => void
}) {
  const [detail, setDetail] = useState<WebResearchRunDetail | null>(null)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ensureLoaded = () => {
    if (requested) return
    setRequested(true)
    api
      .researchRun(projectId, run.id)
      .then(setDetail)
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "failed to load run",
        )
      })
  }

  const sortedFiles = detail
    ? detail.tree
        .filter(isPreviewableResearchFile)
        .map((file) => ({
          file,
          attachment: researchFileToAttachment(projectId, run.id, file),
        }))
        .sort((a, b) => compareAttachments(a.attachment, b.attachment))
    : []
  return (
    <AccordionItem value={run.id} onPointerDown={ensureLoaded}>
      <AccordionTrigger className="text-[12px]">
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="truncate text-xs font-medium">
            {run.topic || run.folder}
          </span>
          <span className="text-muted-foreground/80 flex items-center gap-3 text-[10px]">
            <span className="truncate">
              {run.skill} · {run.status}
            </span>
          </span>
          <span className="text-muted-foreground/80 flex items-center gap-2 text-[10px]">
            <CorpusStat
              icon={BookOpenIcon}
              count={run.corpus.papers}
              label="papers"
            />
            <CorpusStat
              icon={FileTextIcon}
              count={run.corpus.summaries}
              label="summaries"
            />
            <CorpusStat
              icon={ImageIcon}
              count={run.corpus.diagrams}
              label="diagrams"
            />
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {error ? (
          <p className="text-destructive px-1 py-1 text-[11px]">{error}</p>
        ) : !detail ? (
          <p className="text-muted-foreground px-1 py-1 text-[11px]">loading…</p>
        ) : sortedFiles.length === 0 ? (
          <p className="text-muted-foreground px-1 py-1 text-[11px]">
            no previewable files
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto pr-1">
            <ul className="flex flex-col gap-0.5">
              {sortedFiles.map(({ file, attachment }) => (
                <li key={file.path}>
                  <FileRow
                    name={file.name}
                    kind={attachment.kind}
                    sizeBytes={file.size}
                    selected={selectedId === attachment.id}
                    onClick={() => onSelect(attachment)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

interface CorpusStatProps {
  icon: typeof FileIcon
  count: number
  label: string
}

function CorpusStat({ icon: Icon, count, label }: CorpusStatProps) {
  return (
    <span className="flex items-center gap-1" title={label}>
      <Icon className="size-3" />
      {count}
    </span>
  )
}

interface FileRowProps {
  name: string
  kind: WebChatAttachmentKind
  sizeBytes: number
  selected: boolean
  onClick: () => void
}

function FileRow({ name, kind, sizeBytes, selected, onClick }: FileRowProps) {
  const Icon = iconForKind(kind, name)
  const sizeLabel = formatSize(sizeBytes)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors ${
        selected ? "bg-primary/10 text-foreground" : "hover:bg-accent"
      }`}
      title={name}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-muted-foreground/80 shrink-0 text-[10px]">
        {sizeLabel}
      </span>
    </button>
  )
}

function iconForKind(
  kind: WebChatAttachmentKind,
  name: string,
): typeof FileIcon {
  if (kind === "image") return ImageIcon
  if (kind === "pdf") return BookOpenIcon
  if (kind === "markdown") return FileTextIcon
  if (kind === "text") {
    return name.toLowerCase().endsWith(".json") ? BracesIcon : FileTextIcon
  }
  return FileIcon
}

const KIND_ORDER: Record<WebChatAttachmentKind, number> = {
  pdf: 0,
  markdown: 1,
  image: 2,
  text: 3,
  archive: 4,
  audio: 5,
  video: 6,
  other: 7,
}

function compareAttachments(
  a: WebChatAttachment,
  b: WebChatAttachment,
): number {
  const orderDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (orderDelta !== 0) return orderDelta
  return a.name.localeCompare(b.name)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const PREVIEWABLE_KINDS: ReadonlyArray<WebResearchFileKind> = [
  "pdf",
  "markdown",
  "image-png",
  "image-svg",
  "image-other",
  "json",
  "text",
]

function isPreviewableResearchFile(file: WebResearchFile): boolean {
  return PREVIEWABLE_KINDS.includes(file.kind)
}

export function researchFileToAttachment(
  projectId: string,
  runId: string,
  file: WebResearchFile,
): WebChatAttachment {
  const url = researchFileUrl(projectId, runId, file.path)
  return {
    id: `research:${runId}:${file.path}`,
    name: file.name,
    kind: mapResearchKind(file.kind),
    mimeType: null,
    sizeBytes: file.size,
    relativePath: file.path,
    previewUrl: url,
    rawUrl: url,
    source: "returned",
  }
}

function mapResearchKind(kind: WebResearchFileKind): WebChatAttachmentKind {
  switch (kind) {
    case "pdf":
      return "pdf"
    case "markdown":
      return "markdown"
    case "image-png":
    case "image-svg":
    case "image-other":
      return "image"
    case "json":
    case "text":
      return "text"
    default:
      return "other"
  }
}
