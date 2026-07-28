/**
 * "Let a coding agent work in this space" — one button, no JSON.
 *
 * Enabling mints a key scoped to this space and writes the credential registry
 * for you. The alternative, which this replaces, was: pick a slug, invent a
 * token, hand-author JSON, chmod it, wire an env var. A workspace that makes you
 * hand-edit a credential file to use its own feature has not shipped it.
 *
 * The token appears exactly once, at the moment it is minted, inside the connect
 * command — that is the one moment the user needs it, and the registry stores
 * only a hash so there is no second chance to offer. The *skill* still carries a
 * placeholder, because the skill gets committed and pasted into chat threads
 * while the connect command is read once and typed into a config.
 */
import { AlertTriangle, Check, Copy, Plug, Trash2 } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

import {
  useDisableMcp,
  useEnableMcp,
  useMcpSkill,
  useMcpStatus,
  type McpGrant,
} from '@/hooks/useApi';

interface Props {
  space: string;
  spaceName?: string;
  darkMode?: boolean;
}

function CopyButton({ text, label, darkMode }: { text: string; label: string; darkMode: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className={clsx(
        'px-2.5 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors',
        darkMode
          ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
          : 'bg-gray-200 hover:bg-gray-300 text-slate-800',
      )}
    >
      {done ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function McpSection({ space, spaceName, darkMode = false }: Props) {
  const [showSkill, setShowSkill] = useState(false);
  // Held in component state, never re-fetched: this is the only copy that will
  // ever exist. It disappears on navigate, which the warning says out loud.
  const [grant, setGrant] = useState<McpGrant | null>(null);

  const { data: status } = useMcpStatus(space);
  const { data: skill } = useMcpSkill(space, spaceName, showSkill);
  const enable = useEnableMcp(space);
  const disable = useDisableMcp(space);

  const t2 = darkMode ? 'text-slate-400' : 'text-slate-500';
  const t3 = darkMode ? 'text-slate-500' : 'text-slate-400';
  const pre = clsx(
    'mt-2 p-3 rounded text-xs font-mono whitespace-pre-wrap break-all',
    darkMode ? 'bg-slate-900 text-slate-300' : 'bg-gray-50 text-slate-700',
  );
  const btn = clsx(
    'px-2.5 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50',
    darkMode
      ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
      : 'bg-gray-200 hover:bg-gray-300 text-slate-800',
  );

  if (!status) return null;

  // The deployment flag is the one thing a button cannot do for you — it needs a
  // restart. Say exactly that rather than a generic "unavailable".
  if (!status.enabled) {
    return (
      <div>
        <label className={clsx('text-xs font-semibold block mb-1.5', t3)}>
          CODING AGENTS (MCP)
        </label>
        <p className={clsx('text-xs', t2)}>
          Set <code>MCP_ENABLED=true</code> in TeamWork’s <code>.env</code> and
          restart to let Claude Code, Codex or another harness work in this space.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className={clsx('text-xs font-semibold block mb-1.5', t3)}>
        CODING AGENTS (MCP)
      </label>
      <p className={clsx('text-xs mb-3', t2)}>
        Let Claude Code, Codex or another harness read and write{' '}
        <strong>this space only</strong> — board items, notes and comments. It
        cannot join the chat or reach your other spaces.
      </p>

      <div className="flex gap-2 flex-wrap items-center">
        <button
          type="button"
          disabled={enable.isPending}
          onClick={() => enable.mutate(undefined, { onSuccess: setGrant })}
          className={btn}
        >
          <Plug className="w-3 h-3" />
          {enable.isPending
            ? 'Enabling…'
            : status.granted
              ? 'Issue a new key'
              : 'Enable for this space'}
        </button>

        {status.granted && (
          <>
            <button
              type="button"
              onClick={() => setShowSkill((v) => !v)}
              className={btn}
            >
              {showSkill ? 'Hide skill' : 'Get agent skill'}
            </button>
            <button
              type="button"
              disabled={disable.isPending}
              onClick={() => {
                disable.mutate();
                setGrant(null);
              }}
              className={clsx(btn, 'text-red-500')}
            >
              <Trash2 className="w-3 h-3" />
              Revoke
            </button>
          </>
        )}
      </div>

      {enable.isError && (
        <p className="text-xs mt-2 text-red-500">
          {(enable.error as Error)?.message ?? 'Could not enable MCP.'}
        </p>
      )}

      {status.granted && !grant && (
        <p className={clsx('text-xs mt-2', t2)}>
          Enabled. The key was shown once when it was issued — if you no longer
          have it, issue a new one (the old key stops working).
        </p>
      )}

      {grant && (
        <div className={clsx(
          'mt-3 p-3 rounded border',
          darkMode ? 'border-amber-700/50 bg-amber-950/20' : 'border-amber-300 bg-amber-50',
        )}>
          <p className={clsx('text-xs font-medium flex items-center gap-1.5 mb-2',
            darkMode ? 'text-amber-300' : 'text-amber-800')}>
            <AlertTriangle className="w-3.5 h-3.5" />
            {grant.rotated ? 'New key issued — the previous one no longer works' : 'Key issued'}
          </p>
          <p className={clsx('text-xs mb-2', t2)}>{grant.warning}</p>
          <p className={clsx('text-xs mt-3 mb-1 font-medium', t2)}>Claude Code</p>
          <div className={pre}>{grant.connect}</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <CopyButton text={grant.connect} label="Copy command" darkMode={darkMode} />
          </div>

          {/* Codex is configured by file rather than by a CLI call, and it
              speaks stdio — so an HTTP server is reached through mcp-remote.
              We named Codex in the blurb above and then handed over a
              `claude mcp add` line, which only helps one of the two. */}
          <p className={clsx('text-xs mt-3 mb-1 font-medium', t2)}>Codex</p>
          <div className={pre}>{grant.connect_codex}</div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <CopyButton text={grant.connect_codex} label="Copy config" darkMode={darkMode} />
            <CopyButton text={grant.token} label="Copy token" darkMode={darkMode} />
          </div>
        </div>
      )}

      {showSkill && skill && (
        <div className="mt-3">
          <p className={clsx('text-xs mb-2', t2)}>
            Save as <code>{skill.filename}</code> in your agent’s skills
            directory. It tells the agent what belongs on this board — and what
            is its own scratch work and should stay off it.
          </p>
          <div className="flex gap-2 flex-wrap">
            <CopyButton text={skill.skill} label="Copy skill" darkMode={darkMode} />
          </div>
          <p className={clsx('text-xs mt-2', t3)}>
            The skill contains no key, so it is safe to commit.
          </p>
          <pre className={clsx(pre, 'max-h-64 overflow-y-auto')}>{skill.skill}</pre>
        </div>
      )}
    </div>
  );
}
