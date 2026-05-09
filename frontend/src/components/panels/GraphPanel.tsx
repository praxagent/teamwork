import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Workflow,
  X,
  Circle,
  ChevronRight,
  ChevronDown,
  Clock,
  Wrench,
  Terminal,
  Eye,
  RefreshCw,
  List,
  GitFork,
  Download,
  Clipboard,
  Check,
  ArrowRightLeft,
} from 'lucide-react';
import { useExecutionGraphs, useAgentLiveOutput, useAgents, useDeleteExecutionGraph, useMoveGraphSession } from '@/hooks/useApi';
import type { ExecutionGraph, GraphNode } from '@/hooks/useApi';
import { MarkdownContent } from '@/components/common';
import { useUIStore } from '@/stores';
import { GraphVisualView } from './GraphVisualView';

interface GraphPanelProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
  focusTraceId?: string | null;
}

function downloadGraphJSON(graph: ExecutionGraph) {
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trace-${graph.trace_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyTraceButton({ graph, darkMode, size = 'sm' }: { graph: ExecutionGraph; darkMode: boolean; size?: 'sm' | 'md' }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyTextToClipboard(JSON.stringify(graph, null, 2));
    setStatus(ok ? 'copied' : 'failed');
    setTimeout(() => setStatus('idle'), 2000);
  }, [graph]);
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const title = status === 'copied' ? 'Copied!' : status === 'failed' ? 'Copy blocked by browser — use Download' : 'Copy trace to clipboard';
  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition-colors ${
        darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
      }`}
      title={title}
    >
      {status === 'copied' ? <Check className={`${iconSize} text-green-500`} /> : <Clipboard className={`${iconSize} ${status === 'failed' ? 'text-red-500' : ''}`} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Resize handle between columns
// ---------------------------------------------------------------------------

function ResizeHandle({
  onDrag,
  darkMode,
}: {
  onDrag: (deltaX: number) => void;
  darkMode: boolean;
}) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      let lastX = e.clientX;
      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX;
        lastX = ev.clientX;
        onDrag(delta);
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onDrag],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`w-1 shrink-0 cursor-col-resize group relative transition-colors ${
        darkMode ? 'hover:bg-purple-500/40 active:bg-purple-500/60' : 'hover:bg-purple-300/50 active:bg-purple-400/60'
      }`}
      title="Drag to resize"
    >
      <div className={`absolute inset-y-0 -left-1 -right-1`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status colours
// ---------------------------------------------------------------------------

const NODE_STATUS: Record<string, { dot: string; label: string; bg: string }> = {
  running:   { dot: 'bg-green-500 animate-pulse', label: 'Running', bg: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  completed: { dot: 'bg-blue-500',               label: 'Done',    bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  failed:    { dot: 'bg-red-500',                 label: 'Failed',  bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  timed_out: { dot: 'bg-orange-500',              label: 'Timeout', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  aborted:   { dot: 'bg-gray-500',                label: 'Aborted', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
};

const CATEGORY_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  browser: 'Browser',
  sandbox: 'Sandbox',
  content: 'Content',
  finetune: 'Fine-tune',
  sysadmin: 'Sysadmin',
  knowledge: 'Knowledge',
  research: 'Research',
  workspace: 'Workspace',
  scheduler: 'Scheduler',
  codegen: 'Codegen',
  parallel: 'Parallel',
  tool: 'Tool',
};

function formatDuration(s: number): string {
  if (s < 1) return '<1s';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function TreeNode({
  node,
  children,
  depth,
  selectedSpanId,
  onSelect,
  darkMode,
  allNodes,
}: {
  node: GraphNode;
  children: GraphNode[];
  depth: number;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
  darkMode: boolean;
  allNodes: GraphNode[];
}) {
  const [expanded, setExpanded] = useState(true);
  const status = NODE_STATUS[node.status] || NODE_STATUS.completed;
  const isSelected = selectedSpanId === node.span_id;
  const hasChildren = children.length > 0;
  const categoryLabel = CATEGORY_LABELS[node.spoke_or_category] || node.spoke_or_category;
  const isTool = node.spoke_or_category === 'tool';

  return (
    <div>
      <button
        onClick={() => onSelect(node.span_id)}
        className={`w-full text-left flex items-center gap-2 px-3 ${isTool ? 'py-1' : 'py-2'} rounded-lg transition-colors ${
          isSelected
            ? darkMode ? 'bg-slate-700 ring-1 ring-purple-500/50' : 'bg-purple-50 ring-1 ring-purple-200'
            : darkMode ? 'hover:bg-slate-800' : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className={`p-0.5 rounded ${darkMode ? 'hover:bg-slate-600' : 'hover:bg-gray-200'}`}
          >
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />
            }
          </button>
        ) : (
          <span className="w-4.5" /> /* spacer */
        )}

        {/* Status dot — smaller for tool calls */}
        <span className={`${isTool ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5'} rounded-full shrink-0 ${status.dot}`} />

        {/* Name + category */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isTool ? (
            <span className={`text-xs font-mono truncate ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {node.name}
            </span>
          ) : (
            <span className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {node.name}
            </span>
          )}
          {!isTool && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
              darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'
            }`}>
              {categoryLabel}
            </span>
          )}
        </div>

        {/* Duration */}
        <span className={`text-xs tabular-nums shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {formatDuration(node.duration_s)}
        </span>

        {/* Tool calls badge — only for agent nodes, not tool call nodes */}
        {!isTool && node.tool_calls > 0 && (
          <span className={`flex items-center gap-0.5 text-xs shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <Wrench className="w-3 h-3" />
            {node.tool_calls}
          </span>
        )}
      </button>

      {/* Children */}
      {expanded && hasChildren && children.map((child) => (
        <TreeNodeWrapper
          key={child.span_id}
          node={child}
          allNodes={allNodes}
          depth={depth + 1}
          selectedSpanId={selectedSpanId}
          onSelect={onSelect}
          darkMode={darkMode}
          fullNodes={allNodes}
        />
      ))}
    </div>
  );
}

