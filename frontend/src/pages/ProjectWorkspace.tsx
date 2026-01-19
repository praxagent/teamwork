import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Code, ListTodo, Settings, ChevronLeft, Sparkles, Terminal } from 'lucide-react';
import {
  ChannelSidebar,
  MessageList,
  MessageInput,
  ThreadView,
} from '@/components/chat';
import { ProfileModal } from '@/components/profiles';
import { FileBrowser, TaskBoard, SettingsPanel, ClaudePanel, LiveSessionsPanel } from '@/components/workspace';
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
  // Track if Claude panel has ever been opened (for persistent mounting)
  const [claudePanelMounted, setClaudePanelMounted] = useState(false);

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
  const { selectedAgent, setSelectedAgent, unreadCounts, activeThreadId, setActiveThreadId } =
    useUIStore();

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
      // Select first channel by default
      if (!currentChannelId && channelsData.channels.length > 0) {
        setCurrentChannelId(channelsData.channels[0].id);
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
    <div className="flex h-screen bg-white">
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
        }}
        unreadCounts={unreadCounts}
      />

      {/* Main content area - shows either Chat, TaskBoard, FileBrowser, or Settings */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header - hidden when in Executive Access for maximum terminal space */}
        {!showClaudePanel && (
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-white">
          <div className="flex items-center gap-2">
            {/* Back to Projects */}
            <button
              onClick={() => navigate('/projects')}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors mr-2"
              title="Back to Projects"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            {showTaskPanel ? (
              <>
                <ListTodo className="w-5 h-5 text-slack-purple" />
                <h1 className="font-bold text-lg text-gray-900">Task Board</h1>
              </>
            ) : showFileBrowser ? (
              <>
                <Code className="w-5 h-5 text-slack-purple" />
                <h1 className="font-bold text-lg text-gray-900">Files</h1>
              </>
            ) : showClaudePanel ? (
              <>
                <Sparkles className="w-5 h-5 text-slack-purple" />
                <h1 className="font-bold text-lg text-gray-900">Executive Access</h1>
              </>
            ) : showSettings ? (
              <>
                <Settings className="w-5 h-5 text-slack-purple" />
                <h1 className="font-bold text-lg text-gray-900">Settings</h1>
              </>
            ) : showLiveSessions ? (
              <>
                <Terminal className="w-5 h-5 text-green-500" />
                <h1 className="font-bold text-lg text-gray-900">Live Sessions</h1>
              </>
            ) : currentChannel ? (
              <>
                <span className="text-gray-500">{currentChannel.type === 'dm' ? '@' : '#'}</span>
                <h1 className="font-bold text-lg text-gray-900">
                  {currentChannel.type === 'dm' 
                    ? agents.find(a => a.id === currentChannel.dm_participants)?.name || currentChannel.name
                    : currentChannel.name}
                </h1>
                <span className="text-sm text-gray-500 ml-2">
                  {currentChannel.type === 'dm' 
                    ? '2 members' 
                    : currentChannel.type === 'team'
                      ? `${agents.filter(a => a.team === currentChannel.team).length + 1} members`
                      : `${agents.length + 1} members`}
                </span>
              </>
            ) : (
              <div className="h-6 bg-gray-100 rounded w-32 animate-pulse" />
            )}
          </div>
          
          {/* Panel Toggle Buttons */}
          <div className="flex items-center gap-1">
            {/* Back to Chat button when in a panel */}
            {(showTaskPanel || showFileBrowser || showClaudePanel || showSettings || showLiveSessions) && (
              <button
                onClick={() => {
                  setShowTaskPanel(false);
                  setShowFileBrowser(false);
                  setShowClaudePanel(false);
                  setShowSettings(false);
                  setShowLiveSessions(false);
                }}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded mr-2"
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
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                showTaskPanel ? 'bg-slack-purple text-white hover:bg-slack-purple/90' : 'text-gray-600'
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
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                showFileBrowser ? 'bg-slack-purple text-white hover:bg-slack-purple/90' : 'text-gray-600'
              }`}
              title="Files"
            >
              <Code className="w-5 h-5" />
            </button>
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
                }
              }}
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                showClaudePanel ? 'bg-slack-purple text-white hover:bg-slack-purple/90' : 'text-gray-600'
              }`}
              title="Executive Access"
            >
              <Sparkles className="w-5 h-5" />
            </button>
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
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                showSettings ? 'bg-slack-purple text-white hover:bg-slack-purple/90' : 'text-gray-600'
              }`}
              title="Settings"
            >
              <Settings className="w-5 h-5" />
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
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                showLiveSessions ? 'bg-green-600 text-white hover:bg-green-500' : 'text-gray-600'
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
          <div className="flex-1 overflow-y-auto p-4">
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
        ) : !showClaudePanel ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
          onClose={() => setSelectedAgent(null)}
          onSendMessage={() => {
            handleDMSelect(selectedAgent.id);
            setSelectedAgent(null);
          }}
        />
      )}
    </div>
  );
}
