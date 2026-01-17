import { useState, useEffect, useRef } from 'react';
import {
  X,
  Terminal,
  Play,
  CheckCircle,
  FileCode,
  ChevronDown,
  ChevronRight,
  Loader2,
  Clock,
  MessageSquare,
  Radio,
  RefreshCw,
  AlertTriangle,
  ArrowDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { useAgentLogs, useAgentLiveOutput } from '@/hooks/useApi';
import { Avatar } from '@/components/common';
import type { Agent } from '@/types';

interface AgentLogViewerProps {
  agent: Agent;
  onClose: () => void;
}

interface LogEntryProps {
  log: {
    id: string;
    activity_type: string;
    description: string;
    extra_data: Record<string, unknown> | null;
    created_at: string;
  };
}

function LogEntry({ log }: LogEntryProps) {
  const [expanded, setExpanded] = useState(false);
  
  const getIcon = () => {
    switch (log.activity_type) {
      case 'task_started':
        return <Play className="w-4 h-4 text-blue-500" />;
      case 'task_completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'code_written':
      case 'file_edited':
        return <FileCode className="w-4 h-4 text-purple-500" />;
      case 'chat_response':
        return <MessageSquare className="w-4 h-4 text-blue-400" />;
      default:
        return <Terminal className="w-4 h-4 text-gray-500" />;
    }
  };
  
  const getTypeLabel = () => {
    switch (log.activity_type) {
      case 'task_started':
        return 'Started Task';
      case 'task_completed':
        return 'Completed Task';
      case 'code_written':
        return 'Code Written';
      case 'file_edited':
        return 'File Edited';
      case 'chat_response':
        return 'Chat Response';
      case 'code_request':
        return 'Code Request';
      default:
        return log.activity_type;
    }
  };
  
  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };
  
  const hasExtraData = log.extra_data && Object.keys(log.extra_data).length > 0;
  const response = log.extra_data?.response as string | undefined;
  const prompt = log.extra_data?.prompt as string | undefined;
  const taskTitle = log.extra_data?.task_title as string | undefined;
  const executionLog = log.extra_data?.execution_log as string | undefined;
  
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => hasExtraData && setExpanded(!expanded)}
        className={clsx(
          "w-full flex items-start gap-3 p-3 text-left",
          hasExtraData ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
        )}
      >
        {hasExtraData ? (
          expanded ? (
            <ChevronDown className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0" />
          )
        ) : (
          <div className="w-4" />
        )}
        
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx(
              "text-xs font-medium px-2 py-0.5 rounded",
              log.activity_type === 'task_completed' ? "bg-green-100 text-green-700" :
              log.activity_type === 'task_started' ? "bg-blue-100 text-blue-700" :
              log.activity_type === 'code_request' || log.activity_type === 'code_written' ? "bg-purple-100 text-purple-700" :
              "bg-gray-100 text-gray-700"
            )}>
              {getTypeLabel()}
            </span>
            {taskTitle && (
              <span className="text-xs text-gray-500 truncate max-w-[200px]">
                {taskTitle}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-900 line-clamp-2">{log.description}</p>
        </div>
        
        <div className="flex-shrink-0 text-xs text-gray-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(log.created_at)}
        </div>
      </button>
      
      {expanded && hasExtraData && (
        <div className="border-t border-gray-200 bg-gray-50 p-3 space-y-3">
          {prompt && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-1">Prompt</h4>
              <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {prompt}
              </pre>
            </div>
          )}
          
          {executionLog && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-1">Full Execution Log</h4>
              <pre className="text-xs bg-gray-900 text-green-400 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto font-mono">
                {executionLog}
              </pre>
            </div>
          )}
          
          {response && !executionLog && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-1">Claude Code Response</h4>
              <pre className="text-xs bg-gray-900 text-green-400 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto font-mono">
                {response}
              </pre>
            </div>
          )}
          
          {!prompt && !response && !executionLog && log.extra_data && (
            <div>
              <h4 className="text-xs font-medium text-gray-600 mb-1">Details</h4>
              <pre className="text-xs bg-white border border-gray-200 rounded p-2 overflow-x-auto">
                {JSON.stringify(log.extra_data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentLogViewer({ agent, onClose }: AgentLogViewerProps) {
  const queryClient = useQueryClient();
  const liveOutputRef = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const { data: logsData, isLoading, error, refetch } = useAgentLogs(agent.id);
  const isWorking = agent.status === 'working';
  // Always fetch live output if agent appears to be working - this helps detect stale states
  const { data: liveOutput, refetch: refetchLiveOutput } = useAgentLiveOutput(agent.id, isWorking);
  
  // When we detect a stale reset, invalidate the agents query so the UI updates
  useEffect(() => {
    if (liveOutput?.status === 'stale_reset') {
      // Invalidate agents query to refresh the agent status in the sidebar
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    }
  }, [liveOutput?.status, queryClient]);
  
  // Auto-scroll to bottom when new output arrives
  useEffect(() => {
    if (autoScroll && liveOutputRef.current && liveOutput?.output) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
    }
  }, [liveOutput?.output, autoScroll]);
  
  // Detect when user scrolls up (disable auto-scroll)
  const handleScroll = (e: React.UIEvent<HTMLPreElement>) => {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isAtBottom);
  };
  
  const scrollToBottom = () => {
    if (liveOutputRef.current) {
      liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };
  
  const handleRefresh = () => {
    refetch();
    if (isWorking) {
      refetchLiveOutput();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Avatar
              name={agent.name}
              src={agent.profile_image_url}
              size="md"
              status={agent.status}
            />
            <div>
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Work Logs
                {isWorking && (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-600 bg-red-100 px-2 py-0.5 rounded animate-pulse">
                    <Radio className="w-3 h-3" />
                    LIVE
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-500">{agent.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh logs and live output"
            >
              <RefreshCw className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Live Output Section (when agent is working) */}
          {isWorking && (
            <div className={`mb-6 border rounded-lg overflow-hidden ${
              liveOutput?.status === 'stale_reset' ? 'border-yellow-200' :
              liveOutput?.status === 'error' ? 'border-red-300' :
              'border-red-200'
            }`}>
              <div className={`flex items-center gap-2 px-4 py-2 border-b ${
                liveOutput?.status === 'stale_reset' ? 'bg-yellow-50 border-yellow-200' :
                liveOutput?.status === 'error' ? 'bg-red-100 border-red-200' :
                'bg-red-50 border-red-200'
              }`}>
                {liveOutput?.status === 'stale_reset' ? (
                  <AlertTriangle className="w-4 h-4 text-yellow-600" />
                ) : (
                  <Radio className="w-4 h-4 text-red-500 animate-pulse" />
                )}
                <span className={`text-sm font-medium ${
                  liveOutput?.status === 'stale_reset' ? 'text-yellow-700' : 'text-red-700'
                }`}>
                  {liveOutput?.status === 'stale_reset' ? 'Stale State Detected' : 'Live Claude Code Output'}
                </span>
                {liveOutput?.status && (
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    liveOutput.status === 'running' ? 'bg-green-100 text-green-700' :
                    liveOutput.status === 'error' ? 'bg-red-100 text-red-700' :
                    liveOutput.status === 'timeout' ? 'bg-yellow-100 text-yellow-700' :
                    liveOutput.status === 'stale_reset' ? 'bg-yellow-100 text-yellow-700' :
                    liveOutput.status === 'idle' ? 'bg-gray-100 text-gray-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {liveOutput.status}
                  </span>
                )}
                <span className="text-xs text-gray-500 ml-auto">
                  {liveOutput?.last_update && `Updated ${new Date(liveOutput.last_update).toLocaleTimeString()}`}
                </span>
              </div>
              <div className="relative">
                <pre 
                  ref={liveOutputRef}
                  onScroll={handleScroll}
                  style={{ height: '320px', overflowY: 'auto' }}
                  className="p-4 bg-gray-900 text-green-400 text-xs font-mono whitespace-pre-wrap"
                >
                  {liveOutput?.output ? (
                    <span className={liveOutput?.status === 'stale_reset' ? 'text-yellow-400' : 'text-green-400'}>
                      {liveOutput.output}
                    </span>
                  ) : liveOutput?.status === 'running' ? (
                    <span className="text-yellow-400">Claude Code is running... waiting for output...</span>
                  ) : liveOutput?.status === 'invoking' ? (
                    <span className="text-yellow-400">Invoking Claude Code CLI...</span>
                  ) : liveOutput?.status === 'preparing' ? (
                    <span className="text-yellow-400">Preparing task execution...</span>
                  ) : liveOutput?.status === 'initializing' ? (
                    <span className="text-yellow-400">Initializing agent session...</span>
                  ) : liveOutput?.status === 'stale_reset' ? (
                    <span className="text-yellow-400">Agent was in a stale state and has been reset. Try starting a new task.</span>
                  ) : liveOutput?.error ? (
                    <span className="text-red-400">Error: {liveOutput.error}</span>
                  ) : liveOutput?.status === 'error' ? (
                    <span className="text-red-400">An error occurred. Check agent logs for details.</span>
                  ) : liveOutput?.status === 'idle' ? (
                    <span className="text-gray-400">Agent is idle. No active task execution.</span>
                  ) : (
                    <span className="text-gray-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for task to start... (status: {liveOutput?.status || 'unknown'})
                    </span>
                  )}
                </pre>
                {/* Scroll to bottom button - shows when not auto-scrolling */}
                {!autoScroll && liveOutput?.output && (
                  <button
                    onClick={scrollToBottom}
                    className="absolute bottom-2 right-2 p-2 bg-gray-700 hover:bg-gray-600 rounded-full shadow-lg transition-colors"
                    title="Scroll to bottom"
                  >
                    <ArrowDown className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-600">
              Failed to load logs: {String(error)}
            </div>
          ) : logsData ? (
            <>
              {/* Summary */}
              <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Role:</span>
                  <span className="text-sm font-medium text-gray-900 capitalize">
                    {logsData.agent_role}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Total Logs:</span>
                  <span className="text-sm font-medium text-gray-900">
                    {logsData.logs.length}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Status:</span>
                  <span className={clsx(
                    "text-xs font-medium px-2 py-0.5 rounded",
                    agent.status === 'working' ? "bg-red-100 text-red-700" :
                    agent.status === 'blocked' ? "bg-yellow-100 text-yellow-700" :
                    "bg-green-100 text-green-700"
                  )}>
                    {agent.status || 'idle'}
                  </span>
                </div>
              </div>

              {/* Log Entries */}
              {logsData.logs.length > 0 ? (
                <div className="space-y-3">
                  {logsData.logs.map((log) => (
                    <LogEntry key={log.id} log={log} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <Terminal className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No work logs yet</p>
                  <p className="text-sm mt-1">Logs will appear when this agent starts working</p>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              No log data available
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
