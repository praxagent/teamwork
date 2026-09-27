import { describe, expect, it } from 'vitest';
import { cleanSummary, traceReport } from './traceReport';

const page = 'PAGE-START ' + 'Top K Frequent Elements - LeetCode. '.repeat(10);

const runaway = {
  trace_id: 'late', status: 'running', trigger: 'please solve this', session_id: 's',
  cost_estimate_usd: 3.41,
  nodes: [
    { span_id: 'o', parent_id: null, name: 'orchestrator', spoke_or_category: 'orchestrator',
      status: 'running', started_at: '2026-09-27T18:00:00+00:00', finished_at: null },
    // Stored out of order, as the real export was: the spoke's child first.
    { span_id: 'r2', parent_id: 'b', name: 'sandbox_browser_read', spoke_or_category: 'tool',
      status: 'completed', started_at: '2026-09-27T18:00:30+00:00', finished_at: '2026-09-27T18:00:31+00:00',
      summary: `content='${page}' name='sandbox_browser_read' tool_call_id='x2'` },
    { span_id: 'd', parent_id: 'o', name: 'delegate_browser', spoke_or_category: 'tool',
      status: 'completed', started_at: '2026-09-27T18:00:05+00:00', finished_at: '2026-09-27T18:02:00+00:00',
      summary: "content='Spoke agent failed: Recursion limit of 75 reached' name='delegate_browser' tool_call_id='y'" },
    { span_id: 'b', parent_id: 'd', name: 'browser', spoke_or_category: 'browser', status: 'failed',
      started_at: '2026-09-27T18:00:06+00:00', finished_at: '2026-09-27T18:02:00+00:00',
      llm_calls: 38, cost_estimate_usd: 0.29, models_used: [{ model: 'glm' }] },
    { span_id: 'r1', parent_id: 'b', name: 'sandbox_browser_read', spoke_or_category: 'tool',
      status: 'completed', started_at: '2026-09-27T18:00:10+00:00', finished_at: '2026-09-27T18:00:11+00:00',
      summary: `content='${page}' name='sandbox_browser_read' tool_call_id='x1'` },
  ],
};
const early = {
  trace_id: 'early', status: 'completed', trigger: 'create a mascot', session_id: 's',
  nodes: [{ span_id: 'e', parent_id: null, name: 'orchestrator', spoke_or_category: 'orchestrator',
    status: 'completed', started_at: '2026-09-27T17:00:00+00:00', finished_at: '2026-09-27T17:01:00+00:00',
    duration_s: 60 }],
};
const during = {
  trace_id: 'mid', status: 'completed', trigger: 'stop', session_id: 's',
  nodes: [{ span_id: 'm', parent_id: null, name: 'orchestrator', spoke_or_category: 'orchestrator',
    status: 'completed', started_at: '2026-09-27T18:10:00+00:00', finished_at: '2026-09-27T18:10:20+00:00' }],
};

describe('traceReport', () => {
  const report = traceReport([runaway, during, early], 's');

  it('orders traces oldest first and flags the ones that overlapped', () => {
    expect(report.indexOf('create a mascot')).toBeLessThan(report.indexOf('please solve this'));
    expect(report.indexOf('please solve this')).toBeLessThan(report.indexOf('"stop"'));
    expect(report).toContain('Overlapping turns (ran concurrently): [2] and [3]');
  });

  it('nests calls under their caller in time order', () => {
    const lines = report.split('\n');
    const at = (s: string) => lines.findIndex(l => l.includes(s));
    expect(at('✗ delegate_browser')).toBeLessThan(at('✗ browser ('));
    const reads = lines.filter(l => l.includes('sandbox_browser_read'));
    expect(reads[0]).toMatch(/^\+0:10 {7}✓ sandbox_browser_read/);
    expect(reads[1]).toMatch(/^\+0:30/);
  });

  it('marks failures and collapses repeated outputs', () => {
    expect(report).toContain('ERROR: Spoke agent failed: Recursion limit of 75 reached');
    expect(report).toContain('= same output as [2] +0:10 sandbox_browser_read');
    expect(report.split('PAGE-START').length - 1).toBe(1);
    expect(report).not.toContain('tool_call_id');
  });

  it('shows running totals and cost', () => {
    expect(report).toContain('status RUNNING');
    expect(report).toContain('$3.41');
    expect(report).toContain('✗ browser (1m54s, 38 LLM, $0.29, glm)');
  });
});

describe('cleanSummary', () => {
  it('unwraps a tool message and its escapes', () => {
    expect(cleanSummary("content='a\\nb isn\\'t' name='t' tool_call_id='1'")).toBe("a\nb isn't");
    expect(cleanSummary('plain text')).toBe('plain text');
  });
});
