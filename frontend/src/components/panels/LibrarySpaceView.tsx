/**
 * LibrarySpaceView — project detail pane with metadata editor, Kanban
 * board, and expandable task side-panel.
 *
 * Rendered inside LibraryPanel's main area when a project name is clicked
 * in the sidebar.
 */
import { useState, useMemo, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  Star, Target, Pause, CheckCircle2, Archive as ArchiveIcon, Trash2,
  Plus, Calendar, User, Sparkles, X, Bell, BellOff, MessageSquare,
  Clock, Save, Edit2, Circle, CheckCircle, AlertTriangle,
  Image as ImageIcon, Upload, Wand2, Loader2,
} from 'lucide-react';
import {
  useLibrarySpace,
  useUpdateLibrarySpace,
  useProjectTasks,
  useProjectTaskColumns,
  useCreateLibraryTask,
  useUpdateLibraryTask,
  useDeleteLibraryTask,
  useMoveLibraryTask,
  useCommentLibraryTask,
  useAddColumn,
  useRenameColumn,
  useRemoveColumn,
  useGetLibraryTask,
  useUploadSpaceCover,
  useGenerateSpaceCover,
  useDeleteSpaceCover,
  spaceCoverUrl,
} from '@/hooks/useApi';
import type {
  LibraryTask, LibraryTaskColumn, TaskActivity,
} from '@/hooks/useApi';
import { MarkdownContent } from '@/components/common';

interface Props {
  project: string;
  dark: boolean;
  onClose: () => void;
  /** When true, hides the cover banner + title header (used when
   *  embedded inside SpacePage which already shows the space name). */
  embedded?: boolean;
}

