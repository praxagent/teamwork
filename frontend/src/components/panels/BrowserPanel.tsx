import { useEffect, useRef, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Globe, X, RefreshCw, ChevronLeft, ChevronRight, Lock, Unlock, MessageSquare, Radio } from 'lucide-react';
import { useUIStore } from '@/stores';
import { useIsMobile } from '@/hooks';
import { BrowserChatSidebar } from './BrowserChatSidebar';

interface BrowserPanelProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
}

// Modifier key bitmask (CDP convention)
function getModifiers(e: React.MouseEvent | React.KeyboardEvent | React.WheelEvent): number {
  let m = 0;
  if (e.altKey) m |= 1;
  if (e.ctrlKey) m |= 2;
  if (e.metaKey) m |= 4;
  if (e.shiftKey) m |= 8;
  return m;
}

function jitter(v: number, range = 1): number {
  return v + Math.round((Math.random() - 0.5) * range * 2);
}

export function BrowserPanel({ projectId, isVisible, onClose }: BrowserPanelProps) {
  const darkMode = useUIStore((s) => s.darkMode);
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [locked, setLocked] = useState(false);
  const takeover = !locked; // Unlocked = interactive, locked = view-only
  const [urlInput, setUrlInput] = useState('');
  const [, setCurrentUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [browserAvailable, setBrowserAvailable] = useState<boolean | null>(null);
  const [wsDebug, setWsDebug] = useState('');
  const [showChat, setShowChat] = useState(true);
  const screenSize = useRef({ width: 1280, height: 900 });

  // Tab-cast state: A+V stream of the active sandbox-Chrome tab.  The
  // capture itself is triggered from the Desktop tab (real X11 gesture
  // — Ctrl+Shift+K or the prax-cast action icon) because chrome.tabCapture
  // refuses CDP-synthesized invocations.  This panel just opens the
  // receive WebSocket and plays whatever WebM chunks arrive.
  //   castMode = 'off':      canvas + CDP screencast (default)
  //   castMode = 'waiting':  WS open, hinting user to invoke from Desktop tab
  //   castMode = 'streaming': actively decoding WebM into the <video> element
  const [castMode, setCastMode] = useState<'off' | 'waiting' | 'streaming'>('off');
  const [castHint, setCastHint] = useState<string | null>(null);
  const [castError, setCastError] = useState<string | null>(null);
  const castVideoRef = useRef<HTMLVideoElement>(null);
  const castWsRef = useRef<WebSocket | null>(null);
  const isCasting = castMode !== 'off';

  // Check if browser is available
  useEffect(() => {
    if (!isVisible) return;
    fetch(`/api/browser/info`)
      .then(r => r.json())
      .then(data => setBrowserAvailable(data.available))
      .catch(() => setBrowserAvailable(false));
  }, [isVisible]);

  // WebSocket connection — only after browser confirmed available
  useEffect(() => {
    if (!isVisible || browserAvailable !== true) return;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/browser/ws/${projectId}?width=1280&height=900&quality=60&fps=5`;
    setWsDebug('connecting...');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setError(null);
      setWsDebug('open');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status' && msg.connected) {
        setConnected(true);
        setWsDebug('connected');
      } else if (msg.type === 'frame') {
        renderFrame(msg.data, msg.metadata);
      } else if (msg.type === 'clipboard_content') {
        // Sandbox sent back selected text — write to local clipboard
        if (msg.text) {
          navigator.clipboard.writeText(msg.text).catch(() => {});
        }
      } else if (msg.type === 'navigated') {
        setCurrentUrl(msg.url);
        setUrlInput(msg.url);
      } else if (msg.type === 'error') {
        setError(msg.message);
        setWsDebug(`error: ${msg.message}`);
      }
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
      setWsDebug('error');
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      setWsDebug('closed');
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [isVisible, projectId, browserAvailable]);

  // ── Tab-cast WebSocket + MediaSource pipeline ──
  // Intentionally NOT gated on `isVisible` — once the user clicks Cast,
  // the receive WS stays open even when the panel is hidden so chunks
  // keep arriving while the user is over in the Desktop tab clicking
  // the prax-cast icon.  Depends on the derived `isCasting` boolean
  // (not on `castMode` directly) so that internal transitions like
  // 'waiting' → 'streaming' don't tear down the WebSocket — that
  // cleanup would send `{type: 'stop'}` to the extension and kill the
  // capture we just successfully started.
  useEffect(() => {
    if (!isCasting) return;

    const video = castVideoRef.current;
    if (!video) return;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/browser/cast/client`);
    ws.binaryType = 'arraybuffer';
    castWsRef.current = ws;

    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    const pending: ArrayBuffer[] = [];
    let closed = false;

    const flush = () => {
      if (!sourceBuffer || sourceBuffer.updating || pending.length === 0) return;
      try {
        sourceBuffer.appendBuffer(pending.shift()!);
      } catch (e) {
        console.error('[cast] appendBuffer failed:', e);
      }
    };

    const setupMediaSource = (mimeType: string) => {
      mediaSource = new MediaSource();
      video.src = URL.createObjectURL(mediaSource);
      mediaSource.addEventListener('sourceopen', () => {
        if (closed || !mediaSource) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          sourceBuffer.mode = 'sequence';
          sourceBuffer.addEventListener('updateend', flush);
          flush();
        } catch (e) {
          console.error('[cast] addSourceBuffer failed for', mimeType, e);
          setCastError(`Browser cannot decode ${mimeType}`);
        }
      }, { once: true });
    };

    ws.onopen = () => {
      setCastError(null);
      // 'start' is now a *readiness signal* — the SW won't capture until
      // a real X11 gesture (Ctrl+Shift+K from the Desktop tab) fires.
      ws.send(JSON.stringify({ type: 'start' }));
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'awaiting-invocation' && typeof msg.hint === 'string') {
          setCastHint(msg.hint);
        } else if (msg.type === 'meta' && typeof msg.mimeType === 'string') {
          setupMediaSource(msg.mimeType);
        } else if (msg.type === 'started') {
          setCastMode('streaming');
          setCastHint(null);
        } else if (msg.type === 'stopped') {
          setCastMode('off');
        } else if (msg.type === 'error') {
          setCastError(String(msg.error || 'unknown cast error'));
        } else if (msg.type === 'peer_left' && msg.role === 'sandbox') {
          setCastError('Sandbox extension disconnected');
        } else if (msg.type === 'peer_joined' && msg.role === 'sandbox') {
          // Extension reconnected — re-arm.
          ws.send(JSON.stringify({ type: 'start' }));
        }
      } else if (ev.data instanceof ArrayBuffer) {
        pending.push(ev.data);
        flush();
      }
    };

    ws.onerror = () => setCastError('Cast signaling error');
    ws.onclose = () => {
      if (!closed) setCastError('Cast signaling closed');
    };

    return () => {
      closed = true;
      try { ws.send(JSON.stringify({ type: 'stop' })); } catch { /* may be closed */ }
      ws.close();
      castWsRef.current = null;
      try {
        if (mediaSource && mediaSource.readyState === 'open') mediaSource.endOfStream();
      } catch { /* ignore */ }
      URL.revokeObjectURL(video.src);
      video.removeAttribute('src');
      video.load();
      sourceBuffer = null;
      mediaSource = null;
    };
  }, [isCasting]);

  const renderFrame = useCallback((base64Data: string, metadata: Record<string, number>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      if (metadata.deviceWidth && metadata.deviceHeight) {
        screenSize.current = { width: metadata.deviceWidth, height: metadata.deviceHeight };
      }
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${base64Data}`;
  }, []);

  const toPageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = screenSize.current.width / rect.width;
      const scaleY = screenSize.current.height / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    },
    []
  );

  const sendWs = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setWsDebug(`send failed: ws ${ws ? `state=${ws.readyState}` : 'null'}`);
      return;
    }
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      setWsDebug(`send error: ${err}`);
    }
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      e.preventDefault();
      canvasRef.current?.focus();
      const { x, y } = toPageCoords(e);
      sendWs({ type: 'mouse', event: 'mousePressed', x: jitter(x), y: jitter(y), button: 'left', clickCount: 1, modifiers: getModifiers(e) });
    },
    [takeover, toPageCoords, sendWs]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      e.preventDefault();
      const { x, y } = toPageCoords(e);
      sendWs({ type: 'mouse', event: 'mouseReleased', x: jitter(x), y: jitter(y), button: 'left', clickCount: 1, modifiers: getModifiers(e) });
    },
    [takeover, toPageCoords, sendWs]
  );

  // Throttle mousemove to ~30fps; use e.buttons to detect drag (1 = left button held)
  const lastMoveRef = useRef(0);
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      const now = Date.now();
      if (now - lastMoveRef.current < 33) return;
      lastMoveRef.current = now;
      const { x, y } = toPageCoords(e);
      const btn = (e.buttons & 1) ? 'left' : 'none';
      sendWs({ type: 'mouse', event: 'mouseMoved', x, y, button: btn, clickCount: 0, modifiers: getModifiers(e) });
    },
    [takeover, toPageCoords, sendWs]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      e.preventDefault();
      const { x, y } = toPageCoords(e as unknown as React.MouseEvent<HTMLCanvasElement>);
      sendWs({ type: 'scroll', x, y, deltaX: e.deltaX, deltaY: e.deltaY, modifiers: getModifiers(e) });
    },
    [takeover, toPageCoords, sendWs]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (takeover) e.preventDefault();
    },
    [takeover]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      const mod = e.metaKey || e.ctrlKey;

      // Clipboard: Ctrl/Cmd+V → paste local clipboard into sandbox
      if (mod && e.key === 'v') {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => {
          if (text) sendWs({ type: 'clipboard_paste', text });
        }).catch(() => {});
        return;
      }

      // Clipboard: Ctrl/Cmd+C → copy selection from sandbox to local clipboard
      if (mod && e.key === 'c') {
        e.preventDefault();
        sendWs({ type: 'clipboard_copy' });
        return;
      }

      e.preventDefault();
      // keyDown without text — text goes only on the char event to avoid double input
      sendWs({
        type: 'key', event: 'keyDown', key: e.key, code: e.code,
        text: '',
        modifiers: getModifiers(e), windowsVirtualKeyCode: e.keyCode,
      });
      // char event carries the actual character for printable keys
      if (e.key.length === 1) {
        sendWs({
          type: 'key', event: 'char', key: e.key, code: e.code,
          text: e.key, modifiers: getModifiers(e), windowsVirtualKeyCode: e.keyCode,
        });
      }
    },
    [takeover, sendWs]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (!takeover) return;
      e.preventDefault();
      sendWs({
        type: 'key', event: 'keyUp', key: e.key, code: e.code,
        text: '', modifiers: getModifiers(e), windowsVirtualKeyCode: e.keyCode,
      });
    },
    [takeover, sendWs]
  );

  const handleNavigate = useCallback(() => {
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    sendWs({ type: 'navigate', url });
  }, [urlInput, sendWs]);

  const handleBack = useCallback(() => {
    sendWs({ type: 'eval', expression: 'history.back()' });
  }, [sendWs]);

  const handleForward = useCallback(() => {
    sendWs({ type: 'eval', expression: 'history.forward()' });
  }, [sendWs]);

  const handleRefresh = useCallback(() => {
    sendWs({ type: 'eval', expression: 'location.reload()' });
  }, [sendWs]);

  // We don't `return null` when !isVisible — keep the DOM mounted so the
  // cast `<video>` element and its MediaSource buffer survive tab switches,
  // and so the cast-receive WebSocket stays connected while the user goes
  // to the Desktop tab to click the prax-cast icon.
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ display: isVisible ? 'flex' : 'none' }}>
      {/* Browser toolbar */}
      <div className={`flex items-center gap-1.5 px-2 py-1.5 border-b ${darkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'}`}>
        {/* Navigation buttons */}
        <button
          onClick={handleBack}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
          title="Back"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={handleForward}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
          title="Forward"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={handleRefresh}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <Globe className={`w-3.5 h-3.5 flex-shrink-0 ml-1 ${connected ? 'text-green-500' : darkMode ? 'text-gray-500' : 'text-gray-400'}`} />

        {/* URL bar */}
        <div className="flex-1 flex">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNavigate(); } }}
            placeholder="Enter URL..."
            className={`flex-1 px-3 py-1 text-sm rounded-l border ${
              darkMode
                ? 'bg-slate-700 border-slate-600 text-gray-200 placeholder-gray-500'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
            } focus:outline-none focus:ring-1 focus:ring-blue-500`}
          />
          <button
            type="button"
            onClick={handleNavigate}
            className={`px-2.5 py-1 text-sm rounded-r border-t border-r border-b ${
              darkMode
                ? 'bg-slate-600 border-slate-500 text-gray-200 hover:bg-slate-500'
                : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Go
          </button>
        </div>

        {/* Lock toggle */}
        <button
          onClick={() => setLocked((v) => !v)}
          className={`p-1.5 rounded transition-colors ${
            locked
              ? 'text-yellow-500 hover:text-yellow-400'
              : darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
          }`}
          title={locked ? 'Unlock input (currently view-only)' : 'Lock input (watch without clicking)'}
        >
          {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        </button>

        {/* Cast A+V toggle — opens the receive-WS; the actual capture
            is started from the Desktop tab (real X11 gesture). */}
        <button
          onClick={() => {
            setCastError(null);
            setCastHint(null);
            setCastMode((m) => (m === 'off' ? 'waiting' : 'off'));
          }}
          className={clsx(
            'p-1.5 rounded transition-colors',
            castMode === 'streaming' ? 'bg-red-600/80 text-white hover:bg-red-600'
              : castMode === 'waiting' ? 'bg-amber-500/80 text-white hover:bg-amber-500'
              : darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200',
          )}
          title={
            castMode === 'streaming' ? 'Casting — click to stop'
              : castMode === 'waiting' ? 'Waiting for Desktop-tab invocation — click to cancel'
              : 'Open cast receiver (then start capture from the Desktop tab)'
          }
        >
          <Radio className="w-3.5 h-3.5" />
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
            title="Chat with Prax about the browser"
          >
            <MessageSquare className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Close browser */}
        <button
          onClick={onClose}
          className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-red-400 hover:bg-slate-700' : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'}`}
          title="Close browser"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Debug bar */}
      {wsDebug && (
        <div className={`px-3 py-0.5 text-xs font-mono ${darkMode ? 'bg-slate-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
          WS: {wsDebug}
        </div>
      )}

      {/* Browser viewport + optional chat sidebar.  On narrow viewports
          chat takes over the whole panel area instead of squeezing the
          browser canvas to nothing. */}
      <div className="flex-1 flex min-h-0">
        <div className={clsx(
          'flex-1 relative overflow-hidden bg-black min-w-0',
          isMobile && showChat && 'hidden',
        )}>
          {!connected && !error && !isCasting && (
            <div className={`absolute inset-0 flex items-center justify-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className="text-center">
                <Globe className="w-12 h-12 mx-auto mb-3 animate-pulse" />
                <p className="text-sm">Connecting to browser...</p>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-400">
              <div className="text-center">
                <Globe className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            tabIndex={0}
            className={`outline-none ${takeover ? 'cursor-crosshair' : 'cursor-default'}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              imageRendering: 'auto',
              display: isCasting ? 'none' : 'block',
            }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            onContextMenu={handleContextMenu}
          />

          {/* Cast-mode overlay: full-bleed video playing the WebM stream.
              Kept mounted unconditionally so the ref is stable when the
              useEffect runs; visibility is toggled via CSS. */}
          <video
            ref={castVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full bg-black"
            style={{ display: isCasting ? 'block' : 'none', objectFit: 'contain' }}
          />
          {isCasting && castError && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md text-xs bg-red-600/90 text-white shadow-lg">
              Cast: {castError}
            </div>
          )}
          {castMode === 'streaming' && !castError && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-medium bg-red-600/90 text-white flex items-center gap-1 shadow-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
          )}
          {castMode === 'waiting' && !castError && (
            <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${darkMode ? 'text-gray-300' : 'text-gray-100'}`}>
              <div className="text-center max-w-md px-6 py-4 rounded-lg bg-black/70 shadow-lg">
                <Radio className="w-10 h-10 mx-auto mb-3 text-amber-400 animate-pulse" />
                <p className="text-sm font-medium mb-1">Waiting for capture invocation</p>
                <p className="text-xs opacity-80">
                  {castHint || 'Click the prax-cast icon in Chrome\'s toolbar (top-right, in the Desktop tab) to start.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {showChat && projectId && (
          <BrowserChatSidebar
            projectId={projectId}
            activeView="browser"
            panel="browser"
          />
        )}
      </div>
    </div>
  );
}
