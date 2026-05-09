/**
 * DesktopPanel — full Linux desktop via noVNC in an iframe.
 *
 * The sandbox container runs Xvfb + XFCE4 + x11vnc + noVNC,
 * providing a real graphical desktop that both Prax and the user
 * can interact with.  noVNC serves a web-based VNC client on
 * port 6080, which this panel embeds via iframe.
 *
 * Clipboard bridge: a WebSocket connection to the sandbox's clipboard
 * daemon keeps the X11 clipboard and browser clipboard in sync.
 *
 * Use cases:
 * - OAuth login flows that need popup windows (Google, Apple, etc.)
 * - GUI apps that Prax launches for the user
 * - Any task that needs a real desktop environment
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { clsx } from 'clsx';
import { Monitor, X, ExternalLink, MessageSquare, ClipboardCopy, ClipboardPaste } from 'lucide-react';
import { useUIStore } from '@/stores';
import { useIsMobile } from '@/hooks';
import { BrowserChatSidebar } from './BrowserChatSidebar';

interface Props {
  projectId?: string;
  isVisible: boolean;
  onClose: () => void;
}

/** Build the clipboard WebSocket URL relative to the current page. */
function clipboardWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/desktop/clipboard`;
}

export function DesktopPanel({ projectId, isVisible, onClose }: Props) {
  const dark = useUIStore((s) => s.darkMode);
  const isMobile = useIsMobile();
  const [showChat, setShowChat] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Brief non-intrusive toast
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  // --- Clipboard WebSocket connection ---
  useEffect(() => {
    if (!isVisible) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      ws = new WebSocket(clipboardWsUrl());
      wsRef.current = ws;

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'clipboard' && typeof msg.text === 'string') {
            await navigator.clipboard.writeText(msg.text);
            showToast('Clipboard synced from desktop');
          }
        } catch {
          // ignore parse errors or clipboard permission denied
        }
      };

      ws.onclose = () => {
        if (!unmounted) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isVisible, showToast]);

  // --- Paste handler: Ctrl+V while panel is focused ---
  useEffect(() => {
    if (!isVisible) return;

    const handlePaste = async (e: KeyboardEvent) => {
      // Only intercept Ctrl+V / Cmd+V when our container is focused
      if (!((e.ctrlKey || e.metaKey) && e.key === 'v')) return;
      if (!containerRef.current?.contains(document.activeElement) &&
          document.activeElement !== containerRef.current) return;

      try {
        const text = await navigator.clipboard.readText();
        if (text && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'set', text }));
          showToast('Clipboard sent to desktop');
        }
      } catch {
        // clipboard permission denied
      }
    };

    window.addEventListener('keydown', handlePaste);
    return () => window.removeEventListener('keydown', handlePaste);
  }, [isVisible, showToast]);

  if (!isVisible) return null;

  // noVNC URL — proxied through TeamWork's backend.
  const novncUrl = '/api/desktop/vnc_lite.html?autoconnect=true&scale=true&reconnect=true&reconnect_delay=1000&path=api/desktop/websockify';

  // Pull: request current desktop clipboard and write to browser clipboard
  const pullFromDesktop = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get' }));
      showToast('Pulling clipboard from desktop...');
    }
  };

  // Push: read browser clipboard and send to desktop
  const pushToDesktop = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'set', text }));
        showToast('Clipboard sent to desktop');
      } else if (!text) {
        showToast('Browser clipboard is empty');
      }
    } catch {
      showToast('Clipboard access denied — click the page first');
    }
  };

  return (
    <div ref={containerRef} tabIndex={-1} className="flex-1 flex flex-col overflow-hidden outline-none">
      {/* Toolbar */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-2 border-b shrink-0',
        dark ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50',
      )}>
        <Monitor className={clsx('w-4 h-4', dark ? 'text-purple-400' : 'text-purple-600')} />
        <span className={clsx('text-sm font-medium flex-1', dark ? 'text-gray-300' : 'text-gray-700')}>
          Desktop
        </span>

        {/* Clipboard buttons */}
        <button
          onClick={pullFromDesktop}
          className={clsx('p-1.5 rounded', dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200')}
          title="Pull clipboard from desktop"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={pushToDesktop}
          className={clsx('p-1.5 rounded', dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200')}
          title="Push clipboard to desktop"
        >
          <ClipboardCopy className="w-3.5 h-3.5" />
        </button>

        {projectId && (
          <button
            onClick={() => setShowChat((v) => !v)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showChat
                ? dark ? 'bg-purple-600/30 text-purple-400' : 'bg-purple-100 text-purple-600'
                : dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200',
            )}
            title="Chat with Prax about the desktop"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}
        <a
          href={novncUrl}
          target="_blank"
          rel="noreferrer"
          className={clsx('p-1.5 rounded', dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200')}
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button
          onClick={onClose}
          className={clsx('p-1.5 rounded', dark ? 'text-gray-400 hover:text-red-400 hover:bg-slate-700' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100')}
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* noVNC iframe + optional chat sidebar.  On narrow viewports
          chat takes over the whole panel area instead of squeezing the
          desktop iframe to nothing. */}
      <div className="flex-1 flex min-h-0 relative">
        <div className={clsx(
          'flex-1 bg-black relative',
          isMobile && showChat && 'hidden',
        )}>
          <iframe
            src={novncUrl}
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title="Linux Desktop"
            style={{ objectFit: 'contain' }}
          />
        </div>

        {showChat && projectId && (
          <BrowserChatSidebar
            projectId={projectId}
            activeView="desktop"
            panel="desktop"
            contentContext={{ category: 'desktop', slug: 'linux-desktop', title: 'Linux Desktop' }}
          />
        )}

        {/* Toast notification */}
        {toast && (
          <div className={clsx(
            'absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-md text-xs font-medium shadow-lg transition-opacity z-50',
            dark ? 'bg-slate-700 text-gray-200' : 'bg-gray-800 text-white',
          )}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