/** Wrapper that finds children for a node from the full nodes list. */
function TreeNodeWrapper({
  node,
  allNodes: _unused,
  depth,
  selectedSpanId,
  onSelect,
  darkMode,
  fullNodes,
}: {
  node: GraphNode;
  allNodes: GraphNode[];
  depth: number;
  selectedSpanId: string | null;
  onSelect: (spanId: string) => void;
  darkMode: boolean;
  fullNodes?: GraphNode[];
}) {
  // fullNodes is passed from the graph-level; allNodes is for compat
  const nodes = fullNodes || _unused;
  const children = nodes.filter((n) => n.parent_id === node.span_id);
  return (
    <TreeNode
      node={node}
      children={children}
      depth={depth}
      selectedSpanId={selectedSpanId}
      onSelect={onSelect}
      darkMode={darkMode}
      allNodes={nodes}
    />
  );
}

// ---------------------------------------------------------------------------
// Node detail panel (right side)
// ---------------------------------------------------------------------------

function NodeDetail({
  node,
  graph,
  darkMode,
  projectId,
  onSelectSpan,
}: {
  node: GraphNode;
  graph: ExecutionGraph;
  darkMode: boolean;
  projectId: string;
  onSelectSpan?: (spanId: string) => void;
}) {
  const status = NODE_STATUS[node.status] || NODE_STATUS.completed;
  const categoryLabel = CATEGORY_LABELS[node.spoke_or_category] || node.spoke_or_category;

  // Find the agent matching this node's spoke category to get live output
  const { data: agentsData } = useAgents(projectId);
  const agents = agentsData?.agents || [];

  // Try to match by role/name — spokes map loosely to agent roles
  const matchedAgent = useMemo(() => {
    const nameLC = node.name.toLowerCase();
    return agents.find(
      (a) => a.name.toLowerCase().includes(nameLC) || nameLC.includes(a.name.toLowerCase())
    );
  }, [agents, node.name]);

  const { data: liveOutput } = useAgentLiveOutput(
    matchedAgent?.id || null,
    node.status === 'running',
  );

  const outputRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [liveOutput?.output]);

  // Collect children for summary
  const children = graph.nodes.filter((n) => n.parent_id === node.span_id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`px-5 py-4 border-b shrink-0 ${
        darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center gap-3 mb-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.bg}`}>
            <Circle className={`w-2 h-2 fill-current`} />
            {status.label}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
          }`}>
            {categoryLabel}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <CopyTraceButton graph={graph} darkMode={darkMode} />
            <button
              onClick={() => downloadGraphJSON(graph)}
              className={`p-1 rounded transition-colors ${
                darkMode ? 'text-gray-500 hover:text-gray-300 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200'
              }`}
              title="Download full trace as JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <h3 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          {node.name}
        </h3>
        <div className={`flex items-center gap-4 mt-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(node.duration_s)}
          </span>
          {node.tool_calls > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {node.tool_calls} tool calls
            </span>
          )}
          <span>Started {formatTime(node.started_at)}</span>
          {node.finished_at && <span>Ended {formatTime(node.finished_at)}</span>}
        </div>
        <div className={`flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[10px] font-mono ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
          <span>span: {node.span_id}</span>
          {node.parent_id && <span>parent: {node.parent_id}</span>}
          <span>trace: {graph.trace_id}</span>
        </div>
      </div>

      {/* Summary */}
      {node.summary && (
        <div className={`px-5 py-3 border-b text-sm overflow-auto max-h-48 ${
          darkMode ? 'border-slate-700 text-gray-300 bg-slate-800/30' : 'border-gray-100 text-gray-600 bg-gray-50/50'
        }`}>
          <MarkdownContent content={node.summary} />
        </div>
      )}

      {/* Children summary */}
      {children.length > 0 && (
        <div className={`px-5 py-3 border-b ${
          darkMode ? 'border-slate-700' : 'border-gray-100'
        }`}>
          <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
            darkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>
            Delegated Spans ({children.length})
          </h4>
          <div className="space-y-1">
            {children.map((child) => {
              const cs = NODE_STATUS[child.status] || NODE_STATUS.completed;
              return (
                <button
                  key={child.span_id}
                  onClick={() => onSelectSpan?.(child.span_id)}
                  className={`flex items-center gap-2 text-sm w-full text-left rounded px-1.5 py-0.5 -mx-1.5 transition-colors ${
                    darkMode
                      ? 'text-gray-300 hover:bg-slate-700/60 hover:text-gray-100'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${cs.dot}`} />
                  <span className="truncate">{child.name}</span>
                  <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    {formatDuration(child.duration_s)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live output */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className={`flex items-center gap-2 px-5 py-2 border-b shrink-0 ${
          darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
        }`}>
          <Terminal className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
          <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            Live Output
          </span>
          {node.status === 'running' && (
            <span className="flex items-center gap-1.5 text-xs text-green-500 animate-pulse">
              <Eye className="w-3.5 h-3.5" />
              Live
            </span>
          )}
        </div>
        <pre
          ref={outputRef}
          className={`flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words ${
            darkMode ? 'bg-slate-950 text-green-300' : 'bg-white text-gray-800 border-t border-gray-100'
          }`}
        >
          {liveOutput?.output ? (
            liveOutput.output
          ) : node.summary ? (
            <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>
              {node.summary}
            </span>
          ) : (
            <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>
              {node.status === 'running'
                ? 'Waiting for output...'
                : 'No output captured for this span.'}
            </span>
          )}
          {node.status === 'running' && (
            <span className={`inline-block w-2 h-4 ml-0.5 animate-pulse align-middle ${darkMode ? 'bg-green-400' : 'bg-gray-600'}`} />
          )}
        </pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph list item
// ---------------------------------------------------------------------------

function GraphListItem({
  graph,
  isSelected,
  onClick,
  onDelete,
  onMoveSession,
  darkMode,
}: {
  graph: ExecutionGraph;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onMoveSession?: (sessionId: string) => void;
  darkMode: boolean;
}) {
  const [showMoveInput, setShowMoveInput] = useState(false);
  const [moveSessionId, setMoveSessionId] = useState(graph.session_id || '');
  const isRunning = graph.status === 'running';
  const rootNode = graph.nodes[0];
  const runningNodes = graph.nodes.filter((n) => n.status === 'running');
  const totalDuration = rootNode
    ? graph.nodes.reduce((max, n) => Math.max(max, n.duration_s), 0)
    : 0;

  return (
    <div
      className={`group relative w-full text-left px-4 py-3 border-b transition-colors cursor-pointer ${
        darkMode
          ? `border-slate-700/50 ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-700/50'}`
          : `border-gray-100 ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'}`
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <span className={`w-2.5 h-2.5 mt-1 rounded-full shrink-0 ${
          isRunning ? 'bg-green-500 animate-pulse' : 'bg-blue-500'
        }`} />
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
            {rootNode?.name || graph.trace_id.slice(0, 8)}
          </div>
          <div className={`text-xs mt-0.5 truncate ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {graph.node_count} node{graph.node_count !== 1 ? 's' : ''}
            {' · '}
            {formatDuration(totalDuration)}
            {isRunning && runningNodes.length > 0 && (
              <span className="text-green-500 ml-1">
                · {runningNodes.length} active
              </span>
            )}
          </div>
          {graph.trigger && (
            <div className={`text-xs mt-1 truncate ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {graph.trigger.length > 80 ? graph.trigger.slice(0, 80) + '...' : graph.trigger}
            </div>
          )}
          {rootNode && (
            <div className={`text-[10px] mt-0.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
              {formatTime(rootNode.started_at)}
            </div>
          )}
        </div>
      </div>
      <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity`}>
        <CopyTraceButton graph={graph} darkMode={darkMode} />
        <button
          onClick={(e) => { e.stopPropagation(); downloadGraphJSON(graph); }}
          className={`p-1 rounded ${
            darkMode ? 'hover:bg-slate-600 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'
          }`}
          title="Download trace as JSON"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        {onMoveSession && !isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowMoveInput(!showMoveInput); }}
            className={`p-1 rounded ${
              darkMode ? 'hover:bg-slate-600 text-gray-500 hover:text-indigo-400' : 'hover:bg-gray-200 text-gray-400 hover:text-indigo-500'
            }`}
            title="Move to session"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>
        )}
        {onDelete && !isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className={`p-1 rounded ${
              darkMode ? 'hover:bg-slate-600 text-gray-500 hover:text-red-400' : 'hover:bg-gray-200 text-gray-400 hover:text-red-500'
            }`}
            title="Delete graph"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {showMoveInput && (
        <div className="px-4 pb-2 flex gap-1 items-center" onClick={e => e.stopPropagation()}>
          <input
            value={moveSessionId}
            onChange={e => setMoveSessionId(e.target.value)}
            placeholder="Session ID"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter' && moveSessionId.trim()) {
                onMoveSession?.(moveSessionId.trim());
                setShowMoveInput(false);
              }
              if (e.key === 'Escape') setShowMoveInput(false);
            }}
            className={`flex-1 px-2 py-1 rounded border text-xs font-mono outline-none ${
              darkMode ? 'bg-slate-700 text-slate-100 border-slate-600' : 'bg-white text-gray-900 border-gray-300'
            }`}
          />
          <button
            onClick={() => { if (moveSessionId.trim()) { onMoveSession?.(moveSessionId.trim()); setShowMoveInput(false); } }}
            className="p-1 text-green-500 hover:text-green-400"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setShowMoveInput(false)} className={`p-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session-level actions (download all traces, copy to clipboard)
// ---------------------------------------------------------------------------

function SessionActions({ sessionGraphs, sessionId, darkMode }: {
  sessionGraphs: ExecutionGraph[];
  sessionId: string;
  darkMode: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = { session_id: sessionId, traces: sessionGraphs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = { session_id: sessionId, traces: sessionGraphs };
    const ok = await copyTextToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <span className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={handleCopy}
        className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-slate-600 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'}`}
        title="Copy all session traces to clipboard"
      >
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Clipboard className="w-3 h-3" />}
      </button>
      <button
        onClick={handleDownload}
        className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-slate-600 text-gray-500 hover:text-gray-300' : 'hover:bg-gray-200 text-gray-400 hover:text-gray-600'}`}
        title="Download all session traces as JSON"
      >
        <Download className="w-3 h-3" />
      </button>
    </span>
  );
}

