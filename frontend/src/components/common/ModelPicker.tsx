/**
 * Choosing which model answers you.
 *
 * Three states that are genuinely different and so are shown as such, rather
 * than flattened into one list of model names:
 *
 *   auto   — the agent routes per task (cheap model for easy work, big model
 *            for hard work). This is the default and usually the right answer.
 *   tier   — pin a capability level. The concrete model behind "high" can still
 *            change as the deployment is reconfigured; the *level* is fixed.
 *   model  — pin one exact model. Nothing routes.
 *
 * Providers come from the agent, because only it knows what is configured — and
 * under a secrets-proxy it cannot fully know either. A provider may be
 * `configured` (a call can be attempted) without being `verified` (the agent
 * holds a credential it can vouch for). We show that distinction instead of a
 * green tick we cannot back up.
 */
import { clsx } from 'clsx';
import { Check, Cpu, Info, Sparkles } from 'lucide-react';

import type { ModelInfo } from '@/hooks/useApi';

const TIER_ORDER = ['low', 'medium', 'high', 'pro'] as const;
const TIER_LABEL: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', pro: 'Pro',
};

interface Props {
  info: ModelInfo;
  darkMode?: boolean;
  /** Pass `null` for auto, a tier name to pin a level, or a model to pin one. */
  onSelect: (value: string | null) => void;
}

export function ModelPicker({ info, darkMode = false, onSelect }: Props) {
  const mode = info.mode ?? (info.override ? 'model' : 'auto');
  const providers = info.providers ?? [];
  const tiers = info.tiers ?? {};

  const row = (active: boolean) =>
    clsx('w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
      active
        ? darkMode ? 'bg-slate-700/60 text-white' : 'bg-gray-100 text-gray-900'
        : darkMode ? 'text-gray-300 hover:bg-slate-700/40' : 'text-gray-700 hover:bg-gray-50');

  const heading = clsx('px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide',
    darkMode ? 'text-gray-500' : 'text-gray-400');

  return (
    <div className={clsx('w-72 rounded-lg border shadow-lg overflow-hidden',
      darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200')}>

      {/* Auto — deliberately first and visually distinct: it is the recommended
          state, not just another entry in a list of models. */}
      <button type="button" onClick={() => onSelect(null)} className={row(mode === 'auto')}>
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span className="font-medium">Auto</span>
        <span className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
          agent picks per task
        </span>
        {mode === 'auto' && <Check className="w-3.5 h-3.5 ml-auto text-green-500" />}
      </button>

      <div className={heading}>Pin a level</div>
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
            {/* Show the model behind the level so "high" is not a mystery. */}
            <span className={clsx('ml-auto text-xs truncate max-w-[9rem]',
              darkMode ? 'text-gray-500' : 'text-gray-400')}>
              {t.model}
            </span>
            {active && <Check className="w-3.5 h-3.5 text-green-500" />}
          </button>
        );
      })}

      {providers.map((p) => (
        <div key={p.id}>
          <div className={heading}>
            <span className="flex items-center gap-1.5">
              {p.label}
              {!p.configured && (
                <span className="normal-case font-normal text-[10px] opacity-70">
                  not configured
                </span>
              )}
              {p.configured && !p.verified && (
                <Info className="w-3 h-3 opacity-60" aria-label={p.reason ?? undefined} />
              )}
            </span>
          </div>

          {/* An unconfigured provider still appears, with the reason — a silently
              missing provider is a support ticket; a labelled one is a fix. */}
          {!p.configured ? (
            <p className={clsx('px-3 pb-2 text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
              {p.reason}
            </p>
          ) : p.models.length === 0 ? (
            <p className={clsx('px-3 pb-2 text-xs', darkMode ? 'text-gray-500' : 'text-gray-400')}>
              No models assigned to a tier yet.
            </p>
          ) : (
            p.models.map((model) => {
              const active = mode === 'model' && info.override === model;
              return (
                <button key={model} type="button" onClick={() => onSelect(model)}
                        className={row(active)}>
                  <span className="truncate">{model}</span>
                  {active && <Check className="w-3.5 h-3.5 ml-auto text-green-500" />}
                </button>
              );
            })
          )}
        </div>
      ))}

      {info.egress_proxied && (
        <p className={clsx('px-3 py-2 text-[11px] border-t',
          darkMode ? 'text-gray-500 border-slate-700' : 'text-gray-400 border-gray-100')}>
          Credentials are held by the secrets proxy, so availability here is
          best-effort.
        </p>
      )}
    </div>
  );
}

export default ModelPicker;
