import { useState, useMemo, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  Plus,
  GripVertical,
  AlertCircle,
  Loader2,
  User,
  Flag,
  Trash2,
  Eye,
  ArrowRight,
} from 'lucide-react';
import { useUIStore } from '@/stores';
import { useTasks, useCreateTask, useUpdateTask, useDeleteTask } from '@/hooks/useApi';
import type { Task, Agent } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskBoardProps {
  projectId: string;
  agents: unknown[];
  isCoachingProject: boolean;
  onWatchLive: (agentId: string) => void;
}

type ColumnStatus = 'pending' | 'in_progress' | 'review' | 'completed';

interface ColumnDef {
  status: ColumnStatus;
  label: string;
  accent: string;       // border-top color
  dotColor: string;     // status dot in card
  headerBg: string;     // light mode
  headerBgDark: string; // dark mode
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef[] = [
  {
    status: 'pending',
    label: 'Pending',
    accent: 'border-t-gray-400',
    dotColor: 'bg-gray-400',
    headerBg: 'bg-gray-50',
    headerBgDark: 'bg-slate-800/50',
  },
  {
    status: 'in_progress',
    label: 'In Progress',
    accent: 'border-t-blue-500',
    dotColor: 'bg-blue-500',
    headerBg: 'bg-blue-50',
    headerBgDark: 'bg-blue-900/20',
  },
  {
    status: 'review',
    label: 'Review',
    accent: 'border-t-amber-500',
    dotColor: 'bg-amber-500',
    headerBg: 'bg-amber-50',
    headerBgDark: 'bg-amber-900/20',
  },
  {
    status: 'completed',
    label: 'Completed',
    accent: 'border-t-green-500',
    dotColor: 'bg-green-500',
    headerBg: 'bg-green-50',
    headerBgDark: 'bg-green-900/20',
  },
];

const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Medium',
  4: 'Low',
  5: 'Lowest',
};

const PRIORITY_COLORS_LIGHT: Record<number, string> = {
  1: 'text-red-700 bg-red-100',
  2: 'text-orange-700 bg-orange-100',
  3: 'text-yellow-700 bg-yellow-100',
  4: 'text-blue-700 bg-blue-100',
  5: 'text-gray-600 bg-gray-100',
};

