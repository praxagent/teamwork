import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useUIStore } from '@/stores';

/**
 * The human side of an approval gate.
 *
 * An agent that wants to do something risky asks TeamWork for approval and
 * waits. This dialog is where a person answers — outside the chat on purpose,
 * so the agent cannot talk its way past it: the decision goes straight to
 * TeamWork (POST /api/approvals/:id/decide), never through the conversation.
 */
interface Pending {
  approval_id: string;
  capability: string;
  requested_by: string;
  payload: Record<string, unknown> | null;
  reason: string | null;
  created_at: string | null;
  expires_at: string | null;
}

const POLL_MS = 3000;

export function ApprovalPrompt() {
  const darkMode = useUIStore((s) => s.darkMode);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch('/api/approvals/pending');
      if (!resp.ok) return;
      const data = await resp.json();
      setPending(Array.isArray(data.pending) ? data.pending : []);
    } catch {
      /* offline or TeamWork restarting — try again next tick */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const current = pending[0];
  if (!current) return null;

  const decide = async (approve: boolean, scope: 'once' | 'hour' = 'once') => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/approvals/${current.approval_id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, scope }),
      });
      if (!resp.ok && resp.status !== 409) {
        // Say why (e.g. "log in to approve") — never let a person believe a
        // decision was recorded when it was not.
        let detail = '';
        try {
          const body = await resp.json();
          detail = typeof body.detail === 'string' ? body.detail : '';
        } catch { /* not JSON */ }
        setError(detail || `Could not record the decision (${resp.status}).`);
        return;
      }
      setPending((p) => p.filter((x) => x.approval_id !== current.approval_id));
      refresh();
    } catch {
      setError('Could not reach TeamWork — the decision was NOT recorded. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const action = current.capability.replace(/^prax\.(tool|egress)\./, '');
  const kind = current.capability.startsWith('prax.egress.') ? 'network access' : 'action';
  const panel = darkMode ? 'bg-slate-800 text-gray-100 border-slate-600' : 'bg-white text-gray-900 border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const code = darkMode ? 'bg-slate-900 text-gray-200' : 'bg-gray-50 text-gray-800';

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="approval-title">
      <div className={`w-full max-w-lg rounded-lg border shadow-xl ${panel}`}>
        <div className="flex items-start gap-3 p-4">
          <ShieldAlert className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h2 id="approval-title" className="text-base font-semibold">
              {current.requested_by} is asking for approval
            </h2>
            <p className={`mt-1 text-sm ${muted}`}>
              It is paused until you decide. Your answer goes straight to the safety gate, not through the chat.
            </p>
            <dl className="mt-3 space-y-1 text-sm">
              <div><dt className="inline font-medium">{kind === 'action' ? 'Action' : 'Destination'}: </dt><dd className="inline break-all font-mono">{action}</dd></div>
              {current.reason && <div><dt className="inline font-medium">Why it needs you: </dt><dd className="inline">{current.reason}</dd></div>}
            </dl>
            {current.payload && (
              <pre className={`mt-3 max-h-48 overflow-auto rounded p-2 text-xs ${code}`}>
                {JSON.stringify(current.payload, null, 2)}
              </pre>
            )}
            {pending.length > 1 && <p className={`mt-2 text-xs ${muted}`}>{pending.length - 1} more waiting after this one.</p>}
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          </div>
        </div>
        <div className={`flex flex-wrap justify-end gap-2 border-t p-3 ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
          <button type="button" disabled={busy} onClick={() => decide(false)}
            className="rounded px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950">
            Deny
          </button>
          <button type="button" disabled={busy} onClick={() => decide(true, 'hour')}
            title="Approve this kind of action from this agent for the next hour. Each use is still logged."
            className={`rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${darkMode ? 'border-slate-500 hover:bg-slate-700' : 'border-gray-300 hover:bg-gray-100'}`}>
            Allow for 1 hour
          </button>
          <button type="button" disabled={busy} onClick={() => decide(true, 'once')}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Allow once
          </button>
        </div>
      </div>
    </div>
  );
}
