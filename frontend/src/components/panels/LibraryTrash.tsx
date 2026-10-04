/**
 * The Library's trash: deleted notes, notebooks, spaces and space files, kept
 * by Prax for a while (LIBRARY_TRASH_DAYS) and restorable from here.
 */
import { clsx } from 'clsx';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useLibraryTrash, usePurgeTrashItem, useRestoreTrashItem } from '@/hooks/useApi';
import type { TrashItem } from '@/hooks/useApi';

const KIND_LABEL: Record<TrashItem['kind'], string> = {
  note: 'Note', notebook: 'Notebook', space: 'Space', file: 'File',
};

export function LibraryTrash({ dark }: { dark: boolean }) {
  const trash = useLibraryTrash();
  const restore = useRestoreTrashItem();
  const purge = usePurgeTrashItem();
  const items = trash.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h2 className="mb-1 text-lg font-semibold">Trash</h2>
      <p className={clsx('mb-4 text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>
        Deleted items wait here before they are removed for good. Restore puts one back where it was.
      </p>
      {restore.isError && (
        <p className="mb-3 text-sm text-red-500">{(restore.error as Error).message}</p>
      )}
      {trash.isLoading && <p className="text-sm opacity-70">Loading…</p>}
      {!trash.isLoading && items.length === 0 && <p className="text-sm opacity-70">The trash is empty.</p>}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className={clsx('flex items-center gap-3 rounded-lg border px-3 py-2',
            dark ? 'border-slate-700' : 'border-gray-200')}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.label}</p>
              <p className="truncate text-xs opacity-70">
                {KIND_LABEL[item.kind] ?? item.kind} · {item.original} · deleted {new Date(item.deleted_at).toLocaleString()}
                {item.deleted_by === 'prax' ? ' by Prax' : ''}
              </p>
            </div>
            <button
              onClick={() => restore.mutate(item.id)}
              disabled={restore.isPending}
              className="inline-flex items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> Restore
            </button>
            <button
              onClick={() => { if (window.confirm(`Delete "${item.label}" for good? This can't be undone.`)) purge.mutate(item.id); }}
              disabled={purge.isPending}
              aria-label={`Delete ${item.label} for good`}
              className={clsx('rounded p-1.5', dark ? 'text-red-400 hover:bg-slate-800' : 'text-red-600 hover:bg-red-50')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
