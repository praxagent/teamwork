/**
 * GraphVisualView — SVG-based DAG visualization for execution graphs.
 *
 * Renders agent delegation structure as a top-down tree with visible forks
 * for parallel work.  Tool call nodes are hidden by default (toggle to show).
 *
 * Layout is a two-phase process:
 *   1. Hierarchical pass — assigns Y levels (sequential groups stacked, parallel
 *      groups side-by-side) and initial X positions via recursive subtree sizing.
 *   2. Physics pass — runs a d3-force simulation with Y fixed to refine X
 *      positions.  Collision + repulsion forces naturally separate nodes so that
 *      parent→child edges never pass behind sibling nodes.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
} from 'd3-force';
import type { SimulationNodeDatum } from 'd3-force';
import type { ExecutionGraph, GraphNode } from '@/hooks/useApi';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const AGENT_W = 190;
const AGENT_H = 54;
const TOOL_W = 150;
const TOOL_H = 34;
const H_GAP = 32;
const V_GAP = 56;
const PAD = 48;

// ---------------------------------------------------------------------------
// Status colours (matching tree view)
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<string, { border: string; fill: string; darkFill: string }> = {
  running:   { border: '#22c55e', fill: '#f0fdf4', darkFill: '#14532d' },
  completed: { border: '#3b82f6', fill: '#eff6ff', darkFill: '#1e3a5f' },
  failed:    { border: '#ef4444', fill: '#fef2f2', darkFill: '#7f1d1d' },
  timed_out: { border: '#f97316', fill: '#fff7ed', darkFill: '#7c2d12' },
  aborted:   { border: '#6b7280', fill: '#f9fafb', darkFill: '#374151' },
};

const CATEGORY_SHORT: Record<string, string> = {
  orchestrator: 'ORCH',
  browser: 'BROWSER',
  sandbox: 'SANDBOX',
  content: 'CONTENT',
  finetune: 'FINETUNE',
  sysadmin: 'SYSADMIN',
  knowledge: 'KNOWLEDGE',
  research: 'RESEARCH',
  workspace: 'WORKSPACE',
  scheduler: 'SCHED',
  codegen: 'CODEGEN',
  parallel: 'PARALLEL',
  tool: 'TOOL',
};

// ---------------------------------------------------------------------------
// Layout engine — recursive top-down tree
// ---------------------------------------------------------------------------

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  node: GraphNode;
}

interface LayoutEdge {
  fromId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

/**
 * Determine if children ran in parallel or sequentially.
 * Two nodes are parallel if their time ranges overlap.
 */
function nodeEndTime(n: GraphNode): number {
  if (n.finished_at) return new Date(n.finished_at).getTime();
  // Still running — treat as far-future so it groups with parallel peers
  return new Date(n.started_at).getTime() + (n.duration_s || 600) * 1000;
}

function groupByExecution(children: GraphNode[]): GraphNode[][] {
  if (children.length <= 1) return children.map(c => [c]);

  const sorted = [...children].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
  );

  const groups: GraphNode[][] = [];
  let currentGroup: GraphNode[] = [sorted[0]];
  let groupEnd = nodeEndTime(sorted[0]);

  for (let i = 1; i < sorted.length; i++) {
    const start = new Date(sorted[i].started_at).getTime();
    if (start < groupEnd) {
      // Overlaps with current group — parallel execution
      currentGroup.push(sorted[i]);
      groupEnd = Math.max(groupEnd, nodeEndTime(sorted[i]));
    } else {
      // Sequential — new group
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
      groupEnd = nodeEndTime(sorted[i]);
    }
  }
  groups.push(currentGroup);
  return groups;
}

