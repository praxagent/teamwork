import { useRef, useEffect, useCallback } from 'react';
import { clsx } from 'clsx';
import { MessageSquare, MoreHorizontal } from 'lucide-react';
import { Avatar, MarkdownContent } from '@/components/common';
import { useUIStore } from '@/stores';
import type { Message, Agent } from '@/types';

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slack-active" />
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
    <div className={`flex-1 overflow-y-auto px-4 py-2 ${containerBg}`}>
      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={onLoadMore}
            className={`text-sm hover:underline ${darkMode ? 'text-blue-400' : 'text-slack-active'}`}
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
  const userRole = useUIStore((state) => state.userRole);
  const darkMode = useUIStore((state) => state.darkMode);
  
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isFromUser = !message.agent_id;
  // For students, just show "Name (You)" or "You". For CEO, show "Name (You)" or "CEO (You)"
  const getUserDisplayName = () => {
    const name = userProfile.name || 'You';
    if (name === 'You' || name === 'CEO') {
      return userRole === 'student' ? 'You' : 'CEO (You)';
    }
    return `${name} (You)`;
  };
  const senderName = isFromUser ? getUserDisplayName() : agent?.name || message.agent_name || 'Unknown';
  const avatarSrc = isFromUser ? userProfile.photoUrl : agent?.profile_image_url;

  // Explicit colors based on dark mode
  const hoverBg = darkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-100/50';
  const timestampColor = darkMode ? 'text-gray-500' : 'text-gray-400';
  const senderColor = isFromUser 
    ? (darkMode ? 'text-blue-400' : 'text-slack-active') 
    : (darkMode ? 'text-gray-100' : 'text-gray-900');
  const roleTagBg = darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500';
  const messageTextColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const actionsBg = darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200';
  const actionsIconColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const actionsHoverBg = darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100';

  return (
    <div
      className={clsx(
        'group relative py-1 -mx-4 px-4 rounded',
        hoverBg,
        showHeader ? 'mt-4' : 'mt-0.5'
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
            {message.reply_count > 0 && (
              <button
                onClick={() => onThreadClick?.(message.id)}
                className={`flex items-center gap-1 text-sm hover:underline mt-1 ${darkMode ? 'text-blue-400' : 'text-slack-active'}`}
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
          </div>
        </div>
      )}

      {/* Message actions */}
      <div className="absolute right-4 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className={`flex items-center gap-1 border rounded shadow-sm ${actionsBg}`}>
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
