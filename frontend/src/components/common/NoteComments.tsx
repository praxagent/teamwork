/**
 * Comments on a passage of a Library note, the way a shared document does it:
 * select text → Comment; the threads sit under the note with reply, resolve
 * and delete. Writing @prax asks Prax, whose answer arrives as a reply.
 *
 * Passages are highlighted with the CSS Custom Highlight API, which marks
 * ranges without touching the rendered markdown's DOM. Where a browser lacks
 * it the threads still work, just without highlights.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Check, MessageSquarePlus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import {
  useAddNoteComment, useDeleteNoteComment, useNoteComments, useReplyNoteComment, useResolveNoteComment,
  type NoteComment,
} from '@/hooks/useApi';

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * Where *quote* is in the text under *root*, as a DOM Range, or null.
 *
 * Whitespace is ignored when matching: a selection across paragraphs reads
 * "a\n\nb" while the text nodes hold "a" and "b". When the passage occurs
 * more than once, the occurrence that follows *prefix* wins.
 */
export function locatePassage(root: Node, quote: string, prefix = ''): Range | null {
  const want = squash(quote);
  if (!want) return null;
  const chars: Array<[Text, number]> = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (let i = 0; i < n.data.length; i++) {
      if (/\s/.test(n.data[i])) continue;
      text += n.data[i];
      chars.push([n, i]);
    }
  }
  const before = squash(prefix).slice(-16);
  let at = -1;
  for (let i = text.indexOf(want); i >= 0; i = text.indexOf(want, i + 1)) {
    if (at < 0) at = i;
    if (before && text.slice(0, i).endsWith(before)) { at = i; break; }
  }
  if (at < 0) return null;
  const [startNode, startOffset] = chars[at];
  const [endNode, endOffset] = chars[at + want.length - 1];
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset + 1);
  return range;
}

type HighlightRegistry = Map<string, unknown>;
const highlights = (): { registry: HighlightRegistry; Highlight: new (...r: Range[]) => unknown } | null => {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  return registry && Highlight ? { registry, Highlight } : null;
};

const who = (author: string) => (author === 'human' ? 'You' : author === 'prax' ? 'Prax' : author);
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

interface Draft { quote: string; prefix: string; suffix: string; top: number; left: number }

