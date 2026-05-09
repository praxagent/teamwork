import { useEffect, useState, useRef, useCallback } from 'react';
import { Send, Globe, Monitor, TerminalSquare, FolderOpen, RotateCcw } from 'lucide-react';
import { useUIStore, useMessageStore } from '@/stores';
import {
  useMessages,
  useSendMessage,
  useGetOrCreateDMChannel,
  useGetOrCreatePanelChannel,
  useClearChannelMessages,
  useAgents,
} from '@/hooks/useApi';
import { useChannelSubscription } from '@/hooks/useWebSocket';
import { MessageList, TypingIndicatorInline } from '@/components/chat';
import type { Agent } from '@/types';

/** Map panel name to display label and icon. */
const PANEL_META: Record<string, { label: string; Icon: typeof Globe }> = {
  browser:  { label: 'Browser Chat',  Icon: Globe },
  desktop:  { label: 'Desktop Chat',  Icon: Monitor },
  terminal: { label: 'Terminal Chat', Icon: TerminalSquare },
  files:    { label: 'Files Chat',    Icon: FolderOpen },
};

interface BrowserChatSidebarProps {
  projectId: string;
  activeView?: string;
  onTraceClick?: (traceId: string) => void;
  contentContext?: { category: string; slug: string; title: string } | null;
  /** When set, uses a dedicated panel channel instead of the shared DM. */
  panel?: 'browser' | 'desktop' | 'terminal' | 'files';
}

export function BrowserChatSidebar({ projectId, activeView, onTraceClick, contentContext, panel }: BrowserChatSidebarProps) {
  const darkMode = useUIStore((s) => s.darkMode);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [width, setWidth] = useState(400);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: agentsData } = useAgents(projectId);
  const agents: Agent[] = agentsData?.agents || [];

  // --- Channel setup: panel-specific or legacy DM ---
  const getOrCreateDM = useGetOrCreateDMChannel();
  const getOrCreatePanel = useGetOrCreatePanelChannel();
  const clearMessages = useClearChannelMessages();

  const sendMessage = useSendMessage();
  const { data: messagesData } = useMessages(channelId);
  const storeMessages = useMessageStore((s) => channelId ? s.messagesByChannel[channelId] : undefined);
  useChannelSubscription(channelId);

  // Resolve channel: panel-specific or DM fallback
  useEffect(() => {
    if (!projectId || channelId) return;

    if (panel) {
      // Panel-specific channel
      getOrCreatePanel.mutateAsync({ projectId, panel })
        .then((ch) => setChannelId(ch.id))
        .catch((err) => console.error(`Failed to create panel channel (${panel}):`, err));
    } else {
      // Legacy DM fallback
      if (agents.length === 0) return;
      const pmAgent = agents.find((a) => a.role === 'pm')
        || agents.find((a) => a.role === 'personal_manager')
        || agents[0];
      if (!pmAgent) return;

      getOrCreateDM.mutateAsync({ agentId: pmAgent.id, projectId })
        .then((ch) => setChannelId(ch.id))
        .catch((err) => console.error('Failed to create DM with agent:', err));
    }
  }, [projectId, agents.length, panel]);

  // Sync API messages into store
  useEffect(() => {
    if (messagesData?.messages && channelId) {
      useMessageStore.getState().setMessages(channelId, messagesData.messages);
    }
  }, [messagesData, channelId]);

  const chatMessages = storeMessages || messagesData?.messages || [];
  const chatAgent = agents.find((a) => a.role === 'pm')
    || agents.find((a) => a.role === 'personal_manager')
    || agents[0];

  const handleSend = () => {
    if (!chatInput.trim() || !channelId) return;
    const extra: Record<string, unknown> = {};
    if (activeView === 'library' && contentContext) {
      extra.content_context = contentContext;
    }
    sendMessage.mutate({
      channel_id: channelId,
      content: chatInput.trim(),
      active_view: panel || activeView,
      ...(Object.keys(extra).length > 0 ? { extra_data: extra } : {}),
    });
    setChatInput('');
  };

  const handleReset = () => {
    if (!channelId) return;
    clearMessages.mutate(channelId, {
      onSuccess: () => {
        // Clear local message store for this channel
        useMessageStore.getState().setMessages(channelId, []);
      },
    });
  };

  // Drag resize handler
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - startX;
      const newWidth = Math.max(200, Math.min(600, startWidth + delta));
      setWidth(newWidth);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width]);

  // Header icon and label
  const meta = panel ? PANEL_META[panel] : null;
  const HeaderIcon = meta?.Icon || Globe;
  const headerLabel = meta?.label
    || (chatAgent ? `Chat with ${chatAgent.name}` : 'Browser Chat');

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full md:border-r relative ${darkMode ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-gray-50'} browser-chat-sidebar`}
      style={{ '--bcs-width': `${width}px` } as React.CSSProperties}
    >
      {/* Header */}
      <div className={`px-4 py-3 border-b ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
        <div className="flex items-center gap-2">
          <HeaderIcon className={`w-4 h-4 ${darkMode ? 'text-blue-400' : 'text-blue-500'}`} />
          <h3 className={`text-sm font-semibold flex-1 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {headerLabel}
          </h3>
          {/* Reset button — only for panel channels */}
          {panel && channelId && (
            <button
              onClick={handleReset}
              disabled={clearMessages.isPending}
              title="Reset conversation"
              className={`p-1 rounded transition-colors ${
                darkMode
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700'
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'
              } ${clearMessages.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <RotateCcw className={`w-3.5 h-3.5 ${clearMessages.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Messages -- MessageList owns the scroll container */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {channelId ? (
          <MessageList
            messages={chatMessages}
            agents={agents}
            channelId={channelId}
            onTraceClick={onTraceClick}
          />
        ) : (
          <div className={`flex-1 flex items-center justify-center text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <div className="text-center px-4">
              <HeaderIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Connecting to Prax...</p>
            </div>
          </div>
        )}
      </div>

      {/* Typing indicator + Input */}
      <div className={`px-2 py-2 border-t ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
        {channelId && <TypingIndicatorInline channelId={channelId} />}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            onFocus={(e) => {
              // iOS Safari: scroll the input into view when keyboard opens
              setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300);
            }}
            placeholder={chatAgent ? `Message ${chatAgent.name}...` : 'Message...'}
            className={`flex-1 px-2.5 py-1.5 text-sm rounded border ${
              darkMode
                ? 'bg-slate-800 border-slate-600 text-gray-200 placeholder-gray-500'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
            } focus:outline-none focus:ring-1 focus:ring-blue-500`}
          />
          <button
            onClick={handleSend}
            disabled={!chatInput.trim() || !channelId}
            className={`p-1.5 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${
              chatInput.trim() && channelId
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : darkMode
                  ? 'bg-slate-700 text-gray-500'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Resize handle on right edge (hidden on mobile) */}
      <div
        onMouseDown={onDragStart}
        className={`hidden md:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors ${
          darkMode ? 'hover:bg-blue-400/30' : 'hover:bg-blue-500/30'
        }`}
      />
    </div>
  );
}
