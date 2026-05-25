import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"

interface MarkdownMessageProps {
  content: string
  resolveLink?: (href: string) => string
  resolveImage?: (src: string) => string
  className?: string
}

export function MarkdownMessage({
  content,
  resolveLink,
  resolveImage,
  className,
}: MarkdownMessageProps) {
  return (
    <article
      className={
        className ??
        "markdown-body prose prose-sm max-w-none break-words dark:prose-invert"
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          a: ({ href, children, ...rest }) => {
            const external = href ? /^[a-z]+:/iu.test(href) : false
            const resolved = href && resolveLink ? resolveLink(href) : href
            return (
              <a
                href={resolved}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
                {...rest}
              >
                {children}
              </a>
            )
          },
          img: ({ src, alt, ...rest }) => {
            const finalSrc =
              typeof src === "string" && resolveImage ? resolveImage(src) : src
            return <img src={finalSrc} alt={alt ?? ""} loading="lazy" {...rest} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
