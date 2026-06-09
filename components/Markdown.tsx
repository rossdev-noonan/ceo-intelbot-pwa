"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Dark-theme markdown styling for IntelBot answers (GFM tables, code, etc.).
const components: Components = {
  h1: (p) => <h1 className="text-xl font-semibold mt-4 mb-2 text-[#e6eefb]" {...p} />,
  h2: (p) => <h2 className="text-lg font-semibold mt-4 mb-2 text-[#e6eefb]" {...p} />,
  h3: (p) => <h3 className="text-base font-semibold mt-3 mb-1.5 text-[#dbe6f5]" {...p} />,
  p: (p) => <p className="my-2 leading-relaxed" {...p} />,
  ul: (p) => <ul className="my-2 ml-5 list-disc space-y-1" {...p} />,
  ol: (p) => <ol className="my-2 ml-5 list-decimal space-y-1" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-[#eaf1fb]" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  a: (p) => (
    <a
      className="text-[#6db3f2] underline underline-offset-2 hover:text-[#9ccbf7] break-words"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  blockquote: (p) => (
    <blockquote className="my-3 border-l-2 border-[#3a4a63] pl-3 text-[#b6c4d8]" {...p} />
  ),
  hr: () => <hr className="my-4 border-[#1c2838]" />,
  code: ({ className, children, ...rest }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded bg-[#0b121c] px-1.5 py-0.5 text-[13px] font-mono text-[#cfe0f5]" {...rest}>
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
      className="my-3 overflow-x-auto rounded-lg bg-[#0b121c] border border-[#1c2838] p-3 text-[13px]"
      {...p}
    />
  ),
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-[#13202f]" {...p} />,
  th: (p) => (
    <th className="border border-[#243449] px-3 py-2 text-left font-semibold text-[#dbe6f5]" {...p} />
  ),
  td: (p) => <td className="border border-[#243449] px-3 py-2 align-top" {...p} />,
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] text-[#cdd9e8]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
