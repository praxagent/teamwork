import { useRef, useEffect, useCallback, useState } from 'react';
import { clsx } from 'clsx';
import { MessageSquare, MoreHorizontal, Activity, FileText, Download, SmilePlus } from 'lucide-react';
import { Avatar, MarkdownContent } from '@/components/common';
import { useUIStore } from '@/stores';
import { useToggleReaction } from '@/hooks/useApi';
import { QuickReactions, ReactionDisplay } from './EmojiPicker';
import type { Message, Agent, Attachment } from '@/types';

interface MessageListProps {
  messages: Message[];
  agents: Agent[];
  channelId?: string; // Used to detect channel changes
  onThreadClick?: (messageId: string) => void;
  onAgentClick?: (agent: Agent) => void;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function MessageList({
  messages,
  agents,
  channelId,
  onThreadClick,
  onAgentClick,
  loading,
  hasMore,
  onLoadMore,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevChannelRef = useRef<string | undefined>(undefined);
  const prevMessageCountRef = useRef<number>(0);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Scroll to bottom - instant on channel change, smooth on new messages
  const scrollToBottom = useCallback((instant: boolean = false) => {
    bottomRef.current?.scrollIntoView({ behavior: instant ? 'auto' : 'smooth' });
  }, []);

  useEffect(() => {
    const channelChanged = prevChannelRef.current !== channelId;
    const hasNewMessages = messages.length > prevMessageCountRef.current;
    
    // Scroll instantly when switching channels, smooth when new messages arrive
    if (channelChanged) {
      // Instant scroll on channel change
      scrollToBottom(true);
    } else if (hasNewMessages) {
      // Smooth scroll for new messages
      scrollToBottom(false);
    }
    
    prevChannelRef.current = channelId;
    prevMessageCountRef.current = messages.length;
  }, [messages.length, channelId, scrollToBottom]);

  const darkMode = useUIStore((state) => state.darkMode);
  const containerBg = darkMode ? 'bg-slate-900' : 'bg-white';

  if (loading && messages.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${containerBg}`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tw-accent" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${containerBg} ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <div className="text-center">
          <MessageSquare className={`w-12 h-12 mx-auto mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
          <p>No messages yet</p>
          <p className="text-sm">Be the first to say something!</p>
        </div>
      </div>
    );
  }

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div className={`flex-1 overflow-y-auto px-5 py-3 ${containerBg}`}>
      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={onLoadMore}
            className={`text-sm hover:underline ${darkMode ? 'text-blue-400' : 'text-indigo-500'}`}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      )}

      {Object.entries(groupedMessages).map(([date, msgs]) => (
        <div key={date}>
          <DateDivider date={date} />
          {msgs.map((message, index) => {
            // Try to get agent from map, fall back to constructing from message data
            let agent = message.agent_id ? agentMap.get(message.agent_id) : null;
            
            // If agent not in map but message has agent info, create a minimal agent object
            if (!agent && message.agent_id && message.agent_name) {
              agent = {
                id: message.agent_id,
                project_id: '',
                name: message.agent_name,
                role: (message.agent_role?.toLowerCase() || 'developer') as 'pm' | 'developer' | 'qa',
                team: null,
                status: 'idle',
                persona: null,
                profile_image_type: null,
                profile_image_url: null,
                created_at: '',
              };
            }
            
            const prevMessage = index > 0 ? msgs[index - 1] : null;
            const showHeader = shouldShowHeader(message, prevMessage);

            return (
              <MessageItem
                key={message.id}
                message={message}
                agent={agent}
                showHeader={showHeader}
                onThreadClick={onThreadClick}
                onAgentClick={onAgentClick}
              />
            );
          })}
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  agent: Agent | null | undefined;
  showHeader: boolean;
  onThreadClick?: (messageId: string) => void;
  onAgentClick?: (agent: Agent) => void;
}

function MessageItem({ message, agent, showHeader, onThreadClick, onAgentClick }: MessageItemProps) {
  const userProfile = useUIStore((state) => state.userProfile);
  const darkMode = useUIStore((state) => state.darkMode);
  const toggleReaction = useToggleReaction();
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const attachments = (message.extra_data?.attachments as Attachment[] | undefined) || [];
  const reactions = (message.extra_data?.reactions as Record<string, string[]>) || {};

  const handleReact = (emoji: string) => {
    const userName = userProfile.name || 'You';
    toggleReaction.mutate({ messageId: message.id, emoji, userName });
  };

  const isFromUser = !message.agent_id;
  const getUserDisplayName = () => {
    const name = userProfile.name || 'You';
    if (name === 'You' || name === 'CEO') {
      return 'You';
    }
    return `${name} (You)`;
  };
  const senderName = isFromUser ? getUserDisplayName() : agent?.name || message.agent_name || 'Unknown';
  const avatarSrc = isFromUser ? userProfile.photoUrl : agent?.profile_image_url;

  // Explicit colors based on dark mode
  const hoverBg = darkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-100/50';
  const timestampColor = darkMode ? 'text-gray-500' : 'text-gray-400';
  const senderColor = isFromUser 
    ? (darkMode ? 'text-blue-400' : 'text-indigo-500') 
    : (darkMode ? 'text-gray-100' : 'text-gray-900');
  const roleTagBg = darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500';
  const messageTextColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const actionsBg = darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200';
  const actionsIconColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const actionsHoverBg = darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100';

  return (
    <div
      className={clsx(
        'group relative py-2 -mx-4 px-4 rounded-xl transition-colors',
        hoverBg,
        showHeader ? 'mt-5' : 'mt-0.5',
        !isFromUser && showHeader && (darkMode ? 'bg-slate-800/40' : 'bg-gray-50/80'),
      )}
    >
      {showHeader ? (
        <div className="flex gap-3 items-start">
          <button
            onClick={() => agent && onAgentClick?.(agent)}
            disabled={!agent}
            className={clsx(
              'flex-shrink-0 mt-0.5',
              agent && 'cursor-pointer hover:opacity-80 transition-opacity'
            )}
          >
            <Avatar
              name={senderName}
              src={avatarSrc || undefined}
              size="lg"
              status={agent?.status}
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <button
                onClick={() => agent && onAgentClick?.(agent)}
                disabled={!agent}
                className={clsx(
                  'font-bold text-left',
                  senderColor,
                  agent && 'hover:underline cursor-pointer'
                )}
              >
                {senderName}
              </button>
              {agent?.role && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${roleTagBg}`}>
                  {agent.role.toUpperCase()}
                </span>
              )}
              <span className={`text-xs ${timestampColor}`}>{time}</span>
            </div>
            <div className={`message-content ${messageTextColor}`}>
              <MarkdownContent content={message.content} />
            </div>
            {attachments.length > 0 && <AttachmentGrid attachments={attachments} darkMode={darkMode} />}
            <ReactionDisplay reactions={reactions} onToggle={handleReact} />
            {message.reply_count > 0 && (
              <button
                onClick={() => onThreadClick?.(message.id)}
                className={`flex items-center gap-1 text-sm hover:underline mt-1 ${darkMode ? 'text-blue-400' : 'text-indigo-500'}`}
              >
                <MessageSquare className="w-4 h-4" />
                {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="w-10 flex-shrink-0 text-right">
            <span className={`text-xs ${timestampColor} opacity-0 group-hover:opacity-100`}>
              {time}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className={`message-content ${messageTextColor}`}>
              <MarkdownContent content={message.content} />
            </div>
            {attachments.length > 0 && <AttachmentGrid attachments={attachments} darkMode={darkMode} />}
            <ReactionDisplay reactions={reactions} onToggle={handleReact} />
          </div>
        </div>
      )}

      {/* Message actions */}
      <div className="absolute right-4 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className={`flex items-center gap-1 border rounded shadow-sm ${actionsBg}`}>
          {/* Quick reactions */}
          <div className="relative">
            <button
              className={`p-1 rounded ${actionsHoverBg}`}
              onClick={() => setShowReactionPicker((v) => !v)}
              title="Add reaction"
            >
              <SmilePlus className={`w-4 h-4 ${actionsIconColor}`} />
            </button>
            {showReactionPicker && (
              <div className="absolute right-0 top-full mt-1 z-50">
                <QuickReactions onReact={(emoji) => { handleReact(emoji); setShowReactionPicker(false); }} />
              </div>
            )}
          </div>
          {/* Trace button — shown only for agent messages with trace metadata */}
          {message.extra_data?.trace_id ? (
            <button
              className={`p-1 rounded ${actionsHoverBg}`}
              onClick={() => {
                const meta = message.extra_data as Record<string, string>;
                const url = meta.grafana_trace_url ||
                  `http://localhost:3001/explore?left=%7B%22datasource%22:%22tempo%22,%22queries%22:%5B%7B%22query%22:%22${meta.trace_id}%22%7D%5D%7D`;
                window.open(url, '_blank', 'noopener');
              }}
              title={`View trace ${String(message.extra_data.trace_id)}`}
            >
              <Activity className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            </button>
          ) : null}
          <button
            className={`p-1 rounded ${actionsHoverBg}`}
            onClick={() => onThreadClick?.(message.id)}
          >
            <MessageSquare className={`w-4 h-4 ${actionsIconColor}`} />
          </button>
          <button className={`p-1 rounded ${actionsHoverBg}`}>
            <MoreHorizontal className={`w-4 h-4 ${actionsIconColor}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

function DateDivider({ date }: { date: string }) {
  const darkMode = useUIStore((state) => state.darkMode);
  const borderColor = darkMode ? 'border-slate-700' : 'border-gray-200';
  const textColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const bgColor = darkMode ? 'bg-slate-900' : 'bg-white';
  
  return (
    <div className="flex items-center gap-4 py-4">
      <div className={`flex-1 border-t ${borderColor}`} />
      <span className={`text-sm font-medium px-2 ${textColor} ${bgColor}`}>{date}</span>
      <div className={`flex-1 border-t ${borderColor}`} />
    </div>
  );
}

function groupMessagesByDate(messages: Message[]): Record<string, Message[]> {
  const groups: Record<string, Message[]> = {};

  messages.forEach((message) => {
    const date = new Date(message.created_at).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
  });

  return groups;
}

function shouldShowHeader(
  current: Message,
  previous: Message | null
): boolean {
  if (!previous) return true;
  if (current.agent_id !== previous.agent_id) return true;

  // Show header if more than 5 minutes apart
  const currentTime = new Date(current.created_at).getTime();
  const prevTime = new Date(previous.created_at).getTime();
  return currentTime - prevTime > 5 * 60 * 1000;
}

function AttachmentGrid({ attachments, darkMode }: { attachments: Attachment[]; darkMode: boolean }) {
  const images = attachments.filter(a => a.content_type.startsWith('image/'));
  const files = attachments.filter(a => !a.content_type.startsWith('image/'));

  const sizeLabel = (size: number) =>
    size < 1024 ? `${size} B`
    : size < 1024 * 1024 ? `${(size / 1024).toFixed(0)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(img => (
            <a key={img.id} href={img.url} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={img.url}
                alt={img.name}
                className="max-w-xs max-h-60 rounded-lg object-cover border border-transparent hover:border-tw-accent transition-colors"
              />
            </a>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map(file => (
            <a
              key={file.id}
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                darkMode
                  ? 'bg-slate-700/60 hover:bg-slate-700 text-gray-200'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              )}
            >
              <FileText className="w-4 h-4 shrink-0 opacity-60" />
              <span className="truncate max-w-[200px]">{file.name}</span>
              <span className="text-xs opacity-50">{sizeLabel(file.size)}</span>
              <Download className="w-3.5 h-3.5 opacity-40" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
