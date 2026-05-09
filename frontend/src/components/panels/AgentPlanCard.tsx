/**
 * AgentPlanCard — read-only "Currently working on" widget.
 *
 * Renders a thin card in the chat view when Prax has an active
 * `agent_plan` (his private multi-step working memory).  The card
 * shows the goal, the current step, and overall progress, and
 * expands to show the full step list on click.
 *
 * This is **deliberately read-only**.  The CHI 2025 Plan-Then-Execute
 * study (N=248) found that mid-execution user edits to plans often
 * *reduce* plan quality when the system's initial plan is already
 * correct, and raise cognitive load across every NASA-TLX axis.  The
 * right trade-off is situational awareness without forced oversight:
 * let the user see what Prax is doing, don't make them babysit it.
 *
 * The Library Kanban is a separate system for human-managed project
 * work.  See `docs/library.md` in the Prax repo for the full wall
 * between the two.
 */
import { useState } from 'react';
import { clsx } from 'clsx';
import { Cpu, ChevronRight, ChevronDown, CheckCircle2, Circle } from 'lucide-react';
import { useAgentPlan } from '@/hooks/useApi';
import type { Confidence } from '@/hooks/useApi';
import { useUIStore } from '@/stores';

function confidenceStyle(c: Confidence | undefined) {
  switch (c) {
    case 'high':
      return { dot: 'bg-emerald-500', label: 'high confidence' };
    case 'low':
      return { dot: 'bg-red-500', label: 'low confidence — Prax is guessing' };
    default:
      return { dot: 'bg-amber-500', label: 'medium confidence' };
  }
}

export function AgentPlanCard() {
  const dark = useUIStore((s) => s.darkMode);
  const { data: plan } = useAgentPlan(true);
  const [expanded, setExpanded] = useState(false);

  if (!plan) return null;
  if (!plan.total) return null;

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const bg = dark ? 'bg-slate-800/60' : 'bg-slate-50';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const progressBg = dark ? 'bg-slate-700' : 'bg-gray-200';

  const progress = plan.total > 0 ? Math.round((plan.done_count / plan.total) * 100) : 0;
  const current = plan.current_step;
  const conf = confidenceStyle(plan.confidence);

  return (
    <div className={clsx('mx-3 my-2 rounded border', bg, border)}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left"
      >
        {expanded ? (
          <ChevronDown className={clsx('w-3.5 h-3.5 shrink-0', t3)} />
        ) : (
          <ChevronRight className={clsx('w-3.5 h-3.5 shrink-0', t3)} />
        )}
        <Cpu className={clsx('w-3.5 h-3.5 shrink-0', dark ? 'text-indigo-400' : 'text-indigo-600')} />
        <span
          className={clsx('w-2 h-2 rounded-full shrink-0', conf.dot)}
          title={conf.label}
          aria-label={conf.label}
        />
        <div className="flex-1 min-w-0">
          <div className={clsx('text-xs font-semibold truncate', t1)}>
            {current ? current.description : plan.goal}
          </div>
          <div className={clsx('text-[11px] truncate', t2)}>
            Goal: {plan.goal}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={clsx('text-[11px] tabular-nums', t2)}>
            {plan.done_count}/{plan.total}
          </span>
          <div className={clsx('w-16 h-1 rounded-full overflow-hidden', progressBg)}>
            <div
              className="h-full bg-indigo-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </button>

      {expanded && (
        <div className={clsx('px-3 pb-2 pt-0 border-t', border)}>
          <div className="space-y-0.5 pt-1.5">
            {plan.steps.map((s) => (
              <div
                key={s.step}
                className={clsx(
                  'flex items-start gap-1.5 text-xs',
                  s.done ? 'opacity-60' : '',
                )}
              >
                {s.done ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle className={clsx('w-3 h-3 shrink-0 mt-0.5', t3)} />
                )}
                <span className={clsx('tabular-nums', t3)}>{s.step}.</span>
                <span className={clsx('flex-1', s.done ? t2 : t1, s.done && 'line-through')}>
                  {s.description}
                </span>
              </div>
            ))}
          </div>
          <div className={clsx('text-[10px] mt-1.5 italic flex items-center gap-1', t3)}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', conf.dot)} />
            <span>Confidence: {plan.confidence ?? 'medium'} (self-reported, not calibrated)</span>
          </div>
          <div className={clsx('text-[10px] italic', t3)}>
            Read-only — Prax's private working memory. Not the same as the Library Kanban.
          </div>
        </div>
      )}
    </div>
  );
}
