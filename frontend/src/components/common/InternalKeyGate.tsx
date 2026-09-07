/**
 * The screen that appears when the backend refuses a request for want of an
 * internal-key session (see hooks/useInternalKey.ts). Renders nothing at all
 * while the app is not locked, which on a deployment without
 * INTERNAL_API_KEY set is always.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useInternalKey } from '@/hooks/useInternalKey';
import { useUIStore } from '@/stores';

export function InternalKeyGate() {
  const { locked, error, submitting, login } = useInternalKey();
  const darkMode = useUIStore((s) => s.darkMode);
  const [key, setKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (locked) inputRef.current?.focus();
  }, [locked]);

  if (!locked) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || submitting) return;
    if (await login(trimmed)) setKey('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="internal-key-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSubmit}
        className={clsx(
          'w-full max-w-sm rounded-2xl border shadow-2xl p-6 space-y-4',
          darkMode ? 'bg-slate-900 border-slate-700 text-gray-100' : 'bg-white border-gray-200 text-gray-900',
        )}
      >
        <div className="flex items-center gap-3">
          <div className={clsx('p-2 rounded-lg', darkMode ? 'bg-slate-800' : 'bg-gray-100')}>
            <KeyRound className="w-5 h-5 text-tw-accent" />
          </div>
          <div>
            <h2 id="internal-key-title" className="font-semibold">Internal key required</h2>
            <p className={clsx('text-xs mt-0.5', darkMode ? 'text-gray-400' : 'text-gray-500')}>
              This TeamWork asks for its internal API key before serving anything.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="internal-key" className="block text-sm font-medium mb-1">
            Key
          </label>
          <input
            ref={inputRef}
            id="internal-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={submitting}
            className={clsx(
              'block w-full rounded-md border px-3 py-2 text-sm outline-none',
              'focus:border-tw-accent focus:ring-1 focus:ring-tw-accent',
              darkMode
                ? 'bg-slate-800 border-slate-600 text-gray-100 placeholder-gray-500'
                : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400',
              error && 'border-red-500',
            )}
            placeholder="Paste the INTERNAL_API_KEY value"
          />
          {error && (
            <p role="alert" className="mt-1 text-sm text-red-500">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || !key.trim()}
          className={clsx(
            'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium',
            'bg-tw-accent text-white hover:bg-indigo-600 transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Unlock
        </button>
      </form>
    </div>
  );
}
