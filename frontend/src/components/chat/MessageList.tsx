import { useRef, useCallback, useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { MessageSquare, Activity, FileText, Download, SmilePlus, AlertTriangle } from 'lucide-react';
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
  onTraceClick?: (traceId: string) => void;
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
  onTraceClick,
  loading,
  hasMore,
  onLoadMore,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const prevMessageCountRef = useRef(0);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Keep mutable refs for values used in the scroll handler so it stays stable
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);
  const onLoadMoreRef = useRef(onLoadMore);
  hasMoreRef.current = hasMore ?? false;
  loadingRef.current = loading ?? false;
  onLoadMoreRef.current = onLoadMore;

  // Which channel we've completed initial scroll for.
  const scrolledForChannelRef = useRef<string | undefined>(undefined);

  // --- Scroll positioning ---
  // Uses useEffect (fires AFTER paint, layout guaranteed final) instead of
  // useLayoutEffect which fires before paint when flex layout may not be
  // computed yet.  A brief flash is acceptable vs. never scrolling at all.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || messages.length === 0) return;

    const firstId = messages[0].id;
    const lastId = messages[messages.length - 1].id;

    // --- Initial scroll or channel change: snap to bottom ---
    if (scrolledForChannelRef.current !== channelId) {
      // Use setTimeout(0) to guarantee we run after ALL layout/paint/reflow.
      // This is the nuclear option — works even when flex parents haven't
      // finished computing heights during the initial effect pass.
      setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 0);
      scrolledForChannelRef.current = channelId;
      prevFirstIdRef.current = firstId;
      prevLastIdRef.current = lastId;
      prevScrollHeightRef.current = el.scrollHeight;
      prevMessageCountRef.current = messages.length;
      isNearBottomRef.current = true;
      return;
    }

    const firstIdChanged = firstId !== prevFirstIdRef.current;
    const lastIdChanged = lastId !== prevLastIdRef.current;

    if (firstIdChanged && !lastIdChanged && messages.length > prevMessageCountRef.current) {
      // Older messages prepended → maintain viewport position
      const addedHeight = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop += addedHeight;
    } else if (lastIdChanged && isNearBottomRef.current) {
      // New message at bottom + user was near bottom → snap to it
      el.scrollTop = el.scrollHeight;
    }

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevScrollHeightRef.current = el.scrollHeight;
    prevMessageCountRef.current = messages.length;
  }, [messages, channelId]);

  // Stable scroll handler — tracks near-bottom and triggers older message loading
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

    // Load older messages when user scrolls near the top
    if (
      el.scrollTop < 200 &&
      hasMoreRef.current &&
      !loadingRef.current &&
      onLoadMoreRef.current
    ) {
      onLoadMoreRef.current();
    }
  }, []);

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
    <div
      ref={containerRef}
      className={`flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-3 ${containerBg}`}
      onScroll={handleScroll}
    >
      {/* Loading spinner when fetching older messages */}
      {loading && hasMore && (
        <div className="flex justify-center py-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-tw-accent" />
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
                onTraceClick={onTraceClick}
              />
            );
          })}
        </div>
      ))}
      {/* Bottom sentinel — used for scroll detection */}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

interface MessageItemProps {
  message: Message;
  agent: Agent | null | undefined;
  showHeader: boolean;
  onThreadClick?: (messageId: string) => void;
  onAgentClick?: (agent: Agent) => void;
  onTraceClick?: (traceId: string) => void;
}

