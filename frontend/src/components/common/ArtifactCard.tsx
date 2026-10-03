import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Maximize2, Minimize2, LayoutTemplate } from 'lucide-react';
import { useArtifact, useArtifactMeta } from '@/hooks/useApi';
import { prepareArtifactDocument } from '@/utils/artifacts';

/**
 * A page the agent made, rendered in a sandboxed frame: `allow-scripts` and
 * NOT `allow-same-origin`, so it runs in an opaque origin and cannot touch
 * TeamWork's session, storage or /api/*; its CSP allows no network. See
 * utils/artifacts.ts.
 */
export function ArtifactFrame({ html, title, maxHeight }: { html: string; title: string; maxHeight?: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  const doc = useMemo(() => prepareArtifactDocument(html), [html]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only this frame's own window may size it, and only with a number.
      if (event.source !== frameRef.current?.contentWindow) return;
      const reported = (event.data as { tvArtifactHeight?: unknown })?.tvArtifactHeight;
      if (typeof reported === 'number' && Number.isFinite(reported)) {
        setHeight(Math.max(80, Math.min(reported, 20_000)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      className="w-full block bg-white"
      style={{ height: maxHeight ? Math.min(height, maxHeight) : height, border: 0 }}
    />
  );
}

/** `[artifact:<id>]` in a message or note: the artifact, live, with a full-screen view. */
export function ArtifactCard({ id }: { id: string }) {
  const meta = useArtifactMeta(id);
  const page = useArtifact(id, meta.data?.version);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (meta.isError) {
    return (
      <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-500">
        Artifact <code>{id}</code> is not available.
      </div>
    );
  }
  const title = meta.data?.title ?? 'Artifact';
  const header = (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
      <LayoutTemplate className="w-3.5 h-3.5 shrink-0" aria-hidden />
      <span className="font-medium truncate">{title}</span>
      {meta.data && <span className="text-gray-400 shrink-0">v{meta.data.version}</span>}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="ml-auto p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        aria-label={expanded ? 'Close full screen' : 'Open full screen'}
        title={expanded ? 'Close (Esc)' : 'Open full screen'}
      >
        {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
  const body = page.data
    ? <ArtifactFrame html={page.data.html} title={title} maxHeight={expanded ? undefined : 480} />
    : <div className="p-4 text-center text-sm text-gray-500">Loading artifact…</div>;

  return (
    <>
      <div className="my-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {header}
        <div className="max-h-[480px] overflow-auto">{!expanded && body}</div>
      </div>
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-2 md:p-8"
          onClick={() => setExpanded(false)}
        >
          <div
            className={clsx('w-full max-w-6xl h-full rounded-lg overflow-hidden flex flex-col',
              'bg-white dark:bg-gray-900')}
            onClick={(e) => e.stopPropagation()}
          >
            {header}
            <div className="flex-1 overflow-auto">{body}</div>
          </div>
        </div>
      )}
    </>
  );
}
