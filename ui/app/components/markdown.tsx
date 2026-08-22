import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";

function MarkdownLink({ node: _node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

const COMPONENTS = { a: MarkdownLink };

/**
 * Markdown for transcript and prompt content. That content is untrusted (issue
 * bodies flow through it — the pipeline's prompt-injection surface), so the
 * rendering stays hardened: react-markdown emits React elements and never raw
 * HTML, images are disabled (no remote beacons from a hostile issue body), and
 * links open in a new tab without a referrer.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("markdown min-w-0 text-xs leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
