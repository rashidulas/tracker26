'use client';

/**
 * Renders the assistant's markdown: GFM (tables, lists, task lists,
 * strikethrough), bold, code.
 *
 * - While a reply streams, `remend` closes half-finished markup (an unclosed
 *   `**bold`, a link still being written) so it renders instead of flashing
 *   raw asterisks.
 * - Output is sanitised twice over: raw HTML in the markdown is never parsed
 *   (react-markdown's default), and rehype-sanitize filters the resulting
 *   tree and link protocols. Images are not rendered at all, so text from a
 *   receipt or a note cannot make the page load a remote URL.
 */
import { memo } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remend from 'remend';

const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    const className = 'text-mint underline underline-offset-2 hover:text-mint-bright';
    return href.startsWith('/') ? (
      <Link href={href} className={className}>
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  },
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5 marker:text-ink-muted">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5 marker:text-ink-muted">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-lg font-semibold text-ink font-display">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink font-display">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold text-ink">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-4 mb-1.5 text-[15px] font-semibold text-ink">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-graphite-border pl-3 text-ink-secondary">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-graphite-border-subtle" />,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-graphite-border-subtle bg-graphite-elevated p-3 font-mono text-[13px] leading-relaxed text-ink [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded-md border border-graphite-border-subtle bg-graphite-surface-2 px-1.5 py-0.5 font-mono text-[0.86em] text-ink">
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-graphite-border-subtle mobile-table-scroll">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-graphite-surface-2 text-ink-secondary">{children}</thead>,
  th: ({ children, style }) => (
    <th style={style} className="whitespace-nowrap px-3 py-2 text-xs font-medium uppercase tracking-wide">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-t border-graphite-border-subtle px-3 py-2 align-top tabular-nums">
      {children}
    </td>
  ),
};

function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className="min-w-0 break-words text-[15px] leading-7 text-ink-secondary sm:text-base sm:leading-7">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
        disallowedElements={['img']}
      >
        {streaming ? remend(text) : text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
