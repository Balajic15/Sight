import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({ content, isStreaming }) => {
  // Parse simple blocks: code fences, headings, lists, blockquotes, and paragraphs
  const blocks = React.useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="space-y-3 leading-relaxed text-[15px] break-words">
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          return <CodeBlock key={idx} language={block.language || "text"} code={block.content} />;
        }
        if (block.type === "heading") {
          const Tag = (
            block.level === 1 ? "h1" : block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4"
          ) as React.ElementType;
          const sizeClass =
            block.level === 1
              ? "text-xl font-bold mt-4 mb-2"
              : block.level === 2
                ? "text-lg font-semibold mt-3 mb-1.5"
                : "text-base font-semibold mt-2 mb-1";
          return (
            <Tag key={idx} className={`${sizeClass} text-foreground`}>
              <InlineText text={block.content} />
            </Tag>
          );
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={idx}
              className={`space-y-1 my-2 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} text-foreground`}
            >
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx} className="pl-1">
                  <InlineText text={item} />
                </li>
              ))}
            </ListTag>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-primary/50 pl-3 italic text-muted-foreground my-2"
            >
              <InlineText text={block.content} />
            </blockquote>
          );
        }
        // Regular paragraph
        return (
          <p key={idx} className="text-foreground">
            <InlineText text={block.content} />
          </p>
        );
      })}
    </div>
  );
};

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard error */
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-muted/60 text-xs font-mono">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/90 px-3.5 py-1.5 text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider">{language}</span>
        <button
          onClick={onCopy}
          type="button"
          aria-label="Copy code"
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors hover:bg-background hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-3 text-[13px] leading-relaxed text-foreground">
        <pre className="font-mono">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

// Inline parser for bold, italics, inline code, and links
function InlineText({ text }: { text: string }) {
  // Regex splitting on code, bold, italics, links
  const elements = React.useMemo(() => {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Inline code `code`
      const codeMatch = remaining.match(/^`([^`]+)`/);
      if (codeMatch) {
        parts.push(
          <code
            key={key++}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground border border-border/40"
          >
            {codeMatch[1]}
          </code>,
        );
        remaining = remaining.slice(codeMatch[0].length);
        continue;
      }

      // Bold **bold**
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        parts.push(
          <strong key={key++} className="font-semibold text-foreground">
            {boldMatch[1]}
          </strong>,
        );
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italics *italic* or _italic_
      const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/);
      if (italicMatch) {
        parts.push(
          <em key={key++} className="italic text-foreground">
            {italicMatch[2]}
          </em>,
        );
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Link [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {linkMatch[1]}
          </a>,
        );
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // Plain text up to next special char
      const nextSpecial = remaining.search(/[`*_[]/);
      if (nextSpecial === -1) {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      } else if (nextSpecial === 0) {
        // Special character didn't match full pattern, emit single char
        parts.push(<span key={key++}>{remaining[0]}</span>);
        remaining = remaining.slice(1);
      } else {
        parts.push(<span key={key++}>{remaining.slice(0, nextSpecial)}</span>);
        remaining = remaining.slice(nextSpecial);
      }
    }

    return parts;
  }, [text]);

  return <>{elements}</>;
}

type Block =
  | { type: "code"; language: string; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; content: string }
  | { type: "paragraph"; content: string };

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split(/\r?\n/);
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let currentParagraph: string[] = [];
  let currentList: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({
        type: "paragraph",
        content: currentParagraph.join("\n"),
      });
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (currentList) {
      blocks.push({
        type: "list",
        ordered: currentList.ordered,
        items: currentList.items,
      });
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Code block toggle ```
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({
          type: "code",
          language: codeLang,
          content: codeBuffer.join("\n"),
        });
        codeBuffer = [];
        inCode = false;
        codeLang = "";
      } else {
        flushParagraph();
        flushList();
        inCode = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    // Empty line separates blocks
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    // Heading #, ##, ###
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        content: headingMatch[2]!,
      });
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "quote",
        content: line.replace(/^>\s?/, ""),
      });
      continue;
    }

    // List items - bullet or numbered
    const bulletMatch = line.match(/^[*+-]\s+(.+)$/);
    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      const ordered = !bulletMatch;
      const content = (bulletMatch ? bulletMatch[1] : orderedMatch![2])!;
      if (!currentList || currentList.ordered !== ordered) {
        flushList();
        currentList = { ordered, items: [content] };
      } else {
        currentList.items.push(content);
      }
      continue;
    }

    // Otherwise, accumulate in paragraph
    flushList();
    currentParagraph.push(line);
  }

  // Handle unclosed code block (e.g. streaming mid-code)
  if (inCode) {
    blocks.push({
      type: "code",
      language: codeLang,
      content: codeBuffer.join("\n"),
    });
  }

  flushList();
  flushParagraph();

  return blocks;
}
