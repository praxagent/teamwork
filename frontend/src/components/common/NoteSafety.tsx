/**
 * Safe editing for Library notes: the conflict banner shown when a save meets
 * a newer version, and the per-note history (versions, diffs, restore).
 *
 * Prax commits every library write and refuses a save that started from an
 * older version (409) instead of letting the last save silently win.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { History, X } from 'lucide-react';
import { useNoteHistory, useNoteVersion, useRestoreNoteVersion, NoteConflictError } from '@/hooks/useApi';

export function NoteConflictBanner({ conflict, dark, onKeepMine, onTakeTheirs }: {
  conflict: NoteConflictError;
  dark: boolean;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
}) {
  const who = String(conflict.current.meta.last_edited_by || 'someone');
  const when = String(conflict.current.meta.updated_at || '');
  return (
    <div role="alert" className={clsx(
      'mb-3 rounded-lg border px-3 py-2 text-sm',
      dark ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-900',
    )}>
      <p className="font-medium">This note changed while you were editing it.</p>
      <p className="text-xs opacity-80">
        {who === 'prax' ? 'Prax' : who === 'human' ? 'Someone' : who} saved a newer version{when ? ` at ${new Date(when).toLocaleTimeString()}` : ''}.
        Your edit hasn&apos;t been saved.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={onKeepMine} className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500">
          Keep my version
        </button>
        <button onClick={onTakeTheirs} className={clsx('rounded px-2.5 py-1 text-xs font-medium',
          dark ? 'text-amber-200 hover:bg-amber-900/50' : 'text-amber-900 hover:bg-amber-100')}>
          Take theirs (discard my edit)
        </button>
      </div>
    </div>
  );
}

function DiffView({ diff, dark }: { diff: string; dark: boolean }) {
  if (!diff.trim()) return <p className="text-xs opacity-70">Same as now.</p>;
  return (
    <pre className={clsx('max-h-80 overflow-auto rounded-md p-2 text-xs leading-5',
      dark ? 'bg-slate-950' : 'bg-gray-50')}>
      {diff.split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++')).map((line, i) => (
        <div key={i} className={clsx(
          line.startsWith('+') && (dark ? 'bg-emerald-900/40 text-emerald-200' : 'bg-emerald-50 text-emerald-800'),
          line.startsWith('-') && (dark ? 'bg-rose-900/40 text-rose-200' : 'bg-rose-50 text-rose-800'),
          line.startsWith('@@') && 'opacity-50',
        )}>{line || ' '}</div>
      ))}
    </pre>
  );
}

const authorLabel = (author: string) => (author === 'You (TeamWork)' ? 'You' : author);

/** A note's versions, each with a diff against now and a restore button. */
export function NoteHistoryPanel({ project, notebook, slug, dark, onClose }: {
  project: string;
  notebook: string;
  slug: string;
  dark: boolean;
  onClose: () => void;
}) {
  const history = useNoteHistory(project, notebook, slug);
  const [selected, setSelected] = useState<string | null>(null);
  const version = useNoteVersion(project, notebook, slug, selected);
  const restore = useRestoreNoteVersion();
  const versions = history.data?.versions ?? [];

  return (
    <div className={clsx('mb-4 rounded-xl border p-3', dark ? 'border-slate-700 bg-slate-900' : 'border-gray-200 bg-white')}>
      <div className="mb-2 flex items-center gap-2">
        <History className="h-4 w-4 opacity-70" />
        <p className="flex-1 text-sm font-medium">History</p>
        <button onClick={onClose} aria-label="Close history" className="rounded p-1 opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      {history.isLoading && <p className="text-xs opacity-70">Loading…</p>}
      {!history.isLoading && versions.length === 0 && (
        <p className="text-xs opacity-70">No saved versions yet. Every save from now on is kept.</p>
      )}
      <ul className="space-y-1">
        {versions.map((v, i) => (
          <li key={v.commit}>
            <button
              onClick={() => setSelected(selected === v.commit ? null : v.commit)}
              className={clsx('w-full rounded px-2 py-1 text-left text-xs',
                selected === v.commit ? (dark ? 'bg-slate-800' : 'bg-gray-100') : (dark ? 'hover:bg-slate-800' : 'hover:bg-gray-50'))}
            >
              <span className="font-medium">{new Date(v.date).toLocaleString()}</span>
              <span className="opacity-70"> · {authorLabel(v.author)}{i === 0 ? ' · current' : ''}</span>
            </button>
            {selected === v.commit && (
              <div className="mt-1 space-y-2 pl-2">
                {version.isLoading ? <p className="text-xs opacity-70">Loading…</p> : (
                  <DiffView diff={version.data?.diff ?? ''} dark={dark} />
                )}
                {i > 0 && (
                  <button
                    disabled={restore.isPending}
                    onClick={() => restore.mutate({ project, notebook, slug, commit: v.commit }, {
                      onSuccess: () => setSelected(null),
                    })}
                    className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Restore this version
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
