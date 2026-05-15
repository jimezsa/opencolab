import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { researchFileUrl } from "@/lib/api"

interface MarkdownViewerProps {
  projectId: string
  runId: string
  filePath: string
}

export function MarkdownViewer({
  projectId,
  runId,
  filePath,
}: MarkdownViewerProps) {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error"
    content: string
    error: string | null
  }>({ status: "loading", content: "", error: null })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading", content: "", error: null })
    fetch(researchFileUrl(projectId, runId, filePath))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return response.text()
      })
      .then((content) => {
        if (cancelled) return
        setState({ status: "ready", content, error: null })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: "error",
          content: "",
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [projectId, runId, filePath])

  if (state.status === "loading") {
    return <p className="text-muted-foreground text-xs">loading…</p>
  }
  if (state.status === "error") {
    return (
      <p className="text-destructive text-xs">failed to load: {state.error}</p>
    )
  }

  const baseDir = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : ""

  const resolveRef = (href: string): string => {
    if (!href) return href
    if (/^[a-z]+:/iu.test(href) || href.startsWith("#") || href.startsWith("//")) {
      return href
    }
    const joined = joinRelativePath(baseDir, href)
    return researchFileUrl(projectId, runId, joined)
  }

  return (
    <article className="markdown-body prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children, ...rest }) => {
            const finalHref = href ? resolveRef(href) : undefined
            const external = href ? /^[a-z]+:/iu.test(href) : false
            return (
              <a
                href={finalHref}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
                {...rest}
              >
                {children}
              </a>
            )
          },
          img: ({ src, alt, ...rest }) => {
            const finalSrc = typeof src === "string" ? resolveRef(src) : src
            return <img src={finalSrc} alt={alt} {...rest} />
          },
        }}
      >
        {state.content}
      </ReactMarkdown>
    </article>
  )
}

function joinRelativePath(baseDir: string, href: string): string {
  if (href.startsWith("/")) return href.slice(1)
  const parts = (baseDir ? baseDir.split("/") : []).filter((p) => p.length > 0)
  for (const segment of href.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join("/")
}