// Session-grouped list
// ---------------------------------------------------------------------------

function SessionGroupedList({
  graphs,
  selectedTraceId,
  onSelect,
  onDelete,
  onMoveSession,
  darkMode,
}: {
  graphs: ExecutionGraph[];
  selectedTraceId: string | null;
  onSelect: (g: ExecutionGraph) => void;
  onDelete: (g: ExecutionGraph) => void;
  onMoveSession: (traceId: string, sessionId: string) => void;
  darkMode: boolean;
}) {
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());

  // Group graphs by session_id. Ungrouped graphs go under "ungrouped".
  const groups = useMemo(() => {
    const map = new Map<string, ExecutionGraph[]>();
    for (const g of graphs) {
      const sid = g.session_id || `standalone-${g.trace_id}`;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(g);
    }
    return map;
  }, [graphs]);

  const toggleSession = (sid: string) => {
    setCollapsedSessions(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };

  return (
    <>
      {[...groups.entries()].map(([sid, sessionGraphs]) => {
        const isStandalone = sid.startsWith('standalone-') || sessionGraphs.length === 1;
        const isCollapsed = collapsedSessions.has(sid);
        const isRunning = sessionGraphs.some(g => g.status === 'running');
        const firstTrigger = sessionGraphs[0]?.trigger || '';

        if (isStandalone) {
          // Single trace — render directly, no session wrapper
          return sessionGraphs.map(g => (
            <GraphListItem
              key={g.trace_id}
              graph={g}
              isSelected={selectedTraceId === g.trace_id}
              onClick={() => onSelect(g)}
              onDelete={() => onDelete(g)}
              onMoveSession={(sid) => onMoveSession(g.trace_id, sid)}
              darkMode={darkMode}
            />
          ));
        }

        // Multi-trace session — collapsible group
        return (
          <div key={sid}>
            <button
              onClick={() => toggleSession(sid)}
              className={`w-full text-left px-4 py-2 flex items-center gap-2 border-b transition-colors ${
                darkMode
                  ? 'border-slate-700/50 bg-slate-800/50 hover:bg-slate-700/50'
                  : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <ChevronRight className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'} ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`} />
              {isRunning && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />}
              <span className={`text-xs font-semibold ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                Session
              </span>
              <span className={`text-xs truncate flex-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                {firstTrigger.length > 50 ? firstTrigger.slice(0, 50) + '...' : firstTrigger}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
              }`}>
                {sessionGraphs.length}
              </span>
              <SessionActions sessionGraphs={sessionGraphs} sessionId={sid} darkMode={darkMode} />
            </button>
            {!isCollapsed && sessionGraphs.map(g => (
              <div key={g.trace_id} className={darkMode ? 'pl-3 border-l-2 border-indigo-500/20 ml-4' : 'pl-3 border-l-2 border-indigo-200 ml-4'}>
                <GraphListItem
                  graph={g}
                  isSelected={selectedTraceId === g.trace_id}
                  onClick={() => onSelect(g)}
                  onDelete={() => onDelete(g)}
                  onMoveSession={(sid) => onMoveSession(g.trace_id, sid)}
                  darkMode={darkMode}
                />
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function GraphPanel({ projectId, isVisible, onClose, focusTraceId }: GraphPanelProps) {
  const darkMode = useUIStore((s) => s.darkMode);
  const { data, isLoading } = useExecutionGraphs(isVisible);
  const deleteGraph = useDeleteExecutionGraph();
  const moveSession = useMoveGraphSession();
  const graphs = data?.graphs || [];
  const totalGraphs = data?.total ?? graphs.length;

  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree');
  const [showToolsInGraph, setShowToolsInGraph] = useState(true);
  // Mobile: which column/tab is shown (runs | nodes | detail)
  const [mobileGraphTab, setMobileGraphTab] = useState<'runs' | 'nodes' | 'detail'>('runs');

  // Resizable column widths (pixels)
  const [col1Width, setCol1Width] = useState(208); // graph list
  const [col2Width, setCol2Width] = useState(320); // node tree (tree view) or graph detail (graph view)

  const handleCol1Drag = useCallback((delta: number) => {
    setCol1Width((w) => Math.max(120, Math.min(400, w + delta)));
  }, []);
  const handleCol2Drag = useCallback((delta: number) => {
    setCol2Width((w) => Math.max(200, Math.min(600, w + delta)));
  }, []);

  // When focusTraceId is set (e.g. clicking trace icon on a message), select it
  useEffect(() => {
    if (focusTraceId && graphs.length > 0) {
      const target = graphs.find((g) => g.trace_id === focusTraceId);
      if (target) {
        setSelectedTraceId(target.trace_id);
        const root = target.nodes[0];
        if (root) setSelectedSpanId(root.span_id);
      }
    }
  }, [focusTraceId, graphs]);

  // Auto-select the first graph if none selected
  useEffect(() => {
    if (!selectedTraceId && graphs.length > 0) {
      setSelectedTraceId(graphs[0].trace_id);
      const root = graphs[0].nodes[0];
      if (root) setSelectedSpanId(root.span_id);
    }
  }, [graphs, selectedTraceId]);

  const selectedGraph = graphs.find((g) => g.trace_id === selectedTraceId);
  const selectedNode = selectedGraph?.nodes.find((n) => n.span_id === selectedSpanId);

  if (!isVisible) return null;

  const bg = darkMode ? 'bg-slate-900' : 'bg-white';
  const border = darkMode ? 'border-slate-700' : 'border-gray-200';

  return (
    <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${bg}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${border} ${
        darkMode ? 'bg-slate-900' : 'bg-white'
      }`}>
        <div className="flex items-center gap-3">
          <Workflow className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
          <h2 className={`font-bold text-lg ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            Execution Graphs
          </h2>
          {graphs.some((g) => g.status === 'running') && (
            <span className="flex items-center gap-1.5 text-xs text-green-500 animate-pulse">
              <Eye className="w-3.5 h-3.5" />
              Live
            </span>
          )}
        </div>

        {/* View mode toggle + options */}
        <div className="flex items-center gap-2">
          <div className={`flex rounded-lg p-0.5 ${darkMode ? 'bg-slate-800' : 'bg-gray-100'}`}>
            <button
              onClick={() => setViewMode('tree')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'tree'
                  ? darkMode ? 'bg-slate-700 text-gray-200' : 'bg-white text-gray-800 shadow-sm'
                  : darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="Tree view"
            >
              <List className="w-3.5 h-3.5" />
              Tree
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'graph'
                  ? darkMode ? 'bg-slate-700 text-gray-200' : 'bg-white text-gray-800 shadow-sm'
                  : darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
              }`}
              title="Graph view"
            >
              <GitFork className="w-3.5 h-3.5" />
              Graph
            </button>
          </div>

          {viewMode === 'graph' && (
            <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              <input
                type="checkbox"
                checked={showToolsInGraph}
                onChange={(e) => setShowToolsInGraph(e.target.checked)}
                className="rounded border-gray-400 text-purple-500 focus:ring-purple-500 w-3.5 h-3.5"
              />
              Tools
            </label>
          )}
        </div>

        <button
          onClick={onClose}
          className={`p-1.5 rounded transition-colors ${
            darkMode
              ? 'text-gray-400 hover:text-red-400 hover:bg-slate-700'
              : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'
          }`}
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className={`flex-1 flex items-center justify-center ${bg}`}>
          <RefreshCw className={`w-6 h-6 animate-spin ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
        </div>
      ) : graphs.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full text-center">
            <div className={`mx-auto w-16 h-16 rounded-2xl flex items-center justify-center ${
              darkMode ? 'bg-purple-500/10' : 'bg-purple-50'
            }`}>
              <Workflow className={`w-8 h-8 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            </div>
            <h3 className={`mt-4 text-xl font-semibold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              No Execution Graphs
            </h3>
            <p className={`mt-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              When you send a message and the agent starts working, its execution
              graph will appear here. You can watch the delegation tree in real
              time and inspect each node's output.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Mobile tab bar for graph columns */}
          <div className={`md:hidden flex border-b shrink-0 ${border}`}>
            {(['runs', 'nodes', 'detail'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMobileGraphTab(tab)}
                className={`flex-1 py-2.5 text-xs font-medium text-center min-h-[44px] transition-colors ${
                  mobileGraphTab === tab
                    ? darkMode ? 'text-purple-400 border-b-2 border-purple-400' : 'text-purple-600 border-b-2 border-purple-600'
                    : darkMode ? 'text-gray-500' : 'text-gray-400'
                }`}
              >
                {tab === 'runs' ? `Runs (${totalGraphs})` : tab === 'nodes' ? `Nodes${selectedGraph ? ` (${selectedGraph.node_count})` : ''}` : 'Detail'}
              </button>
            ))}
          </div>

          {/* Three-column layout (desktop) / tabbed (mobile) */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Column 1: Graph list */}
            <div
              style={{ width: col1Width }}
              className={`${mobileGraphTab === 'runs' ? 'flex' : 'hidden'} md:flex w-full md:w-auto shrink-0 flex-col overflow-hidden ${
                darkMode ? 'bg-slate-800' : 'bg-gray-50'
              }`}
            >
              <div className={`hidden md:flex items-center gap-2 px-4 py-3 border-b shrink-0 ${
                darkMode ? 'border-slate-700' : 'border-gray-200'
              }`}>
                <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  Runs
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                }`}>
                  {totalGraphs}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SessionGroupedList
                  graphs={graphs}
                  selectedTraceId={selectedTraceId}
                  onSelect={(g) => {
                    setSelectedTraceId(g.trace_id);
                    setSelectedSpanId(g.nodes[0]?.span_id || null);
                    setMobileGraphTab('nodes');
                  }}
                  onDelete={(g) => {
                    deleteGraph.mutate(g.trace_id);
                    if (selectedTraceId === g.trace_id) {
                      setSelectedTraceId(null);
                      setSelectedSpanId(null);
                    }
                  }}
                  onMoveSession={(traceId, sessionId) => {
                    moveSession.mutate({ traceId, sessionId });
                  }}
                  darkMode={darkMode}
                />
              </div>
            </div>

            <div className="hidden md:block">
              <ResizeHandle onDrag={handleCol1Drag} darkMode={darkMode} />
            </div>

            {viewMode === 'tree' ? (
              <>
                {/* Column 2: Node tree */}
                {selectedGraph && (
                  <div
                    style={{ width: col2Width }}
                    className={`${mobileGraphTab === 'nodes' ? 'flex' : 'hidden'} md:flex w-full md:w-auto shrink-0 flex-col overflow-hidden`}
                  >
                    <div className={`hidden md:block px-4 py-3 border-b shrink-0 ${
                      darkMode ? 'border-slate-700' : 'border-gray-200'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                          Nodes
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
                        }`}>
                          {selectedGraph.node_count}
                        </span>
                      </div>
                      {selectedGraph.trigger && (
                        <details className={`mt-1 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          <summary className="cursor-pointer select-none truncate">
                            Trigger: {selectedGraph.trigger.length > 60 ? selectedGraph.trigger.slice(0, 60) + '…' : selectedGraph.trigger}
                          </summary>
                          <div className={`mt-2 p-2 rounded whitespace-pre-wrap break-words font-mono text-[11px] max-h-60 overflow-y-auto ${
                            darkMode ? 'bg-slate-800 text-gray-300' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {selectedGraph.trigger}
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto py-1">
                      {selectedGraph.nodes
                        .filter((n) => !n.parent_id || !selectedGraph.nodes.find((p) => p.span_id === n.parent_id))
                        .map((rootNode) => (
                          <TreeNode
                            key={rootNode.span_id}
                            node={rootNode}
                            children={selectedGraph.nodes.filter((n) => n.parent_id === rootNode.span_id)}
                            depth={0}
                            selectedSpanId={selectedSpanId}
                            onSelect={(spanId) => { setSelectedSpanId(spanId); setMobileGraphTab('detail'); }}
                            darkMode={darkMode}
                            allNodes={selectedGraph.nodes}
                          />
                        ))
                      }
                    </div>
                  </div>
                )}

                <div className="hidden md:block">
                  <ResizeHandle onDrag={handleCol2Drag} darkMode={darkMode} />
                </div>

                {/* Column 3: Node detail */}
                <div className={`${mobileGraphTab === 'detail' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 w-full md:w-auto ${bg}`}>
                  {selectedNode && selectedGraph ? (
                    <NodeDetail
                      node={selectedNode}
                      graph={selectedGraph}
                      darkMode={darkMode}
                      projectId={projectId}
                      onSelectSpan={setSelectedSpanId}
                    />
                  ) : (
                    <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${
                      darkMode ? 'text-gray-500' : 'text-gray-400'
                    }`}>
                      <Workflow className="w-12 h-12 opacity-30" />
                      <p className="text-sm">Select a node to view its details</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Graph visual view + detail panel */}
                {selectedGraph ? (
                  <>
                    <div className={`${mobileGraphTab === 'nodes' ? 'flex' : 'hidden'} md:flex flex-1 flex-col min-w-0 w-full md:w-auto ${
                      darkMode ? 'bg-slate-950' : 'bg-gray-50'
                    }`}>
                      <GraphVisualView
                        graph={selectedGraph}
                        selectedSpanId={selectedSpanId}
                        onSelectSpan={(spanId) => { setSelectedSpanId(spanId); setMobileGraphTab('detail'); }}
                        darkMode={darkMode}
                        showTools={showToolsInGraph}
                      />
                    </div>
                    <div className="hidden md:block">
                      <ResizeHandle onDrag={(d) => handleCol2Drag(-d)} darkMode={darkMode} />
                    </div>
                    <div
                      style={{ width: col2Width }}
                      className={`${mobileGraphTab === 'detail' ? 'flex' : 'hidden'} md:flex shrink-0 flex-col overflow-hidden w-full md:w-auto ${bg}`}
                    >
                      {selectedNode ? (
                        <NodeDetail
                          node={selectedNode}
                          graph={selectedGraph}
                          darkMode={darkMode}
                          projectId={projectId}
                          onSelectSpan={setSelectedSpanId}
                        />
                      ) : (
                        <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${
                          darkMode ? 'text-gray-500' : 'text-gray-400'
                        }`}>
                          <Workflow className="w-12 h-12 opacity-30" />
                          <p className="text-sm">Click a node in the graph</p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className={`flex-1 flex items-center justify-center ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                    <p className="text-sm">Select a run from the list</p>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
