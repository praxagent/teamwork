import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Code, ListTodo, Settings, ChevronLeft, Sparkles, Terminal, BarChart3, Moon, Sun } from 'lucide-react';
import {
  ChannelSidebar,
  MessageList,
  MessageInput,
  ThreadView,
} from '@/components/chat';
import { ProfileModal } from '@/components/profiles';
import { FileBrowser, TaskBoard, SettingsPanel, ClaudePanel, LiveSessionsPanel, ProgressPanel } from '@/components/workspace';
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
} from '@/hooks/useApi';
import { useProjectSubscription, useChannelSubscription } from '@/hooks/useWebSocket';
import { useProjectStore, useMessageStore, useUIStore } from '@/stores';
import type { Message, Agent } from '@/types';

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Panel visibility
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClaudePanel, setShowClaudePanel] = useState(false);
  const [showLiveSessions, setShowLiveSessions] = useState(false);
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  // Track if Claude panel has ever been opened (for persistent mounting)
  const [claudePanelMounted, setClaudePanelMounted] = useState(false);
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

  const { messagesByChannel, setMessages, addMessage } = useMessageStore();
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
  const { data: projectData, error: projectError, isError: isProjectError } = useProject(projectId || null);
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
      // Select #general by default, or first public channel, or any first channel
      if (!currentChannelId && channelsData.channels.length > 0) {
        const generalChannel = channelsData.channels.find(c => c.name === 'general');
        const firstPublic = channelsData.channels.find(c => c.type === 'public');
        const defaultChannel = generalChannel || firstPublic || channelsData.channels[0];
        setCurrentChannelId(defaultChannel.id);
      }
    }
  }, [channelsData, setChannels, currentChannelId, setCurrentChannelId]);

  useEffect(() => {
    if (messagesData?.messages && currentChannelId) {
      setMessages(currentChannelId, messagesData.messages);
    }
  }, [messagesData, currentChannelId, setMessages]);

  // Handlers
  const handleChannelSelect = (channelId: string) => {
    setCurrentChannelId(channelId);
    setActiveThreadId(null);
    // Close any open panels to show chat view (but keep Claude panel mounted)
    setShowTaskPanel(false);
    setShowFileBrowser(false);
    setShowSettings(false);
    setShowProgressPanel(false);
    setShowClaudePanel(false);
  };

  const handleSendMessage = (content: string) => {
    if (!currentChannelId) return;
    sendMessage.mutate({
      channel_id: currentChannelId,
      content,
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
        // Show the file browser after successful code generation
        setShowFileBrowser(true);
        setShowTaskPanel(false);
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
      setActiveThreadId(null);
      // Close any open panels to show chat view (but keep Claude panel mounted)
      setShowTaskPanel(false);
      setShowProgressPanel(false);
      setShowFileBrowser(false);
      setShowSettings(false);
      setShowClaudePanel(false);
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

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
      {/* Sidebar */}
      <ChannelSidebar
        project={currentProject}
        channels={channels}
        agents={agents}
        currentChannelId={currentChannelId}
        onChannelSelect={handleChannelSelect}
        onDMSelect={handleDMSelect}
        onAgentProfileClick={handleAgentClick}
        onSettingsClick={() => {
          setShowSettings(true);
          setShowTaskPanel(false);
          setShowFileBrowser(false);
          setShowClaudePanel(false);
          setShowProgressPanel(false);
        }}
        unreadCounts={unreadCounts}
      />

      {/* Main content area - shows either Chat, TaskBoard, FileBrowser, or Settings */}
      <div className={`flex-1 flex flex-col min-w-0 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
        {/* Header - hidden when in Executive Access or Progress panel for maximum space */}
        {!showClaudePanel && !showProgressPanel && (
        <div className={`flex items-center justify-between border-b px-4 py-3 ${darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center gap-2">
            {/* Back to Projects */}
            <button
              onClick={() => navigate('/projects')}
              className={`p-1.5 rounded transition-colors mr-2 ${darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
              title="Back to Projects"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            {showTaskPanel ? (
              <>
                <ListTodo className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-slack-purple'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Task Board</h1>
              </>
            ) : showFileBrowser ? (
              <>
                <Code className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-slack-purple'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Files</h1>
              </>
            ) : showClaudePanel ? (
              <>
                <Sparkles className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-slack-purple'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Executive Access</h1>
              </>
            ) : showSettings ? (
              <>
                <Settings className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-slack-purple'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Settings</h1>
              </>
            ) : showLiveSessions ? (
              <>
                <Terminal className={`w-5 h-5 ${darkMode ? 'text-green-400' : 'text-green-500'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Live Sessions</h1>
              </>
            ) : showProgressPanel ? (
              <>
                <BarChart3 className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Progress</h1>
              </>
            ) : currentChannel ? (
              <>
                <span className={darkMode ? 'text-gray-400' : 'text-gray-500'}>{currentChannel.type === 'dm' ? '@' : '#'}</span>
                <h1 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                  {currentChannel.type === 'dm' 
                    ? agents.find(a => a.id === currentChannel.dm_participants)?.name || currentChannel.name
                    : currentChannel.name}
                </h1>
                <span className={`text-sm ml-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {currentChannel.type === 'dm' 
                    ? '2 members' 
                    : currentChannel.type === 'team'
                      ? `${agents.filter(a => a.team === currentChannel.team).length + 1} members`
                      : `${agents.length + 1} members`}
                </span>
              </>
            ) : (
              <div className={`h-6 rounded w-32 animate-pulse ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`} />
            )}
          </div>
          
          {/* Panel Toggle Buttons */}
          <div className="flex items-center gap-1">
            {/* Back to Chat button when in a panel */}
            {(showTaskPanel || showFileBrowser || showClaudePanel || showSettings || showLiveSessions || showProgressPanel) && (
              <button
                onClick={() => {
                  setShowTaskPanel(false);
                  setShowFileBrowser(false);
                  setShowClaudePanel(false);
                  setShowSettings(false);
                  setShowLiveSessions(false);
                  setShowProgressPanel(false);
                }}
                className={`px-3 py-1.5 text-sm rounded mr-2 ${darkMode ? 'text-gray-300 hover:text-white hover:bg-slate-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
              >
                ← Back to Chat
              </button>
            )}
            
            <button
              onClick={() => {
                setShowTaskPanel(!showTaskPanel);
                if (!showTaskPanel) {
                  setShowFileBrowser(false);
                  setShowClaudePanel(false);
                  setShowSettings(false);
                  setShowLiveSessions(false);
                }
              }}
              className={`p-2 rounded transition-colors ${
                showTaskPanel 
                  ? 'bg-slack-purple text-white hover:bg-slack-purple/90' 
                  : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="Tasks"
            >
              <ListTodo className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                setShowFileBrowser(!showFileBrowser);
                if (!showFileBrowser) {
                  setShowTaskPanel(false);
                  setShowClaudePanel(false);
                  setShowSettings(false);
                  setShowLiveSessions(false);
                }
              }}
              className={`p-2 rounded transition-colors ${
                showFileBrowser 
                  ? 'bg-slack-purple text-white hover:bg-slack-purple/90' 
                  : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="Files"
            >
              <Code className="w-5 h-5" />
            </button>
            {/* Executive Access button - hidden for coaching projects */}
            {!isCoachingProject && (
              <button
                onClick={() => {
                  const willShow = !showClaudePanel;
                  setShowClaudePanel(willShow);
                  if (willShow) {
                    setClaudePanelMounted(true);
                    setShowTaskPanel(false);
                    setShowFileBrowser(false);
                    setShowSettings(false);
                    setShowLiveSessions(false);
                    setShowProgressPanel(false);
                  }
                }}
                className={`p-2 rounded transition-colors ${
                  showClaudePanel 
                    ? 'bg-slack-purple text-white hover:bg-slack-purple/90' 
                    : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Executive Access"
              >
                <Sparkles className="w-5 h-5" />
              </button>
            )}
            {/* Progress button - shown only for coaching projects */}
            {isCoachingProject && (
              <button
                onClick={() => {
                  setShowProgressPanel(!showProgressPanel);
                  if (!showProgressPanel) {
                    setShowTaskPanel(false);
                    setShowFileBrowser(false);
                    setShowClaudePanel(false);
                    setShowSettings(false);
                    setShowLiveSessions(false);
                  }
                }}
                className={`p-2 rounded transition-colors ${
                  showProgressPanel 
                    ? 'bg-purple-600 text-white hover:bg-purple-700' 
                    : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
                }`}
                title="Progress"
              >
                <BarChart3 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => {
                setShowSettings(!showSettings);
                if (!showSettings) {
                  setShowTaskPanel(false);
                  setShowFileBrowser(false);
                  setShowClaudePanel(false);
                  setShowLiveSessions(false);
                }
              }}
              className={`p-2 rounded transition-colors ${
                showSettings 
                  ? 'bg-slack-purple text-white hover:bg-slack-purple/90' 
                  : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            
            {/* Dark mode toggle */}
            <button
              onClick={toggleDarkMode}
              className={`p-2 rounded transition-colors ${darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'}`}
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            
            {/* Live Sessions toggle - shows running Claude Code sessions as full panel */}
            <button
              onClick={() => {
                setShowLiveSessions(!showLiveSessions);
                if (!showLiveSessions) {
                  setShowTaskPanel(false);
                  setShowFileBrowser(false);
                  setShowClaudePanel(false);
                  setShowSettings(false);
                }
              }}
              className={`p-2 rounded transition-colors ${
                showLiveSessions 
                  ? 'bg-green-600 text-white hover:bg-green-500' 
                  : darkMode ? 'text-gray-300 hover:bg-slate-700' : 'text-gray-700 hover:bg-gray-100'
              }`}
              title="Live Sessions - Watch agents work in real-time"
            >
              <Terminal className="w-5 h-5" />
            </button>
          </div>
        </div>
        )}
        
        {/* Content area - switches between views */}
        {/* Claude Panel - rendered separately with CSS visibility for persistence */}
        {claudePanelMounted && projectId && (
          <ClaudePanel
            projectId={projectId}
            isVisible={showClaudePanel}
            onBack={() => setShowClaudePanel(false)}
          />
        )}
        
        {/* Main content - panel views */}
        {showTaskPanel && projectId ? (
          <TaskBoard
            projectId={projectId}
            agents={agents}
            isCoachingProject={isCoachingProject}
            onWatchLive={(agentId) => {
              // Switch to Live Sessions panel when "Watch Live" is clicked
              setShowTaskPanel(false);
              setShowFileBrowser(false);
              setShowSettings(false);
              setShowClaudePanel(false);
              setShowLiveSessions(true);
              // TODO: Could also pass agentId to pre-select that agent's session
            }}
          />
        ) : showFileBrowser && projectId ? (
          <FileBrowser
            projectId={projectId}
            onOpenClaudePanel={() => {
              setShowClaudePanel(true);
              setClaudePanelMounted(true);
              setShowFileBrowser(false);
            }}
          />
        ) : showSettings && currentProject ? (
          <div className={`flex-1 overflow-y-auto p-4 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <SettingsPanel
              project={currentProject}
            />
          </div>
        ) : showLiveSessions && projectId ? (
          <LiveSessionsPanel
            projectId={projectId}
            agents={agents}
            isVisible={true}
            onClose={() => setShowLiveSessions(false)}
            fullPage={true}
          />
        ) : showProgressPanel && projectId ? (
          <div className={`flex-1 overflow-hidden ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <ProgressPanel
              projectId={projectId}
              onClose={() => setShowProgressPanel(false)}
              onEditCoach={(coachSlug) => {
                // Find the agent matching this coach slug and open profile in edit mode
                const matchedAgent = agents.find((a) => {
                  const agentSlug = a.name
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9\s-]/g, '')
                    .replace(/[\s_]+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');
                  return agentSlug === coachSlug;
                });
                if (matchedAgent) {
                  setShowProgressPanel(false);
                  setProfileEditMode(true);
                  setSelectedAgent(matchedAgent);
                }
              }}
            />
          </div>
        ) : !showClaudePanel ? (
          <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
            <MessageList
              messages={currentMessages}
              agents={agents}
              channelId={currentChannelId || undefined}
              onThreadClick={handleThreadClick}
              onAgentClick={handleAgentClick}
            />
            <MessageInput
              channelName={currentChannel?.name || 'channel'}
              channelId={currentChannelId || undefined}
              agents={agents}
              onSend={handleSendMessage}
              onCodeRequest={handleCodeRequest}
            />
          </div>
        ) : null}
      </div>

      {/* Thread panel */}
      {activeThreadId && !showTaskPanel && !showFileBrowser && !showClaudePanel && !showSettings && (
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
    </div>
  );
}