function computeLayout(allNodes: GraphNode[], showTools: boolean): LayoutResult {
  const nodes = showTools ? allNodes : allNodes.filter(n => n.spoke_or_category !== 'tool');
  if (!nodes.length) return { nodes: [], edges: [], width: 0, height: 0 };

  const nodeIds = new Set(nodes.map(n => n.span_id));
  const childMap = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const pid = n.parent_id && nodeIds.has(n.parent_id) ? n.parent_id : '__root__';
    if (!childMap.has(pid)) childMap.set(pid, []);
    childMap.get(pid)!.push(n);
  }

  const roots = childMap.get('__root__') || [];
  const positions = new Map<string, LayoutNode>();
  const widthCache = new Map<string, number>();
  const heightCache = new Map<string, number>();

  function dims(n: GraphNode): [number, number] {
    return n.spoke_or_category === 'tool' ? [TOOL_W, TOOL_H] : [AGENT_W, AGENT_H];
  }

  // Bottom-up: compute horizontal space needed for a parallel group.
  function groupWidth(group: GraphNode[]): number {
    const widths = group.map(c => subtreeWidth(c));
    return widths.reduce((s, w) => s + w, 0) + (group.length - 1) * H_GAP;
  }

  function subtreeWidth(node: GraphNode): number {
    const cached = widthCache.get(node.span_id);
    if (cached !== undefined) return cached;
    const [w] = dims(node);
    const children = childMap.get(node.span_id) || [];
    if (!children.length) { widthCache.set(node.span_id, w); return w; }
    const groups = groupByExecution(children);
    const maxGroupW = Math.max(...groups.map(g => groupWidth(g)));
    const result = Math.max(w, maxGroupW);
    widthCache.set(node.span_id, result);
    return result;
  }

  function subtreeHeight(node: GraphNode): number {
    const cached = heightCache.get(node.span_id);
    if (cached !== undefined) return cached;
    const [, h] = dims(node);
    const children = childMap.get(node.span_id) || [];
    if (!children.length) { heightCache.set(node.span_id, h); return h; }
    const groups = groupByExecution(children);
    let totalChildH = 0;
    for (const group of groups) {
      const maxChildH = Math.max(...group.map(c => subtreeHeight(c)));
      totalChildH += V_GAP + maxChildH;
    }
    const result = h + totalChildH;
    heightCache.set(node.span_id, result);
    return result;
  }

  // Top-down: assign (x, y) positions.
  function place(node: GraphNode, cx: number, y: number) {
    const [w, h] = dims(node);
    positions.set(node.span_id, { id: node.span_id, x: cx - w / 2, y, w, h, node });

    const children = childMap.get(node.span_id) || [];
    if (!children.length) return;

    const groups = groupByExecution(children);
    let currentY = y + h + V_GAP;

    for (const group of groups) {
      // Place this parallel group at currentY, spread horizontally
      const widths = group.map(c => subtreeWidth(c));
      const totalGW = widths.reduce((s, gw) => s + gw, 0) + (group.length - 1) * H_GAP;
      let left = cx - totalGW / 2;

      let maxRowH = 0;
      for (let i = 0; i < group.length; i++) {
        place(group[i], left + widths[i] / 2, currentY);
        left += widths[i] + H_GAP;
        maxRowH = Math.max(maxRowH, subtreeHeight(group[i]));
      }
      // Next sequential group goes below this one
      currentY += maxRowH + V_GAP;
    }
  }

  // Layout roots side by side.
  const rootWidths = roots.map(r => subtreeWidth(r));
  let rx = PAD;
  for (let i = 0; i < roots.length; i++) {
    place(roots[i], rx + rootWidths[i] / 2, PAD);
    rx += rootWidths[i] + H_GAP;
  }

  const layoutNodes = Array.from(positions.values());
  return buildResult(layoutNodes);
}

// ---------------------------------------------------------------------------
// Phase 2: Physics refinement — d3-force with fixed Y
// ---------------------------------------------------------------------------
// Runs a short force simulation on X positions only.  Collision + repulsion
// push nodes apart so that parent→child edges never pass behind siblings.

