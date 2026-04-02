import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Code, ListTodo, Settings, ChevronLeft, Workflow, TerminalSquare, BarChart3, Moon, Sun, Globe, Activity, MessageSquare, Search, BookOpen } from 'lucide-react';
import {
  ChannelSidebar,
  MessageList,
  MessageInput,
  ThreadView,
} from '@/components/chat';
import { ProfileModal } from '@/components/profiles';
import { BrowserPanel, BrowserChatSidebar, ContentPanel, FileBrowser, TaskBoard, SettingsPanel, GraphPanel, ProgressPanel, TerminalPanel, ObservabilityPanel } from '@/components/workspace';
import { CommandPalette } from '@/components/common';
import {
  useProject,
  useAgents,
  useChannels,
  useMessages,
  useThreadMessages,
  useSendMessage,
  useAgentActivity,
  useGetOrCreateDMChannel,
  useExecuteCode,
  useLoadOlderMessages,
} from '@/hooks/useApi';
import { useProjectSubscription, useChannelSubscription } from '@/hooks/useWebSocket';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useProjectStore, useMessageStore, useUIStore } from '@/stores';
import type { Agent, Attachment } from '@/types';

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Restore saved view from localStorage
  const savedView = projectId ? localStorage.getItem(`tw:view:${projectId}`) : null;

  // Panel visibility
  const [showTaskPanel, setShowTaskPanel] = useState(savedView === 'tasks');
  const [showFileBrowser, setShowFileBrowser] = useState(savedView === 'files');
  const [showSettings, setShowSettings] = useState(savedView === 'settings');
  const [showClaudePanel, setShowClaudePanel] = useState(savedView === 'claude');
  const [showProgressPanel, setShowProgressPanel] = useState(savedView === 'progress');
  const [showBrowserPanel, setShowBrowserPanel] = useState(savedView === 'browser');
  const [showTerminalPanel, setShowTerminalPanel] = useState(savedView === 'terminal');
  const [showObservabilityPanel, setShowObservabilityPanel] = useState(savedView === 'observability');
  const [showContentPanel, setShowContentPanel] = useState(savedView === 'content');
  // Track if Claude panel has ever been opened (for persistent mounting)
  const [claudePanelMounted, setClaudePanelMounted] = useState(savedView === 'claude');
  const [focusTraceId, setFocusTraceId] = useState<string | null>(null);
  const [channelPanelOpen, setChannelPanelOpen] = useState(true);

  // Persist active view to localStorage
  useEffect(() => {
    if (!projectId) return;
    const view = showTerminalPanel ? 'terminal'
      : showBrowserPanel ? 'browser'
      : showClaudePanel ? 'claude'
      : showObservabilityPanel ? 'observability'
      : showContentPanel ? 'content'
      : showTaskPanel ? 'tasks'
      : showFileBrowser ? 'files'
      : showSettings ? 'settings'
      : showProgressPanel ? 'progress'
      : 'chat';
    localStorage.setItem(`tw:view:${projectId}`, view);
  }, [projectId, showTerminalPanel, showBrowserPanel, showClaudePanel, showObservabilityPanel, showContentPanel, showTaskPanel, showFileBrowser, showSettings, showProgressPanel]);
  // Content context for sidebar chat (which note/course/news is being viewed)
  const [contentContext, setContentContext] = useState<{ category: string; slug: string; title: string } | null>(null);
  // Track if profile modal should open in edit mode
  const [profileEditMode, setProfileEditMode] = useState(false);

  // Stores
  const {
    currentProject,
    setCurrentProject,
    agents,
    setAgents,
    channels,
    setChannels,
    currentChannelId,
    setCurrentChannelId,
  } = useProjectStore();

  const { messagesByChannel, setMessages, prependMessages, hasMore: storeHasMore, setHasMore } = useMessageStore();
  const { selectedAgent, setSelectedAgent, unreadCounts, activeThreadId, setActiveThreadId, darkMode, toggleDarkMode } =
    useUIStore();

  // Check if this is a coaching project
  const isCoachingProject = currentProject?.config?.project_type === 'coaching';
  
  // Set user role based on project type
  const setUserRole = useUIStore((state) => state.setUserRole);
  useEffect(() => {
    setUserRole(isCoachingProject ? 'student' : 'ceo');
  }, [isCoachingProject, setUserRole]);

  // API queries
  const { data: projectData, isError: isProjectError } = useProject(projectId || null);
  const { data: agentsData } = useAgents(projectId || null);
  const { data: channelsData } = useChannels(projectId || null);
  const { data: messagesData } = useMessages(currentChannelId);
  const { data: threadData } = useThreadMessages(activeThreadId);
  const { data: agentActivityData } = useAgentActivity(selectedAgent?.id || null);

  // Redirect to home if project not found
  useEffect(() => {
    if (isProjectError) {
      console.log('[ProjectWorkspace] Project not found, redirecting to home');
      navigate('/', { replace: true });
    }
  }, [isProjectError, navigate]);

  const sendMessage = useSendMessage();
  const getOrCreateDM = useGetOrCreateDMChannel();
  const executeCode = useExecuteCode();
  const loadOlderMutation = useLoadOlderMessages();

  const handleLoadOlderMessages = useCallback(() => {
    if (!currentChannelId || loadOlderMutation.isPending) return;
    const skip = (messagesByChannel[currentChannelId] || []).length;
    loadOlderMutation.mutate(
      { channelId: currentChannelId, skip },
      {
        onSuccess: (data) => {
          prependMessages(currentChannelId, data.messages);
          setHasMore(currentChannelId, data.has_more);
        },
      },
    );
  }, [currentChannelId, loadOlderMutation.isPending, messagesByChannel, prependMessages, setHasMore]);

  // WebSocket subscriptions
  useProjectSubscription(projectId || null);
  useChannelSubscription(currentChannelId);

  // Update stores when data changes
  useEffect(() => {
    if (projectData) {
      setCurrentProject(projectData);
    }
  }, [projectData, setCurrentProject]);

  useEffect(() => {
    if (agentsData?.agents) {
      setAgents(agentsData.agents);
    }
  }, [agentsData, setAgents]);

  useEffect(() => {
    if (channelsData?.channels) {
      setChannels(channelsData.channels);
      if (!currentChannelId && channelsData.channels.length > 0) {
        // Try to restore the last-viewed channel for this project
        const savedId = projectId ? localStorage.getItem(`tw:channel:${projectId}`) : null;
        const saved = savedId ? channelsData.channels.find(c => c.id === savedId) : null;
        const generalChannel = channelsData.channels.find(c => c.name === 'general');
        const firstPublic = channelsData.channels.find(c => c.type === 'public');
        const defaultChannel = saved || generalChannel || firstPublic || channelsData.channels[0];
        setCurrentChannelId(defaultChannel.id);
      }
    }
  }, [channelsData, setChannels, currentChannelId, setCurrentChannelId]);

  useEffect(() => {
    if (messagesData && currentChannelId) {
      const existingCount = (messagesByChannel[currentChannelId] || []).length;
      setMessages(currentChannelId, messagesData.messages);
      // Only update hasMore on fresh loads, not refetches when older messages are already in the store
      if (existingCount <= messagesData.messages.length) {
        setHasMore(currentChannelId, messagesData.has_more);
      }
    }
  }, [messagesData, currentChannelId, setMessages, setHasMore]);

  // View switching helpers
  const switchTo = (view: string) => {
    setShowTaskPanel(view === 'tasks');
    setShowFileBrowser(view === 'files');
    setShowSettings(view === 'settings');
    setShowClaudePanel(view === 'execution_graphs');
    setShowProgressPanel(view === 'progress');
    setShowBrowserPanel(view === 'browser');
    setShowTerminalPanel(view === 'terminal');
    setShowObservabilityPanel(view === 'observability');
    setShowContentPanel(view === 'content');
    if (view === 'execution_graphs') setClaudePanelMounted(true);
  };

  const toggleView = (view: string) => {
    activeView === view ? switchTo('chat') : switchTo(view);
  };

  // Navigate to Execution Graphs focused on a specific trace
  const handleTraceClick = useCallback((traceId: string) => {
    setFocusTraceId(traceId);
    switchTo('execution_graphs');
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onToggleDarkMode: toggleDarkMode,
    onNextChannel: () => {
      const idx = channels.findIndex((c) => c.id === currentChannelId);
      if (idx < channels.length - 1) handleChannelSelect(channels[idx + 1].id);
    },
    onPrevChannel: () => {
      const idx = channels.findIndex((c) => c.id === currentChannelId);
      if (idx > 0) handleChannelSelect(channels[idx - 1].id);
    },
  });

  // Handlers
  const handleChannelSelect = (channelId: string) => {
    setCurrentChannelId(channelId);
    if (projectId) localStorage.setItem(`tw:channel:${projectId}`, channelId);
    setActiveThreadId(null);
    switchTo('chat');
  };

  // Derive current active view for context.
  const activeView = showTerminalPanel ? 'terminal'
    : showBrowserPanel ? 'browser'
    : showClaudePanel ? 'execution_graphs'
    : showObservabilityPanel ? 'observability'
    : showContentPanel ? 'content'
    : showTaskPanel ? 'tasks'
    : showFileBrowser ? 'files'
    : showSettings ? 'settings'
    : showProgressPanel ? 'progress'
    : 'chat';

  const handleSendMessage = (content: string, attachments?: Attachment[]) => {
    if (!currentChannelId) return;
    sendMessage.mutate({
      channel_id: currentChannelId,
      content,
      active_view: activeView,
      ...(attachments?.length ? { extra_data: { attachments } } : {}),
    });
  };

  const handleCodeRequest = async (agentId: string, request: string) => {
    if (!currentChannelId) return;
    
    try {
      const result = await executeCode.mutateAsync({
        agentId,
        request,
        channelId: currentChannelId,
      });
      
      if (result.success) {
        switchTo('files');
      } else {
        console.error('Code execution failed:', result.message);
      }
    } catch (error) {
      console.error('Code execution error:', error);
    }
  };

  const handleSendReply = (content: string) => {
    if (!currentChannelId || !activeThreadId) return;
    sendMessage.mutate({
      channel_id: currentChannelId,
      content,
      thread_id: activeThreadId,
    });
  };

  const handleThreadClick = (messageId: string) => {
    setActiveThreadId(messageId);
  };

  const handleAgentClick = (agent: Agent) => {
    setSelectedAgent(agent);
  };

  const handleDMSelect = async (agentId: string) => {
    if (!projectId) return;
    try {
      const dmChannel = await getOrCreateDM.mutateAsync({
        agentId,
        projectId,
      });
      setCurrentChannelId(dmChannel.id);
      localStorage.setItem(`tw:channel:${projectId}`, dmChannel.id);
      setActiveThreadId(null);
      switchTo('chat');
    } catch (error) {
      console.error('Failed to open DM:', error);
    }
  };

  // Get current data
  const currentChannel = channels.find((c) => c.id === currentChannelId);
  const currentMessages = currentChannelId
    ? messagesByChannel[currentChannelId] || []
    : [];
  const parentMessage = activeThreadId
    ? currentMessages.find((m) => m.id === activeThreadId) || null
    : null;

  const isChatView = activeView === 'chat';

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
      {/* ── Icon Rail ── */}
      <nav className={`w-14 shrink-0 flex flex-col items-center py-3 gap-1 border-r ${
        darkMode ? 'bg-slate-950 border-slate-800' : 'bg-gray-50 border-gray-200'
      }`}>
        {/* Project initial — toggles channel panel */}
        <button
          onClick={() => {
            if (!isChatView) { switchTo('chat'); setChannelPanelOpen(true); }
            else setChannelPanelOpen(v => !v);
          }}
          className={clsx(
            'w-10 h-10 rounded-xl flex items-center justify-center mb-2 text-sm font-bold transition-colors',
            isChatView && channelPanelOpen
              ? 'bg-tw-accent text-white'
              : darkMode ? 'bg-slate-800 text-gray-300 hover:bg-slate-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          )}
          title={currentProject?.name || 'Project'}
        >
          {currentProject?.name?.[0]?.toUpperCase() || 'P'}
        </button>

        <div className={`w-6 border-t mb-1 ${darkMode ? 'border-slate-800' : 'border-gray-200'}`} />

        <RailIcon icon={Search} active={false} onClick={() => window.dispatchEvent(new Event('open-command-palette'))} title="Search (⌘K)" darkMode={darkMode} />
        <RailIcon icon={MessageSquare} active={isChatView} onClick={() => switchTo('chat')} title="Chat" darkMode={darkMode} />
        <RailIcon icon={ListTodo} active={activeView === 'tasks'} onClick={() => toggleView('tasks')} title="Tasks" darkMode={darkMode} />
        <RailIcon icon={Code} active={activeView === 'files'} onClick={() => toggleView('files')} title="Files" darkMode={darkMode} />
        <RailIcon icon={TerminalSquare} active={activeView === 'terminal'} onClick={() => toggleView('terminal')} title="Terminal" darkMode={darkMode} activeColor="bg-green-500/15 text-green-400" />
        <RailIcon icon={Globe} active={activeView === 'browser'} onClick={() => toggleView('browser')} title="Browser" darkMode={darkMode} activeColor="bg-blue-500/15 text-blue-400" />
        <RailIcon icon={BookOpen} active={activeView === 'content'} onClick={() => toggleView('content')} title="Prax's Space" darkMode={darkMode} activeColor="bg-purple-500/15 text-purple-400" />
        {isCoachingProject && (
          <RailIcon icon={BarChart3} active={activeView === 'progress'} onClick={() => toggleView('progress')} title="Progress" darkMode={darkMode} />
        )}

        <div className="flex-1" />

        {!isCoachingProject && (
          <RailIcon icon={Workflow} active={activeView === 'execution_graphs'} onClick={() => toggleView('execution_graphs')} title="Execution Graphs" darkMode={darkMode} />
        )}
        <RailIcon icon={Activity} active={activeView === 'observability'} onClick={() => toggleView('observability')} title="Observability" darkMode={darkMode} activeColor="bg-green-500/15 text-green-400" />

        <div className={`w-6 border-t my-1 ${darkMode ? 'border-slate-800' : 'border-gray-200'}`} />

        <RailIcon icon={Settings} active={activeView === 'settings'} onClick={() => toggleView('settings')} title="Settings" darkMode={darkMode} />
        <RailIcon icon={darkMode ? Sun : Moon} active={false} onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'} darkMode={darkMode} />
        <RailIcon icon={ChevronLeft} active={false} onClick={() => navigate('/projects')} title="All Projects" darkMode={darkMode} />
      </nav>

      {/* ── Channel Panel (chat mode, collapsible) ── */}
      {isChatView && channelPanelOpen && (
        <ChannelSidebar
          project={currentProject}
          channels={channels}
          agents={agents}
          currentChannelId={currentChannelId}
          onChannelSelect={handleChannelSelect}
          onDMSelect={handleDMSelect}
          onAgentProfileClick={handleAgentClick}
          onSettingsClick={() => switchTo('settings')}
          unreadCounts={unreadCounts}
        />
      )}

      {/* ── Browser Chat Sidebar (browser/terminal/content mode) ── */}
      {(activeView === 'browser' || activeView === 'terminal' || activeView === 'content') && projectId && (
        <BrowserChatSidebar projectId={projectId} activeView={activeView} onTraceClick={handleTraceClick} contentContext={contentContext} />
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex flex-col min-w-0 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>

        {/* Browser Panel */}
        {activeView === 'browser' && projectId && (
          <BrowserPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Terminal Panel */}
        {activeView === 'terminal' && projectId && (
          <TerminalPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Observability Panel */}
        {activeView === 'observability' && projectId && (
          <ObservabilityPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Content Panel — Prax's Space */}
        {activeView === 'content' && (
          <ContentPanel isVisible={true} onClose={() => switchTo('chat')} projectId={projectId} onContentSelect={setContentContext} />
        )}

        {/* Graph Panel — persistent mount */}
        {claudePanelMounted && projectId && (
          <GraphPanel projectId={projectId} isVisible={showClaudePanel} onClose={() => switchTo('chat')} focusTraceId={focusTraceId} />
        )}

        {/* Task Board */}
        {activeView === 'tasks' && projectId && (
          <TaskBoard projectId={projectId} agents={agents} isCoachingProject={isCoachingProject} onWatchLive={() => switchTo('observability')} />
        )}

        {/* File Browser */}
        {activeView === 'files' && projectId && (
          <FileBrowser projectId={projectId} onOpenClaudePanel={() => switchTo('execution_graphs')} />
        )}

        {/* Settings */}
        {activeView === 'settings' && currentProject && (
          <div className={`flex-1 overflow-y-auto p-4 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <SettingsPanel project={currentProject} />
          </div>
        )}

        {/* Progress Panel */}
        {activeView === 'progress' && projectId && (
          <div className={`flex-1 overflow-hidden ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <ProgressPanel
              projectId={projectId}
              onClose={() => switchTo('chat')}
              onEditCoach={(coachSlug) => {
                const matchedAgent = agents.find((a) => {
                  const agentSlug = a.name.toLowerCase().trim()
                    .replace(/[^a-z0-9\s-]/g, '').replace(/[\s_]+/g, '-')
                    .replace(/-+/g, '-').replace(/^-|-$/g, '');
                  return agentSlug === coachSlug;
                });
                if (matchedAgent) {
                  switchTo('chat');
                  setProfileEditMode(true);
                  setSelectedAgent(matchedAgent);
                }
              }}
            />
          </div>
        )}

        {/* Chat View */}
        {isChatView && (
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            {/* Minimal channel indicator */}
            {currentChannel && (
              <div className={`px-5 pt-3 pb-1 flex items-center gap-2 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {currentChannel.type === 'dm' ? '' : '# '}
                  {currentChannel.type === 'dm'
                    ? agents.find(a => a.id === currentChannel.dm_participants)?.name || currentChannel.name
                    : currentChannel.name}
                </span>
                <span className="text-xs">
                  {currentChannel.type === 'dm'
                    ? '2 members'
                    : currentChannel.type === 'team'
                      ? `${agents.filter(a => a.team === currentChannel.team).length + 1} members`
                      : `${agents.length + 1} members`}
                </span>
              </div>
            )}
            <MessageList
              messages={currentMessages}
              agents={agents}
              channelId={currentChannelId || undefined}
              onThreadClick={handleThreadClick}
              onAgentClick={handleAgentClick}
              onTraceClick={handleTraceClick}
              hasMore={currentChannelId ? storeHasMore[currentChannelId] ?? false : false}
              onLoadMore={handleLoadOlderMessages}
              loading={loadOlderMutation.isPending}
            />
            <MessageInput
              channelName={currentChannel?.name || 'channel'}
              channelId={currentChannelId || undefined}
              projectId={projectId}
              agents={agents}
              onSend={handleSendMessage}
              onCodeRequest={handleCodeRequest}
            />
          </div>
        )}
      </div>

      {/* Thread panel — only in chat view */}
      {activeThreadId && isChatView && (
        <ThreadView
          parentMessage={parentMessage}
          replies={threadData?.messages || []}
          agents={agents}
          onSendReply={handleSendReply}
          onClose={() => setActiveThreadId(null)}
        />
      )}

      {/* Profile modal */}
      {selectedAgent && (
        <ProfileModal
          agent={selectedAgent}
          activities={agentActivityData || []}
          onClose={() => {
            setSelectedAgent(null);
            setProfileEditMode(false);
          }}
          onSendMessage={() => {
            handleDMSelect(selectedAgent.id);
            setSelectedAgent(null);
            setProfileEditMode(false);
          }}
          initialEditMode={profileEditMode}
        />
      )}

      {/* Command palette (Cmd+K) */}
      <CommandPalette
        onChannelSelect={handleChannelSelect}
        onDMSelect={handleDMSelect}
        onSwitchView={switchTo}
      />
    </div>
  );
}

// ── Icon Rail button ──
function RailIcon({
  icon: Icon,
  active,
  onClick,
  title,
  darkMode,
  activeColor,
}: {
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
  title: string;
  darkMode: boolean;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-10 h-10 flex items-center justify-center rounded-xl transition-colors',
        active
          ? (activeColor || 'bg-tw-accent/15 text-indigo-400')
          : darkMode
            ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
      )}
      title={title}
    >
      <Icon className="w-5 h-5" />
    </button>
  );
}
