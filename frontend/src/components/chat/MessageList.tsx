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

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slack-active" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
          <p>No messages yet</p>
          <p className="text-sm">Be the first to say something!</p>
        </div>
      </div>
    );
  }

  // Group messages by date
  const groupedMessages = groupMessagesByDate(messages);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
      {hasMore && (
        <div className="text-center py-4">
          <button
            onClick={onLoadMore}
            className="text-sm text-slack-active hover:underline"
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
  const ceoProfile = useUIStore((state) => state.ceoProfile);
  
  const time = new Date(message.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isFromCEO = !message.agent_id;
  const senderName = isFromCEO ? `${ceoProfile.name} (You)` : agent?.name || message.agent_name || 'Unknown';
  const avatarSrc = isFromCEO ? ceoProfile.photoUrl : agent?.profile_image_url;

  return (
    <div
      className={clsx(
        'group relative py-1 hover:bg-gray-50 -mx-4 px-4 rounded',
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
                  isFromCEO && 'text-slack-active',
                  agent && 'hover:underline cursor-pointer'
                )}
              >
                {senderName}
              </button>
              {agent?.role && (
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  {agent.role.toUpperCase()}
                </span>
              )}
              <span className="text-xs text-gray-400">{time}</span>
            </div>
            <div className="message-content text-gray-900">
                <MarkdownContent content={message.content} />
              </div>
            {message.reply_count > 0 && (
              <button
                onClick={() => onThreadClick?.(message.id)}
                className="flex items-center gap-1 text-sm text-slack-active hover:underline mt-1"
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
            <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100">
              {time}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="message-content text-gray-900">
                <MarkdownContent content={message.content} />
              </div>
          </div>
        </div>
      )}

      {/* Message actions */}
      <div className="absolute right-4 top-0 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded shadow-sm">
          <button
            className="p-1 hover:bg-gray-100 rounded"
            onClick={() => onThreadClick?.(message.id)}
          >
            <MessageSquare className="w-4 h-4 text-gray-500" />
          </button>
          <button className="p-1 hover:bg-gray-100 rounded">
            <MoreHorizontal className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <div className="flex-1 border-t border-gray-200" />
      <span className="text-sm font-medium text-gray-500 bg-white px-2">{date}</span>
      <div className="flex-1 border-t border-gray-200" />
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
