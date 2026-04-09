import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Code, ListTodo, Settings, ChevronLeft, Workflow, TerminalSquare, BarChart3, Moon, Sun, Globe, Activity, MessageSquare, Search, Home, Library, Brain, Timer, MoreHorizontal, Cpu, Check } from 'lucide-react';
import {
  ChannelSidebar,
  MessageList,
  MessageInput,
  ThreadView,
} from '@/components/chat';
import { ClaudeCodeStatus } from '@/components/chat/ClaudeCodeStatus';
import { ProfileModal } from '@/components/profiles';
import { BrowserPanel, BrowserChatSidebar, LibraryPanel, HomeDashboard, AgentPlanCard, FileBrowser, TaskBoard, SettingsPanel, GraphPanel, ProgressPanel, TerminalPanel, ObservabilityPanel, MemoryPanel, SchedulerPanel } from '@/components/workspace';
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
  useCurrentModel,
  useSetModel,
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
  const [showHomeDashboard, setShowHomeDashboard] = useState(savedView === 'home');
  const [showLibraryPanel, setShowLibraryPanel] = useState(savedView === 'library');
  const [showMemoryPanel, setShowMemoryPanel] = useState(savedView === 'memory');
  // Track which project the Library should open to when we jump from Home.
  const [libraryFocusProject, setLibraryFocusProject] = useState<string | null>(null);
  const [showScheduler, setShowScheduler] = useState(savedView === 'scheduler');
  // Track if panels have ever been opened (for persistent mounting)
  const [claudePanelMounted, setClaudePanelMounted] = useState(savedView === 'claude');
  const [terminalMounted, setTerminalMounted] = useState(savedView === 'terminal');
  const [focusTraceId, setFocusTraceId] = useState<string | null>(null);
  const [channelPanelOpen, setChannelPanelOpen] = useState(true);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  // On mobile, the channel sidebar is an overlay toggled separately
  const [mobileChannelOpen, setMobileChannelOpen] = useState(false);

  // Persist active view to localStorage
  useEffect(() => {
    if (!projectId) return;
    const view = showTerminalPanel ? 'terminal'
      : showBrowserPanel ? 'browser'
      : showClaudePanel ? 'claude'
      : showObservabilityPanel ? 'observability'
      : showMemoryPanel ? 'memory'
      : showHomeDashboard ? 'home'
      : showLibraryPanel ? 'library'
      : showTaskPanel ? 'tasks'
      : showFileBrowser ? 'files'
      : showSettings ? 'settings'
      : showProgressPanel ? 'progress'
      : showScheduler ? 'scheduler'
      : 'chat';
    localStorage.setItem(`tw:view:${projectId}`, view);
  }, [projectId, showTerminalPanel, showBrowserPanel, showClaudePanel, showObservabilityPanel, showMemoryPanel, showHomeDashboard, showLibraryPanel, showTaskPanel, showFileBrowser, showSettings, showProgressPanel, showScheduler]);
  // Content context for sidebar chat (which note/course/news is being viewed)
  // Currently always null — library-item context gets passed in a future
  // turn when the UI wires the selected note back into the chat sidebar.
  const [contentContext] = useState<{ category: string; slug: string; title: string } | null>(null);
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

  // Model picker
  const { data: modelData } = useCurrentModel();
  const setModelMutation = useSetModel();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

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
    setShowMemoryPanel(view === 'memory');
    setShowHomeDashboard(view === 'home');
    setShowLibraryPanel(view === 'library');
    setShowScheduler(view === 'scheduler');
    if (view === 'execution_graphs') setClaudePanelMounted(true);
    if (view === 'terminal') setTerminalMounted(true);
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
    : showMemoryPanel ? 'memory'
    : showHomeDashboard ? 'home'
    : showLibraryPanel ? 'library'
    : showTaskPanel ? 'tasks'
    : showFileBrowser ? 'files'
    : showSettings ? 'settings'
    : showProgressPanel ? 'progress'
    : showScheduler ? 'scheduler'
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
    <div className={`flex flex-col md:flex-row h-screen ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
      {/* ── Icon Rail (desktop only) ── */}
      <nav className={`hidden md:flex w-14 shrink-0 flex-col items-center py-3 gap-1 border-r ${
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
        <RailIcon icon={Home} active={activeView === 'home'} onClick={() => toggleView('home')} title="Home" darkMode={darkMode} activeColor="bg-sky-500/15 text-sky-400" />
        <RailIcon icon={Library} active={activeView === 'library'} onClick={() => toggleView('library')} title="Library" darkMode={darkMode} activeColor="bg-purple-500/15 text-purple-400" />
        {isCoachingProject && (
          <RailIcon icon={BarChart3} active={activeView === 'progress'} onClick={() => toggleView('progress')} title="Progress" darkMode={darkMode} />
        )}

        <div className="flex-1" />

        {!isCoachingProject && (
          <RailIcon icon={Workflow} active={activeView === 'execution_graphs'} onClick={() => toggleView('execution_graphs')} title="Execution Graphs" darkMode={darkMode} />
        )}
        <RailIcon icon={Brain} active={activeView === 'memory'} onClick={() => toggleView('memory')} title="Memory" darkMode={darkMode} activeColor="bg-purple-500/15 text-purple-400" />
        <RailIcon icon={Timer} active={activeView === 'scheduler'} onClick={() => toggleView('scheduler')} title="Scheduler" darkMode={darkMode} activeColor="bg-indigo-500/15 text-indigo-400" />
        <RailIcon icon={Activity} active={activeView === 'observability'} onClick={() => toggleView('observability')} title="Observability" darkMode={darkMode} activeColor="bg-green-500/15 text-green-400" />

        <div className={`w-6 border-t my-1 ${darkMode ? 'border-slate-800' : 'border-gray-200'}`} />

        <RailIcon icon={Settings} active={activeView === 'settings'} onClick={() => toggleView('settings')} title="Settings" darkMode={darkMode} />
        <RailIcon icon={darkMode ? Sun : Moon} active={false} onClick={toggleDarkMode} title={darkMode ? 'Light mode' : 'Dark mode'} darkMode={darkMode} />
        <RailIcon icon={ChevronLeft} active={false} onClick={() => navigate('/projects')} title="All Projects" darkMode={darkMode} />
      </nav>

      {/* ── Channel Panel (desktop: inline sidebar; mobile: overlay) ── */}
      {/* Desktop channel sidebar */}
      {isChatView && channelPanelOpen && (
        <div className="hidden md:flex">
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
        </div>
      )}
      {/* Mobile channel overlay */}
      {mobileChannelOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileChannelOpen(false)} />
          <div className={`absolute inset-y-0 left-0 w-72 z-10 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <ChannelSidebar
              project={currentProject}
              channels={channels}
              agents={agents}
              currentChannelId={currentChannelId}
              onChannelSelect={(id) => { handleChannelSelect(id); setMobileChannelOpen(false); }}
              onDMSelect={(id) => { handleDMSelect(id); setMobileChannelOpen(false); }}
              onAgentProfileClick={handleAgentClick}
              onSettingsClick={() => { switchTo('settings'); setMobileChannelOpen(false); }}
              unreadCounts={unreadCounts}
              onMobileClose={() => setMobileChannelOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Browser Chat Sidebar (browser/terminal/library mode) ── */}
      {/* Single instance — CSS repositions between desktop sidebar and mobile stacked.
          Uses order-1 on mobile to appear after the main content panel (order-0),
          and order-none on desktop to stay in normal flow as a sidebar. */}
      {(activeView === 'browser' || activeView === 'terminal' || activeView === 'library') && projectId && (
        <div className="order-1 md:order-none flex-shrink-0 h-64 md:h-auto border-t md:border-t-0 border-slate-700">
          <BrowserChatSidebar projectId={projectId} activeView={activeView} onTraceClick={handleTraceClick} contentContext={contentContext} />
        </div>
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex flex-col min-w-0 order-0 md:order-none pb-14 md:pb-0 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>

        {/* Browser Panel */}
        {activeView === 'browser' && projectId && (
          <BrowserPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Terminal Panel — persistent mount to preserve session */}
        {terminalMounted && projectId && (
          <TerminalPanel projectId={projectId} isVisible={showTerminalPanel} onClose={() => switchTo('chat')} />
        )}

        {/* Observability Panel */}
        {activeView === 'observability' && projectId && (
          <ObservabilityPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Memory Panel */}
        {activeView === 'memory' && projectId && (
          <MemoryPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
        )}

        {/* Home dashboard — grid of active projects */}
        {activeView === 'home' && (
          <HomeDashboard
            isVisible={true}
            onClose={() => switchTo('chat')}
            onOpenProject={(slug) => {
              setLibraryFocusProject(slug);
              switchTo('library');
            }}
          />
        )}

        {/* Library Panel — Space → Notebook → Note (see docs/library.md) */}
        {activeView === 'library' && (
          <LibraryPanel
            isVisible={true}
            onClose={() => switchTo('chat')}
            onGoHome={() => switchTo('home')}
            focusProject={libraryFocusProject}
            onFocusProjectConsumed={() => setLibraryFocusProject(null)}
          />
        )}

        {/* Scheduler */}
        {activeView === 'scheduler' && projectId && (
          <SchedulerPanel projectId={projectId} isVisible={true} onClose={() => switchTo('chat')} />
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
              <div className={`px-3 md:px-5 pt-3 pb-1 flex items-center gap-2 shrink-0 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {/* Mobile-only hamburger to open channel sidebar */}
                <button
                  onClick={() => setMobileChannelOpen(true)}
                  className={clsx(
                    'md:hidden p-1.5 -ml-1 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center',
                    darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
                  )}
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
                <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {currentChannel.type === 'dm' ? '' : '# '}
                  {currentChannel.type === 'dm'
                    ? agents.find(a => a.id === currentChannel.dm_participants)?.name || currentChannel.name
                    : currentChannel.name}
                </span>
                <span className="text-xs hidden md:inline">
                  {currentChannel.type === 'dm'
                    ? '2 members'
                    : currentChannel.type === 'team'
                      ? `${agents.filter(a => a.team === currentChannel.team).length + 1} members`
                      : `${agents.length + 1} members`}
                </span>
                {/* Model picker badge */}
                {modelData && (
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setModelPickerOpen(v => !v)}
                      className={clsx(
                        'flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors',
                        modelData.override
                          ? darkMode ? 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : darkMode ? 'bg-slate-700/60 text-gray-400 hover:bg-slate-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      )}
                      title={`Model: ${modelData.current_model}${modelData.override ? ' (override)' : ''}`}
                    >
                      <Cpu className="w-3 h-3" />
                      <span className="hidden sm:inline max-w-[120px] truncate">{modelData.current_model.split('/').pop()}</span>
                    </button>
                    {modelPickerOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setModelPickerOpen(false)} />
                        <div className={clsx(
                          'absolute right-0 top-full mt-1 z-50 rounded-lg shadow-lg border min-w-[200px] py-1',
                          darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'
                        )}>
                          <div className={clsx('px-3 py-1.5 text-xs font-semibold', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                            Model
                          </div>
                          <button
                            onClick={() => { setModelMutation.mutate('auto'); setModelPickerOpen(false); }}
                            className={clsx(
                              'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                              !modelData.override
                                ? darkMode ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-900'
                                : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-50'
                            )}
                          >
                            {!modelData.override && <Check className="w-3.5 h-3.5 text-green-400" />}
                            <span className={!modelData.override ? '' : 'ml-5'}>Auto</span>
                            <span className={clsx('ml-auto text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>default</span>
                          </button>
                          {modelData.available.map((m) => {
                            const isActive = modelData.override === m.model;
                            return (
                              <button
                                key={m.model}
                                onClick={() => { setModelMutation.mutate(m.model); setModelPickerOpen(false); }}
                                className={clsx(
                                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                                  isActive
                                    ? darkMode ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-900'
                                    : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-50'
                                )}
                              >
                                {isActive && <Check className="w-3.5 h-3.5 text-green-400" />}
                                <span className={isActive ? '' : 'ml-5'}>{m.model}</span>
                                <span className={clsx('ml-auto text-xs uppercase', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                                  {m.tier}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                )}
                {['claude-code', 'codex', 'opencode'].includes(currentChannel.name) && !modelData && (
                  <div className="ml-auto">
                    <ClaudeCodeStatus darkMode={darkMode} />
                  </div>
                )}
                {['claude-code', 'codex', 'opencode'].includes(currentChannel.name) && modelData && (
                  <ClaudeCodeStatus darkMode={darkMode} />
                )}
              </div>
            )}
            {/* Read-only "Currently working on" widget — shows Prax's
                private agent_plan (his ephemeral within-turn working
                memory).  NOT the Library Kanban — see docs/library.md
                for the wall between the two. */}
            <AgentPlanCard />
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

      {/* Thread panel — only in chat view (full-screen overlay on mobile) */}
      {activeThreadId && isChatView && (
        <div className="fixed inset-0 z-40 md:relative md:inset-auto md:z-auto">
          <ThreadView
            parentMessage={parentMessage}
            replies={threadData?.messages || []}
            agents={agents}
            onSendReply={handleSendReply}
            onClose={() => setActiveThreadId(null)}
          />
        </div>
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

      {/* ── Mobile Bottom Tab Bar ── */}
      <nav className={clsx(
        'md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t safe-area-bottom',
        darkMode ? 'bg-slate-950 border-slate-800' : 'bg-white border-gray-200'
      )}>
        <MobileTabButton
          icon={MessageSquare}
          label="Chat"
          active={isChatView}
          onClick={() => switchTo('chat')}
          darkMode={darkMode}
        />
        <MobileTabButton
          icon={ListTodo}
          label="Tasks"
          active={activeView === 'tasks'}
          onClick={() => switchTo('tasks')}
          darkMode={darkMode}
        />
        <MobileTabButton
          icon={TerminalSquare}
          label="Terminal"
          active={activeView === 'terminal'}
          onClick={() => switchTo('terminal')}
          darkMode={darkMode}
        />
        <MobileTabButton
          icon={Globe}
          label="Browser"
          active={activeView === 'browser'}
          onClick={() => switchTo('browser')}
          darkMode={darkMode}
        />
        <div className="relative">
          <MobileTabButton
            icon={MoreHorizontal}
            label="More"
            active={mobileMoreOpen}
            onClick={() => setMobileMoreOpen(v => !v)}
            darkMode={darkMode}
          />
          {mobileMoreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMobileMoreOpen(false)} />
              <div className={clsx(
                'absolute bottom-full right-0 mb-2 z-50 rounded-xl shadow-lg border min-w-[180px] py-1',
                darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'
              )}>
                <MobileMoreItem icon={Code} label="Files" active={activeView === 'files'} onClick={() => { switchTo('files'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={Home} label="Home" active={activeView === 'home'} onClick={() => { switchTo('home'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={Library} label="Library" active={activeView === 'library'} onClick={() => { switchTo('library'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={Brain} label="Memory" active={activeView === 'memory'} onClick={() => { switchTo('memory'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={Timer} label="Scheduler" active={activeView === 'scheduler'} onClick={() => { switchTo('scheduler'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                {!isCoachingProject && (
                  <MobileMoreItem icon={Workflow} label="Exec Graphs" active={activeView === 'execution_graphs'} onClick={() => { switchTo('execution_graphs'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                )}
                <MobileMoreItem icon={Activity} label="Observability" active={activeView === 'observability'} onClick={() => { switchTo('observability'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                {isCoachingProject && (
                  <MobileMoreItem icon={BarChart3} label="Progress" active={activeView === 'progress'} onClick={() => { switchTo('progress'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                )}
                <div className={`my-1 border-t ${darkMode ? 'border-slate-700' : 'border-gray-200'}`} />
                <MobileMoreItem icon={Settings} label="Settings" active={activeView === 'settings'} onClick={() => { switchTo('settings'); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={darkMode ? Sun : Moon} label={darkMode ? 'Light mode' : 'Dark mode'} active={false} onClick={() => { toggleDarkMode(); setMobileMoreOpen(false); }} darkMode={darkMode} />
                <MobileMoreItem icon={ChevronLeft} label="All Projects" active={false} onClick={() => { navigate('/projects'); setMobileMoreOpen(false); }} darkMode={darkMode} />
              </div>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}

// ── Icon Rail button (desktop) ──
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

// ── Mobile bottom tab button ──
function MobileTabButton({
  icon: Icon,
  label,
  active,
  onClick,
  darkMode,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  darkMode: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1.5 px-2 transition-colors',
        active
          ? 'text-tw-accent'
          : darkMode
            ? 'text-gray-500'
            : 'text-gray-400'
      )}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] mt-0.5 leading-tight">{label}</span>
    </button>
  );
}

// ── Mobile "More" menu item ──
function MobileMoreItem({
  icon: Icon,
  label,
  active,
  onClick,
  darkMode,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
  darkMode: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-2.5 text-sm min-h-[44px] transition-colors',
        active
          ? 'text-tw-accent'
          : darkMode
            ? 'text-gray-300 hover:bg-slate-700'
            : 'text-gray-700 hover:bg-gray-100'
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
    </button>
  );
}
