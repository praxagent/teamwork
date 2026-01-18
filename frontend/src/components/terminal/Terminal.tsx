import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { X, AlertTriangle, Terminal as TerminalIcon, Plus, Sparkles } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface TerminalTabProps {
  id: string;
  projectId: string;
  mode: 'local' | 'docker';
  startClaude: boolean;
  isActive: boolean;
  onActivate: () => void;
}

function TerminalTab({ id, projectId, mode, startClaude, isActive, onActivate }: TerminalTabProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#3c3c3c',  // Slightly lighter than background so it's visible
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
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
    
    // Delay fit to ensure container is sized
    setTimeout(() => fitAddon.fit(), 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Connect to WebSocket
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:8000/api/terminal/ws/${projectId}?mode=${mode}&start_claude=${startClaude}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    let hasConnected = false;
    
    ws.onopen = () => {
      hasConnected = true;
      setConnected(true);
      setError(null);
      if (isActive) term.focus();
      
      const { rows, cols } = term;
      ws.send(`\x1b[8;${rows};${cols}t`);
    };

    ws.onmessage = (event) => {
      // Backend now sends text (properly decoded UTF-8)
      if (typeof event.data === 'string') {
        term.write(event.data);
      } else if (event.data instanceof Blob) {
        // Fallback for binary data
        event.data.text().then((text) => {
          term.write(text);
        });
      }
    };

    ws.onerror = () => {};

    ws.onclose = (event) => {
      setConnected(false);
      if (!hasConnected) {
        setError('Connection error. Make sure the backend is running.');
      } else if (event.wasClean) {
        term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n');
      }
    };

    // Send input as binary to preserve control characters (Ctrl+C, etc.)
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        // Convert to Uint8Array to send as binary
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
  }, [projectId, mode, startClaude]);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && xtermRef.current) {
      xtermRef.current.focus();
      fitAddonRef.current?.fit();
    }
  }, [isActive]);

  return (
    <div 
      className={`flex-1 flex flex-col min-h-0 overflow-hidden ${isActive ? '' : 'hidden'}`}
      onClick={onActivate}
    >
      {error && (
        <div className="px-4 py-2 bg-red-500/10 text-red-400 text-sm border-b border-red-500/20 flex-shrink-0">
          {error}
        </div>
      )}
      <div 
        ref={terminalRef} 
        className="flex-1 p-2 min-h-0 overflow-hidden"
        style={{ backgroundColor: '#1e1e1e' }}
      />
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  startClaude: boolean;
}

interface TerminalProps {
  projectId: string;
  mode: 'local' | 'docker';
  startClaude?: boolean;
  onClose: () => void;
}

export function Terminal({ projectId, mode, startClaude = false, onClose }: TerminalProps) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', label: startClaude ? 'Claude Code' : 'Terminal', startClaude }
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const tabCounter = useRef(1);

  const addClaudeTab = useCallback(() => {
    tabCounter.current++;
    const newTab: Tab = {
      id: String(tabCounter.current),
      label: 'Claude Code',
      startClaude: true,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const addTerminalTab = useCallback(() => {
    tabCounter.current++;
    const newTab: Tab = {
      id: String(tabCounter.current),
      label: 'Terminal',
      startClaude: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (newTabs.length === 0) {
        onClose();
        return prev;
      }
      if (activeTabId === tabId) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  }, [activeTabId, onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden">
        {/* Tab Bar */}
        <div className="flex items-center bg-gray-800 border-b border-gray-700">
          <div className="flex-1 flex items-center overflow-x-auto">
            {tabs.map(tab => (
              <div
                key={tab.id}
                className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-r border-gray-700 ${
                  activeTabId === tab.id 
                    ? 'bg-gray-900 text-white' 
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-750 hover:text-gray-200'
                }`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.startClaude ? (
                  <Sparkles className="w-4 h-4 text-purple-400" />
                ) : (
                  <TerminalIcon className="w-4 h-4 text-green-400" />
                )}
                <span className="text-sm whitespace-nowrap">{tab.label}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="p-0.5 hover:bg-gray-600 rounded"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            
            {/* Add Tab Buttons */}
            <div className="flex items-center gap-1 px-2">
              <button
                onClick={addTerminalTab}
                className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                title="New Terminal"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={addClaudeTab}
                className="p-1.5 hover:bg-gray-700 rounded text-purple-400 hover:text-purple-300 flex items-center gap-1"
                title="New Claude Code"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-4">
            <span className="text-xs text-gray-500">
              {mode === 'docker' ? 'Docker' : 'Local'}
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Warning Banner */}
        <div className={`px-4 py-2 flex items-start gap-2 text-sm ${
          mode === 'docker' 
            ? 'bg-blue-500/10 text-blue-300 border-b border-blue-500/20' 
            : 'bg-yellow-500/10 text-yellow-300 border-b border-yellow-500/20'
        }`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            {mode === 'docker' ? (
              <>
                <strong>Docker Mode:</strong> Sandboxed container using your API key.
                {' '}Set <code>CLAUDE_CONFIG_BASE64</code> in .env to skip setup.
              </>
            ) : (
              <>
                <strong>Local Mode:</strong> Running directly on your machine.
                Use with caution - commands have full system access.
              </>
            )}
          </div>
        </div>

        {/* Terminal Tabs Content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {tabs.map(tab => (
            <TerminalTab
              key={tab.id}
              id={tab.id}
              projectId={projectId}
              mode={mode}
              startClaude={tab.startClaude}
              isActive={activeTabId === tab.id}
              onActivate={() => setActiveTabId(tab.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
          <div>
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">Ctrl+C</kbd>
            <span> interrupt • </span>
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">exit</kbd>
            <span> close session</span>
          </div>
          <div className="text-gray-600">
            Claude config: <code>~/.claude/settings.json</code>
          </div>
        </div>
      </div>
    </div>
  );
}
