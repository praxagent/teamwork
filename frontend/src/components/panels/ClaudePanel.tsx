import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import {
  Sparkles,
  Terminal as TerminalIcon,
  ChevronLeft,
  Wifi,
  WifiOff,
  Loader2,
  Info,
  Plus,
  X,
} from 'lucide-react';
import { useUIStore } from '@/stores';
import '@xterm/xterm/css/xterm.css';

interface ClaudePanelProps {
  projectId: string;
  isVisible: boolean;
  onBack: () => void;
}

interface TerminalInfo {
  has_terminal: boolean;
  modes: string[];
  claude_code_available: boolean;
}

interface TerminalSession {
  id: string;
  label: string;
  startClaude: boolean;
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

/**
 * Embedded terminal tab -- each one owns its own xterm + WebSocket lifecycle.
 * Hidden via CSS (not unmount) to preserve terminal state.
 */
function EmbeddedTerminal({
  projectId,
  mode,
  startClaude,
  isActive,
  onStatusChange,
}: {
  projectId: string;
  mode: string;
  startClaude: boolean;
  isActive: boolean;
  onStatusChange: (status: {
    connected: boolean;
    connecting: boolean;
    error: string | null;
  }) => void;
}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const darkMode = useUIStore((s) => s.darkMode);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: {
        background: darkMode ? '#1a1b26' : '#1e1e2e',
        foreground: '#c0caf5',
        cursor: '#7aa2f7',
        cursorAccent: '#1a1b26',
        selectionBackground: '#33467c',
        black: '#9aa5ce',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#c0caf5',
        brightBlack: '#9aa5ce',
        brightRed: '#ff9e9e',
        brightGreen: '#b5e890',
        brightYellow: '#ffd280',
        brightBlue: '#a8d1ff',
        brightMagenta: '#d4b8ff',
        brightCyan: '#a0e5ff',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';
    term.open(terminalRef.current);

    setTimeout(() => fitAddon.fit(), 100);
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // WebSocket connection
    const wsProtocol =
      window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/ws/${projectId}?mode=${mode}&start_claude=${startClaude}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let hasConnected = false;
    onStatusChange({ connected: false, connecting: true, error: null });

    ws.onopen = () => {
      hasConnected = true;
      onStatusChange({ connected: true, connecting: false, error: null });
      if (isActive) term.focus();
      const { rows, cols } = term;
      ws.send(`\x1b[8;${rows};${cols}t`);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else if (event.data instanceof Blob) {
        event.data.text().then((text) => term.write(text));
      }
    };

    ws.onerror = () => {};

    ws.onclose = (event) => {
      onStatusChange({ connected: false, connecting: false, error: null });
      if (!hasConnected) {
        setTimeout(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            onStatusChange({
              connected: false,
              connecting: false,
              error: 'Failed to connect. Make sure the backend is running.',
            });
          }
        }, 1000);
      } else if (event.wasClean) {
        term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const encoder = new TextEncoder();
        ws.send(encoder.encode(data));
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const { rows, cols } = term;
        ws.send(`\x1b[8;${rows};${cols}t`);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, mode, startClaude]);

  // Re-fit and focus when tab becomes visible/active
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.focus();
      fitAddonRef.current?.fit();
    }
  }, [isActive]);

  return (
    <div
      ref={terminalRef}
      className={`flex-1 min-h-0 overflow-hidden ${isActive ? '' : 'hidden'}`}
      style={{ padding: 4 }}
    />
  );
}

