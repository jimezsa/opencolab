import { useCallback, useMemo, useState } from "react"
import { Document, Page, pdfjs } from "react-pdf"
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"
import { Button } from "@/components/ui/button"
import { researchFileUrl } from "@/lib/api"

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

const MAX_INLINE_BYTES = 50 * 1024 * 1024

interface PdfViewerProps {
  projectId: string
  runId: string
  filePath: string
  sizeBytes: number
}

export function PdfViewer({
  projectId,
  runId,
  filePath,
  sizeBytes,
}: PdfViewerProps) {
  const fileUrl = useMemo(
    () => researchFileUrl(projectId, runId, filePath),
    [projectId, runId, filePath],
  )
  const [numPages, setNumPages] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n)
    setError(null)
  }, [])

  const onLoadError = useCallback((err: Error) => {
    setError(err.message)
  }, [])

  if (sizeBytes > MAX_INLINE_BYTES) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-xs">
          PDF is larger than 50 MB. Open in a new tab to view.
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={fileUrl} target="_blank" rel="noreferrer noopener">
            Open PDF
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-2">
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
        </div>
      </div>
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
          <Page pageNumber={page} scale={scale} renderTextLayer={false} />
        </Document>
      )}
    </div>
  )
}
