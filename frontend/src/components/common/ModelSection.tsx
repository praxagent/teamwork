/**
 * A model choice rendered inline in a settings page.
 *
 * The picker used to live behind a badge in the chat header, which made it the
 * wrong shape for two jobs it now has to do: the deployment-wide choice belongs
 * in Settings, and a space's own choice belongs in that space's settings. Both
 * are the same decision at different scopes, so they are the same component
 * with a different label and a different `inheritLabel`.
 *
 * The inherit row is the part worth getting right. "Use the default" and "pin
 * the model that happens to be the default today" look identical the moment you
 * choose them, and behave differently forever after — so inheriting is an
 * explicit choice with its own row, showing what it currently resolves to.
 */
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

import { ModelPicker } from './ModelPicker';
import type { ModelInfo } from '@/hooks/useApi';

interface Props {
  title: string;
  description: string;
  info?: ModelInfo;
  /** The current choice: a model id, a tier, or null when inheriting. */
  value: string | null;
  /** What null resolves to right now, shown so "inherit" is not a mystery. */
  inheritsTo?: string | null | undefined;
  /** e.g. "Use the deployment default" or "Follow the global model". */
  inheritLabel?: string;
  darkMode?: boolean;
  disabled?: boolean;
  onSelect: (value: string | null) => void;
}

export function ModelSection({
  title,
  description,
  info,
  value,
  inheritsTo,
  inheritLabel,
  darkMode = false,
  disabled = false,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);

  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';

  return (
    <div>
      <p className={clsx('text-sm font-medium mb-2', heading)}>{title}</p>
      <p className={clsx('text-xs mb-3', subtext)}>{description}</p>

      <div className="relative inline-block">
        <button
          type="button"
          disabled={disabled || !info}
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-mono transition-colors',
            disabled || !info
              ? 'opacity-50 cursor-not-allowed'
              : darkMode
                ? 'border-slate-600 bg-slate-800 text-gray-200 hover:bg-slate-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
          )}
        >
          <span>{value ?? inheritsTo ?? 'default'}</span>
          {!value && (
            <span className={clsx('text-xs font-sans', subtext)}>inherited</span>
          )}
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {open && info && (
          <>
            {/* Click-away. A settings page has plenty of empty space to click,
                and a picker that only closes via its own button strands you. */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1">
              <ModelPicker
                info={{ ...info, override: value }}
                darkMode={darkMode}
                onSelect={(v) => {
                  onSelect(v);
                  setOpen(false);
                }}
              />
              {inheritLabel && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(null);
                    setOpen(false);
                  }}
                  className={clsx(
                    'w-full mt-1 px-3 py-2 rounded-md border text-left text-sm transition-colors',
                    darkMode
                      ? 'border-slate-600 bg-slate-800 text-gray-300 hover:bg-slate-700'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {inheritLabel}
                  {inheritsTo && (
                    <span className={clsx('block text-xs font-mono mt-0.5', subtext)}>
                      currently {inheritsTo}
                    </span>
                  )}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
