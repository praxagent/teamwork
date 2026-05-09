import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  GitCommit,
  BarChart3,
  Users,
  Circle,
  Pencil,
  Search,
  X,
} from 'lucide-react';
import { useTasks, useAgents } from '@/hooks/useApi';
import { useUIStore } from '@/stores';

interface ProgressPanelProps {
  projectId: string;
  onClose: () => void;
  onEditCoach: (coachSlug: string) => void;
}

interface GitCommitEntry {
  hash: string;
  author_name: string;
  author_email: string;
  timestamp: number;
  message: string;
}

function useGitLog(projectId: string | null) {
  return useQuery({
    queryKey: ['git-log', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/workspace/${projectId}/git-log?limit=15`);
      if (!res.ok) throw new Error('Failed to fetch git log');
      return res.json() as Promise<{ commits: GitCommitEntry[]; error?: string }>;
    },
    enabled: !!projectId,
    refetchInterval: 30000,
  });
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  darkMode,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  color: string;
  darkMode: boolean;
}) {
  return (
    <div className={`rounded-lg p-4 ${darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200 shadow-sm'}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className={`text-2xl font-bold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            {value}
          </div>
          <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

export function ProgressPanel({ projectId, onClose, onEditCoach }: ProgressPanelProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const { data: tasksData, isLoading: tasksLoading } = useTasks(projectId);
  const { data: agentsData } = useAgents(projectId);
  const { data: gitData, isLoading: gitLoading } = useGitLog(projectId);

  const tasks = tasksData?.tasks || [];
  const agents = agentsData?.agents || [];
  const commits = gitData?.commits || [];

  // Task stats
  const stats = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
    const review = tasks.filter((t) => t.status === 'review').length;
    const total = tasks.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, inProgress, pending, blocked, review, total, pct };
  }, [tasks]);

  // Agent activity summary
  const agentSummary = useMemo(() => {
    return agents.map((agent) => {
      const assignedTasks = tasks.filter((t) => t.assigned_to === agent.id);
      const completedTasks = assignedTasks.filter((t) => t.status === 'completed').length;
      return {
        ...agent,
        assignedCount: assignedTasks.length,
        completedCount: completedTasks,
      };
    });
  }, [agents, tasks]);

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${darkMode ? 'bg-slate-900' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
        darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <BarChart3 className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
          <h1 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            Project Progress
          </h1>
        </div>
        <button
          onClick={onClose}
          className={`p-1.5 rounded transition-colors ${
            darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
          }`}
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Summary Stats */}
        {tasksLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`rounded-lg p-4 animate-pulse ${darkMode ? 'bg-slate-800' : 'bg-white border border-gray-200'}`}>
                <div className={`h-10 rounded ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={CheckCircle2}
              label="Completed"
              value={stats.completed}
              color={darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600'}
              darkMode={darkMode}
            />
            <StatCard
              icon={Loader2}
              label="In Progress"
              value={stats.inProgress}
              color={darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}
              darkMode={darkMode}
            />
            <StatCard
              icon={Clock}
              label="Pending"
              value={stats.pending}
              color={darkMode ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-600'}
              darkMode={darkMode}
            />
            <StatCard
              icon={AlertTriangle}
              label="Blocked / Review"
              value={stats.blocked + stats.review}
              color={darkMode ? 'bg-yellow-500/20 text-yellow-400' : 'bg-yellow-100 text-yellow-600'}
              darkMode={darkMode}
            />
          </div>
        )}

        {/* Overall progress bar */}
        {stats.total > 0 && (
          <div className={`rounded-lg p-4 ${darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200 shadow-sm'}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Overall Progress
              </span>
              <span className={`text-sm font-bold ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {stats.pct}%
              </span>
            </div>
            <div className={`h-3 rounded-full overflow-hidden ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-purple-500 to-blue-500"
                style={{ width: `${stats.pct}%` }}
              />
            </div>
            <div className={`flex items-center justify-between mt-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <span>{stats.completed} of {stats.total} tasks complete</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <Circle className="w-2 h-2 fill-green-500 text-green-500" /> Done
                </span>
                <span className="flex items-center gap-1">
                  <Circle className="w-2 h-2 fill-blue-500 text-blue-500" /> Active
                </span>
                <span className="flex items-center gap-1">
                  <Circle className="w-2 h-2 fill-gray-400 text-gray-400" /> Pending
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Two-column layout for bottom sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Activity */}
          <div className={`rounded-lg overflow-hidden ${darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200 shadow-sm'}`}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${
              darkMode ? 'border-slate-700' : 'border-gray-200'
            }`}>
              <Users className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              <h2 className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Agent Activity
              </h2>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'
              }`}>
                {agents.length}
              </span>
            </div>
            <div className="divide-y max-h-80 overflow-y-auto ${darkMode ? 'divide-slate-700' : 'divide-gray-100'}">
              {agentSummary.length === 0 ? (
                <div className={`p-6 text-center text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No agents found
                </div>
              ) : (
                agentSummary.map((agent) => {
                  const isWorking = agent.status === 'working';
                  const isCoach = agent.role === 'coach';
                  const coachSlug = agent.name
                    .toLowerCase()
                    .trim()
                    .replace(/[^a-z0-9\s-]/g, '')
                    .replace(/[\s_]+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '');

                  return (
                    <div
                      key={agent.id}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        darkMode ? 'border-slate-700' : 'border-gray-100'
                      }`}
                    >
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${
                          darkMode ? 'bg-slate-700' : 'bg-gray-100'
                        }`}>
                          {agent.profile_image_url ? (
                            <img
                              src={agent.profile_image_url}
                              alt={agent.name}
                              className="w-9 h-9 rounded-full object-cover"
                            />
                          ) : (
                            <Users className={`w-4 h-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                          )}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                          darkMode ? 'border-slate-800' : 'border-white'
                        } ${
                          isWorking ? 'bg-green-500' : agent.status === 'idle' ? 'bg-gray-400' : agent.status === 'blocked' ? 'bg-yellow-500' : 'bg-gray-400'
                        }`} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {agent.name}
                          </span>
                          {isWorking && (
                            <span className="flex items-center gap-1 text-xs text-green-500">
                              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                              active
                            </span>
                          )}
                        </div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {agent.role}{agent.specialization ? ` - ${agent.specialization}` : ''}
                          {agent.assignedCount > 0 && (
                            <span className="ml-2">
                              {agent.completedCount}/{agent.assignedCount} tasks
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Task completion mini-bar */}
                      {agent.assignedCount > 0 && (
                        <div className="w-16 shrink-0">
                          <div className={`h-1.5 rounded-full overflow-hidden ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
                            <div
                              className="h-full rounded-full bg-green-500 transition-all"
                              style={{ width: `${Math.round((agent.completedCount / agent.assignedCount) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Edit button for coaches */}
                      {isCoach && (
                        <button
                          onClick={() => onEditCoach(coachSlug)}
                          className={`p-1.5 rounded transition-colors shrink-0 ${
                            darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                          }`}
                          title="Edit coach profile"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Git Commits */}
          <div className={`rounded-lg overflow-hidden ${darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-gray-200 shadow-sm'}`}>
            <div className={`flex items-center gap-2 px-4 py-3 border-b ${
              darkMode ? 'border-slate-700' : 'border-gray-200'
            }`}>
              <GitCommit className={`w-4 h-4 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} />
              <h2 className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Recent Commits
              </h2>
              {commits.length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-100 text-gray-500'
                }`}>
                  {commits.length}
                </span>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {gitLoading ? (
                <div className="p-4 space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-start gap-3 animate-pulse">
                      <div className={`w-6 h-6 rounded-full shrink-0 ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`} />
                      <div className="flex-1 space-y-1">
                        <div className={`h-3 rounded w-3/4 ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`} />
                        <div className={`h-2 rounded w-1/2 ${darkMode ? 'bg-slate-700' : 'bg-gray-100'}`} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : commits.length === 0 ? (
                <div className={`p-6 text-center text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  <GitCommit className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No commits yet
                </div>
              ) : (
                <div className={`divide-y ${darkMode ? 'divide-slate-700/50' : 'divide-gray-100'}`}>
                  {commits.map((commit) => (
                    <div
                      key={commit.hash}
                      className={`px-4 py-3 ${darkMode ? 'hover:bg-slate-700/30' : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Commit dot */}
                        <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                          darkMode ? 'bg-orange-400' : 'bg-orange-500'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {commit.message}
                          </p>
                          <div className={`flex items-center gap-2 mt-0.5 text-xs ${
                            darkMode ? 'text-gray-500' : 'text-gray-400'
                          }`}>
                            <span>{commit.author_name}</span>
                            <span>-</span>
                            <span>{formatTimeAgo(commit.timestamp)}</span>
                            <span className={`font-mono ${darkMode ? 'text-gray-600' : 'text-gray-300'}`}>
                              {commit.hash.slice(0, 7)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
