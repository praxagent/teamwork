import { useEffect, useRef, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal as TerminalIcon, X, RotateCcw, Lock, Unlock, MessageSquare } from 'lucide-react';
import { useUIStore } from '@/stores';
import { useIsMobile } from '@/hooks';
import { BrowserChatSidebar } from './BrowserChatSidebar';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
}

export function TerminalPanel({ projectId, isVisible, onClose }: TerminalPanelProps) {
  const darkMode = useUIStore((s) => s.darkMode);
  const isMobile = useIsMobile();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(locked);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  const [error, setError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [showChat, setShowChat] = useState(true);

  // Re-fit xterm when the chat toggle changes the terminal's available width.
  useEffect(() => {
    if (!isVisible) return;
    const id = setTimeout(() => fitAddonRef.current?.fit(), 50);
    return () => clearTimeout(id);
  }, [showChat, isVisible]);

  useEffect(() => {
    if (!isVisible || !terminalRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: darkMode ? {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selectionBackground: '#334155',
      } : {
        background: '#ffffff',
        foreground: '#1e293b',
        cursor: '#1e293b',
        selectionBackground: '#bfdbfe',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const unicodeAddon = new Unicode11Addon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(unicodeAddon);
    term.unicode.activeVersion = '11';

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);
    setTimeout(() => {
      fitAddon.fit();
      if (!lockedRef.current) term.focus();
    }, 50);

    // Connect WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/terminal/ws/${projectId}?mode=docker&start_claude=false`;

    term.write('\x1b[32mConnecting to sandbox...\x1b[0m\r\n');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      const { rows, cols } = term;
      ws.send(`\x1b[8;${rows};${cols}t`);
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
    };

    ws.onclose = () => {
      setConnected(false);
      term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n');
    };

    // Input gate — blocked when locked
    term.onData((data) => {
      if (lockedRef.current) return;
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
      wsRef.current = null;
      term.dispose();
      xtermRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, projectId, reconnectKey]);

  useEffect(() => {
    if (isVisible) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (!locked) xtermRef.current?.focus();
      }, 100);
    }
  }, [isVisible, locked]);

  const handleReset = useCallback(() => {
    wsRef.current?.close();
    setReconnectKey((k) => k + 1);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ display: isVisible ? undefined : 'none' }}>
      {/* Toolbar */}
      <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${darkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'}`}>
        <TerminalIcon className={`w-4 h-4 ${connected ? 'text-green-500' : darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
        <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Terminal {connected ? '' : '(connecting...)'}
        </span>

        <div className="flex-1" />

        {/* Lock toggle — prevents accidental input */}
        <button
          onClick={() => setLocked((v) => !v)}
          className={`p-1.5 rounded transition-colors ${
            locked
              ? 'text-yellow-500 hover:text-yellow-400'
              : darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
          }`}
          title={locked ? 'Unlock input (currently view-only)' : 'Lock input (watch without typing)'}
        >
          {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>

        {/* Reset button */}
        <button
          onClick={handleReset}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'}`}
          title="Reset terminal session"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Chat toggle */}
        {projectId && (
          <button
            onClick={() => setShowChat((v) => !v)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showChat
                ? darkMode ? 'bg-purple-600/30 text-purple-400' : 'bg-purple-100 text-purple-600'
                : darkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200',
            )}
            title="Chat with Prax about the terminal"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-red-400 hover:bg-slate-700' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'}`}
          title="Close terminal"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Terminal body + optional chat sidebar.
          Narrow viewport (< md): chat takes over the whole panel area
          when open, instead of squeezing the terminal to nothing.  Wide
          viewport: side-by-side as before. */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Terminal — hidden when chat is open on narrow screens, since
            we can't reasonably show both at once. */}
        <div className={clsx(
          'flex-1 flex flex-col min-w-0',
          isMobile && showChat && 'hidden',
        )}>
          <div
            ref={terminalRef}
            className="flex-1"
            style={{ padding: '4px', background: darkMode ? '#0f172a' : '#ffffff' }}
          />

          {locked && (
            <div className={`px-3 py-1 text-xs text-center ${darkMode ? 'bg-yellow-900/20 text-yellow-500' : 'bg-yellow-50 text-yellow-700'}`}>
              Input locked — watching only
            </div>
          )}

          {error && (
            <div className={`px-3 py-1.5 text-xs ${darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'}`}>
              {error}
            </div>
          )}
        </div>

        {showChat && projectId && (
          // BrowserChatSidebar's own CSS (.browser-chat-sidebar in
          // index.css) gives it width: 100% on narrow viewports and the
          // user-set pixel width on desktop, so no wrapper sizing needed.
          <BrowserChatSidebar
            projectId={projectId}
            activeView="terminal"
            panel="terminal"
          />
        )}
      </div>
    </div>
  );
}
