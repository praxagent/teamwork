/**
 * Execution traces as a report a person — or a model — can read top to bottom.
 *
 * The raw export was the stored graph: nodes in insertion order (every spoke's
 * children dumped after it, so time jumps backwards), traces in list order,
 * each tool summary wrapped in `content='…' name=… tool_call_id=…`, and the
 * same 2 KB page text repeated dozens of times. A 26-minute runaway came to
 * ~150 KB, most of it noise. This keeps what diagnosis needs:
 *
 * - traces in start order, with overlaps between them called out;
 * - each call nested under its caller, siblings in start order, stamped with
 *   its offset from the trace start;
 * - failures marked, tool wrappers stripped, repeated outputs collapsed to a
 *   back-reference, long outputs trimmed;
 * - per-trace totals: status, duration, cost, tokens, calls.
 *
 * The Download button still gives the raw JSON.
 */

type Node = Record<string, unknown> & {
  span_id?: string;
  parent_id?: string | null;
  name?: string;
  status?: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_s?: number | null;
  summary?: string;
  spoke_or_category?: string;
  cost_estimate_usd?: number | null;
  llm_calls?: number;
  tokens_in?: number;
  tokens_out?: number;
  models_used?: { model?: string }[];
};

type Graph = Record<string, unknown> & {
  trace_id?: string;
  status?: string;
  trigger?: string;
  session_id?: string;
  source?: string;
  nodes?: Node[];
  cost_estimate_usd?: number | null;
  tokens_in?: number;
  tokens_out?: number;
};

const SUMMARY_MAX = 400;