/** Wraps a rendered note so its text can be commented on, and shows its threads. */
export function CommentableNote({ project, notebook, slug, dark, content, editing = false, children }: {
  project: string;
  notebook: string;
  slug: string;
  dark: boolean;
  /** The note's markdown: passages are found again whenever it changes. */
  content: string;
  /** While the note is being edited there is no rendered text to select. */
  editing?: boolean;
  children: ReactNode;
}) {
  const note = { project, notebook, slug };
  const comments = useNoteComments(project, notebook, slug);
  const add = useAddNoteComment();
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const all = useMemo(() => comments.data?.comments ?? [], [comments.data]);

  // Offer "Comment" for a selection inside the note.
  useEffect(() => {
    if (editing || composing) return;
    const onChange = () => {
      const sel = window.getSelection();
      const root = contentRef.current;
      const wrap = wrapRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root || !wrap) { setDraft(null); return; }
      const range = sel.getRangeAt(0);
      const quote = sel.toString().trim();
      if (!quote || !root.contains(range.commonAncestorContainer)) { setDraft(null); return; }
      const before = document.createRange();
      before.selectNodeContents(root);
      before.setEnd(range.startContainer, range.startOffset);
      const after = document.createRange();
      after.selectNodeContents(root);
      after.setStart(range.endContainer, range.endOffset);
      const rect = range.getBoundingClientRect();
      const base = wrap.getBoundingClientRect();
      setDraft({
        quote: quote.slice(0, 2000),
        prefix: before.toString().slice(-32),
        suffix: after.toString().slice(0, 32),
        top: rect.bottom - base.top + 6,
        left: Math.max(0, Math.min(rect.left - base.left, base.width - 300)),
      });
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [editing, composing]);

  // Highlight the passages of open threads, and note which ones are gone.
  useEffect(() => {
    const root = contentRef.current;
    if (!root || editing) return;
    const api = highlights();
    let frame = 0;
    const paint = () => {
      frame = 0;
      const ranges: Range[] = [];
      let activeRange: Range | null = null;
      const gone: string[] = [];
      for (const c of all) {
        if (c.resolved || !c.quote) continue;
        const r = locatePassage(root, c.quote, c.prefix);
        if (!r) { gone.push(c.id); continue; }
        ranges.push(r);
        if (c.id === active) activeRange = r;
      }
      setMissing((prev) => (prev.size === gone.length && gone.every((id) => prev.has(id)) ? prev : new Set(gone)));
      if (!api) return;
      api.registry.set('note-comments', new api.Highlight(...ranges));
      if (activeRange) api.registry.set('note-comment-active', new api.Highlight(activeRange));
      else api.registry.delete('note-comment-active');
    };
    paint();
    // Ranges live on text nodes. When the renderer replaces them (a diagram or
    // formula finishing, a re-render) the old ranges collapse: paint again.
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(paint); });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      api?.registry.delete('note-comments');
      api?.registry.delete('note-comment-active');
    };
  }, [all, content, editing, active]);

  const submit = () => {
    if (!text.trim() || !draft) return;
    add.mutate({ ...note, text, quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix }, {
      onSuccess: () => { setText(''); setDraft(null); setComposing(false); window.getSelection()?.removeAllRanges(); },
    });
  };
  const cancel = () => { setText(''); setDraft(null); setComposing(false); };

  const showPassage = (c: NoteComment) => {
    setActive(c.id);
    const root = contentRef.current;
    const r = root && c.quote ? locatePassage(root, c.quote, c.prefix) : null;
    const el = r?.startContainer.parentElement;
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };

  const panel = dark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-gray-200 bg-white text-slate-900';

  return (
    <>
      <div ref={wrapRef} className="relative">
        <div ref={contentRef}>{children}</div>
        {draft && !editing && !composing && (
          <button
            // Keep the selection: a plain mousedown would clear it first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setComposing(true)}
            style={{ top: draft.top, left: draft.left }}
            className="absolute z-20 flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white shadow-lg hover:bg-indigo-500"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" /> Comment
          </button>
        )}
        {draft && composing && (
          <div style={{ top: draft.top, left: draft.left }}
            className={clsx('absolute z-20 w-72 rounded-lg border p-2 shadow-xl', panel)}>
            <p className="mb-1 line-clamp-2 border-l-2 border-amber-400 pl-2 text-xs opacity-70">{draft.quote}</p>
            <CommentBox
              value={text} onChange={setText} onSubmit={submit} onCancel={cancel} dark={dark}
              placeholder="Comment… (@prax to ask Prax)" busy={add.isPending} submitLabel="Comment" autoFocus
            />
            {add.isError && <p className="mt-1 text-xs text-red-500">{(add.error as Error).message}</p>}
          </div>
        )}
      </div>
      <CommentThreads
        note={note} comments={all} missing={missing} dark={dark} active={active}
        onShowPassage={showPassage}
      />
    </>
  );
}

function CommentBox({ value, onChange, onSubmit, onCancel, dark, placeholder, busy, submitLabel, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  dark: boolean;
  placeholder: string;
  busy: boolean;
  submitLabel: string;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <textarea
        autoFocus={autoFocus}
        rows={2}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
          if (e.key === 'Escape' && onCancel) onCancel();
        }}
        className={clsx('w-full resize-y rounded border px-2 py-1 text-sm outline-none',
          dark ? 'border-slate-700 bg-slate-950 focus:border-indigo-500' : 'border-gray-300 bg-white focus:border-indigo-500')}
      />
      <div className="mt-1 flex justify-end gap-1">
        {onCancel && (
          <button onClick={onCancel} className={clsx('rounded px-2 py-0.5 text-xs',
            dark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')}>Cancel</button>
        )}
        <button
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="rounded bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CommentThreads({ note, comments, missing, dark, active, onShowPassage }: {
  note: { project: string; notebook: string; slug: string };
  comments: NoteComment[];
  missing: Set<string>;
  dark: boolean;
  active: string | null;
  onShowPassage: (c: NoteComment) => void;
}) {
  const add = useAddNoteComment();
  const [showResolved, setShowResolved] = useState(false);
  const [general, setGeneral] = useState<string | null>(null);
  const open = comments.filter((c) => !c.resolved);
  const resolved = comments.length - open.length;
  const shown = showResolved ? comments : open;

  return (
    <section aria-label="Comments" className={clsx('mt-8 border-t pt-4', dark ? 'border-slate-700' : 'border-gray-200')}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Comments{open.length ? ` (${open.length})` : ''}</h3>
        {resolved > 0 && (
          <button onClick={() => setShowResolved((v) => !v)} className="text-xs opacity-70 hover:opacity-100">
            {showResolved ? 'Hide resolved' : `Show resolved (${resolved})`}
          </button>
        )}
        <span className="flex-1" />
        {general === null && (
          <button onClick={() => setGeneral('')} className="text-xs text-indigo-500 hover:text-indigo-400">
            Comment on the note
          </button>
        )}
      </div>
      {general !== null && (
        <div className="mb-3">
          <CommentBox
            value={general} onChange={setGeneral} dark={dark} busy={add.isPending} submitLabel="Comment" autoFocus
            placeholder="Comment on the whole note… (@prax to ask Prax)"
            onCancel={() => setGeneral(null)}
            onSubmit={() => add.mutate({ ...note, text: general }, { onSuccess: () => setGeneral(null) })}
          />
        </div>
      )}
      {comments.length === 0 && general === null && (
        <p className="text-xs opacity-60">Select text in the note to comment on it. Write @prax to ask Prax.</p>
      )}
      <ul className="space-y-3">
        {shown.map((c) => (
          <CommentThread
            key={c.id} note={note} comment={c} dark={dark} active={active === c.id}
            missing={missing.has(c.id)} onShowPassage={() => onShowPassage(c)}
          />
        ))}
      </ul>
    </section>
  );
}

