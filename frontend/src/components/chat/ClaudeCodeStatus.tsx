import { useState } from 'react';
import { Bot, X, Clock, MessageSquare } from 'lucide-react';
import { useClaudeCodeSessions, useKillClaudeCodeSession } from '@/hooks/useApi';

interface ClaudeCodeStatusProps {
  darkMode: boolean;
}

function formatIdle(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function ClaudeCodeStatus({ darkMode }: ClaudeCodeStatusProps) {
  const { data } = useClaudeCodeSessions();
  const killSession = useKillClaudeCodeSession();
  const [expanded, setExpanded] = useState(false);

  const sessions = data?.sessions ?? [];
  const bridgeAvailable = data?.bridge_available ?? false;

  // Don't render anything if bridge is down and no sessions
  if (!bridgeAvailable && sessions.length === 0) return null;

  // Compact badge when no active sessions
  if (sessions.length === 0) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        darkMode ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'
      }`}>
        <Bot className="w-3 h-3" />
        Bridge idle
      </span>
    );
  }

  return (
    <div className="relative">
      {/* Active session badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors ${
          darkMode
            ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60'
            : 'bg-green-100 text-green-700 hover:bg-green-200'
        }`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        {sessions.length} active session{sessions.length > 1 ? 's' : ''}
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <div className={`absolute top-full right-0 mt-1 z-50 w-72 rounded-lg shadow-lg border ${
          darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'
        }`}>
          <div className={`px-3 py-2 border-b text-xs font-semibold ${
            darkMode ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600'
          }`}>
            Claude Code Sessions
          </div>
          {sessions.map((s) => (
            <div
              key={s.session_id}
              className={`px-3 py-2 flex items-center justify-between gap-2 ${
                darkMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-50'
              }`}
            >
              <div className="min-w-0">
                <div className={`text-xs font-mono truncate ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                  {s.session_id}
                </div>
                <div className={`flex items-center gap-2 text-xs mt-0.5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                  <span className="flex items-center gap-0.5">
                    <MessageSquare className="w-3 h-3" />
                    {s.turn_count} turns
                  </span>
                  <span className="flex items-center gap-0.5">
                    <Clock className="w-3 h-3" />
                    idle {formatIdle(s.idle_seconds)}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  killSession.mutate(s.session_id);
                }}
                disabled={killSession.isPending}
                className={`p-1 rounded transition-colors ${
                  darkMode
                    ? 'hover:bg-red-900/50 text-slate-500 hover:text-red-400'
                    : 'hover:bg-red-100 text-slate-400 hover:text-red-600'
                }`}
                title="End session"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