interface SimNode extends SimulationNodeDatum {
  id: string;
  fy: number;  // Y is fixed — preserves hierarchy
  w: number;
  h: number;
  initialX: number;
  layoutNode: LayoutNode;
}

function refineWithPhysics(raw: LayoutResult): LayoutResult {
  if (raw.nodes.length < 3) return raw;

  const simNodes: SimNode[] = raw.nodes.map(ln => ({
    id: ln.id,
    x: ln.x + ln.w / 2,   // center X — will be adjusted by simulation
    y: ln.y + ln.h / 2,   // center Y
    fy: ln.y + ln.h / 2,  // fix Y so hierarchy is preserved
    w: ln.w,
    h: ln.h,
    initialX: ln.x + ln.w / 2,
    layoutNode: ln,
  }));

  const nodeById = new Map(simNodes.map(n => [n.id, n]));

  // Build links from parent_id relationships
  const simLinks = simNodes
    .filter(sn => {
      const pid = sn.layoutNode.node.parent_id;
      return pid && nodeById.has(pid);
    })
    .map(sn => ({
      source: sn.layoutNode.node.parent_id!,
      target: sn.id,
    }));

  const sim = forceSimulation(simNodes)
    .force(
      'collide',
      forceCollide<SimNode>()
        .radius(n => n.w / 2 + H_GAP / 2)
        .strength(1),
    )
    .force(
      'link',
      forceLink(simLinks)
        .id((d) => (d as SimNode).id)
        .distance(V_GAP + AGENT_H)
        .strength(0.3),
    )
    .force('charge', forceManyBody().strength(-40))
    .force(
      'centerX',
      forceX<SimNode>().x(n => n.initialX).strength(0.15),
    )
    .alphaDecay(0.03)
    .stop();

  // Run synchronously — no animation needed
  for (let i = 0; i < 200; i++) sim.tick();

  // Shift so leftmost node starts at PAD
  const minX = Math.min(...simNodes.map(n => (n.x ?? 0) - n.w / 2));
  const xShift = PAD - minX;

  const refinedNodes: LayoutNode[] = simNodes.map(sn => ({
    ...sn.layoutNode,
    x: (sn.x ?? 0) - sn.w / 2 + xShift,
  }));

  return buildResult(refinedNodes);
}

// ---------------------------------------------------------------------------
// Shared: build edges + bounding box from positioned nodes
// ---------------------------------------------------------------------------

function buildResult(layoutNodes: LayoutNode[]): LayoutResult {
  const posMap = new Map(layoutNodes.map(n => [n.id, n]));

  const edges: LayoutEdge[] = [];
  for (const ln of layoutNodes) {
    const parent = ln.node.parent_id ? posMap.get(ln.node.parent_id) : undefined;
    if (parent) {
      edges.push({
        fromId: parent.id,
        fromX: parent.x + parent.w / 2,
        fromY: parent.y + parent.h,
        toX: ln.x + ln.w / 2,
        toY: ln.y,
      });
    }
  }

  const width = Math.max(...layoutNodes.map(n => n.x + n.w), 0) + PAD;
  const height = Math.max(...layoutNodes.map(n => n.y + n.h), 0) + PAD;

  return { nodes: layoutNodes, edges, width, height };
}

// ---------------------------------------------------------------------------
// Edge path — smooth S-curve from parent bottom to child top
// ---------------------------------------------------------------------------

function edgePath(e: LayoutEdge): string {
  const midY = (e.fromY + e.toY) / 2;
  return `M ${e.fromX} ${e.fromY} C ${e.fromX} ${midY}, ${e.toX} ${midY}, ${e.toX} ${e.toY}`;
}

// ---------------------------------------------------------------------------
// SVG Node component
// ---------------------------------------------------------------------------

