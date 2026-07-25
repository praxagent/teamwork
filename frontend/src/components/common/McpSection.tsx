/**
 * The "connect a coding agent to this space" panel.
 *
 * Two things a user needs and one they do not. They need the connect command,
 * and they need the skill — the instructions that stop a connected agent from
 * either ignoring the board or burying it under its own scratch todos. They do
 * not need us to hand them a token: the skill gets pasted into repos and chat
 * windows, so it carries a placeholder and says so, loudly enough that nobody
 * pastes `<your-key>` into a config and wonders why it 401s.
 *
 * When MCP is off, this says which of the two gates is closed. "Enabled but
 * nothing granted" is a real state — you flip the flag and expect it to work —
 * and calling it simply "off" sends you to fix the wrong thing.
 */
import { Check, Copy, Plug } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

import { useMcpSkill, useMcpStatus } from '@/hooks/useApi';

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
  const { data: status } = useMcpStatus(space);
  // Only fetched once asked for: it is a page of text nobody needs by default.
  const { data: skill } = useMcpSkill(space, spaceName, showSkill);

  const t2 = darkMode ? 'text-slate-400' : 'text-slate-500';
  const t3 = darkMode ? 'text-slate-500' : 'text-slate-400';
  const pre = clsx(
    'mt-2 p-3 rounded text-xs font-mono whitespace-pre-wrap break-all',
    darkMode ? 'bg-slate-900 text-slate-300' : 'bg-gray-50 text-slate-700',
  );

  if (!status) return null;

  if (!status.available) {
    return (
      <div>
        <label className={clsx('text-xs font-semibold block mb-1.5', t3)}>
          CODING AGENTS (MCP)
        </label>
        <p className={clsx('text-xs', t2)}>
          {status.reason ?? 'Not available.'}
          {!status.enabled
            ? ' Set MCP_ENABLED=true in TeamWork’s .env and restart.'
            : ' Add "mcp": true to a credential in your agent-clients registry.'}
        </p>
      </div>
    );
  }

  const scoped = status.keys_for_space.filter((k) => k.scoped);

  return (
    <div>
      <label className={clsx('text-xs font-semibold block mb-1.5', t3)}>
        CODING AGENTS (MCP)
      </label>
      <p className={clsx('text-xs mb-3', t2)}>
        Let Claude Code, Codex or another harness read and write this space —
        board items, notes and comments. It cannot join the chat.
      </p>

      {status.keys_for_space.length === 0 ? (
        <p className={clsx('text-xs', t2)}>
          No key reaches this space yet. Add one to your registry with{' '}
          <code>"spaces": ["{space}"]</code>.
        </p>
      ) : (
        <>
          <p className={clsx('text-xs mb-2', t2)}>
            {scoped.length > 0
              ? `${scoped.length} key${scoped.length > 1 ? 's' : ''} scoped to this space`
              : 'Reachable by a workspace-wide key — scope one to this space to narrow it'}
          </p>

          <div className={pre}>
            {status.server_url}
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <CopyButton text={status.server_url} label="Copy URL" darkMode={darkMode} />
            <button
              type="button"
              onClick={() => setShowSkill((v) => !v)}
              className={clsx(
                'px-2.5 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors',
                darkMode
                  ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  : 'bg-gray-200 hover:bg-gray-300 text-slate-800',
              )}
            >
              <Plug className="w-3 h-3" />
              {showSkill ? 'Hide skill' : 'Get agent skill'}
            </button>
          </div>

          {showSkill && skill && (
            <div className="mt-3">
              <p className={clsx('text-xs mb-2', t2)}>
                Save as <code>{skill.filename}</code> in your agent’s skills
                directory. It tells the agent what belongs on this board — and
                what is its own scratch work and should stay off it.
              </p>
              <div className="flex gap-2 flex-wrap">
                <CopyButton text={skill.skill} label="Copy skill" darkMode={darkMode} />
                <CopyButton text={skill.connect} label="Copy connect command" darkMode={darkMode} />
              </div>
              <p className={clsx('text-xs mt-2', t3)}>
                Replace <code>&lt;your-key&gt;</code> with the token from your
                registry — the skill never contains it, so it is safe to commit.
              </p>
              <pre className={clsx(pre, 'max-h-64 overflow-y-auto')}>{skill.skill}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
