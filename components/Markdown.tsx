"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Dark-theme markdown styling for IntelBot answers (GFM tables, code, etc.).
const components: Components = {
  h1: (p) => <h1 className="text-xl font-semibold mt-4 mb-2 text-[var(--text-strong)]" {...p} />,
  h2: (p) => <h2 className="text-lg font-semibold mt-4 mb-2 text-[var(--text-strong)]" {...p} />,
  h3: (p) => <h3 className="text-base font-semibold mt-3 mb-1.5 text-[var(--text)]" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 ml-5 list-disc space-y-1" {...p} />,
  ol: (p) => <ol className="my-2 ml-5 list-decimal space-y-1" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-[var(--text-strong)]" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  a: (p) => (
    <a
      className="text-[var(--accent-text)] underline underline-offset-2 hover:text-[var(--accent-text)] break-words"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote className="my-3 border-l-2 border-[var(--border-2)] pl-3 text-[var(--muted)]" {...p} />
  ),
  hr: () => <hr className="my-4 border-[var(--border)]" />,
  code: ({ className, children, ...rest }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[13px] font-mono text-[var(--text)]" {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className={`font-mono text-[13px] ${className ?? ""}`} {...rest}>
        {children}
      </code>
    );
  },
  pre: (p) => (
    <pre
      className="my-3 overflow-x-auto rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 text-[13px]"
      {...p}
    />
  ),
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-[var(--hover)]" {...p} />,
  th: (p) => (
    <th className="border border-[var(--border-2)] px-3 py-2 text-left font-semibold text-[var(--text)]" {...p} />
  ),
  td: (p) => <td className="border border-[var(--border-2)] px-3 py-2 align-top" {...p} />,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] text-[var(--text)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
