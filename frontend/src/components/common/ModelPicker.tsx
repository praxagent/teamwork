/**
 * Choosing which model answers you.
 *
 * Three states that are genuinely different, so they are shown as such rather
 * than flattened into one list of names:
 *
 *   auto   — the agent routes per task (cheap model for easy work, big model
 *            for hard work). The default, and usually the right answer.
 *   tier   — pin a capability level. The concrete model behind "high" can still
 *            change as the deployment is reconfigured; the *level* is fixed.
 *   model  — pin one exact model. Nothing routes.
 *
 * The layout problem this solves: a provider's real catalogue is hundreds of
 * entries. Rendering them flat pushed the panel off-screen with no scroll, and
 * buried the *other providers* below a wall of OpenAI names — so switching to
 * Anthropic or OpenRouter looked impossible. Hence: a fixed height that scrolls,
 * provider sections collapsed to a count, and a filter box that searches across
 * all of them at once.
 *
 * Providers come from the agent, because only it knows what is configured — and
 * under a secrets-proxy it cannot fully know either. A provider may be
 * `configured` (a call can be attempted) without being `verified` (the agent
 * holds a credential it can vouch for). We show that rather than a green tick we
 * cannot back up.
 */
import { clsx } from 'clsx';
import { Check, ChevronDown, ChevronRight, Cpu, Info, Search, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ModelInfo } from '@/hooks/useApi';

const TIER_ORDER = ['low', 'medium', 'high', 'pro'] as const;
const TIER_LABEL: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', pro: 'Pro',
};

interface Props {
  info: ModelInfo;
  darkMode?: boolean;
  /** `null` for auto, a tier name to pin a level, or a model id to pin one. */
  onSelect: (value: string | null) => void;
}

export function ModelPicker({ info, darkMode = false, onSelect }: Props) {
  const mode = info.mode ?? (info.override ? 'model' : 'auto');
  const providers = info.providers ?? [];
  const tiers = info.tiers ?? {};

  const [query, setQuery] = useState('');
  // Collapsed by default: the point of the section header is to be a summary you
  // can skip past, not a wall you have to scroll through.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return providers.map((p) => ({
      ...p,
      shown: q ? p.models.filter((m) => m.toLowerCase().includes(q)) : p.models,
    }));
  }, [providers, query]);

  const searching = query.trim().length > 0;

  const row = (active: boolean) =>
    clsx('w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
      active
        ? darkMode ? 'bg-slate-700/60 text-white' : 'bg-gray-100 text-gray-900'
        : darkMode ? 'text-gray-300 hover:bg-slate-700/40' : 'text-gray-700 hover:bg-gray-50');

  const heading = clsx('px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide',
    darkMode ? 'text-gray-500' : 'text-gray-400');

  return (
    <div className={clsx('w-[min(20rem,calc(100vw-2rem))] rounded-lg border shadow-lg overflow-hidden flex flex-col',
      darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200')}>

      {/* Auto and the tiers stay pinned: they are the choices most people want,
          and they must not scroll away behind a long catalogue. */}
      <div className={clsx('shrink-0 border-b', darkMode ? 'border-slate-700' : 'border-gray-100')}>
        <button type="button" onClick={() => onSelect(null)} className={clsx(row(mode === 'auto'), 'py-2')}>
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span className="font-medium">Auto</span>
          <span className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
            agent picks per task
          </span>
          {mode === 'auto' && <Check className="w-3.5 h-3.5 ml-auto text-green-500" />}
        </button>

        {TIER_ORDER.filter((t) => tiers[t]).map((tier) => {
          const t = tiers[tier];
          const active = mode === 'tier' && info.override === tier;
          return (
            <button
              key={tier}
              type="button"
              disabled={!t.enabled}
              onClick={() => onSelect(tier)}
              className={clsx(row(active), !t.enabled && 'opacity-40 cursor-not-allowed')}
              title={t.enabled ? `Currently ${t.model}` : 'This tier is disabled'}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{TIER_LABEL[tier] ?? tier}</span>
              <span className={clsx('ml-auto text-xs truncate max-w-[10rem]',
                darkMode ? 'text-gray-500' : 'text-gray-400')}>
                {t.model}
              </span>
              {active && <Check className="w-3.5 h-3.5 text-green-500" />}
            </button>
          );
        })}
      </div>

      {providers.length > 0 && (
        <div className={clsx('shrink-0 px-2 py-2 border-b',
          darkMode ? 'border-slate-700' : 'border-gray-100')}>
          <div className="relative">
            <Search className={clsx('absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5',
              darkMode ? 'text-gray-500' : 'text-gray-400')} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all models…"
              aria-label="Search models"
              className={clsx(
                'w-full pl-7 pr-2 py-1 text-sm rounded border outline-none',
                darkMode
                  ? 'bg-slate-900 border-slate-700 text-gray-200 placeholder-gray-500'
                  : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400')}
            />
          </div>
        </div>
      )}

      {/* The only scrolling region. Bounded so the panel can never run off the
          bottom of the window the way a flat list did. */}
      <div className="overflow-y-auto max-h-72">
        {filtered.map((p) => {
          // While searching, expand anything with a hit — hiding matches behind a
          // collapsed header would make the search look broken.
          const expanded = searching ? true : !!open[p.id];
          return (
            <div key={p.id}>
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [p.id]: !s[p.id] }))}
                disabled={searching || !p.configured}
                className={clsx(heading,
                  'w-full flex items-center gap-1.5 hover:opacity-80 disabled:hover:opacity-100')}
              >
                {p.configured && !searching && (
                  expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
                )}
                {p.label}
                {p.configured && (
                  <span className="normal-case font-normal opacity-60">({p.shown.length})</span>
                )}
                {!p.configured && (
                  <span className="normal-case font-normal text-[10px] opacity-70">not configured</span>
                )}
                {p.configured && !p.verified && (
                  <Info className="w-3 h-3 opacity-60 ml-auto" aria-label={p.reason ?? undefined} />
                )}
              </button>

              {!p.configured ? (
                <p className={clsx('px-3 pb-2 text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                  {p.reason}
                </p>
              ) : expanded && (
                p.shown.length === 0 ? (
                  <p className={clsx('px-3 pb-2 text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                    {searching ? 'No match here.' : 'No models reported.'}
                  </p>
                ) : (
                  p.shown.map((model) => {
                    const active = mode === 'model' && info.override === model;
                    return (
                      <button key={model} type="button" onClick={() => onSelect(model)}
                              className={row(active)}>
                        <span className="truncate">{model}</span>
                        {active && <Check className="w-3.5 h-3.5 ml-auto text-green-500" />}
                      </button>
                    );
                  })
                )
              )}
            </div>
          );
        })}
      </div>

      {info.egress_proxied && (
        <p className={clsx('shrink-0 px-3 py-2 text-[11px] border-t',
          darkMode ? 'text-gray-500 border-slate-700' : 'text-gray-400 border-gray-100')}>
          Credentials are held by the secrets proxy, so availability here is
          best-effort.
        </p>
      )}
    </div>
  );
}

export default ModelPicker;
