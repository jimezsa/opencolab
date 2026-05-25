import { useMemo } from "react"
import { PdfViewer as GenericPdfViewer } from "@/components/pdf/pdf-viewer"
import { researchFileUrl } from "@/lib/api"

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
  return <GenericPdfViewer fileUrl={fileUrl} sizeBytes={sizeBytes} />
}
