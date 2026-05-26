import { useCallback, useEffect, useRef, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { Maximize2Icon, MinimizeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

const MAX_INLINE_BYTES = 50 * 1024 * 1024

interface PdfViewerProps {
  fileUrl: string
  sizeBytes?: number
  /** Optional URL the "Open raw" affordance points at; falls back to fileUrl. */
  rawUrl?: string
}

export function PdfViewer({ fileUrl, sizeBytes, rawUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
    setError(null)
  }, [])

  const onLoadError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) setContainerWidth(rect.width)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fullscreen])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fullscreen])

  if (typeof sizeBytes === "number" && sizeBytes > MAX_INLINE_BYTES) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-xs">
          PDF is larger than 50 MB. Open in a new tab to view.
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={rawUrl ?? fileUrl} target="_blank" rel="noreferrer noopener">
            Open PDF
          </a>
        </Button>
      </div>
    )
  }

  const pageWidth = containerWidth ? Math.max(120, containerWidth * scale) : undefined

  const body = (
    <>
      <div className="flex w-full items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="ghost"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Prev
        </Button>
        <span className="font-mono">
          {page} / {numPages ?? "…"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={numPages !== null && page >= numPages}
          onClick={() =>
            setPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))
          }
        >
          Next
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          >
            −
          </Button>
          <span className="font-mono">{Math.round(scale * 100)}%</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.25))}
          >
            +
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {fullscreen ? (
              <MinimizeIcon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={rawUrl ?? fileUrl} target="_blank" rel="noreferrer noopener">
              Open
            </a>
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="w-full flex-1 overflow-auto flex justify-center"
      >
        {error ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            loading={
              <p className="text-muted-foreground text-xs">loading PDF…</p>
            }
          >
            <Page
              pageNumber={page}
              width={pageWidth}
              renderTextLayer={false}
            />
          </Document>
        )}
      </div>
    </>
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-background/95 p-4 supports-backdrop-filter:backdrop-blur-sm">
        {body}
      </div>
    )
  }

  return <div className="flex h-full w-full flex-col gap-2">{body}</div>
}
