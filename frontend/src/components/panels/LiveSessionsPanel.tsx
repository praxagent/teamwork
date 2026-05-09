import { useState, useEffect, useRef, useMemo } from 'react';
import { Terminal, Circle, Eye, XCircle, ChevronDown, User } from 'lucide-react';
import { useAgentLiveOutput } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import type { Agent } from '@/types';

interface LiveSessionsPanelProps {
  projectId: string;
  agents: unknown[];
  isVisible: boolean;
  onClose: () => void;
  fullPage: boolean;
}

const STATUS_COLORS: Record<string, { dot: string; label: string; bg: string }> = {
  running: { dot: 'bg-green-500', label: 'Running', bg: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  invoking: { dot: 'bg-green-400 animate-pulse', label: 'Invoking', bg: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  preparing: { dot: 'bg-yellow-400 animate-pulse', label: 'Preparing', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  initializing: { dot: 'bg-yellow-400 animate-pulse', label: 'Initializing', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  completed: { dot: 'bg-blue-500', label: 'Completed', bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  idle: { dot: 'bg-gray-400', label: 'Idle', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  error: { dot: 'bg-red-500', label: 'Error', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  failed: { dot: 'bg-red-500', label: 'Failed', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  startup_failed: { dot: 'bg-red-500', label: 'Startup Failed', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  timeout: { dot: 'bg-orange-500', label: 'Timeout', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  stopped: { dot: 'bg-gray-500', label: 'Stopped', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  stale_reset: { dot: 'bg-gray-500', label: 'Stale', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  retry_loop: { dot: 'bg-orange-400 animate-pulse', label: 'Retrying', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
};

const ACTIVE_STATUSES = new Set(['running', 'invoking', 'preparing', 'initializing']);

function AgentOutputView({ agentId, darkMode }: { agentId: string; darkMode: boolean }) {
  const { data: liveOutput } = useAgentLiveOutput(agentId, true);
  const outputRef = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevOutputLength = useRef(0);

  // Auto-scroll when new output arrives
  useEffect(() => {
    const outputText = liveOutput?.output || '';
    if (outputText.length !== prevOutputLength.current) {
      prevOutputLength.current = outputText.length;
      if (autoScroll && outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    }
  }, [liveOutput?.output, autoScroll]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const statusInfo = STATUS_COLORS[liveOutput?.status || 'idle'] || STATUS_COLORS.idle;
  const isActive = ACTIVE_STATUSES.has(liveOutput?.status || '');

  return (
    <div className="flex flex-col h-full">
      {/* Output header bar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0 ${
        darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center gap-2">
          <Terminal className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
          <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            {liveOutput?.agent_name || 'Agent Output'}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bg}`}>
            <Circle className={`w-2 h-2 fill-current ${statusInfo.dot.replace(/bg-/, 'text-').replace(' animate-pulse', '')}`} />
            {statusInfo.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs text-green-500 animate-pulse">
              <Eye className="w-3.5 h-3.5" />
              Watch Live
            </span>
          )}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight;
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                darkMode
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
              }`}
            >
              <ChevronDown className="w-3 h-3" />
              Auto-scroll
            </button>
          )}
        </div>
      </div>

      {/* Terminal output area */}
      <pre
        ref={outputRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words ${
          darkMode
            ? 'bg-slate-950 text-green-300'
            : 'bg-white text-gray-800 border-t border-gray-100'
        }`}
      >
        {liveOutput?.output ? (
          liveOutput.output
        ) : liveOutput?.error ? (
          <span className="text-red-400">{liveOutput.error}</span>
        ) : (
          <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>
            {isActive ? 'Waiting for output...' : 'No output available. Agent is not currently running.'}
          </span>
        )}
        {isActive && (
          <span className={`inline-block w-2 h-4 ml-0.5 animate-pulse align-middle ${darkMode ? 'bg-green-400' : 'bg-gray-600'}`} />
        )}
      </pre>
    </div>
  );
}

export function LiveSessionsPanel({ agents: rawAgents, isVisible, onClose, fullPage }: LiveSessionsPanelProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const agents = rawAgents as Agent[];

  // Sort agents: active ones first, then by name
  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aActive = a.status === 'working' ? 0 : 1;
      const bActive = b.status === 'working' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.name.localeCompare(b.name);
    });
  }, [agents]);

  // Auto-select first working agent, or first agent
  useEffect(() => {
    if (!selectedAgentId && sortedAgents.length > 0) {
      const working = sortedAgents.find((a) => a.status === 'working');
      setSelectedAgentId(working?.id || sortedAgents[0].id);
    }
  }, [sortedAgents, selectedAgentId]);

  // Reset selection if selected agent is removed
  useEffect(() => {
    if (selectedAgentId && !agents.find((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  if (!isVisible) return null;

  const containerClass = fullPage
    ? 'flex-1 flex overflow-hidden'
    : 'flex overflow-hidden h-full';

  return (
    <div className={containerClass}>
      {/* Agent list sidebar */}
      <div className={`w-64 shrink-0 flex flex-col border-r overflow-hidden ${
        darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'
      }`}>
        {/* Sidebar header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
          darkMode ? 'border-slate-700' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <Terminal className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
            <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
              Agents
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
            }`}>
              {agents.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded transition-colors ${
              darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
            }`}
            title="Close"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {sortedAgents.length === 0 ? (
            <div className={`p-4 text-sm text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              No agents in this project
            </div>
          ) : (
            sortedAgents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const isWorking = agent.status === 'working';

              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full text-left px-4 py-3 border-b transition-colors ${
                    darkMode
                      ? `border-slate-700/50 ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-700/50'}`
                      : `border-gray-100 ${isSelected ? 'bg-white shadow-sm' : 'hover:bg-gray-100'}`
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {/* Agent avatar */}
                    <div className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      darkMode ? 'bg-slate-600' : 'bg-gray-200'
                    }`}>
                      {agent.profile_image_url ? (
                        <img
                          src={agent.profile_image_url}
                          alt={agent.name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <User className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                      )}
                      {/* Status dot */}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                        darkMode ? 'border-slate-800' : 'border-gray-50'
                      } ${
                        isWorking ? 'bg-green-500' : agent.status === 'idle' ? 'bg-gray-400' : agent.status === 'blocked' ? 'bg-yellow-500' : 'bg-gray-400'
                      }`} />
                    </div>

                    {/* Agent info */}
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${
                        darkMode ? 'text-gray-200' : 'text-gray-800'
                      }`}>
                        {agent.name}
                      </div>
                      <div className={`text-xs truncate ${
                        darkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {agent.role}
                        {agent.specialization ? ` - ${agent.specialization}` : ''}
                      </div>
                    </div>

                    {/* Live indicator */}
                    {isWorking && (
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Output area */}
      <div className={`flex-1 flex flex-col min-w-0 ${
        darkMode ? 'bg-slate-900' : 'bg-white'
      }`}>
        {selectedAgentId ? (
          <AgentOutputView agentId={selectedAgentId} darkMode={darkMode} />
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${
            darkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>
            <Terminal className="w-12 h-12 opacity-30" />
            <p className="text-sm">Select an agent to view their live output</p>
          </div>
        )}
      </div>
    </div>
  );
}