export function LibrarySpaceView({ project, dark, onClose, embedded }: Props) {
  const projectDetail = useLibrarySpace(project);
  const updateProject = useUpdateLibrarySpace();
  const tasksQuery = useProjectTasks(project);
  const columnsQuery = useProjectTaskColumns(project);
  const createTask = useCreateLibraryTask();
  const moveTask = useMoveLibraryTask();
  const deleteTask = useDeleteLibraryTask();
  const addColumn = useAddColumn();
  const removeColumn = useRemoveColumn();
  const uploadCover = useUploadSpaceCover();
  const generateCover = useGenerateSpaceCover();
  const deleteCover = useDeleteSpaceCover();
  const renameColumn = useRenameColumn();

  const [editingMeta, setEditingMeta] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{
    name: string;
    description: string;
    kind: string;
    status: 'active' | 'paused' | 'completed' | 'archived';
    target_date: string;
    reminder_channel: 'all' | 'sms' | 'discord' | 'teamwork';
  } | null>(null);

  const [addingTaskIn, setAddingTaskIn] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [renameColumnDraft, setRenameColumnDraft] = useState('');

  const meta = projectDetail.data;

  useEffect(() => {
    if (!editingMeta && meta) {
      setDraftMeta({
        name: meta.name,
        description: meta.description ?? '',
        kind: meta.kind ?? '',
        status: meta.status ?? 'active',
        target_date: meta.target_date ?? '',
        reminder_channel: meta.reminder_channel ?? 'all',
      });
    }
  }, [meta, editingMeta]);

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const columns = useMemo(() => columnsQuery.data?.columns ?? [], [columnsQuery.data]);

  const tasksByColumn = useMemo(() => {
    const map: Record<string, LibraryTask[]> = {};
    for (const col of columns) map[col.id] = [];
    for (const t of tasks) {
      if (!map[t.column]) map[t.column] = [];
      map[t.column].push(t);
    }
    return map;
  }, [tasks, columns]);

  // Styles
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';
  const inputBase = clsx(
    'px-2 py-1 rounded border text-sm outline-none',
    dark
      ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500'
      : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
  );
  const btnPrimary =
    'px-2.5 py-1 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40';
  const btnGhost = clsx(
    'px-2 py-1 rounded text-xs',
    dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200',
  );

  const handleSaveMeta = () => {
    if (!draftMeta) return;
    updateProject.mutate({ project, ...draftMeta }, {
      onSuccess: () => setEditingMeta(false),
    });
  };

  const handleTogglePinned = () => {
    if (!meta) return;
    updateProject.mutate({ project, pinned: !meta.pinned });
  };

  const handleAddTask = (column: string) => {
    if (!newTaskTitle.trim()) return;
    createTask.mutate(
      { project, title: newTaskTitle.trim(), column, author: 'human' },
      {
        onSuccess: () => {
          setNewTaskTitle('');
          setAddingTaskIn(null);
        },
      },
    );
  };

  const handleDropOnColumn = (column: string) => {
    if (!draggingTaskId) return;
    const task = tasks.find((t) => t.id === draggingTaskId);
    if (!task || task.column === column) {
      setDraggingTaskId(null);
      setDragOverColumn(null);
      return;
    }
    moveTask.mutate(
      { project, task_id: draggingTaskId, column, editor: 'human' },
      {
        onSuccess: () => {
          setDraggingTaskId(null);
          setDragOverColumn(null);
        },
      },
    );
  };

  if (projectDetail.isLoading || !meta) {
    return (
      <div className={clsx('flex-1 flex items-center justify-center', dark ? 'bg-slate-900' : 'bg-white')}>
        <span className={t2}>Loading project…</span>
      </div>
    );
  }

  const coverSrc = spaceCoverUrl(meta);
  const handleUploadClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadCover.mutate({ space: project, file });
    };
    input.click();
  };

  return (
    <div className={clsx('flex-1 flex flex-col min-w-0 overflow-hidden', dark ? 'bg-slate-900' : 'bg-white')}>
      {/* Cover banner — hidden when embedded in SpacePage */}
      {!embedded && <div className="relative w-full h-32 shrink-0 group">
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={`Cover for ${meta.name}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: (() => {
                let h = 0;
                for (let i = 0; i < meta.slug.length; i++) {
                  h = (h * 31 + meta.slug.charCodeAt(i)) | 0;
                }
                const hue = Math.abs(h) % 360;
                return `linear-gradient(135deg, hsl(${hue}, 60%, ${dark ? 25 : 65}%) 0%, hsl(${(hue + 40) % 360}, 60%, ${dark ? 35 : 75}%) 100%)`;
              })(),
            }}
          />
        )}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleUploadClick}
            disabled={uploadCover.isPending}
            className="px-2 py-1 rounded bg-black/60 text-white text-xs hover:bg-black/80 flex items-center gap-1"
            title="Upload a cover image"
          >
            {uploadCover.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Upload
          </button>
          <button
            onClick={() => generateCover.mutate({ space: project })}
            disabled={generateCover.isPending}
            className="px-2 py-1 rounded bg-indigo-600/90 text-white text-xs hover:bg-indigo-500 flex items-center gap-1"
            title="Ask Prax to generate a cover image"
          >
            {generateCover.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Wand2 className="w-3 h-3" />
            )}
            {generateCover.isPending ? 'Generating…' : 'Generate with Prax'}
          </button>
          {coverSrc && (
            <button
              onClick={() => {
                if (confirm('Remove the cover image?')) {
                  deleteCover.mutate(project);
                }
              }}
              className="px-2 py-1 rounded bg-black/60 text-white text-xs hover:bg-red-600/80 flex items-center gap-1"
              title="Remove cover"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {!coverSrc && !generateCover.isPending && !uploadCover.isPending && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="px-3 py-1 rounded bg-black/50 text-white text-xs flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              Hover and click Upload or Generate to add a cover
            </div>
          </div>
        )}
      </div>}

      {/* Header with project meta — hidden when embedded */}
      {!embedded && <div className={clsx('px-4 py-3 border-b', border)}>
        <div className="flex items-start gap-2 mb-2">
          <button
            onClick={handleTogglePinned}
            className={clsx('p-1 rounded', dark ? 'hover:bg-slate-800' : 'hover:bg-gray-200')}
            title={meta.pinned ? 'Unpin' : 'Pin'}
          >
            <Star
              className={clsx(
                'w-4 h-4',
                meta.pinned ? 'text-amber-400 fill-amber-400' : t3,
              )}
            />
          </button>
          {editingMeta && draftMeta ? (
            <input
              value={draftMeta.name}
              onChange={(e) => setDraftMeta({ ...draftMeta, name: e.target.value })}
              className={clsx(inputBase, 'flex-1 text-lg font-semibold')}
            />
          ) : (
            <h2 className={clsx('text-xl font-semibold flex-1', t1)}>{meta.name}</h2>
          )}
          <StatusPill status={meta.status ?? 'active'} dark={dark} />
          {!editingMeta && (
            <button onClick={() => setEditingMeta(true)} className={btnGhost} title="Edit project meta">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {editingMeta && (
            <>
              <button onClick={handleSaveMeta} className={btnPrimary}>
                <Save className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Save
              </button>
              <button onClick={() => setEditingMeta(false)} className={btnGhost}>Cancel</button>
            </>
          )}
          <button onClick={onClose} className={btnGhost} title="Close"><X className="w-3.5 h-3.5" /></button>
        </div>

        {editingMeta && draftMeta ? (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <label className={clsx('text-xs flex flex-col gap-0.5', t2)}>
              Kind
              <input
                value={draftMeta.kind}
                placeholder="learning, initiative, creative, …"
                onChange={(e) => setDraftMeta({ ...draftMeta, kind: e.target.value })}
                className={inputBase}
                list="project-kinds"
              />
              <datalist id="project-kinds">
                <option value="learning" />
                <option value="initiative" />
                <option value="creative" />
                <option value="life_area" />
                <option value="ops" />
                <option value="research" />
              </datalist>
            </label>
            <label className={clsx('text-xs flex flex-col gap-0.5', t2)}>
              Status
              <select
                value={draftMeta.status}
                onChange={(e) => setDraftMeta({ ...draftMeta, status: e.target.value as 'active' | 'paused' | 'completed' | 'archived' })}
                className={inputBase}
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className={clsx('text-xs flex flex-col gap-0.5', t2)}>
              Target date
              <input
                type="date"
                value={draftMeta.target_date.slice(0, 10)}
                onChange={(e) => setDraftMeta({ ...draftMeta, target_date: e.target.value })}
                className={inputBase}
              />
            </label>
            <label className={clsx('text-xs flex flex-col gap-0.5', t2)}>
              Reminder channel
              <select
                value={draftMeta.reminder_channel}
                onChange={(e) => setDraftMeta({ ...draftMeta, reminder_channel: e.target.value as 'all' | 'sms' | 'discord' | 'teamwork' })}
                className={inputBase}
              >
                <option value="all">All channels</option>
                <option value="sms">SMS only</option>
                <option value="discord">Discord only</option>
                <option value="teamwork">TeamWork only</option>
              </select>
            </label>
            <label className={clsx('text-xs flex flex-col gap-0.5 col-span-2', t2)}>
              Description
              <textarea
                value={draftMeta.description}
                onChange={(e) => setDraftMeta({ ...draftMeta, description: e.target.value })}
                rows={2}
                className={inputBase}
              />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {meta.kind && (
              <span className={clsx(
                'px-1.5 py-0.5 rounded',
                dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-slate-700',
              )}>{meta.kind}</span>
            )}
            {meta.target_date && (
              <span className={clsx('flex items-center gap-0.5', t3)}>
                <Calendar className="w-3 h-3" /> {meta.target_date.slice(0, 10)}
              </span>
            )}
            <span className={clsx('flex items-center gap-0.5', t3)}>
              <Bell className="w-3 h-3" /> {meta.reminder_channel}
            </span>
            <span className={t3}>
              {meta.notebook_count ?? 0} notebooks · {meta.note_count ?? 0} notes · {meta.progress_percent ?? 0}% progress
            </span>
          </div>
        )}
        {meta.description && !editingMeta && (
          <p className={clsx('text-xs mt-2', t2)}>{meta.description}</p>
        )}
      </div>}

      {/* Kanban board */}
      {(meta.tasks_enabled ?? true) && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className={clsx('px-4 py-2 border-b flex items-center gap-2', border)}>
            <span className={clsx('text-xs font-semibold', t3)}>TASKS</span>
            <span className={clsx('text-xs', t3)}>{tasks.length} total</span>
            <div className="flex-1" />
            {!addingColumn && (
              <button onClick={() => setAddingColumn(true)} className={btnGhost}>
                <Plus className="w-3 h-3 inline -mt-0.5 mr-1" /> Column
              </button>
            )}
            {addingColumn && (
              <>
                <input
                  autoFocus
                  placeholder="Column name"
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newColumnName.trim()) {
                      addColumn.mutate({ project, name: newColumnName.trim() }, {
                        onSuccess: () => { setNewColumnName(''); setAddingColumn(false); },
                      });
                    }
                  }}
                  className={clsx(inputBase, 'w-40')}
                />
                <button
                  onClick={() => {
                    if (newColumnName.trim()) {
                      addColumn.mutate({ project, name: newColumnName.trim() }, {
                        onSuccess: () => { setNewColumnName(''); setAddingColumn(false); },
                      });
                    }
                  }}
                  className={btnPrimary}
                >
                  Add
                </button>
                <button onClick={() => setAddingColumn(false)} className={btnGhost}>Cancel</button>
              </>
            )}
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
            <div className="flex gap-3 h-full min-w-max mx-auto justify-center">
              {columns.map((col: LibraryTaskColumn) => {
                const isDropTarget = dragOverColumn === col.id;
                return (
                  <div
                    key={col.id}
                    className={clsx(
                      'w-72 shrink-0 flex flex-col rounded-lg border transition-colors',
                      cardBg, border,
                      isDropTarget && 'ring-2 ring-indigo-500',
                    )}
                    onDragOver={(e) => { e.preventDefault(); setDragOverColumn(col.id); }}
                    onDragLeave={() => dragOverColumn === col.id && setDragOverColumn(null)}
                    onDrop={(e) => { e.preventDefault(); handleDropOnColumn(col.id); }}
                  >
                    <div className={clsx('px-3 py-2 border-b flex items-center gap-1 group', border)}>
                      {renamingColumn === col.id ? (
                        <>
                          <input
                            autoFocus
                            value={renameColumnDraft}
                            onChange={(e) => setRenameColumnDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && renameColumnDraft.trim()) {
                                renameColumn.mutate({ project, column_id: col.id, name: renameColumnDraft.trim() }, {
                                  onSuccess: () => setRenamingColumn(null),
                                });
                              }
                            }}
                            className={clsx(inputBase, 'flex-1 text-xs')}
                          />
                          <button onClick={() => setRenamingColumn(null)} className={btnGhost}>
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className={clsx('text-xs font-semibold flex-1', t1)}>{col.name}</span>
                          <span className={clsx('text-xs', t3)}>{tasksByColumn[col.id]?.length ?? 0}</span>
                          <button
                            className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                            onClick={() => {
                              setRenamingColumn(col.id);
                              setRenameColumnDraft(col.name);
                            }}
                            title="Rename"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {(tasksByColumn[col.id]?.length ?? 0) === 0 && col.id !== 'todo' && (
                            <button
                              className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                              onClick={() => {
                                if (confirm(`Delete empty column "${col.name}"?`)) {
                                  removeColumn.mutate({ project, column_id: col.id });
                                }
                              }}
                              title="Delete column"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {(tasksByColumn[col.id] ?? []).map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          dark={dark}
                          onClick={() => setSelectedTaskId(task.id)}
                          onDragStart={() => setDraggingTaskId(task.id)}
                          onDragEnd={() => { setDraggingTaskId(null); setDragOverColumn(null); }}
                        />
                      ))}
                      {addingTaskIn === col.id ? (
                        <div className={clsx('rounded border p-2 space-y-1', border, dark ? 'bg-slate-900' : 'bg-white')}>
                          <input
                            autoFocus
                            placeholder="Task title"
                            value={newTaskTitle}
                            onChange={(e) => setNewTaskTitle(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddTask(col.id)}
                            className={clsx(inputBase, 'w-full')}
                          />
                          <div className="flex gap-1">
                            <button onClick={() => handleAddTask(col.id)} className={btnPrimary}>Add</button>
                            <button onClick={() => { setAddingTaskIn(null); setNewTaskTitle(''); }} className={btnGhost}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingTaskIn(col.id)}
                          className={clsx(
                            'w-full text-left text-xs py-1.5 px-2 rounded',
                            dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-gray-100',
                          )}
                        >
                          <Plus className="w-3 h-3 inline -mt-0.5 mr-1" /> Add task
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Task side panel */}
      {selectedTaskId && (
        <TaskSidePanel
          project={project}
          taskId={selectedTaskId}
          dark={dark}
          onClose={() => setSelectedTaskId(null)}
          onDelete={() => {
            if (confirm('Delete this task?')) {
              deleteTask.mutate({ project, task_id: selectedTaskId }, {
                onSuccess: () => setSelectedTaskId(null),
              });
            }
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Task card
// ────────────────────────────────────────────────────────────

function confidenceDotClass(c: LibraryTask['confidence']) {
  switch (c) {
    case 'high':
      return 'bg-emerald-500';
    case 'low':
      return 'bg-red-500';
    case 'medium':
      return 'bg-amber-500';
    default:
      return '';
  }
}

function confidenceLabel(c: LibraryTask['confidence']) {
  if (!c) return '';
  if (c === 'low') return 'Low confidence (Prax is guessing)';
  return `${c[0].toUpperCase()}${c.slice(1)} confidence (self-reported)`;
}

function TaskCard({
  task, dark, onClick, onDragStart, onDragEnd,
}: {
  task: LibraryTask;
  dark: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';

  const overdue = task.due_date && new Date(task.due_date) < new Date();
  const fromToolOutput = task.source === 'tool_output';
  const confClass = confidenceDotClass(task.confidence);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={clsx(
        'rounded border p-2 cursor-pointer transition-colors',
        fromToolOutput
          ? (dark ? 'bg-amber-950/40 border-amber-700 hover:border-amber-500' : 'bg-amber-50 border-amber-300 hover:border-amber-500')
          : (dark ? 'bg-slate-900 border-slate-700 hover:border-indigo-500' : 'bg-white border-gray-200 hover:border-indigo-400'),
      )}
    >
      {fromToolOutput && (
        <div
          className={clsx('text-[10px] flex items-center gap-1 mb-1 font-semibold', dark ? 'text-amber-300' : 'text-amber-700')}
          title={task.source_justification || 'This task came from a tool output — review before trusting.'}
        >
          <AlertTriangle className="w-3 h-3" />
          From tool output
        </div>
      )}
      <div className="flex items-start gap-1 mb-1">
        {task.author === 'human' ? (
          <User className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
        ) : (
          <Sparkles className="w-3 h-3 text-indigo-500 shrink-0 mt-0.5" />
        )}
        <span className={clsx('text-xs flex-1', t1)}>{task.title}</span>
        {confClass && (
          <span
            className={clsx('w-1.5 h-1.5 rounded-full shrink-0 mt-1', confClass)}
            title={confidenceLabel(task.confidence)}
            aria-label={confidenceLabel(task.confidence)}
          />
        )}
      </div>
      {task.due_date && (
        <div className={clsx('text-xs flex items-center gap-0.5 mt-1', overdue ? 'text-red-400' : t3)}>
          <Clock className="w-3 h-3" /> {new Date(task.due_date).toLocaleString([], { month: 'short', day: 'numeric' })}
          {task.reminder_id ? <Bell className="w-3 h-3 ml-1" /> : null}
        </div>
      )}
      {task.assignees && task.assignees.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {task.assignees.slice(0, 3).map((a) => (
            <span
              key={a}
              className={clsx(
                'text-xs px-1 py-0.5 rounded',
                dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-slate-700',
              )}
            >
              {a}
            </span>
          ))}
        </div>
      )}
      {task.comments.length > 0 && (
        <div className={clsx('text-xs flex items-center gap-0.5 mt-1', t3)}>
          <MessageSquare className="w-3 h-3" /> {task.comments.length}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Task side panel (expandable task detail)
// ────────────────────────────────────────────────────────────

function TaskSidePanel({
  project, taskId, dark, onClose, onDelete,
}: {
  project: string;
  taskId: string;
  dark: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const taskQuery = useGetLibraryTask(project, taskId);
  const updateTask = useUpdateLibraryTask();
  const commentTask = useCommentLibraryTask();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    due_date: string;
    reminder_enabled: boolean;
    assignees: string;
  } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const task = taskQuery.data;

  useEffect(() => {
    if (task && !editing) {
      setDraft({
        title: task.title,
        description: task.description,
        due_date: task.due_date ? task.due_date.slice(0, 16) : '',
        reminder_enabled: task.reminder_enabled,
        assignees: task.assignees.join(', '),
      });
    }
  }, [task, editing]);

  if (!task || !draft) return null;

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const inputBase = clsx(
    'px-2 py-1 rounded border text-sm outline-none w-full',
    dark
      ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500'
      : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
  );
  const btnPrimary = 'px-2.5 py-1 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40';
  const btnGhost = clsx('px-2 py-1 rounded text-xs', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200');

  const handleSave = () => {
    updateTask.mutate({
      project,
      task_id: taskId,
      title: draft.title,
      description: draft.description,
      due_date: draft.due_date ? new Date(draft.due_date).toISOString() : '',
      reminder_enabled: draft.reminder_enabled,
      assignees: draft.assignees.split(',').map((a) => a.trim()).filter(Boolean),
      editor: 'human',
    }, {
      onSuccess: () => setEditing(false),
    });
  };

  const handleComment = () => {
    if (!commentDraft.trim()) return;
    commentTask.mutate({ project, task_id: taskId, text: commentDraft.trim(), actor: 'human' }, {
      onSuccess: () => setCommentDraft(''),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className={clsx(
        'w-[480px] h-full flex flex-col border-l shadow-xl',
        dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200',
      )}>
        {/* Header */}
        <div className={clsx('px-4 py-3 border-b flex items-center gap-2', border)}>
          <span className={clsx('text-xs px-1.5 py-0.5 rounded', dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-slate-700')}>
            {task.column}
          </span>
          <span className={clsx('text-xs', t3)}>{task.id}</span>
          <div className="flex-1" />
          {editing ? (
            <>
              <button onClick={handleSave} className={btnPrimary}><Save className="w-3 h-3" /></button>
              <button onClick={() => setEditing(false)} className={btnGhost}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className={btnGhost}><Edit2 className="w-3 h-3" /></button>
          )}
          <button onClick={onDelete} className={btnGhost}><Trash2 className="w-3 h-3 text-red-400" /></button>
          <button onClick={onClose} className={btnGhost}><X className="w-3.5 h-3.5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Title */}
          {editing ? (
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={clsx(inputBase, 'text-lg font-semibold')} />
          ) : (
            <h2 className={clsx('text-lg font-semibold', t1)}>{task.title}</h2>
          )}

          {/* Author + source + confidence */}
          <div className={clsx('text-xs flex items-center gap-2 flex-wrap', t2)}>
            <span>Created by: <AuthorBadge author={task.author} dark={dark} /></span>
            {task.source && (
              <span className="flex items-center gap-1">
                · Source: <SourceBadge source={task.source} dark={dark} />
              </span>
            )}
            {task.confidence && (
              <span className="flex items-center gap-1" title={confidenceLabel(task.confidence)}>
                · Confidence:
                <span className={clsx('w-1.5 h-1.5 rounded-full inline-block', confidenceDotClass(task.confidence))} />
                <span>{task.confidence}</span>
              </span>
            )}
          </div>
          {task.source === 'tool_output' && task.source_justification && (
            <div
              className={clsx(
                'text-xs rounded border px-2 py-1.5 flex items-start gap-2',
                dark ? 'border-amber-700 bg-amber-950/40 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800',
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Tool-originated task</div>
                <div>{task.source_justification}</div>
                <div className="italic mt-0.5 opacity-80">Review before trusting — tool outputs can carry prompt-injection attempts.</div>
              </div>
            </div>
          )}

          {/* Assignees */}
          <div>
            <div className={clsx('text-xs font-semibold mb-1', t3)}>ASSIGNEES</div>
            {editing ? (
              <input
                placeholder="prax, human, sam"
                value={draft.assignees}
                onChange={(e) => setDraft({ ...draft, assignees: e.target.value })}
                className={inputBase}
              />
            ) : task.assignees.length > 0 ? (
              <div className="flex gap-1 flex-wrap">
                {task.assignees.map((a) => (
                  <span key={a} className={clsx('text-xs px-2 py-0.5 rounded flex items-center gap-1', dark ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-slate-700')}>
                    {a === 'prax' ? <Sparkles className="w-3 h-3 text-indigo-500" /> : <User className="w-3 h-3 text-emerald-500" />}
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <span className={clsx('text-xs italic', t3)}>No assignees</span>
            )}
          </div>

          {/* Due date + reminder */}
          <div>
            <div className={clsx('text-xs font-semibold mb-1', t3)}>DUE DATE</div>
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  className={clsx(inputBase, 'flex-1')}
                />
                <button
                  onClick={() => setDraft({ ...draft, reminder_enabled: !draft.reminder_enabled })}
                  className={btnGhost}
                  title={draft.reminder_enabled ? 'Reminder enabled' : 'Reminder disabled'}
                >
                  {draft.reminder_enabled ? <Bell className="w-4 h-4 text-amber-400" /> : <BellOff className="w-4 h-4" />}
                </button>
              </div>
            ) : task.due_date ? (
              <div className={clsx('text-xs flex items-center gap-2', t2)}>
                <Clock className="w-3 h-3" />
                {new Date(task.due_date).toLocaleString()}
                {task.reminder_id ? (
                  <span className="text-amber-400 flex items-center gap-1"><Bell className="w-3 h-3" /> scheduled</span>
                ) : task.reminder_enabled ? (
                  <span className={t3}>(no reminder)</span>
                ) : (
                  <span className={t3}><BellOff className="w-3 h-3 inline" /> off</span>
                )}
              </div>
            ) : (
              <span className={clsx('text-xs italic', t3)}>No due date</span>
            )}
          </div>

          {/* Description */}
          <div>
            <div className={clsx('text-xs font-semibold mb-1', t3)}>DESCRIPTION</div>
            {editing ? (
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={6}
                className={inputBase}
              />
            ) : task.description ? (
              <div className={clsx('prose prose-sm max-w-none', dark && 'prose-invert')}>
                <MarkdownContent content={task.description} darkMode={dark} />
              </div>
            ) : (
              <span className={clsx('text-xs italic', t3)}>No description</span>
            )}
          </div>

          {/* Checklist */}
          {task.checklist.length > 0 && (
            <div>
              <div className={clsx('text-xs font-semibold mb-1', t3)}>CHECKLIST</div>
              <div className="space-y-1">
                {task.checklist.map((item, i) => (
                  <div key={i} className={clsx('text-xs flex items-center gap-1.5', t1)}>
                    {item.done ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Circle className="w-3.5 h-3.5" />}
                    <span className={item.done ? 'line-through opacity-60' : ''}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <div className={clsx('text-xs font-semibold mb-1', t3)}>COMMENTS</div>
            <div className="space-y-2 mb-2">
              {task.comments.map((c, i) => (
                <div key={i} className={clsx('rounded p-2 text-xs', dark ? 'bg-slate-800' : 'bg-gray-50')}>
                  <div className={clsx('flex items-center gap-1 mb-1', t3)}>
                    <AuthorBadge author={c.actor} dark={dark} />
                    <span>{new Date(c.at).toLocaleString()}</span>
                  </div>
                  <div className={t1}>{c.text}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                placeholder="Add a comment…"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleComment()}
                className={clsx(inputBase, 'flex-1')}
              />
              <button onClick={handleComment} disabled={!commentDraft.trim()} className={btnPrimary}>Post</button>
            </div>
          </div>

          {/* Activity log */}
          <div>
            <div className={clsx('text-xs font-semibold mb-1', t3)}>ACTIVITY</div>
            <div className="space-y-1">
              {task.activity.map((a: TaskActivity, i) => (
                <div key={i} className={clsx('text-xs flex items-center gap-1', t2)}>
                  <AuthorBadge author={a.actor} dark={dark} />
                  <span>
                    {a.action}
                    {a.action === 'moved' && a.from && a.to && <span className={t3}> {a.from} → {a.to}</span>}
                    {a.action === 'updated' && a.fields && <span className={t3}> ({a.fields.join(', ')})</span>}
                    {a.action === 'commented' && a.text && <span className={t3}>: "{a.text.slice(0, 40)}…"</span>}
                  </span>
                  <span className={t3}>· {new Date(a.at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthorBadge({ author, dark }: { author: string; dark: boolean }) {
  if (author === 'human') {
    return (
      <span className={clsx('text-xs px-1 py-0.5 rounded inline-flex items-center gap-0.5', dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}>
        <User className="w-3 h-3" /> You
      </span>
    );
  }
  if (author === 'prax') {
    return (
      <span className={clsx('text-xs px-1 py-0.5 rounded inline-flex items-center gap-0.5', dark ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-700')}>
        <Sparkles className="w-3 h-3" /> Prax
      </span>
    );
  }
  return (
    <span className={clsx('text-xs px-1 py-0.5 rounded inline-flex items-center gap-0.5', dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-slate-700')}>
      {author}
    </span>
  );
}

function SourceBadge({ source, dark }: { source: LibraryTask['source']; dark: boolean }) {
  if (source === 'user_request') {
    return (
      <span className={clsx('text-xs px-1 py-0.5 rounded', dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}>
        user request
      </span>
    );
  }
  if (source === 'agent_derived') {
    return (
      <span className={clsx('text-xs px-1 py-0.5 rounded', dark ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-700')}>
        agent derived
      </span>
    );
  }
  if (source === 'tool_output') {
    return (
      <span className={clsx('text-xs px-1 py-0.5 rounded inline-flex items-center gap-0.5', dark ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-800')}>
        <AlertTriangle className="w-3 h-3" /> tool output
      </span>
    );
  }
  return null;
}

function StatusPill({ status, dark }: { status: string; dark: boolean }) {
  const styles: Record<string, { icon: typeof Target; color: string }> = {
    active: { icon: Target, color: dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700' },
    paused: { icon: Pause, color: dark ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-50 text-amber-700' },
    completed: { icon: CheckCircle2, color: dark ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-700' },
    archived: { icon: ArchiveIcon, color: dark ? 'bg-slate-700 text-slate-400' : 'bg-gray-100 text-slate-500' },
  };
  const { icon: Icon, color } = styles[status] ?? styles.active;
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded flex items-center gap-1', color)}>
      <Icon className="w-3 h-3" /> {status}
    </span>
  );
}
