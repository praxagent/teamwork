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
import {
  ArrowLeft,
  ArrowRight,
  ClipboardCopy,
  ClipboardPaste,
  ExternalLink,
  Keyboard,
  MessageSquare,
  Monitor,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useUIStore } from '@/stores';
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

type DesktopShortcutKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ControlLeft'
  | 'Digit0'
  | 'Equal'
  | 'Minus'
  | 'Plus'
  | 'SuperLeft';

function editableElementHasFocus(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
}

function desktopShortcutFromEvent(e: KeyboardEvent): DesktopShortcutKey[] | null {
  const primaryModifier = e.ctrlKey || e.metaKey;

  // Treat Cmd as the user's local "primary" shortcut key, but send Linux
  // Control to the remote desktop for app zoom/font-size shortcuts.
  if (primaryModifier && !e.altKey) {
    if (e.key === '=') return ['ControlLeft', 'Equal'];
    if (e.key === '+') return ['ControlLeft', 'Plus'];
    if (e.key === '-' || e.key === '_') return ['ControlLeft', 'Minus'];
    if (e.key === '0' || e.key === ')') return ['ControlLeft', 'Digit0'];
  }

  if (e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'ArrowLeft') return ['SuperLeft', 'ArrowLeft'];
    if (e.key === 'ArrowRight') return ['SuperLeft', 'ArrowRight'];
  }

  return null;
}

function isTeamWorkShortcut(e: KeyboardEvent): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return true;
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') return true;
  return e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown');
}

export function DesktopPanel({ projectId, isVisible, onClose }: Props) {
  const dark = useUIStore((s) => s.darkMode);
  const [showChat, setShowChat] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [keyboardCaptured, setKeyboardCaptured] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Brief non-intrusive toast
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  }, []);

  const postDesktopMessage = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  const focusDesktop = useCallback(() => {
    setKeyboardCaptured(true);
    iframeRef.current?.focus();
    iframeRef.current?.contentWindow?.focus();
    postDesktopMessage({ type: 'teamwork-vnc:focus' });
  }, [postDesktopMessage]);

  const sendDesktopShortcut = useCallback((keys: DesktopShortcutKey[]) => {
    setKeyboardCaptured(true);
    postDesktopMessage({ type: 'teamwork-vnc:sendShortcut', keys });
    iframeRef.current?.focus();
  }, [postDesktopMessage]);

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

  // The iframe page tells us when noVNC has grabbed focus.  This lets the
  // parent shell suppress its own shortcuts while the user is driving the
  // remote desktop.
  useEffect(() => {
    if (!isVisible) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'teamwork-vnc:focused') {
        setKeyboardCaptured(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(focusDesktop, 150);
    return () => clearTimeout(timer);
  }, [isVisible, focusDesktop]);

  // If focus is still in TeamWork instead of inside the iframe, catch the
  // shortcuts browsers commonly keep for themselves and send explicit VNC
  // key events.  Once the iframe is focused, noVNC handles normal typing.
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!keyboardCaptured || editableElementHasFocus()) return;

      const keys = desktopShortcutFromEvent(e);
      if (keys) {
        e.preventDefault();
        e.stopImmediatePropagation();
        sendDesktopShortcut(keys);
        return;
      }

      if (isTeamWorkShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        focusDesktop();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, keyboardCaptured, focusDesktop, sendDesktopShortcut]);

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
  const novncUrl = '/api/desktop/teamwork.html?autoconnect=true&scale=true&reconnect=true&reconnect_delay=1000&path=api/desktop/websockify';
  const iconButton = (active = false) => clsx(
    'p-1.5 rounded transition-colors',
    active
      ? dark ? 'bg-purple-600/30 text-purple-400' : 'bg-purple-100 text-purple-600'
      : dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200',
  );

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
      {/* Toolbar — wraps on narrow (mobile) widths so its many shortcut/
          clipboard/chat/close buttons are never clipped off the right edge
          (matches BrowserPanel). The flex-1 label keeps the desktop layout
          unchanged: one row with actions pushed right. */}
      <div className={clsx(
        'flex flex-wrap items-center gap-2 px-3 py-2 border-b shrink-0',
        dark ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50',
      )}>
        <Monitor className={clsx('w-4 h-4', dark ? 'text-purple-400' : 'text-purple-600')} />
        <span className={clsx('text-sm font-medium flex-1', dark ? 'text-gray-300' : 'text-gray-700')}>
          Desktop
        </span>

        <button
          onClick={focusDesktop}
          className={iconButton(keyboardCaptured)}
          title={keyboardCaptured ? 'Desktop keyboard focused' : 'Focus desktop keyboard'}
        >
          <Keyboard className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendDesktopShortcut(['ControlLeft', 'Minus'])}
          className={iconButton()}
          title="Send Ctrl+-"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendDesktopShortcut(['ControlLeft', 'Equal'])}
          className={iconButton()}
          title="Send Ctrl+="
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendDesktopShortcut(['ControlLeft', 'Digit0'])}
          className={iconButton()}
          title="Send Ctrl+0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendDesktopShortcut(['SuperLeft', 'ArrowLeft'])}
          className={iconButton()}
          title="Send Super+Left"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendDesktopShortcut(['SuperLeft', 'ArrowRight'])}
          className={iconButton()}
          title="Send Super+Right"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

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

      {/* noVNC iframe + optional chat sidebar.  Narrow viewport (< md):
          stacked 50/50 — desktop on top, chat below — so it's obvious there's
          more than chat (toggle chat off for the full desktop). Wide viewport
          (md+): side-by-side, chat keeps its resizable width. */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 relative">
        <div className="flex-1 bg-black relative min-h-0">
          <iframe
            ref={iframeRef}
            src={novncUrl}
            className="absolute inset-0 w-full h-full border-0"
            allow="clipboard-read; clipboard-write"
            title="Linux Desktop"
            style={{ objectFit: 'contain' }}
            onFocus={() => setKeyboardCaptured(true)}
            onLoad={focusDesktop}
          />
        </div>

        {showChat && projectId && (
          // Mobile: 50% flex row (desktop gets the other half). Desktop:
          // md:contents drops the wrapper so the sidebar keeps its width.
          <div className="flex-1 min-h-0 md:contents">
            <BrowserChatSidebar
              projectId={projectId}
              activeView="desktop"
              panel="desktop"
              contentContext={{ category: 'desktop', slug: 'linux-desktop', title: 'Linux Desktop' }}
            />
          </div>
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
