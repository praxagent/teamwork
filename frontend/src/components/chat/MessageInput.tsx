import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import { Send, Paperclip, AtSign, Smile, Code, Loader2 } from 'lucide-react';
import { useUIStore } from '@/stores';
import type { Agent } from '@/types';

interface MessageInputProps {
  channelName: string;
  channelId?: string;
  agents?: Agent[];
  onSend: (content: string) => void;
  onCodeRequest?: (agentId: string, request: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

function TypingIndicatorInline({ channelId }: { channelId?: string }) {
  const typingAgents = useUIStore((state) => 
    channelId ? state.typingAgents[channelId] || [] : []
  );
  const darkMode = useUIStore((state) => state.darkMode);

  if (typingAgents.length === 0) {
    return null;
  }

  const names = typingAgents.map((a) => a.agent_name.split(' ')[0]); // First names only
  
  let typingText: string;
  if (names.length === 1) {
    typingText = `${names[0]} is typing`;
  } else if (names.length === 2) {
    typingText = `${names[0]} and ${names[1]} are typing`;
  } else {
    typingText = `${names.length} people are typing`;
  }

  const textColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const dotColor = darkMode ? 'bg-gray-500' : 'bg-gray-400';

  return (
    <div className={`flex items-center gap-1.5 text-xs mr-2 ${textColor}`}>
      <div className="flex gap-0.5">
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '0ms', animationDuration: '1s' }} />
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '150ms', animationDuration: '1s' }} />
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '300ms', animationDuration: '1s' }} />
      </div>
      <span className="italic whitespace-nowrap">{typingText}</span>
    </div>
  );
}