const PRIORITY_COLORS_DARK: Record<number, string> = {
  1: 'text-red-300 bg-red-900/40',
  2: 'text-orange-300 bg-orange-900/40',
  3: 'text-yellow-300 bg-yellow-900/40',
  4: 'text-blue-300 bg-blue-900/40',
  5: 'text-gray-400 bg-slate-700/60',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function castAgents(agents: unknown[]): Agent[] {
  return agents as Agent[];
}

function getAgentName(agents: Agent[], agentId: string | null): string | null {
  if (!agentId) return null;
  const agent = agents.find((a) => a.id === agentId);
  return agent?.name ?? null;
}

function truncate(text: string | null, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A single task card rendered inside a column. */
function TaskCard({
  task,
  agents,
  darkMode,
  onChangeStatus,
  onDelete,
  onWatchLive,
  isUpdating,
}: {
  task: Task;
  agents: Agent[];
  darkMode: boolean;
  onChangeStatus: (taskId: string, newStatus: ColumnStatus) => void;
  onDelete: (taskId: string) => void;
  onWatchLive: (agentId: string) => void;
  isUpdating: boolean;
}) {
  const [showActions, setShowActions] = useState(false);

  const cardBg = darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200';
  const cardHover = darkMode ? 'hover:border-slate-500' : 'hover:border-gray-300';
  const titleColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const descColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const metaColor = darkMode ? 'text-gray-500' : 'text-gray-400';
  const actionBtnHover = darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100';
  const priorityColors = darkMode ? PRIORITY_COLORS_DARK : PRIORITY_COLORS_LIGHT;

  const assignedName = task.assigned_agent_name ?? getAgentName(agents, task.assigned_to);

  // Determine which status transitions to offer
  const nextStatuses = COLUMNS.filter((c) => c.status !== task.status).map((c) => c);

  return (
    <div
      className={clsx(
        'group relative rounded-lg border p-3 transition-all',
        cardBg,
        cardHover,
        isUpdating && 'opacity-60 pointer-events-none',
        task.is_blocked && 'ring-1 ring-red-400/50',
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Drag handle (visual only) + actions */}
      <div className="flex items-start gap-2">
        <GripVertical className={clsx('w-4 h-4 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-40 transition-opacity', metaColor)} />
        <div className="flex-1 min-w-0">
          <h4 className={clsx('text-sm font-semibold leading-snug', titleColor)}>
            {task.title}
          </h4>
          {task.description && (
            <p className={clsx('text-xs mt-1 leading-relaxed', descColor)}>
              {truncate(task.description, 120)}
            </p>
          )}
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* Priority badge */}
        <span
          className={clsx(
            'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
            priorityColors[task.priority] ?? priorityColors[3],
          )}
        >
          <Flag className="w-3 h-3" />
          {PRIORITY_LABELS[task.priority] ?? `P${task.priority}`}
        </span>

        {/* Assigned agent */}
        {assignedName && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
              darkMode ? 'text-purple-300 bg-purple-900/40' : 'text-purple-700 bg-purple-100',
            )}
          >
            <User className="w-3 h-3" />
            {assignedName}
          </span>
        )}

        {/* Blocked indicator */}
        {task.is_blocked && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
              darkMode ? 'text-red-300 bg-red-900/40' : 'text-red-700 bg-red-100',
            )}
            title={task.blocked_by_titles?.join(', ')}
          >
            <AlertCircle className="w-3 h-3" />
            Blocked
          </span>
        )}

        {/* Subtask count */}
        {task.subtask_count > 0 && (
          <span className={clsx('text-[10px]', metaColor)}>
            {task.subtask_count} subtask{task.subtask_count > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Hover actions overlay */}
      {showActions && (
        <div
          className={clsx(
            'absolute top-1 right-1 flex items-center gap-0.5 rounded-md px-1 py-0.5 shadow-sm border',
            darkMode ? 'bg-slate-700 border-slate-600' : 'bg-white border-gray-200',
          )}
        >
          {/* Move to next status buttons */}
          {nextStatuses.map((col) => (
            <button
              key={col.status}
              onClick={() => onChangeStatus(task.id, col.status)}
              className={clsx('p-1 rounded text-[10px] font-medium flex items-center gap-0.5', actionBtnHover, darkMode ? 'text-gray-300' : 'text-gray-600')}
              title={`Move to ${col.label}`}
            >
              <ArrowRight className="w-3 h-3" />
              <span className={clsx('w-2 h-2 rounded-full', col.dotColor)} />
            </button>
          ))}

          {/* Watch live */}
          {task.assigned_to && task.status === 'in_progress' && (
            <button
              onClick={() => onWatchLive(task.assigned_to!)}
              className={clsx('p-1 rounded', actionBtnHover, darkMode ? 'text-green-400' : 'text-green-600')}
              title="Watch live"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => onDelete(task.id)}
            className={clsx('p-1 rounded', actionBtnHover, 'text-red-500')}
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The inline form for creating a new task inside a column. */
function CreateTaskForm({
  darkMode,
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  darkMode: boolean;
  defaultStatus: ColumnStatus;
  onSubmit: (title: string, description: string, priority: number) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(3);

  const inputBg = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder:text-gray-500'
    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-400';
  const labelColor = darkMode ? 'text-gray-300' : 'text-gray-600';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), description.trim(), priority);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={clsx(
        'rounded-lg border p-3 space-y-2',
        darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200',
      )}
    >
      <input
        autoFocus
        type="text"
        placeholder="Task title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className={clsx('block w-full rounded-md border px-2.5 py-1.5 text-sm', inputBg)}
      />
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className={clsx('block w-full rounded-md border px-2.5 py-1.5 text-sm resize-none', inputBg)}
      />
      <div className="flex items-center gap-2">
        <label className={clsx('text-xs font-medium', labelColor)}>Priority:</label>
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          className={clsx('rounded border px-2 py-1 text-xs', inputBg)}
        >
          {[1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!title.trim() || isSubmitting}
          className={clsx(
            'inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            'bg-blue-600 text-white hover:bg-blue-700',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={clsx(
            'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            darkMode
              ? 'text-gray-400 hover:bg-slate-700'
              : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TaskBoard({ projectId, agents, isCoachingProject, onWatchLive }: TaskBoardProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const typedAgents = castAgents(agents);

  // Data hooks
  const { data, isLoading, isError, error } = useTasks(projectId);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  // Local UI state
  const [creatingInColumn, setCreatingInColumn] = useState<ColumnStatus | null>(null);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Set<string>>(new Set());

  // Group tasks by column status. Tasks with 'blocked' status appear in pending.
  const tasksByColumn = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const grouped: Record<ColumnStatus, Task[]> = {
      pending: [],
      in_progress: [],
      review: [],
      completed: [],
    };

    for (const task of tasks) {
      const status = task.status === 'blocked' ? 'pending' : task.status;
      if (status in grouped) {
        grouped[status as ColumnStatus].push(task);
      } else {
        grouped.pending.push(task);
      }
    }

    // Sort each column: higher priority (lower number) first, then by creation date
    for (const col of Object.values(grouped)) {
      col.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
    }

    return grouped;
  }, [data?.tasks]);

  // Handlers
  const handleChangeStatus = useCallback(
    (taskId: string, newStatus: ColumnStatus) => {
      setUpdatingTaskIds((prev) => new Set(prev).add(taskId));
      updateTask.mutate(
        { taskId, status: newStatus },
        {
          onSettled: () => {
            setUpdatingTaskIds((prev) => {
              const next = new Set(prev);
              next.delete(taskId);
              return next;
            });
          },
        },
      );
    },
    [updateTask],
  );

  const handleDelete = useCallback(
    (taskId: string) => {
      if (!confirm('Delete this task?')) return;
      setUpdatingTaskIds((prev) => new Set(prev).add(taskId));
      deleteTask.mutate(
        { taskId, projectId },
        {
          onSettled: () => {
            setUpdatingTaskIds((prev) => {
              const next = new Set(prev);
              next.delete(taskId);
              return next;
            });
          },
        },
      );
    },
    [deleteTask, projectId],
  );

  const handleCreateTask = useCallback(
    (title: string, description: string, priority: number) => {
      createTask.mutate(
        {
          project_id: projectId,
          title,
          description: description || undefined,
          priority,
        },
        {
          onSuccess: () => setCreatingInColumn(null),
        },
      );
    },
    [createTask, projectId],
  );

  // ------ Styles ------
  const containerBg = darkMode ? 'bg-slate-900' : 'bg-gray-50';
  const headerColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const columnBorder = darkMode ? 'border-slate-700' : 'border-gray-200';
  const countBadgeBg = darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-600';
  const addBtnClasses = darkMode
    ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700'
    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200';

  // ------ Loading state ------
  if (isLoading) {
    return (
      <div className={clsx('flex-1 flex items-center justify-center', containerBg)}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={clsx('w-8 h-8 animate-spin', subColor)} />
          <p className={clsx('text-sm', subColor)}>Loading tasks...</p>
        </div>
      </div>
    );
  }

  // ------ Error state ------
  if (isError) {
    return (
      <div className={clsx('flex-1 flex items-center justify-center', containerBg)}>
        <div className="flex flex-col items-center gap-3 max-w-sm text-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <p className={clsx('text-sm font-medium', headerColor)}>Failed to load tasks</p>
          <p className={clsx('text-xs', subColor)}>
            {error instanceof Error ? error.message : 'An unexpected error occurred.'}
          </p>
        </div>
      </div>
    );
  }

  // ------ Board ------
  const totalTasks = data?.total ?? 0;

  return (
    <div className={clsx('flex-1 flex flex-col overflow-hidden', containerBg)}>
      {/* Board header */}
      <div className={clsx('flex items-center justify-between px-5 py-3 border-b', darkMode ? 'border-slate-700' : 'border-gray-200')}>
        <div>
          <h2 className={clsx('text-base font-bold', headerColor)}>
            {isCoachingProject ? 'Learning Tasks' : 'Task Board'}
          </h2>
          <p className={clsx('text-xs mt-0.5', subColor)}>
            {totalTasks} task{totalTasks !== 1 ? 's' : ''} across {COLUMNS.length} stages
          </p>
        </div>
        <button
          onClick={() => setCreatingInColumn('pending')}
          className={clsx(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            'bg-blue-600 text-white hover:bg-blue-700',
          )}
        >
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 h-full min-w-max">
          {COLUMNS.map((col) => {
            const tasks = tasksByColumn[col.status];
            const isCreatingHere = creatingInColumn === col.status;

            return (
              <div
                key={col.status}
                className={clsx(
                  'flex flex-col w-72 rounded-lg border-t-2 border',
                  col.accent,
                  columnBorder,
                  darkMode ? 'bg-slate-800/40' : 'bg-white/60',
                )}
              >
                {/* Column header */}
                <div
                  className={clsx(
                    'flex items-center justify-between px-3 py-2.5 rounded-t-lg',
                    darkMode ? col.headerBgDark : col.headerBg,
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={clsx('w-2.5 h-2.5 rounded-full', col.dotColor)} />
                    <span className={clsx('text-sm font-semibold', headerColor)}>
                      {col.label}
                    </span>
                    <span
                      className={clsx(
                        'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                        countBadgeBg,
                      )}
                    >
                      {tasks.length}
                    </span>
                  </div>
                  <button
                    onClick={() => setCreatingInColumn(isCreatingHere ? null : col.status)}
                    className={clsx('p-1 rounded transition-colors', addBtnClasses)}
                    title={`Add task to ${col.label}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Cards list */}
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
                  {/* Inline create form */}
                  {isCreatingHere && (
                    <CreateTaskForm
                      darkMode={darkMode}
                      defaultStatus={col.status}
                      onSubmit={handleCreateTask}
                      onCancel={() => setCreatingInColumn(null)}
                      isSubmitting={createTask.isPending}
                    />
                  )}

                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agents={typedAgents}
                      darkMode={darkMode}
                      onChangeStatus={handleChangeStatus}
                      onDelete={handleDelete}
                      onWatchLive={onWatchLive}
                      isUpdating={updatingTaskIds.has(task.id)}
                    />
                  ))}

                  {tasks.length === 0 && !isCreatingHere && (
                    <p className={clsx('text-xs text-center py-6', subColor)}>
                      No tasks
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
