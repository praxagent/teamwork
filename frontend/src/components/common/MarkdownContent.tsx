import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';
import { ReactNode } from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Highlights @mentions in text content.
 * Returns an array of strings and React elements.
 * 
 * Matches:
 * - @CEO
 * - @Alex (single capitalized name)
 * - @Alex Chen (first + last name, both capitalized)
 */
function highlightMentions(text: string): ReactNode[] {
  // Match @Word or @Word Word where words start with capital letter
  // This prevents matching regular words after the name
  const mentionRegex = /@([A-Z][a-z]*(?:\s+[A-Z][a-z]*)?)/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(text)) !== null) {
    // Add text before the mention
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    // Add the highlighted mention
    parts.push(
      <span
        key={match.index}
        className="bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded font-medium"
      >
        @{match[1]}
      </span>
    );
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : [text];
}

/**
 * Process children to highlight @mentions in text nodes.
 */
function processChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') {
    const parts = highlightMentions(children);
    return parts.length === 1 && typeof parts[0] === 'string' 
      ? children 
      : <>{parts}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{processChildren(child)}</span>
    ));
  }
  return children;
}

/**
 * Renders markdown content with proper styling for chat messages.
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className={clsx('markdown-content', className)}
      components={{
        // Headings
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-3 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-bold mt-2 mb-1">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-2 mb-1">{children}</h3>
        ),
        
        // Paragraphs - with @mention highlighting
        p: ({ children }) => (
          <p className="mb-2 last:mb-0">{processChildren(children)}</p>
        ),
        
        // Lists
        ul: ({ children }) => (
          <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="ml-2">{processChildren(children)}</li>
        ),
        
        // Inline formatting - with @mention highlighting
        strong: ({ children }) => (
          <strong className="font-bold">{processChildren(children)}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-gray-700">{processChildren(children)}</em>
        ),
        
        // Handle plain text nodes
        text: ({ children }) => <>{processChildren(children)}</>,
        
        // Code
        code: ({ className, children }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            );
          }
          return (
            <code className="block bg-gray-900 text-gray-100 p-3 rounded-md text-sm font-mono overflow-x-auto my-2">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-2">{children}</pre>
        ),
        
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slack-active hover:underline"
          >
            {children}
          </a>
        ),
        
        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-300 pl-3 my-2 text-gray-600 italic">
            {children}
          </blockquote>
        ),
        
        // Horizontal rule
        hr: () => <hr className="my-3 border-gray-200" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
