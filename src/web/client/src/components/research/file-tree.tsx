import { FileTextIcon, FileIcon, ImageIcon, BookOpenIcon, BracesIcon, BookmarkIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/format"
import type { WebResearchFile } from "@shared/types"

interface FileTreeProps {
  files: WebResearchFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
}

interface Section {
  label: string
  prefix: string | null // null => root level
  files: WebResearchFile[]
}

const SECTION_DEFS: { label: string; prefix: string | null }[] = [
  { label: "Findings", prefix: null },
  { label: "PDFs", prefix: "pdf/" },
  { label: "Diagrams", prefix: "diagrams/" },
  { label: "PageIndex", prefix: "pageindex/" },
  { label: "Search", prefix: "search/" },
  { label: "Metadata", prefix: "meta/" },
]

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  const sections = groupFiles(files)
  return (
    <nav className="flex flex-col gap-3 text-xs">
      {sections.map((section) =>
        section.files.length === 0 ? null : (
          <div key={section.label}>
            <p className="text-muted-foreground mb-1 px-2 uppercase tracking-wide">
              {section.label}
            </p>
            <ul className="flex flex-col">
              {section.files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(file.path)}
                    className={cn(
                      "hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors",
                      selectedPath === file.path && "bg-accent text-accent-foreground",
                    )}
                  >
                    <FileIconFor kind={file.kind} />
                    <span className="truncate font-mono">{displayName(file, section)}</span>
                    <span className="text-muted-foreground ml-auto text-[10px]">
                      {formatBytes(file.size)}
                    </span>
                  </button>
                  {file.pairedSummary && (
                    <button
                      type="button"
                      onClick={() => onSelect(file.pairedSummary as string)}
                      className={cn(
                        "hover:bg-accent text-muted-foreground flex w-full items-center gap-2 rounded px-2 py-1 pl-7 text-left transition-colors",
                        selectedPath === file.pairedSummary &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <FileTextIcon className="size-3.5" />
                      <span className="truncate font-mono">summary.md</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </nav>
  )
}

function groupFiles(files: WebResearchFile[]): Section[] {
  const sections: Section[] = SECTION_DEFS.map((def) => ({
    ...def,
    files: [],
  }))
  const other: WebResearchFile[] = []
  outer: for (const file of files) {
    if (!file.path.includes("/")) {
      sections[0].files.push(file)
      continue
    }
    // skip files paired as a summary — they show as a child of their PDF
    for (const f of files) {
      if (f.pairedSummary === file.path) {
        continue outer
      }
    }
    for (const section of sections) {
      if (section.prefix && file.path.startsWith(section.prefix)) {
        section.files.push(file)
        continue outer
      }
    }
    other.push(file)
  }
  if (other.length > 0) {
    sections.push({ label: "Other", prefix: null, files: other })
  }
  return sections
}

function displayName(file: WebResearchFile, section: Section): string {
  if (!section.prefix) return file.name
  return file.path.startsWith(section.prefix)
    ? file.path.slice(section.prefix.length)
    : file.name
}

function FileIconFor({ kind }: { kind: WebResearchFile["kind"] }) {
  switch (kind) {
    case "pdf":
      return <BookOpenIcon className="size-3.5" />
    case "markdown":
      return <FileTextIcon className="size-3.5" />
    case "image-png":
    case "image-svg":
    case "image-other":
      return <ImageIcon className="size-3.5" />
    case "json":
      return <BracesIcon className="size-3.5" />
    case "text":
      return <BookmarkIcon className="size-3.5" />
    default:
      return <FileIcon className="size-3.5" />
  }
}