export function ClaudePanel({
  projectId,
  isVisible,
  onBack,
}: ClaudePanelProps) {
  const darkMode = useUIStore((s) => s.darkMode);

  // Terminal info from backend
  const [terminalInfo, setTerminalInfo] = useState<TerminalInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  // Sessions management
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const sessionCounter = useRef(0);

  // Fetch terminal info once
  useEffect(() => {
    let cancelled = false;
    setInfoLoading(true);
    fetch('/api/terminal/info')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setTerminalInfo(data);
      })
      .catch(() => {
        if (!cancelled)
          setTerminalInfo({
            has_terminal: true,
            modes: ['local', 'docker'],
            claude_code_available: true,
          });
      })
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addSession = useCallback(
    (startClaude: boolean) => {
      sessionCounter.current++;
      const id = `session-${sessionCounter.current}`;
      const session: TerminalSession = {
        id,
        label: startClaude ? 'Claude Code' : 'Terminal',
        startClaude,
        connected: false,
        connecting: true,
        error: null,
      };
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(id);
    },
    []
  );

  const closeSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== sessionId);
        if (activeSessionId === sessionId && next.length > 0) {
          setActiveSessionId(next[next.length - 1].id);
        } else if (next.length === 0) {
          setActiveSessionId(null);
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const updateSessionStatus = useCallback(
    (
      sessionId: string,
      status: { connected: boolean; connecting: boolean; error: string | null }
    ) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, ...status } : s))
      );
    },
    []
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const hasSessions = sessions.length > 0;

  // Determine mode from project config (default docker for containerized setups)
  const mode = 'docker';

  // Style helpers
  const bg = darkMode ? 'bg-slate-900' : 'bg-gray-50';
  const border = darkMode ? 'border-slate-700' : 'border-gray-200';
  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 overflow-hidden ${bg} ${
        isVisible ? '' : 'hidden'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${border} ${
          darkMode ? 'bg-slate-900' : 'bg-white'
        }`}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className={`p-1.5 rounded transition-colors ${
              darkMode
                ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
            title="Back to chat"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <Sparkles
            className={`w-5 h-5 ${
              darkMode ? 'text-purple-400' : 'text-purple-600'
            }`}
          />
          <h2 className={`font-bold text-lg ${heading}`}>Executive Access</h2>

          {/* Connection indicator */}
          {activeSession && (
            <span className="flex items-center gap-1.5 ml-4">
              {activeSession.connecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                  <span className="text-xs text-blue-400">Connecting</span>
                </>
              ) : activeSession.connected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-xs text-green-400">Connected</span>
                </>
              ) : activeSession.error ? (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-xs text-red-400">Error</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs text-gray-400">Disconnected</span>
                </>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasSessions && (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => addSession(false)}
                className={`p-1.5 rounded transition-colors ${
                  darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-slate-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
                title="New Terminal tab"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => addSession(true)}
                className="p-1.5 rounded transition-colors text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                title="New Claude Code tab"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Capabilities info bar */}
      {terminalInfo && !hasSessions && (
        <div
          className={`px-4 py-3 border-b ${border} ${
            darkMode ? 'bg-slate-800/50' : 'bg-blue-50'
          }`}
        >
          <div className="flex items-start gap-2">
            <Info
              className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                darkMode ? 'text-blue-400' : 'text-blue-500'
              }`}
            />
            <div className={`text-sm ${subtext}`}>
              <span className={`font-medium ${heading}`}>
                Terminal Capabilities:
              </span>{' '}
              {terminalInfo.claude_code_available
                ? 'Claude Code is available.'
                : 'Claude Code is not available on this server.'}{' '}
              Supported modes:{' '}
              {terminalInfo.modes?.join(', ') || 'local, docker'}.
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {!hasSessions ? (
        /* Launch screen */
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full space-y-6 text-center">
            <div
              className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${
                darkMode ? 'bg-purple-500/10' : 'bg-purple-50'
              }`}
            >
              <Sparkles
                className={`w-8 h-8 ${
                  darkMode ? 'text-purple-400' : 'text-purple-600'
                }`}
              />
            </div>
            <div>
              <h3 className={`text-xl font-semibold ${heading}`}>
                Executive Access
              </h3>
              <p className={`mt-2 text-sm ${subtext}`}>
                Launch a terminal session to interact directly with the project
                workspace, or start Claude Code for AI-assisted development.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => addSession(true)}
                disabled={infoLoading}
                className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {infoLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                Launch Claude Code
              </button>
              <button
                onClick={() => addSession(false)}
                disabled={infoLoading}
                className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  darkMode
                    ? 'bg-slate-700 text-gray-200 hover:bg-slate-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {infoLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TerminalIcon className="w-4 h-4" />
                )}
                Launch Terminal
              </button>
            </div>
            {terminalInfo && !terminalInfo.claude_code_available && (
              <p className="text-xs text-yellow-500">
                Claude Code is not detected on this server. Terminal sessions
                are still available.
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Tab bar + terminal area */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Tab bar */}
          {sessions.length > 0 && (
            <div
              className={`flex items-center border-b ${border} ${
                darkMode ? 'bg-slate-800' : 'bg-gray-100'
              }`}
            >
              <div className="flex-1 flex items-center overflow-x-auto">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer text-sm border-r ${border} transition-colors ${
                      activeSessionId === session.id
                        ? darkMode
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-gray-900'
                        : darkMode
                        ? 'bg-slate-800 text-gray-400 hover:text-gray-200'
                        : 'bg-gray-100 text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {session.startClaude ? (
                      <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    ) : (
                      <TerminalIcon className="w-3.5 h-3.5 text-green-400" />
                    )}
                    <span className="whitespace-nowrap">{session.label}</span>
                    {/* Connection dot */}
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        session.connecting
                          ? 'bg-blue-400 animate-pulse'
                          : session.connected
                          ? 'bg-green-400'
                          : session.error
                          ? 'bg-red-400'
                          : 'bg-gray-400'
                      }`}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeSession(session.id);
                      }}
                      className={`p-0.5 rounded transition-colors ${
                        darkMode
                          ? 'hover:bg-slate-600'
                          : 'hover:bg-gray-300'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error bar for active session */}
          {activeSession?.error && (
            <div className="px-4 py-2 bg-red-500/10 text-red-400 text-sm border-b border-red-500/20 flex-shrink-0">
              {activeSession.error}
            </div>
          )}

          {/* Terminal area */}
          <div
            className="flex-1 min-h-0 overflow-hidden flex flex-col"
            style={{
              backgroundColor: darkMode ? '#1a1b26' : '#1e1e2e',
            }}
          >
            {sessions.map((session) => (
              <EmbeddedTerminal
                key={session.id}
                projectId={projectId}
                mode={mode}
                startClaude={session.startClaude}
                isActive={activeSessionId === session.id}
                onStatusChange={(status) =>
                  updateSessionStatus(session.id, status)
                }
              />
            ))}
          </div>

          {/* Footer */}
          <div
            className={`px-4 py-2 border-t ${border} text-xs flex justify-between ${
              darkMode
                ? 'bg-slate-800 text-gray-500'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            <div>
              <kbd
                className={`px-1.5 py-0.5 rounded text-xs ${
                  darkMode
                    ? 'bg-slate-700 text-gray-300'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                Ctrl+C
              </kbd>{' '}
              interrupt{' '}
              <span className={darkMode ? 'text-slate-600' : 'text-gray-300'}>
                |
              </span>{' '}
              <kbd
                className={`px-1.5 py-0.5 rounded text-xs ${
                  darkMode
                    ? 'bg-slate-700 text-gray-300'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                exit
              </kbd>{' '}
              close session
            </div>
            <div>
              Mode: <span className="font-medium">{mode}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
