import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';
import { ReactNode } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

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
        className="bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300 px-1 py-0.5 rounded font-medium"
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

// Custom syntax highlighter style based on OneDark but with better contrast
const customStyle = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]'],
    background: '#1e293b',
    margin: 0,
    padding: '1rem',
    borderRadius: '0.5rem',
  },
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]'],
    background: 'transparent',
  },
};

/**
 * Preprocesses content to normalize bullet points and other formatting.
 * Converts various bullet characters to proper markdown list syntax.
 */
function preprocessContent(content: string): string {
  // Convert bullet characters to proper markdown list syntax
  // Match lines starting with bullet characters (•, ◦, ▪, ▸, ►, ●, ○, etc.)
  // and convert them to markdown list items
  return content
    .replace(/^[\s]*[•◦▪▸►●○‣⁃]\s*/gm, '- ')
    // Also handle lines that start with "• " in the middle of text
    .replace(/\n[\s]*[•◦▪▸►●○‣⁃]\s*/g, '\n- ');
}

/**
 * Renders markdown content with proper styling for chat messages.
 * Supports:
 * - Syntax highlighted code blocks
 * - LaTeX math equations (inline $...$ and block $$...$$)
 * - @mentions
 * - All standard markdown formatting
 */
export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const processedContent = preprocessContent(content);
  
  return (
    <ReactMarkdown
      className={clsx('markdown-content', className)}
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // Headings
        h1: ({ children }) => (
          <h1 className="text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-gray-100">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-bold mt-3 mb-2 text-gray-900 dark:text-gray-100">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold mt-2 mb-1 text-gray-800 dark:text-gray-200">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold mt-2 mb-1 text-gray-800 dark:text-gray-200">{children}</h4>
        ),
        
        // Paragraphs - with @mention highlighting
        p: ({ children }) => (
          <p className="mb-2 last:mb-0 leading-relaxed text-gray-900 dark:text-gray-100">{processChildren(children)}</p>
        ),
        
        // Lists
        ul: ({ children }) => (
          <ul className="list-disc list-outside ml-5 mb-2 space-y-1 text-gray-900 dark:text-gray-100">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside ml-5 mb-2 space-y-1 text-gray-900 dark:text-gray-100">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="pl-1 text-gray-900 dark:text-gray-100">{processChildren(children)}</li>
        ),
        
        // Inline formatting - with @mention highlighting
        strong: ({ children }) => (
          <strong className="font-bold text-gray-900 dark:text-gray-100">{processChildren(children)}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-gray-700 dark:text-gray-300">{processChildren(children)}</em>
        ),
        
        // Handle plain text nodes
        text: ({ children }) => <>{processChildren(children)}</>,
        
        // Code - with syntax highlighting
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : '';
          const codeString = String(children).replace(/\n$/, '');
          
          // Check if it's a code block or inline code
          const isInline = !className && !codeString.includes('\n') && codeString.length < 80;
          
          if (isInline) {
            // Inline code - pink on light gray
            return (
              <code className="bg-slate-200 dark:bg-slate-700 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-sm font-mono">
                {children}
              </code>
            );
          }
          
          // Code block with syntax highlighting
          return (
            <div className="my-3 rounded-lg overflow-hidden border border-slate-600 shadow-md">
              {language && (
                <div className="bg-slate-700 px-3 py-1 text-xs text-slate-300 font-mono border-b border-slate-600">
                  {language}
                </div>
              )}
              <SyntaxHighlighter
                style={customStyle}
                language={language || 'text'}
                PreTag="div"
                customStyle={{
                  margin: 0,
                  background: '#1e293b',
                  fontSize: '0.875rem',
                }}
                codeTagProps={{
                  style: {
                    fontFamily: 'Monaco, Menlo, Consolas, "Courier New", monospace',
                  }
                }}
              >
                {codeString}
              </SyntaxHighlighter>
            </div>
          );
        },
        
        // Pre wraps code blocks - let the code component handle styling
        pre: ({ children }) => <>{children}</>,
        
        // Links
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            {children}
          </a>
        ),
        
        // Blockquotes
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-purple-400 dark:border-purple-500 pl-4 my-3 py-1 bg-purple-50 dark:bg-purple-900/20 rounded-r-lg text-gray-700 dark:text-gray-300 italic">
            {children}
          </blockquote>
        ),
        
        // Horizontal rule
        hr: () => <hr className="my-4 border-gray-300 dark:border-gray-600" />,
        
        // Tables
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-100 dark:bg-gray-800">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">{children}</tbody>
        ),
        tr: ({ children }) => (
          <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-300 dark:border-gray-600">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
            {children}
          </td>
        ),
      }}
    >
      {processedContent}
    </ReactMarkdown>
  );
}