function MessageItem({ message, agent, showHeader, onThreadClick, onAgentClick, onTraceClick }: MessageItemProps) {
  const userProfile = useUIStore((state) => state.userProfile);
  const darkMode = useUIStore((state) => state.darkMode);
  const toggleReaction = useToggleReaction();
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  // Timestamps from the DB are UTC but lack a 'Z' suffix — append it
  // so JavaScript parses them correctly and toLocaleTimeString converts
  // to the user's local timezone.
  const utcTimestamp = message.created_at.endsWith('Z') || message.created_at.includes('+')
    ? message.created_at
    : message.created_at + 'Z';
  const time = new Date(utcTimestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const attachments = (message.extra_data?.attachments as Attachment[] | undefined) || [];
  const reactions = (message.extra_data?.reactions as Record<string, string[]>) || {};

  const handleReact = (emoji: string) => {
    const userName = userProfile.name || 'You';
    toggleReaction.mutate({ messageId: message.id, emoji, userName });
  };

  const isSystemMessage = message.message_type === 'system';

  // System/error messages get a distinct banner style.
  if (isSystemMessage) {
    const systemBg = darkMode ? 'bg-red-900/30 border-red-800/50' : 'bg-red-50 border-red-200';
    const systemText = darkMode ? 'text-red-300' : 'text-red-700';
    const systemIcon = darkMode ? 'text-red-400' : 'text-red-500';
    // Strip the "[System] " prefix if present — the icon already conveys it.
    const displayContent = message.content.replace(/^\[System\]\s*/i, '');
    return (
      <div className={clsx('py-2 -mx-4 px-4 mt-3')}>
        <div className={clsx(
          'flex items-start gap-2.5 px-3 py-2 rounded-lg border',
          systemBg,
        )}>
          <AlertTriangle className={clsx('w-4 h-4 flex-shrink-0 mt-0.5', systemIcon)} />
          <div className="flex-1 min-w-0">
            <span className={clsx('text-sm', systemText)}>{displayContent}</span>
            <span className={clsx('text-xs ml-2', darkMode ? 'text-red-400/60' : 'text-red-400')}>
              {time}
            </span>
          </div>
        </div>
      </div>
    );
  }

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
                const traceId = String(message.extra_data!.trace_id);
                if (onTraceClick) {
                  onTraceClick(traceId);
                } else {
                  // Fallback: open Grafana Tempo if no handler provided
                  const meta = message.extra_data as Record<string, string>;
                  const url = meta.grafana_trace_url ||
                    `http://localhost:3001/explore?left=%7B%22datasource%22:%22tempo%22,%22queries%22:%5B%7B%22query%22:%22${traceId}%22%7D%5D%7D`;
                  window.open(url, '_blank', 'noopener');
                }
              }}
              title={`View trace ${String(message.extra_data.trace_id)}`}
            >
              <Activity className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            </button>
          ) : null}
          {onThreadClick && (
            <button
              className={`p-1 rounded ${actionsHoverBg}`}
              onClick={() => onThreadClick(message.id)}
            >
              <MessageSquare className={`w-4 h-4 ${actionsIconColor}`} />
            </button>
          )}
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
  const audio = attachments.filter(a => a.content_type.startsWith('audio/'));
  const video = attachments.filter(a => a.content_type.startsWith('video/'));
  const files = attachments.filter(a =>
    !a.content_type.startsWith('image/') &&
    !a.content_type.startsWith('audio/') &&
    !a.content_type.startsWith('video/')
  );

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
      {audio.map(a => (
        <div key={a.id} className={clsx(
          'flex items-center gap-3 p-3 rounded-lg max-w-md',
          darkMode ? 'bg-slate-700/60' : 'bg-gray-100'
        )}>
          <div className="flex-1 min-w-0">
            <p className={clsx('text-sm font-medium truncate', darkMode ? 'text-gray-200' : 'text-gray-700')}>
              {a.name}
            </p>
            <audio controls preload="metadata" className="w-full mt-1.5" style={{ height: 32 }}>
              <source src={a.url} type={a.content_type} />
            </audio>
          </div>
          <a href={a.url} download={a.name} className="shrink-0 p-1.5 rounded hover:bg-black/10 transition-colors">
            <Download className="w-4 h-4 opacity-50" />
          </a>
        </div>
      ))}
      {video.map(v => (
        <div key={v.id} className="max-w-lg">
          <video controls preload="metadata" className="w-full rounded-lg">
            <source src={v.url} type={v.content_type} />
          </video>
          <div className={clsx('flex items-center gap-2 mt-1 text-xs', darkMode ? 'text-gray-400' : 'text-gray-500')}>
            <span className="truncate">{v.name}</span>
            <span>{sizeLabel(v.size)}</span>
            <a href={v.url} download={v.name} className="ml-auto hover:text-tw-accent">
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      ))}
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
