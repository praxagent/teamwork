import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Activity, ExternalLink, RefreshCw, Terminal, Circle, Eye, ChevronDown, User, X, Heart, AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight } from 'lucide-react';
import { useAgentLiveOutput, useAgents } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import type { Agent } from '@/types';

interface ObservabilityConfig {
  enabled: boolean;
  grafana_url: string | null;
  tempo_url: string | null;
}

interface ObservabilityPanelProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
}

type Tab = 'dashboards' | 'live' | 'health';

// ---------------------------------------------------------------------------
// Live agent output viewer (merged from LiveSessionsPanel)
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { dot: string; label: string; bg: string }> = {
  running: { dot: 'bg-green-500', label: 'Running', bg: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  invoking: { dot: 'bg-green-400 animate-pulse', label: 'Invoking', bg: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  preparing: { dot: 'bg-yellow-400 animate-pulse', label: 'Preparing', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  initializing: { dot: 'bg-yellow-400 animate-pulse', label: 'Initializing', bg: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  completed: { dot: 'bg-blue-500', label: 'Completed', bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  idle: { dot: 'bg-gray-400', label: 'Idle', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  error: { dot: 'bg-red-500', label: 'Error', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  failed: { dot: 'bg-red-500', label: 'Failed', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  startup_failed: { dot: 'bg-red-500', label: 'Startup Failed', bg: 'bg-red-500/10 text-red-600 dark:text-red-400' },
  timeout: { dot: 'bg-orange-500', label: 'Timeout', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
  stopped: { dot: 'bg-gray-500', label: 'Stopped', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  stale_reset: { dot: 'bg-gray-500', label: 'Stale', bg: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
  retry_loop: { dot: 'bg-orange-400 animate-pulse', label: 'Retrying', bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400' },
};

const ACTIVE_STATUSES = new Set(['running', 'invoking', 'preparing', 'initializing']);

function AgentOutputView({ agentId, darkMode }: { agentId: string; darkMode: boolean }) {
  const { data: liveOutput } = useAgentLiveOutput(agentId, true);
  const outputRef = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevOutputLength = useRef(0);

  useEffect(() => {
    const outputText = liveOutput?.output || '';
    if (outputText.length !== prevOutputLength.current) {
      prevOutputLength.current = outputText.length;
      if (autoScroll && outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    }
  }, [liveOutput?.output, autoScroll]);

  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  };

  const statusInfo = STATUS_COLORS[liveOutput?.status || 'idle'] || STATUS_COLORS.idle;
  const isActive = ACTIVE_STATUSES.has(liveOutput?.status || '');

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0 ${
        darkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-center gap-2">
          <Terminal className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
          <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            {liveOutput?.agent_name || 'Agent Output'}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.bg}`}>
            <Circle className={`w-2 h-2 fill-current ${statusInfo.dot.replace(/bg-/, 'text-').replace(' animate-pulse', '')}`} />
            {statusInfo.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs text-green-500 animate-pulse">
              <Eye className="w-3.5 h-3.5" />
              Watch Live
            </span>
          )}
          {!autoScroll && (
            <button
              onClick={() => {
                setAutoScroll(true);
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight;
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                darkMode
                  ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
              }`}
            >
              <ChevronDown className="w-3 h-3" />
              Auto-scroll
            </button>
          )}
        </div>
      </div>

      <pre
        ref={outputRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-auto p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words ${
          darkMode
            ? 'bg-slate-950 text-green-300'
            : 'bg-white text-gray-800 border-t border-gray-100'
        }`}
      >
        {liveOutput?.output ? (
          liveOutput.output
        ) : liveOutput?.error ? (
          <span className="text-red-400">{liveOutput.error}</span>
        ) : (
          <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>
            {isActive ? 'Waiting for output...' : 'No output available. Agent is not currently running.'}
          </span>
        )}
        {isActive && (
          <span className={`inline-block w-2 h-4 ml-0.5 animate-pulse align-middle ${darkMode ? 'bg-green-400' : 'bg-gray-600'}`} />
        )}
      </pre>
    </div>
  );
}

function LiveAgentsTab({ projectId, darkMode }: { projectId: string; darkMode: boolean }) {
  const { data: agentsData } = useAgents(projectId);
  const agents = (agentsData?.agents || []) as Agent[];
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => {
      const aActive = a.status === 'working' ? 0 : 1;
      const bActive = b.status === 'working' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.name.localeCompare(b.name);
    });
  }, [agents]);

  useEffect(() => {
    if (!selectedAgentId && sortedAgents.length > 0) {
      const working = sortedAgents.find((a) => a.status === 'working');
      setSelectedAgentId(working?.id || sortedAgents[0].id);
    }
  }, [sortedAgents, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId && !agents.find((a) => a.id === selectedAgentId)) {
      setSelectedAgentId(null);
    }
  }, [agents, selectedAgentId]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Agent list sidebar */}
      <div className={`w-56 shrink-0 flex flex-col border-r overflow-hidden ${
        darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'
      }`}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b shrink-0 ${
          darkMode ? 'border-slate-700' : 'border-gray-200'
        }`}>
          <Terminal className={`w-4 h-4 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
          <span className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            Agents
          </span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
            darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'
          }`}>
            {agents.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sortedAgents.length === 0 ? (
            <div className={`p-4 text-sm text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              No agents in this project
            </div>
          ) : (
            sortedAgents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const isWorking = agent.status === 'working';

              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full text-left px-4 py-3 border-b transition-colors ${
                    darkMode
                      ? `border-slate-700/50 ${isSelected ? 'bg-slate-700' : 'hover:bg-slate-700/50'}`
                      : `border-gray-100 ${isSelected ? 'bg-white shadow-sm' : 'hover:bg-gray-100'}`
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                      darkMode ? 'bg-slate-600' : 'bg-gray-200'
                    }`}>
                      {agent.profile_image_url ? (
                        <img
                          src={agent.profile_image_url}
                          alt={agent.name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <User className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                      )}
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                        darkMode ? 'border-slate-800' : 'border-gray-50'
                      } ${
                        isWorking ? 'bg-green-500' : agent.status === 'idle' ? 'bg-gray-400' : 'bg-gray-400'
                      }`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${
                        darkMode ? 'text-gray-200' : 'text-gray-800'
                      }`}>
                        {agent.name}
                      </div>
                      <div className={`text-xs truncate ${
                        darkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                        {agent.role}
                      </div>
                    </div>
                    {isWorking && (
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse shrink-0" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Output area */}
      <div className={`flex-1 flex flex-col min-w-0 ${
        darkMode ? 'bg-slate-900' : 'bg-white'
      }`}>
        {selectedAgentId ? (
          <AgentOutputView agentId={selectedAgentId} darkMode={darkMode} />
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${
            darkMode ? 'text-gray-500' : 'text-gray-400'
          }`}>
            <Terminal className="w-12 h-12 opacity-30" />
            <p className="text-sm">Select an agent to view their live output</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboards tab
// ---------------------------------------------------------------------------

function DashboardsTab({ config, darkMode }: { config: ObservabilityConfig; darkMode: boolean }) {
  const text = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';

  if (!config.enabled) {
    return (
      <div className={`flex-1 flex items-center justify-center`}>
        <div className="text-center max-w-md">
          <Activity className={`w-12 h-12 mx-auto mb-4 ${subtext}`} />
          <h2 className={`text-lg font-bold mb-2 ${text}`}>Observability Disabled</h2>
          <p className={subtext}>
            Set <code className="px-1.5 py-0.5 rounded bg-slate-700 text-sm">OBSERVABILITY_ENABLED=true</code> and
            run with <code className="px-1.5 py-0.5 rounded bg-slate-700 text-sm">docker-compose.dev.yml</code> to
            enable traces, metrics, and dashboards.
          </p>
        </div>
      </div>
    );
  }

  // Grafana's host depends on where you're viewing TeamWork from.  If the
  // backend supplied a non-localhost GRAFANA_URL (explicit override), trust
  // it; otherwise derive the host from window.location.  Local dev binds
  // Grafana on host port 3002 directly (avoids conflicting with Tailscale
  // Serve which claims :3001 on the tailnet interface); remote viewers
  // over Tailscale hit :3001 because that's the HTTPS port Tailscale
  // serves, proxied to localhost:3002 upstream.
  const grafanaUrl = (() => {
    if (config.grafana_url && !/^https?:\/\/localhost(:|\/|$)/i.test(config.grafana_url)) {
      return config.grafana_url;
    }
    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3002';
    }
    return `${protocol}//${hostname}:3001`;
  })();

  // Grafana 10+ rewrote the Explore URL schema.  The legacy `?left={...}`
  // format is silently dropped and you land on a blank Explore pane; the
  // current schema uses `?schemaVersion=1&panes={paneId:{...}}&orgId=1`.
  const exploreUrl = (datasourceUid: string): string => {
    const panes = {
      a: {
        datasource: datasourceUid,
        queries: [{ refId: 'A' }],
        range: { from: 'now-1h', to: 'now' },
      },
    };
    return `${grafanaUrl}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
  };

  const dashboards = [
    {
      title: 'LLM Performance',
      description: 'Token usage, call counts, latency by model, error rates',
      url: `${grafanaUrl}/d/prax-llm-performance`,
      icon: '🧠',
    },
    {
      title: 'Agent Overview',
      description: 'Spoke delegations, durations, success/failure, delegation trees',
      url: `${grafanaUrl}/d/prax-agent-overview`,
      icon: '🤖',
    },
    {
      title: 'Trace Explorer',
      description: 'Search and inspect distributed traces across all agent flows',
      url: exploreUrl('tempo'),
      icon: '🔍',
    },
    {
      title: 'Log Explorer',
      description: 'Search application logs with Loki — filter by service, level, trace ID',
      url: exploreUrl('loki'),
      icon: '📋',
    },
    {
      title: 'Metrics Explorer',
      description: 'Raw Prometheus metrics — build custom queries and dashboards',
      url: exploreUrl('prometheus'),
      icon: '📊',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <p className={`mb-6 ${subtext}`}>
          Every LLM call, tool invocation, and agent delegation is traced. Click any dashboard below
          to open it in Grafana, or use the trace button on individual chat messages to jump directly
          to that message's execution trace.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dashboards.map((d) => (
            <a
              key={d.title}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`block p-4 rounded-lg border transition-colors ${cardBg} hover:border-blue-500/50`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{d.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold ${text}`}>{d.title}</h3>
                    <ExternalLink className={`w-3.5 h-3.5 ${subtext}`} />
                  </div>
                  <p className={`text-sm mt-1 ${subtext}`}>{d.description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>

        <div className={`mt-8 p-4 rounded-lg border ${cardBg}`}>
          <h3 className={`font-semibold mb-2 ${text}`}>Stack Components</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { name: 'Tempo', role: 'Distributed traces', port: '3200' },
              { name: 'Loki', role: 'Log aggregation', port: '3100' },
              { name: 'Prometheus', role: 'Metrics', port: '9090' },
              { name: 'Grafana', role: 'Dashboards', port: '3002' },
            ].map((s) => (
              <div key={s.name} className={`text-sm ${subtext}`}>
                <span className={`font-medium ${text}`}>{s.name}</span>
                <br />
                {s.role}
                <br />
                <span className="text-xs opacity-75">:{s.port}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health monitoring tab — status page with subsystem indicators
// ---------------------------------------------------------------------------

interface SubsystemStatus {
  name: string;
  status: 'healthy' | 'warning' | 'error';
  message: string;
  metric_value: number;
  threshold: number;
}

interface HealthCheckData {
  timestamp: number;
  overall: 'healthy' | 'degraded' | 'unhealthy';
  subsystems: Record<string, SubsystemStatus>;
  alerts: string[];
}

interface HealthStats {
  window_minutes: number;
  total_events: number;
  turns: number;
  tool_calls: number;
  tool_errors: number;
  tool_error_rate: number;
  spoke_calls: number;
  spoke_failures: number;
  spoke_failure_rate: number;
  context_overflows: number;
  compactions: number;
  retries: number;
  llm_errors: number;
  timeouts: number;
  budget_exhaustions: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

interface HealthResponse {
  check: HealthCheckData;
  stats: HealthStats;
  alert_history: Array<{ timestamp: number; message: string; overall: string }>;
  check_interval_turns: number;
  window_minutes: number;
}

interface HealthEvent {
  category: string;
  severity: string;
  component: string;
  details: string;
  timestamp: number;
  latency_ms: number;
  tokens: number;
}

const OVERALL_STYLES = {
  healthy: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', icon: CheckCircle, label: 'Healthy' },
  degraded: { bg: 'bg-yellow-500/10', text: 'text-yellow-600 dark:text-yellow-400', icon: AlertTriangle, label: 'Degraded' },
  unhealthy: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: XCircle, label: 'Unhealthy' },
};

const STATUS_DOT = {
  healthy: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
};

function HealthTab({ darkMode }: { darkMode: boolean }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSubsystem, setExpandedSubsystem] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';

  const fetchHealth = useCallback(async () => {
    try {
      const resp = await fetch('/api/observability/health');
      if (resp.ok) {
        const data = await resp.json();
        setHealth(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const resp = await fetch('/api/observability/health/events?minutes=60&limit=50');
      if (resp.ok) {
        const data = await resp.json();
        setEvents(data.events || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchEvents();
    const interval = setInterval(() => {
      fetchHealth();
      fetchEvents();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchEvents]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className={`w-6 h-6 animate-spin ${subtext}`} />
      </div>
    );
  }

  if (health && (health as any).enabled === false) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Heart className={`w-12 h-12 opacity-30 ${subtext}`} />
        <h3 className={`text-lg font-bold ${text}`}>Health Monitor Disabled</h3>
        <p className={`text-sm max-w-md text-center ${subtext}`}>
          Set <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>HEALTH_MONITOR_ENABLED=true</code> to
          enable self-monitoring health checks, telemetry recording, and anomaly detection.
        </p>
      </div>
    );
  }

  if (!health || health.check == null) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <Heart className={`w-12 h-12 opacity-30 ${subtext}`} />
        <p className={`text-sm ${subtext}`}>No health data available yet. Health checks run every {health?.check_interval_turns || 10} turns.</p>
        <button
          onClick={() => { setLoading(true); fetchHealth(); fetchEvents(); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
            darkMode ? 'bg-slate-700 text-gray-200 hover:bg-slate-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    );
  }

  const { check, stats, alert_history } = health;
  const overallStyle = OVERALL_STYLES[check.overall] || OVERALL_STYLES.healthy;
  const OverallIcon = overallStyle.icon;
  const subsystems = Object.entries(check.subsystems);

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Overall status banner */}
        <div className={`flex items-center justify-between p-4 rounded-lg border ${cardBg}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${overallStyle.bg}`}>
              <OverallIcon className={`w-6 h-6 ${overallStyle.text}`} />
            </div>
            <div>
              <div className={`text-lg font-bold ${text}`}>System {overallStyle.label}</div>
              <div className={`text-sm ${subtext}`}>
                Last check: {formatTime(check.timestamp)} &middot; Window: {stats.window_minutes}min
              </div>
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); fetchHealth(); fetchEvents(); }}
            className={`p-2 rounded-lg transition-colors ${
              darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'
            }`}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Alerts */}
        {check.alerts.length > 0 && (
          <div className={`p-4 rounded-lg border ${
            darkMode ? 'bg-red-900/20 border-red-800/50' : 'bg-red-50 border-red-200'
          }`}>
            <div className={`text-sm font-semibold mb-2 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
              Active Alerts ({check.alerts.length})
            </div>
            {check.alerts.map((alert, i) => (
              <div key={i} className={`flex items-start gap-2 text-sm py-1 ${
                darkMode ? 'text-red-300' : 'text-red-600'
              }`}>
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                {alert}
              </div>
            ))}
          </div>
        )}

        {/* Subsystem status cards */}
        <div>
          <h3 className={`text-sm font-semibold mb-3 ${text}`}>Subsystems</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {subsystems.map(([key, sub]) => {
              const dotColor = STATUS_DOT[sub.status] || STATUS_DOT.healthy;
              const isExpanded = expandedSubsystem === key;
              return (
                <button
                  key={key}
                  onClick={() => setExpandedSubsystem(isExpanded ? null : key)}
                  className={`text-left p-4 rounded-lg border transition-colors ${cardBg} ${
                    isExpanded ? (darkMode ? 'ring-1 ring-slate-500' : 'ring-1 ring-gray-300') : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                      <span className={`text-sm font-medium ${text}`}>{sub.name}</span>
                    </div>
                    <ChevronRight className={`w-4 h-4 transition-transform ${subtext} ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                  <div className={`text-xs mt-1.5 ml-5 ${subtext}`}>{sub.message}</div>
                  {isExpanded && sub.threshold > 0 && (
                    <div className={`mt-3 ml-5 pt-2 border-t text-xs ${
                      darkMode ? 'border-slate-600' : 'border-gray-200'
                    } ${subtext}`}>
                      <div className="flex justify-between">
                        <span>Current</span>
                        <span className={text}>
                          {typeof sub.metric_value === 'number' && sub.metric_value < 1
                            ? `${(sub.metric_value * 100).toFixed(1)}%`
                            : sub.metric_value}
                        </span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span>Threshold</span>
                        <span className={text}>
                          {typeof sub.threshold === 'number' && sub.threshold < 1
                            ? `${(sub.threshold * 100).toFixed(1)}%`
                            : sub.threshold}
                        </span>
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Rolling metrics */}
        <div className={`p-4 rounded-lg border ${cardBg}`}>
          <h3 className={`text-sm font-semibold mb-3 ${text}`}>
            Rolling Metrics ({stats.window_minutes}min window)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Turns', value: stats.turns },
              { label: 'Tool Calls', value: stats.tool_calls },
              { label: 'Tool Errors', value: stats.tool_errors, warn: stats.tool_error_rate >= 0.15 },
              { label: 'Spoke Failures', value: stats.spoke_failures, warn: stats.spoke_failure_rate >= 0.2 },
              { label: 'Ctx Overflows', value: stats.context_overflows, warn: stats.context_overflows >= 3 },
              { label: 'Compactions', value: stats.compactions, warn: stats.compactions >= 5 },
              { label: 'Avg Latency', value: `${(stats.avg_latency_ms / 1000).toFixed(1)}s`, warn: stats.avg_latency_ms > 60000 },
              { label: 'P95 Latency', value: `${(stats.p95_latency_ms / 1000).toFixed(1)}s` },
              { label: 'Retries', value: stats.retries, warn: stats.retries > 5 },
              { label: 'LLM Errors', value: stats.llm_errors, warn: stats.llm_errors >= 3 },
              { label: 'Timeouts', value: stats.timeouts, warn: stats.timeouts >= 2 },
              { label: 'Budget Exhaustions', value: stats.budget_exhaustions, warn: stats.budget_exhaustions >= 3 },
            ].map(({ label, value, warn }) => (
              <div key={label} className="text-center">
                <div className={`text-lg font-bold ${warn ? (darkMode ? 'text-yellow-400' : 'text-yellow-600') : text}`}>
                  {value}
                </div>
                <div className={`text-xs ${subtext}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent events */}
        <div className={`rounded-lg border ${cardBg}`}>
          <button
            onClick={() => setShowEvents(!showEvents)}
            className={`w-full flex items-center justify-between p-4 text-left`}
          >
            <h3 className={`text-sm font-semibold ${text}`}>
              Recent Events ({events.length})
            </h3>
            <ChevronRight className={`w-4 h-4 transition-transform ${subtext} ${showEvents ? 'rotate-90' : ''}`} />
          </button>
          {showEvents && (
            <div className={`border-t max-h-80 overflow-y-auto ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
              {events.length === 0 ? (
                <div className={`p-4 text-sm text-center ${subtext}`}>No events in the last hour</div>
              ) : (
                events.map((evt, i) => (
                  <div key={i} className={`flex items-start gap-3 px-4 py-2.5 border-b last:border-0 text-xs ${
                    darkMode ? 'border-slate-700/50' : 'border-gray-100'
                  }`}>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono ${
                      evt.severity === 'error'
                        ? darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700'
                        : evt.severity === 'warning'
                          ? darkMode ? 'bg-yellow-900/30 text-yellow-400' : 'bg-yellow-100 text-yellow-700'
                          : darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {evt.severity}
                    </span>
                    <span className={`shrink-0 font-medium ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
                      {evt.category}
                    </span>
                    <span className={`flex-1 truncate ${subtext}`} title={evt.details}>
                      {evt.component && <span className={`font-medium ${text}`}>[{evt.component}]</span>}{' '}
                      {evt.details}
                    </span>
                    <span className={`shrink-0 ${subtext}`}>{formatTime(evt.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Alert history */}
        {alert_history.length > 0 && (
          <div className={`p-4 rounded-lg border ${cardBg}`}>
            <h3 className={`text-sm font-semibold mb-3 ${text}`}>Alert History</h3>
            <div className="space-y-1.5">
              {alert_history.slice(-10).reverse().map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs ${subtext}`}>
                  <Clock className="w-3 h-3 mt-0.5 shrink-0" />
                  <span className="shrink-0">{formatTime(alert.timestamp)}</span>
                  <span className={`shrink-0 font-medium ${
                    alert.overall === 'unhealthy'
                      ? darkMode ? 'text-red-400' : 'text-red-600'
                      : darkMode ? 'text-yellow-400' : 'text-yellow-600'
                  }`}>
                    [{alert.overall}]
                  </span>
                  <span className="flex-1">{alert.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel with tab bar
// ---------------------------------------------------------------------------

export function ObservabilityPanel({ projectId, isVisible, onClose }: ObservabilityPanelProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const [config, setConfig] = useState<ObservabilityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('health');

  useEffect(() => {
    fetch('/api/observability/config')
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (!isVisible) return null;

  const bg = darkMode ? 'bg-slate-900' : 'bg-white';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const borderColor = darkMode ? 'border-slate-700' : 'border-gray-200';

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${bg}`}>
        <RefreshCw className={`w-6 h-6 animate-spin ${subtext}`} />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'health',
      label: 'Health',
      icon: <Heart className="w-4 h-4" />,
    },
    {
      key: 'live',
      label: 'Live Agents',
      icon: <Terminal className="w-4 h-4" />,
    },
    {
      key: 'dashboards',
      label: 'Dashboards',
      icon: <Activity className="w-4 h-4" />,
    },
  ];

  return (
    <div className={`flex-1 flex flex-col ${bg}`}>
      {/* Tab bar */}
      <div className={`flex items-center gap-1 px-4 pt-3 pb-0 border-b ${borderColor}`}>
        <Activity className={`w-5 h-5 mr-2 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
        <span className={`text-sm font-bold mr-4 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
          Observability
        </span>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? darkMode
                  ? 'border-green-400 text-green-400'
                  : 'border-green-600 text-green-700'
                : darkMode
                  ? 'border-transparent text-gray-400 hover:text-gray-200'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className={`p-1.5 rounded transition-colors mb-1 ${
            darkMode
              ? 'text-gray-400 hover:text-red-400 hover:bg-slate-700'
              : 'text-gray-500 hover:text-red-500 hover:bg-gray-100'
          }`}
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'health' ? (
        <HealthTab darkMode={darkMode} />
      ) : activeTab === 'live' ? (
        <LiveAgentsTab projectId={projectId} darkMode={darkMode} />
      ) : (
        <DashboardsTab config={config || { enabled: false, grafana_url: null, tempo_url: null }} darkMode={darkMode} />
      )}
    </div>
  );
}