const time = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '?';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function fmtOffset(ms: number): string {
  if (!Number.isFinite(ms)) return '  ?  ';
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtClock(iso?: string | null): string {
  return iso ? iso.replace('T', ' ').replace(/\.\d+/, '').replace('+00:00', 'Z') : '?';
}

const money = (v: unknown) => (typeof v === 'number' && v > 0 ? `$${v.toFixed(v < 0.01 ? 4 : 2)}` : '');

/** The text inside a LangChain ToolMessage repr, without its wrapper. */
export function cleanSummary(raw: string): string {
  let s = raw ?? '';
  const m = /^content=(['"])([\s\S]*?)\1 name='[^']*' tool_call_id='[^']*'\s*$/.exec(s);
  if (m) s = m[2];
  s = s.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\xa0/g, ' ');
  return s.replace(/\s+\n/g, '\n').trim();
}

function oneLine(s: string, max = SUMMARY_MAX): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}… [${flat.length} chars]` : flat;
}

const FAILED = new Set(['failed', 'error', 'timed_out', 'aborted', 'cancelled']);
const looksFailed = (n: Node, text: string) =>
  FAILED.has(String(n.status)) ||
  /^(Browser error|Spoke agent failed|Error:|Failed to|Unknown action)/.test(text) ||
  /Traceback \(most recent call last\)/.test(text) ||
  /\(exit code: [1-9]\d*\)/.test(text);

function nodeLabel(n: Node): string {
  const kind = n.spoke_or_category;
  const models = (n.models_used ?? []).map(m => m.model).filter(Boolean);
  const bits = [
    n.status === 'running' ? 'RUNNING' : '',
    typeof n.duration_s === 'number' ? fmtDuration(n.duration_s)
      : Number.isFinite(time(n.finished_at) - time(n.started_at))
        ? fmtDuration((time(n.finished_at) - time(n.started_at)) / 1000) : '',
    n.llm_calls ? `${n.llm_calls} LLM` : '',
    money(n.cost_estimate_usd),
    models.length ? [...new Set(models)].join('+') : '',
  ].filter(Boolean);
  const name = kind && kind !== 'tool' && kind !== n.name ? `${n.name} [${kind}]` : String(n.name ?? '?');
  return bits.length ? `${name} (${bits.join(', ')})` : name;
}

function renderGraph(g: Graph, index: number, seen: Map<string, string>): string[] {
  const nodes = (g.nodes ?? []).slice();
  const byParent = new Map<string, Node[]>();
  const ids = new Set(nodes.map(n => n.span_id));
  for (const n of nodes) {
    const parent = n.parent_id && ids.has(n.parent_id) ? n.parent_id : '';
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => time(a.started_at) - time(b.started_at));

  const roots = byParent.get('') ?? [];
  const start = Math.min(...nodes.map(n => time(n.started_at)).filter(Number.isFinite));
  const ends = nodes.map(n => time(n.finished_at)).filter(Number.isFinite);
  const running = g.status === 'running';
  const tools = nodes.filter(n => n.spoke_or_category === 'tool').length;
  const failures = nodes.filter(n => looksFailed(n, cleanSummary(String(n.summary ?? '')))).length;
  const root = roots[0];
  const duration = root && typeof root.duration_s === 'number'
    ? root.duration_s
    : ((ends.length ? Math.max(...ends) : start) - start) / 1000;

  const head = [
    `## [${index}] ${fmtClock(root?.started_at)} "${oneLine(String(g.trigger ?? ''), 160)}"`,
    [
      `status ${String(g.status ?? '?').toUpperCase()}`,
      `${fmtDuration(duration)}${running ? ' so far' : ''}`,
      money(g.cost_estimate_usd),
      g.tokens_in ? `${g.tokens_in} tok in / ${g.tokens_out ?? 0} out` : '',
      `${nodes.length} nodes, ${tools} tool calls, ${failures} failed`,
      g.source ? `via ${g.source}` : '',
      `trace ${g.trace_id}`,
    ].filter(Boolean).join(' · '),
  ];

  const lines: string[] = [];
  const walk = (n: Node, depth: number) => {
    const text = cleanSummary(String(n.summary ?? ''));
    const failed = looksFailed(n, text);
    const mark = n.status === 'running' ? '…' : failed ? '✗' : '✓';
    const pad = '  '.repeat(depth);
    lines.push(`${fmtOffset(time(n.started_at) - start)} ${pad}${mark} ${nodeLabel(n)}`);
    if (text) {
      const key = text.replace(/\s+/g, ' ');
      const prior = key.length > 60 ? seen.get(key) : undefined;
      if (prior) {
        lines.push(`       ${pad}  = same output as ${prior}`);
      } else {
        const ref = `[${index}] ${fmtOffset(time(n.started_at) - start)} ${n.name}`;
        if (key.length > 60) seen.set(key, ref);
        lines.push(`       ${pad}  ${failed ? 'ERROR: ' : ''}${oneLine(text)}`);
      }
    }
    for (const child of byParent.get(String(n.span_id)) ?? []) walk(child, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return [...head, '', ...lines];
}

/** A chronological, de-duplicated plain-text report of *graphs*. */
export function traceReport(input: readonly object[], sessionId?: string): string {
  // Loosely typed on purpose: it reads stored graphs, whose shape grows over
  // time, and only needs the fields below.
  const graphs = input as Graph[];
  const start = (g: Graph) => Math.min(...(g.nodes ?? []).map(n => time(n.started_at)).filter(Number.isFinite));
  const end = (g: Graph) => {
    if (g.status === 'running') return Infinity;
    const ends = (g.nodes ?? []).map(n => time(n.finished_at)).filter(Number.isFinite);
    return ends.length ? Math.max(...ends) : start(g);
  };
  const ordered = graphs.slice().sort((a, b) => start(a) - start(b));
  const cost = ordered.reduce((sum, g) => sum + (typeof g.cost_estimate_usd === 'number' ? g.cost_estimate_usd : 0), 0);

  const out = [
    `# Prax trace report${sessionId ? ` — session ${sessionId}` : ''}`,
    `${ordered.length} trace(s), oldest first · total ${money(cost) || '$0'} · times are offsets from each trace's start · ✓ ok ✗ failed … still running`,
  ];

  // Turns that ran at the same time matter: they share one browser, one sandbox.
  const overlaps: string[] = [];
  ordered.forEach((a, i) => ordered.slice(i + 1).forEach((b, j) => {
    if (start(b) < end(a)) overlaps.push(`[${i + 1}] and [${i + j + 2}]`);
  }));
  if (overlaps.length) out.push(`Overlapping turns (ran concurrently): ${overlaps.join(', ')}`);

  const seen = new Map<string, string>();
  ordered.forEach((g, i) => out.push('', ...renderGraph(g, i + 1, seen)));
  return out.join('\n') + '\n';
}