function SvgNode({
  ln,
  isSelected,
  onClick,
  darkMode,
}: {
  ln: LayoutNode;
  isSelected: boolean;
  onClick: () => void;
  darkMode: boolean;
}) {
  const n = ln.node;
  const isTool = n.spoke_or_category === 'tool';
  const style = STATUS_STYLE[n.status] || STATUS_STYLE.completed;
  const fill = darkMode ? style.darkFill : style.fill;
  const textColor = darkMode ? '#e2e8f0' : '#1e293b';
  const subColor = darkMode ? '#94a3b8' : '#64748b';
  const tag = CATEGORY_SHORT[n.spoke_or_category] || n.spoke_or_category.toUpperCase();
  const isRunning = n.status === 'running';

  return (
    <g
      transform={`translate(${ln.x}, ${ln.y})`}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Clip path to contain text within node bounds */}
      <clipPath id={`clip-${ln.id}`}>
        <rect x={0} y={0} width={ln.w} height={ln.h} rx={isTool ? 6 : 10} />
      </clipPath>

      {/* Selection glow */}
      {isSelected && (
        <rect
          x={-3}
          y={-3}
          width={ln.w + 6}
          height={ln.h + 6}
          rx={isTool ? 8 : 12}
          fill="none"
          stroke="#a855f7"
          strokeWidth={2}
          opacity={0.6}
        />
      )}

      {/* Node body */}
      <rect
        x={0}
        y={0}
        width={ln.w}
        height={ln.h}
        rx={isTool ? 6 : 10}
        fill={fill}
        stroke={style.border}
        strokeWidth={isSelected ? 2 : 1.5}
        opacity={darkMode ? 0.95 : 1}
      >
        {isRunning && (
          <animate attributeName="stroke-opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
        )}
      </rect>

      {/* Running pulse ring */}
      {isRunning && (
        <rect
          x={-2}
          y={-2}
          width={ln.w + 4}
          height={ln.h + 4}
          rx={isTool ? 8 : 12}
          fill="none"
          stroke={style.border}
          strokeWidth={1}
        >
          <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite" />
        </rect>
      )}

      <g clipPath={`url(#clip-${ln.id})`}>
        {isTool ? (
          /* Tool call node — compact single line */
          <text
            x={10}
            y={ln.h / 2 + 1}
            dominantBaseline="middle"
            fontSize={11}
            fontFamily="ui-monospace, monospace"
            fill={subColor}
          >
            {n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}
          </text>
        ) : (
          /* Agent node — name + category tag + tool count */
          <>
            {/* Name */}
            <text
              x={12}
              y={20}
              fontSize={13}
              fontWeight={600}
              fill={textColor}
            >
              {n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name}
            </text>
            {/* Category tag */}
            <text
              x={12}
              y={38}
              fontSize={10}
              fill={subColor}
            >
              {tag}
            </text>
            {/* Tool calls badge */}
            {n.tool_calls > 0 && (
              <>
                <rect
                  x={ln.w - 38}
                  y={8}
                  width={28}
                  height={18}
                  rx={9}
                  fill={darkMode ? '#334155' : '#e2e8f0'}
                />
                <text
                  x={ln.w - 24}
                  y={20}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={600}
                  fill={subColor}
                >
                  🔧{n.tool_calls}
                </text>
              </>
            )}
          </>
        )}
      </g>

      {/* Status dot */}
      <circle
        cx={isTool ? ln.w - 10 : ln.w - 14}
        cy={isTool ? ln.h / 2 : 38}
        r={isTool ? 3 : 4}
        fill={style.border}
      >
        {isRunning && (
          <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
        )}
      </circle>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface GraphVisualViewProps {
  graph: ExecutionGraph;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  darkMode: boolean;
  showTools: boolean;
}

export function GraphVisualView({
  graph,
  selectedSpanId,
  onSelectSpan,
  darkMode,
  showTools,
}: GraphVisualViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan and zoom state.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const layout = useMemo(
    () => refineWithPhysics(computeLayout(graph.nodes, showTools)),
    [graph.nodes, showTools],
  );

  // Fit graph in viewport on first render or graph change.
  useEffect(() => {
    if (!containerRef.current || !layout.nodes.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / layout.width;
    const scaleY = rect.height / layout.height;
    const scale = Math.min(scaleX, scaleY, 1.2) * 0.9;
    const x = (rect.width - layout.width * scale) / 2;
    const y = Math.max(16, (rect.height - layout.height * scale) / 2);
    setTransform({ x, y, scale });
  }, [layout]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setTransform(prev => {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(Math.max(prev.scale * delta, 0.15), 3);
      // Zoom toward cursor.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      return {
        scale: newScale,
        x: mx - (mx - prev.x) * (newScale / prev.scale),
        y: my - (my - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Only start panning if clicking on the SVG background (not a node).
    if ((e.target as SVGElement).tagName === 'svg' || (e.target as SVGElement).tagName === 'rect' && (e.target as SVGElement).getAttribute('data-bg') === 'true') {
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    }
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    setTransform(prev => ({
      ...prev,
      x: panStart.current.tx + (e.clientX - panStart.current.x),
      y: panStart.current.ty + (e.clientY - panStart.current.y),
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const fitToView = useCallback(() => {
    if (!containerRef.current || !layout.nodes.length) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = rect.width / layout.width;
    const scaleY = rect.height / layout.height;
    const scale = Math.min(scaleX, scaleY, 1.2) * 0.9;
    const x = (rect.width - layout.width * scale) / 2;
    const y = Math.max(16, (rect.height - layout.height * scale) / 2);
    setTransform({ x, y, scale });
  }, [layout]);

  const edgeColor = darkMode ? '#475569' : '#cbd5e1';

  if (!layout.nodes.length) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        No nodes to visualize
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
    >
      {/* Trigger label */}
      {graph.trigger && (
        <div
          className={`absolute top-3 left-3 z-10 max-w-[50%] px-2.5 py-1.5 rounded-lg text-xs truncate shadow-sm ${
            darkMode
              ? 'bg-slate-800/90 border border-slate-700 text-gray-400'
              : 'bg-white/90 border border-gray-200 text-gray-500'
          }`}
          title={graph.trigger}
        >
          <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>Trigger:</span>{' '}
          {graph.trigger.length > 80 ? graph.trigger.slice(0, 80) + '...' : graph.trigger}
        </div>
      )}

      {/* Zoom controls */}
      <div className={`absolute top-3 right-3 z-10 flex flex-col gap-1 rounded-lg p-1 shadow-sm ${
        darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200'
      }`}>
        <button
          onClick={() => setTransform(p => ({ ...p, scale: Math.min(p.scale * 1.25, 3) }))}
          className={`p-1.5 rounded ${darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          title="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setTransform(p => ({ ...p, scale: Math.max(p.scale * 0.8, 0.15) }))}
          className={`p-1.5 rounded ${darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          title="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={fitToView}
          className={`p-1.5 rounded ${darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          title="Fit to view"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Background (for pan detection) */}
        <rect x={0} y={0} width="100%" height="100%" fill="transparent" data-bg="true" />

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {layout.edges.map((e, i) => (
            <path
              key={i}
              d={edgePath(e)}
              fill="none"
              stroke={edgeColor}
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          ))}

          {/* Nodes */}
          {layout.nodes.map(ln => (
            <SvgNode
              key={ln.id}
              ln={ln}
              isSelected={selectedSpanId === ln.id}
              onClick={() => onSelectSpan(ln.id)}
              darkMode={darkMode}
            />
          ))}
        </g>

        {/* Arrow marker definition */}
        <defs>
          <marker
            id="arrowhead"
            viewBox="0 0 10 7"
            refX={10}
            refY={3.5}
            markerWidth={8}
            markerHeight={6}
            orient="auto-start-reverse"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill={edgeColor} />
          </marker>
        </defs>
      </svg>
    </div>
  );
}