export function MessageInput({
  channelName,
  channelId,
  agents = [],
  onSend,
  onCodeRequest,
  disabled,
  placeholder,
}: MessageInputProps) {
  const [content, setContent] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isExecutingCode, setIsExecutingCode] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  // Check if message mentions a developer and contains coding keywords
  const getMentionedDeveloper = (): Agent | null => {
    const devKeywords = ['implement', 'create', 'build', 'write', 'code', 'make', 'add', 'fix', 'update', 'develop'];
    const hasCodeKeyword = devKeywords.some(kw => content.toLowerCase().includes(kw));
    
    if (!hasCodeKeyword) return null;
    
    // Find mentioned agent
    for (const agent of agents) {
      if (content.includes(`@${agent.name}`)) {
        // Check if they're a developer-ish role
        const role = agent.role?.toLowerCase() || '';
        if (role.includes('developer') || role.includes('engineer') || role.includes('dev')) {
          return agent;
        }
      }
    }
    return null;
  };

  const mentionedDeveloper = getMentionedDeveloper();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [content]);

  const handleSend = () => {
    if (!content.trim() || disabled) return;
    onSend(content.trim());
    setContent('');
    setShowMentions(false);
  };

  const handleCodeRequest = async () => {
    if (!mentionedDeveloper || !onCodeRequest || !content.trim()) return;
    
    setIsExecutingCode(true);
    try {
      // First send the message so it appears in chat
      onSend(content.trim());
      // Then trigger code execution
      await onCodeRequest(mentionedDeveloper.id, content.trim());
      setContent('');
    } catch (error) {
      console.error('Code execution failed:', error);
    } finally {
      setIsExecutingCode(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) =>
          Math.min(prev + 1, filteredAgents.length - 1)
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (filteredAgents[selectedMentionIndex]) {
          insertMention(filteredAgents[selectedMentionIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // Check for @ mentions
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      const hasSpaceAfterAt = textAfterAt.includes(' ');

      if (!hasSpaceAfterAt && lastAtIndex === value.length - 1 - textAfterAt.length) {
        setShowMentions(true);
        setMentionFilter(textAfterAt);
        setSelectedMentionIndex(0);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (agent: Agent) => {
    const lastAtIndex = content.lastIndexOf('@');
    const newContent = content.slice(0, lastAtIndex) + `@${agent.name} `;
    setContent(newContent);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const darkMode = useUIStore((state) => state.darkMode);
  
  // Explicit colors based on dark mode
  const containerBg = darkMode ? 'bg-slate-900' : 'bg-white';
  const popupBg = darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200';
  const popupHeaderBg = darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-50 text-gray-500';
  const popupItemBg = darkMode ? 'hover:bg-slate-700 text-gray-100' : 'hover:bg-gray-100 text-gray-900';
  const popupItemRole = darkMode ? 'text-gray-500' : 'text-gray-400';
  const inputContainerBorder = darkMode ? 'border-slate-600 focus-within:border-slate-500 focus-within:ring-slate-500' : 'border-gray-300 focus-within:border-gray-400 focus-within:ring-gray-400';
  const inputContainerBg = darkMode ? 'bg-slate-800' : 'bg-white';
  const inputTextColor = darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400';
  const toolbarBorder = darkMode ? 'border-slate-700' : 'border-gray-100';
  const toolbarButtonColor = darkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100';
  const sendButtonInactive = darkMode ? 'bg-slate-700 text-gray-500' : 'bg-gray-100 text-gray-400';

  return (
    <div className={`px-4 pb-4 ${containerBg}`}>
      <div className="relative">
        {/* Mention popup */}
        {showMentions && filteredAgents.length > 0 && (
          <div className={`absolute bottom-full left-0 w-64 mb-2 border rounded-lg shadow-lg overflow-hidden ${popupBg}`}>
            <div className={`px-3 py-2 text-xs font-medium ${popupHeaderBg}`}>
              Team Members
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  onClick={() => insertMention(agent)}
                  className={clsx(
                    'w-full px-3 py-2 flex items-center gap-2 text-left',
                    index === selectedMentionIndex
                      ? 'bg-slack-active text-white'
                      : popupItemBg
                  )}
                >
                  <span className="font-medium">{agent.name}</span>
                  <span
                    className={clsx(
                      'text-xs',
                      index === selectedMentionIndex ? 'text-white/70' : popupItemRole
                    )}
                  >
                    {agent.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input container */}
        <div className={`border rounded-lg focus-within:ring-1 ${inputContainerBorder} ${inputContainerBg}`}>
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || `Message #${channelName}`}
            disabled={disabled}
            rows={1}
            className={`w-full px-3 py-2 resize-none bg-transparent focus:outline-none disabled:opacity-50 ${inputTextColor}`}
          />

          {/* Bottom toolbar */}
          <div className={`flex items-center justify-between px-2 py-1 border-t ${toolbarBorder}`}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`p-1.5 rounded ${toolbarButtonColor}`}
                title="Attach file"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={`p-1.5 rounded ${toolbarButtonColor}`}
                title="Mention someone"
                onClick={() => {
                  setContent(content + '@');
                  setShowMentions(true);
                  setMentionFilter('');
                  textareaRef.current?.focus();
                }}
              >
                <AtSign className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={`p-1.5 rounded ${toolbarButtonColor}`}
                title="Add emoji"
              >
                <Smile className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              {/* Typing indicator - shows who's typing */}
              <TypingIndicatorInline channelId={channelId} />
              
              {/* Code button - appears when mentioning a developer with coding keywords */}
              {mentionedDeveloper && onCodeRequest && (
                <button
                  onClick={handleCodeRequest}
                  disabled={!content.trim() || disabled || isExecutingCode}
                  className={clsx(
                    'px-2 py-1 rounded transition-colors text-xs font-medium flex items-center gap-1',
                    'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                  )}
                  title={`Ask ${mentionedDeveloper.name} to code this`}
                >
                  {isExecutingCode ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Code className="w-3 h-3" />
                  )}
                  Code it
                </button>
              )}
              
              <button
                onClick={handleSend}
                disabled={!content.trim() || disabled}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  content.trim()
                    ? 'bg-slack-active text-white hover:bg-blue-700'
                    : sendButtonInactive
                )}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