function CommentThread({ note, comment: c, dark, active, missing, onShowPassage }: {
  note: { project: string; notebook: string; slug: string };
  comment: NoteComment;
  dark: boolean;
  active: boolean;
  missing: boolean;
  onShowPassage: () => void;
}) {
  const reply = useReplyNoteComment();
  const resolve = useResolveNoteComment();
  const remove = useDeleteNoteComment();
  const [text, setText] = useState('');
  const [replying, setReplying] = useState(false);
  const ref = { ...note, commentId: c.id };

  return (
    <li className={clsx('rounded-lg border p-3 text-sm',
      dark ? 'border-slate-700 bg-slate-900/60' : 'border-gray-200 bg-gray-50/60',
      active && 'ring-2 ring-amber-400/70',
      c.resolved && 'opacity-60')}>
      {c.quote && (
        <button onClick={onShowPassage} className="mb-2 block w-full text-left" title="Show the passage">
          <span className="line-clamp-3 border-l-2 border-amber-400 pl-2 text-xs italic opacity-80">{c.quote}</span>
          {missing && !c.resolved && (
            <span className="pl-2 text-[11px] opacity-60">This passage is no longer in the note.</span>
          )}
        </button>
      )}
      <Message author={c.author} text={c.text} at={c.created_at} />
      {c.replies.map((r) => (
        <div key={r.id} className={clsx('mt-2 border-l pl-3', dark ? 'border-slate-700' : 'border-gray-300')}>
          <Message author={r.author} text={r.text} at={r.created_at} />
        </div>
      ))}
      {c.prax_replying && (
        <p className="mt-2 flex items-center gap-1 text-xs text-indigo-500">
          <Sparkles className="h-3 w-3 animate-pulse" /> Prax is replying…
        </p>
      )}
      {replying ? (
        <div className="mt-2">
          <CommentBox
            value={text} onChange={setText} dark={dark} busy={reply.isPending} submitLabel="Reply" autoFocus
            placeholder="Reply… (@prax to ask Prax)"
            onCancel={() => { setReplying(false); setText(''); }}
            onSubmit={() => reply.mutate({ ...ref, text }, { onSuccess: () => { setText(''); setReplying(false); } })}
          />
        </div>
      ) : (
        <div className="mt-2 flex gap-3 text-xs">
          {!c.resolved && (
            <button onClick={() => setReplying(true)} className="opacity-70 hover:opacity-100">Reply</button>
          )}
          <button
            onClick={() => resolve.mutate({ ...ref, resolved: !c.resolved })}
            className="flex items-center gap-1 opacity-70 hover:opacity-100"
          >
            {c.resolved ? <><RotateCcw className="h-3 w-3" /> Reopen</> : <><Check className="h-3 w-3" /> Resolve</>}
          </button>
          <button
            onClick={() => { if (confirm('Delete this comment and its replies?')) remove.mutate(ref); }}
            className="flex items-center gap-1 text-red-500 opacity-70 hover:opacity-100"
            aria-label="Delete comment"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
      {(reply.isError || resolve.isError || remove.isError) && (
        <p className="mt-1 text-xs text-red-500">
          {((reply.error || resolve.error || remove.error) as Error).message}
        </p>
      )}
    </li>
  );
}

function Message({ author, text, at }: { author: string; text: string; at: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={clsx('text-xs font-semibold', author === 'prax' && 'text-indigo-500')}>{who(author)}</span>
        <span className="text-[11px] opacity-50">{when(at)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
