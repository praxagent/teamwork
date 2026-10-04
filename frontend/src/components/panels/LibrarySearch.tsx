/**
 * Search box for the Library sidebar: Prax searches note titles, tags and
 * text; picking a result opens the note.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { Search, X } from 'lucide-react';
import { useLibrarySearch } from '@/hooks/useApi';

export function LibrarySearch({ dark, onOpen }: {
  dark: boolean;
  onOpen: (space: string, notebook: string, slug: string) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useLibrarySearch(query);
  const active = query.trim().length >= 2;
  const hits = search.data ?? [];

  return (
    <div className={clsx('px-3 py-2 border-b', dark ? 'border-slate-700' : 'border-gray-200')}>
      <div className={clsx('flex items-center gap-1.5 rounded-md border px-2 py-1',
        dark ? 'border-slate-700 bg-slate-800' : 'border-gray-300 bg-white')}>
        <Search className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
          placeholder="Search notes"
          aria-label="Search notes"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {active && (
        <div className="mt-2 max-h-80 overflow-y-auto">
          {search.isLoading && <p className="px-1 text-xs opacity-60">Searching…</p>}
          {search.isError && <p className="px-1 text-xs text-red-500">Search failed: {(search.error as Error).message}</p>}
          {!search.isLoading && !search.isError && hits.length === 0 && (
            <p className="px-1 text-xs opacity-60">No notes match.</p>
          )}
          <ul>
            {hits.map((h) => (
              <li key={`${h.space}/${h.notebook}/${h.slug}`}>
                <button
                  onClick={() => onOpen(h.space, h.notebook, h.slug)}
                  className={clsx('w-full rounded px-1.5 py-1 text-left', dark ? 'hover:bg-slate-700' : 'hover:bg-gray-100')}
                >
                  <p className="truncate text-sm font-medium">{h.title}</p>
                  <p className="truncate text-xs opacity-60">{h.snippet || `${h.space} / ${h.notebook}`}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
