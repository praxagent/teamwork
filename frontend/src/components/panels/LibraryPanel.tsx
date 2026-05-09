/**
 * LibraryPanel — hierarchical knowledge base (Project → Notebook → Note).
 *
 * Design inspired by Karpathy's "Second Brain" three-folder pattern
 * (raw / wiki / outputs) and Obsidian's vault-with-notebooks UX.  See
 * docs/library.md in the Prax repo for the full design.
 *
 * Phase 2 features live in this file:
 *   - [[wikilinks]] rendering in note bodies
 *   - Backlinks panel (reverse lookup)
 *   - HTML5 drag-and-drop to move notes between notebooks
 *   - "Ask Prax to refine" with diff preview + Apply/Cancel flow
 *   - LIBRARY.md schema editor
 *   - INDEX.md viewer
 *   - Raw captures browser with Promote action
 *   - Outputs browser
 *   - SVG graph view showing wikilink topology
 *   - Health check runner + report viewer (Karpathy's monthly audit)
 */
import { useState, useMemo, useEffect } from 'react';
import { clsx } from 'clsx';
import {
  X, ChevronRight, ChevronDown, Plus, FolderOpen, Folder, FileText,
  Trash2, Save, Pencil, User, Sparkles, Lock, Unlock, ArrowRightCircle,
  Settings, FileCode, Archive, Inbox, Network, Stethoscope, Play,
  Link as LinkIcon, AlertTriangle, CheckCircle, Circle, Clock,
  RefreshCw, MessageSquare, StickyNote, Home,
} from 'lucide-react';
import {
  useLibrary,
  useCreateLibrarySpace,
  useCreateLibraryNotebook,
  useCreateLibraryNote,
  useLibraryNote,
  useUpdateLibraryNote,
  useDeleteLibraryNote,
  useMoveLibraryNote,
  useSetLibraryNoteEditable,
  useDeleteLibraryNotebook,
  useDeleteLibrarySpace,
  useLibrarySchema,
  useSaveLibrarySchema,
  useLibraryIndex,
  useRebuildLibraryIndex,
  useLibraryBacklinks,
  useRefineLibraryNote,
  useApplyLibraryRefine,
  useRefineViaAgent,
  useLibraryRaw,
  useGetRaw,
  usePromoteRaw,
  useDeleteRaw,
  useLibraryArchive,
  useGetLibraryArchive,
  useDeleteLibraryArchive,
  useLibraryOutputs,
  useGetOutput,
  useDeleteOutput,
  useLibraryHealthCheck,
  useScheduleLibraryHealthCheck,
  useUpdateLibraryNotebook,
  useSetNoteStatus,
  useReorderNotebook,
} from '@/hooks/useApi';
import { LibrarySpaceView } from './LibrarySpaceView';
import type {
  LibraryNote, LibraryNotebook, LibrarySpace, LibraryBacklink,
  RawItem, OutputItem, HealthCheckReport, ArchiveItem,
} from '@/hooks/useApi';
import { MarkdownContent } from '@/components/common';
import { useUIStore } from '@/stores';

interface Props {
  isVisible: boolean;
  onClose: () => void;
  /** Optional: called when the user clicks the Home button in the
   *  library sidebar.  The parent layout is responsible for switching
   *  views (the library panel doesn't manage top-level routing). */
  onGoHome?: () => void;
  /** Optional project slug to open the project view for on mount (used
   *  when jumping from the Home dashboard to a specific project). */
  focusProject?: string | null;
  /** Called after the focus has been consumed so the caller can clear
   *  its state. */
  onFocusProjectConsumed?: () => void;
}

type MainView =
  | { kind: 'empty' }
  | { kind: 'all-notes' }
  | { kind: 'note'; project: string; notebook: string; slug: string }
  | { kind: 'project'; project: string }
  | { kind: 'notebook'; project: string; notebook: string }
  | { kind: 'schema' }
  | { kind: 'index' }
  | { kind: 'raw'; slug: string }
  | { kind: 'archive'; slug: string }
  | { kind: 'output'; slug: string }
  | { kind: 'graph' }
  | { kind: 'health' };

export function LibraryPanel({ isVisible, onClose, onGoHome, focusProject, onFocusProjectConsumed }: Props) {
  const dark = useUIStore((s) => s.darkMode);
  const { data, isLoading } = useLibrary();
  const createProject = useCreateLibrarySpace();
  const createNotebook = useCreateLibraryNotebook();
  const createNote = useCreateLibraryNote();
  const updateNote = useUpdateLibraryNote();
  const deleteNote = useDeleteLibraryNote();
  const moveNote = useMoveLibraryNote();
  const setEditable = useSetLibraryNoteEditable();
  const deleteNotebook = useDeleteLibraryNotebook();
  const deleteProject = useDeleteLibrarySpace();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [mainView, setMainView] = useState<MainView>({ kind: 'empty' });
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState('');

  // Inline create states
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingNotebookIn, setCreatingNotebookIn] = useState<string | null>(null);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [creatingNoteIn, setCreatingNoteIn] = useState<{ project: string; notebook: string } | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteBody, setNewNoteBody] = useState('');
  const [movingNote, setMovingNote] = useState<{ to_project: string; to_notebook: string } | null>(null);

  // Drag-and-drop state
  const [dragging, setDragging] = useState<{ project: string; notebook: string; slug: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Refine flow state
  const [refineModal, setRefineModal] = useState<{ instructions: string } | null>(null);
  const [refinePreview, setRefinePreview] = useState<{ before: string; after: string } | null>(null);
  const refine = useRefineLibraryNote();
  const applyRefine = useApplyLibraryRefine();
  const refineViaAgent = useRefineViaAgent();

  // Schema editor state
  const [schemaDraft, setSchemaDraft] = useState<string | null>(null);
  const schemaQuery = useLibrarySchema();
  const saveSchema = useSaveLibrarySchema();

  // Index content
  const indexQuery = useLibraryIndex();
  const rebuildIndex = useRebuildLibraryIndex();

  // Inbox (stored as raw on disk) + archive + outputs
  const rawQuery = useLibraryRaw();
  const archiveQuery = useLibraryArchive();
  const outputsQuery = useLibraryOutputs();
  const rawDetail = useGetRaw(mainView.kind === 'raw' ? mainView.slug : null);
  const archiveDetail = useGetLibraryArchive(mainView.kind === 'archive' ? mainView.slug : null);
  const outputDetail = useGetOutput(mainView.kind === 'output' ? mainView.slug : null);
  const promoteRaw = usePromoteRaw();
  const deleteRaw = useDeleteRaw();
  const deleteArchive = useDeleteLibraryArchive();
  const deleteOutput = useDeleteOutput();
  const [promoteTarget, setPromoteTarget] = useState<{ project: string; notebook: string } | null>(null);

  // Settings popover (for Schema / Index / Health — pulled out of the
  // primary sidebar nav so browsing the library doesn't feel like an
  // admin panel)
  const [settingsOpen, setSettingsOpen] = useState(false);

  // New-note modal state (used from the All Notes view's "New Note"
  // button).  Opens a real markdown editor with live preview instead of
  // a cramped inline form.
  const [newNoteModal, setNewNoteModal] = useState<{
    title: string;
    body: string;
    project: string;
    notebook: string;
    showPreview: boolean;
  } | null>(null);

  // Library chat toggle — controls whether the parent layout renders
  // the chat column while the library is open.
  const libraryHideChat = useUIStore((s) => s.libraryHideChat);
  const toggleLibraryHideChat = useUIStore((s) => s.toggleLibraryHideChat);

  // Health check
  const healthCheck = useLibraryHealthCheck();
  const scheduleHealthCheck = useScheduleLibraryHealthCheck();
  const [healthReport, setHealthReport] = useState<HealthCheckReport | null>(null);

  // Notebook operations (sequenced mode, reorder, lesson status)
  const updateNotebookMeta = useUpdateLibraryNotebook();
  const setNoteStatus = useSetNoteStatus();
  const reorderNotebook = useReorderNotebook();

  // Open project view when Home dashboard jumps here
  useEffect(() => {
    if (focusProject) {
      setMainView({ kind: 'project', project: focusProject });
      setExpandedProjects((prev) => new Set([...prev, focusProject]));
      onFocusProjectConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProject]);

  // Selected note
  const selection = mainView.kind === 'note' ? mainView : null;
  const selectedNote = useLibraryNote(
    selection?.project ?? null,
    selection?.notebook ?? null,
    selection?.slug ?? null,
  );
  const backlinks = useLibraryBacklinks(
    selection?.project ?? null,
    selection?.notebook ?? null,
    selection?.slug ?? null,
  );

  // Internal variable kept as `projects` because many downstream
  // references (drag/drop, promote target, filters) use `project` as
  // the field key on LibraryNote metadata — renaming would cascade
  // across ~30 sites with no user-visible benefit.  UI labels still
  // say "Space" everywhere the user sees them.
  const projects = useMemo<LibrarySpace[]>(() => data?.spaces ?? [], [data]);
  const notebookKey = (p: string, n: string) => `${p}/${n}`;

  // Flattened all-notes view: every note from every project/notebook
  // sorted newest-first by updated_at, so the user can scan "what did
  // I touch recently" without drilling through the tree.
  type FlatNote = LibraryNote & {
    project: string;
    project_name: string;
    notebook: string;
    notebook_name: string;
  };
  const allNotesFlat = useMemo<FlatNote[]>(() => {
    const out: FlatNote[] = [];
    for (const p of projects) {
      for (const nb of p.notebooks) {
        for (const n of nb.notes) {
          out.push({
            ...n,
            project: p.slug,
            project_name: p.name,
            notebook: nb.slug,
            notebook_name: nb.name,
          });
        }
      }
    }
    out.sort((a, b) =>
      (b.updated_at || '').localeCompare(a.updated_at || ''),
    );
    return out;
  }, [projects]);

  // When schema editor opens, load current content
  useEffect(() => {
    if (mainView.kind === 'schema' && schemaDraft === null && schemaQuery.data) {
      setSchemaDraft(schemaQuery.data.content);
    }
  }, [mainView, schemaDraft, schemaQuery.data]);

  const toggleProject = (slug: string) => {
    const next = new Set(expandedProjects);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setExpandedProjects(next);
  };

  const toggleNotebook = (key: string) => {
    const next = new Set(expandedNotebooks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedNotebooks(next);
  };

  if (!isVisible) return null;

  // Styles
  const bg = dark ? 'bg-slate-900' : 'bg-white';
  const sidebarBg = dark ? 'bg-slate-950' : 'bg-gray-50';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const hover = dark ? 'hover:bg-slate-800' : 'hover:bg-gray-100';
  const inputBase = clsx(
    'px-2 py-1 rounded border text-sm outline-none w-full',
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

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    createProject.mutate(
      { name: newProjectName.trim() },
      {
        onSuccess: () => { setNewProjectName(''); setCreatingProject(false); },
      },
    );
  };

  const handleCreateNotebook = (project: string) => {
    if (!newNotebookName.trim()) return;
    createNotebook.mutate(
      { project, name: newNotebookName.trim() },
      {
        onSuccess: () => {
          setNewNotebookName('');
          setCreatingNotebookIn(null);
          setExpandedProjects(new Set([...expandedProjects, project]));
        },
      },
    );
  };

  const handleCreateNote = () => {
    if (!creatingNoteIn || !newNoteTitle.trim()) return;
    createNote.mutate(
      {
        project: creatingNoteIn.project,
        notebook: creatingNoteIn.notebook,
        title: newNoteTitle.trim(),
        content: newNoteBody,
        author: 'human',
      },
      {
        onSuccess: () => {
          setNewNoteTitle(''); setNewNoteBody(''); setCreatingNoteIn(null);
          setExpandedNotebooks(
            new Set([
              ...expandedNotebooks,
              notebookKey(creatingNoteIn.project, creatingNoteIn.notebook),
            ]),
          );
        },
      },
    );
  };

  const handleSaveEdit = () => {
    if (!selection) return;
    updateNote.mutate(
      { ...selection, content: editBody, editor: 'human' },
      { onSuccess: () => setEditMode(false) },
    );
  };

  const handleRefineSubmit = () => {
    if (!selection || !refineModal) return;
    refine.mutate(
      { ...selection, instructions: refineModal.instructions },
      {
        onSuccess: (result) => {
          if (result.error) {
            alert(`Refine failed: ${result.error}`);
            return;
          }
          setRefineModal(null);
          setRefinePreview({ before: result.before, after: result.after });
        },
      },
    );
  };

  const handleApplyRefine = () => {
    if (!selection || !refinePreview) return;
    applyRefine.mutate(
      { ...selection, content: refinePreview.after },
      { onSuccess: () => setRefinePreview(null) },
    );
  };

  const handleDropOnNotebook = (targetProject: string, targetNotebook: string) => {
    if (!dragging) return;
    if (dragging.project === targetProject && dragging.notebook === targetNotebook) {
      setDragging(null);
      setDragOver(null);
      return;
    }
    moveNote.mutate(
      {
        project: dragging.project,
        notebook: dragging.notebook,
        slug: dragging.slug,
        to_project: targetProject,
        to_notebook: targetNotebook,
      },
      {
        onSuccess: () => {
          if (selection?.slug === dragging.slug) {
            setMainView({ kind: 'note', project: targetProject, notebook: targetNotebook, slug: dragging.slug });
          }
          setDragging(null);
          setDragOver(null);
        },
      },
    );
  };

  const runHealthCheck = () => {
    healthCheck.mutate(undefined, {
      onSuccess: (report) => {
        setHealthReport(report);
        setMainView({ kind: 'health' });
      },
    });
  };

  const noteMeta = selectedNote.data?.meta;
  const noteContent = selectedNote.data?.content ?? '';
  const isHumanNote = noteMeta?.author === 'human';

  return (
    <div className={clsx('flex-1 flex min-w-0 min-h-0 h-full', bg)}>
      {/* ── Sidebar ──────────────────────────────── */}
      <div className={clsx('w-72 border-r overflow-y-auto shrink-0 min-h-0', border, sidebarBg)}>
        <div className={clsx('px-3 py-2.5 flex items-center justify-between border-b sticky top-0 z-10', border, sidebarBg)}>
          <div className="flex items-center gap-2">
            <FolderOpen className={clsx('w-4 h-4', dark ? 'text-indigo-400' : 'text-indigo-600')} />
            <span className={clsx('font-semibold text-sm', t1)}>Library</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={toggleLibraryHideChat}
              className={clsx(
                'p-1.5 rounded transition-colors',
                !libraryHideChat
                  ? dark ? 'bg-purple-600/30 text-purple-400' : 'bg-purple-100 text-purple-600'
                  : dark ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-200',
              )}
              title={libraryHideChat ? 'Show chat panel' : 'Hide chat panel'}
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setCreatingProject((v) => !v)} className={btnGhost} title="New space">
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className={btnGhost} title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Primary nav — the views you actually browse */}
        <div className={clsx('py-1 border-b', border)}>
          {onGoHome && (
            <SidebarButton
              icon={Home}
              label="Home"
              active={false}
              onClick={onGoHome}
              dark={dark}
            />
          )}
          <SidebarButton
            icon={StickyNote}
            label="All Notes"
            active={mainView.kind === 'all-notes'}
            onClick={() => setMainView({ kind: 'all-notes' })}
            dark={dark}
          />
          <SidebarButton
            icon={Inbox}
            label={`Inbox (${rawQuery.data?.raw.length ?? 0})`}
            active={mainView.kind === 'raw'}
            onClick={() => {
              const first = rawQuery.data?.raw[0];
              if (first) setMainView({ kind: 'raw', slug: first.slug });
            }}
            dark={dark}
          />
          {mainView.kind === 'raw' && (rawQuery.data?.raw ?? []).length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {(rawQuery.data?.raw ?? []).map((r: RawItem) => (
                <div
                  key={r.slug}
                  onClick={() => setMainView({ kind: 'raw', slug: r.slug })}
                  className={clsx(
                    'pl-8 pr-3 py-1 text-xs cursor-pointer flex items-center gap-1',
                    mainView.slug === r.slug ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50') : hover,
                    t1,
                  )}
                >
                  <Inbox className="w-3 h-3 shrink-0" />
                  <span className="truncate">{r.title}</span>
                </div>
              ))}
            </div>
          )}
          <SidebarButton
            icon={Archive}
            label={`Archive (${archiveQuery.data?.archive.length ?? 0})`}
            active={mainView.kind === 'archive'}
            onClick={() => {
              const first = archiveQuery.data?.archive[0];
              if (first) setMainView({ kind: 'archive', slug: first.slug });
            }}
            dark={dark}
          />
          {mainView.kind === 'archive' && (archiveQuery.data?.archive ?? []).length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {(archiveQuery.data?.archive ?? []).map((a: ArchiveItem) => (
                <div
                  key={a.slug}
                  onClick={() => setMainView({ kind: 'archive', slug: a.slug })}
                  className={clsx(
                    'pl-8 pr-3 py-1 text-xs cursor-pointer flex items-center gap-1',
                    mainView.slug === a.slug ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50') : hover,
                    t1,
                  )}
                >
                  <Archive className="w-3 h-3 shrink-0" />
                  <span className="truncate">{a.title}</span>
                </div>
              ))}
            </div>
          )}
          <SidebarButton
            icon={FileText}
            label={`Outputs (${outputsQuery.data?.outputs.length ?? 0})`}
            active={mainView.kind === 'output'}
            onClick={() => {
              const first = outputsQuery.data?.outputs[0];
              if (first) setMainView({ kind: 'output', slug: first.slug });
            }}
            dark={dark}
          />
          {mainView.kind === 'output' && (outputsQuery.data?.outputs ?? []).length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {(outputsQuery.data?.outputs ?? []).map((o: OutputItem) => (
                <div
                  key={o.slug}
                  onClick={() => setMainView({ kind: 'output', slug: o.slug })}
                  className={clsx(
                    'pl-8 pr-3 py-1 text-xs cursor-pointer flex items-center gap-1',
                    mainView.slug === o.slug ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50') : hover,
                    t1,
                  )}
                  title={o.kind}
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{o.title}</span>
                </div>
              ))}
            </div>
          )}
          <SidebarButton
            icon={Network}
            label="Graph"
            active={mainView.kind === 'graph'}
            onClick={() => setMainView({ kind: 'graph' })}
            dark={dark}
          />
        </div>

        {/* Settings popover — Schema, Index, Health check.  Pulled out
            of primary nav so browsing doesn't feel like admin work. */}
        <div className={clsx('py-1 border-b', border)}>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            className={clsx(
              'w-full px-3 py-1.5 flex items-center gap-2 text-xs',
              dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-gray-100',
            )}
          >
            {settingsOpen ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <Settings className="w-3.5 h-3.5" />
            <span className="flex-1 text-left">Settings & audit</span>
          </button>
          {settingsOpen && (
            <div className="pl-2">
              <SidebarButton
                icon={FileCode}
                label="Schema (LIBRARY.md)"
                active={mainView.kind === 'schema'}
                onClick={() => { setMainView({ kind: 'schema' }); setSchemaDraft(null); }}
                dark={dark}
              />
              <SidebarButton
                icon={FileText}
                label="Index"
                active={mainView.kind === 'index'}
                onClick={() => setMainView({ kind: 'index' })}
                dark={dark}
              />
              <SidebarButton
                icon={Stethoscope}
                label="Health check"
                active={mainView.kind === 'health'}
                onClick={() => setMainView({ kind: 'health' })}
                dark={dark}
              />
            </div>
          )}
        </div>

        {creatingProject && (
          <div className={clsx('px-3 py-2 border-b space-y-1.5', border)}>
            <input
              autoFocus
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              className={inputBase}
            />
            <div className="flex gap-1">
              <button onClick={handleCreateProject} className={btnPrimary}>Create</button>
              <button onClick={() => setCreatingProject(false)} className={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        {isLoading && <div className={clsx('px-3 py-4 text-xs', t3)}>Loading…</div>}
        {!isLoading && projects.length === 0 && (
          <div className={clsx('px-3 py-6 text-xs', t2)}>
            No spaces yet. Click + to create one.
          </div>
        )}

        {projects.map((project) => {
          const expanded = expandedProjects.has(project.slug);
          return (
            <div key={project.slug}>
              <div
                className={clsx(
                  'px-2 py-1.5 flex items-center gap-1 cursor-pointer group',
                  hover,
                  mainView.kind === 'project' && mainView.project === project.slug
                    ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50')
                    : '',
                )}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleProject(project.slug); }}
                  className="p-0.5"
                  aria-label={expanded ? 'Collapse' : 'Expand'}
                >
                  {expanded ? <ChevronDown className={clsx('w-3.5 h-3.5', t3)} /> : <ChevronRight className={clsx('w-3.5 h-3.5', t3)} />}
                </button>
                <Folder className={clsx('w-3.5 h-3.5', t2)} />
                <span
                  className={clsx('text-sm font-medium flex-1 truncate', t1)}
                  onClick={() => setMainView({ kind: 'project', project: project.slug })}
                >
                  {project.name}
                </span>
                <span className={clsx('text-xs', t3)}>{project.notebook_count}</span>
                <button
                  className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                  title="New notebook"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreatingNotebookIn(project.slug);
                    setExpandedProjects(new Set([...expandedProjects, project.slug]));
                  }}
                >
                  <Plus className="w-3 h-3" />
                </button>
                {project.notebook_count === 0 && (
                  <button
                    className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                    title="Delete space"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete space "${project.name}"? Notes will be archived.`)) {
                        deleteProject.mutate({ slug: project.slug, archiveNotes: true });
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                )}
              </div>

              {expanded && creatingNotebookIn === project.slug && (
                <div className="pl-6 pr-2 py-1.5 space-y-1">
                  <input
                    autoFocus
                    placeholder="Notebook name"
                    value={newNotebookName}
                    onChange={(e) => setNewNotebookName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateNotebook(project.slug)}
                    className={inputBase}
                  />
                  <div className="flex gap-1">
                    <button onClick={() => handleCreateNotebook(project.slug)} className={btnPrimary}>Add</button>
                    <button onClick={() => setCreatingNotebookIn(null)} className={btnGhost}>Cancel</button>
                  </div>
                </div>
              )}

              {expanded && project.notebooks.map((notebook: LibraryNotebook) => {
                const nbKey = notebookKey(project.slug, notebook.slug);
                const nbExpanded = expandedNotebooks.has(nbKey);
                const isDropTarget = dragOver === nbKey;
                return (
                  <div key={nbKey}>
                    <div
                      className={clsx(
                        'pl-6 pr-2 py-1 flex items-center gap-1 cursor-pointer group transition-colors',
                        hover,
                        mainView.kind === 'notebook' && mainView.project === project.slug && mainView.notebook === notebook.slug
                          ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50')
                          : '',
                        isDropTarget && (dark ? 'bg-indigo-500/30 ring-1 ring-indigo-500' : 'bg-indigo-100 ring-1 ring-indigo-400'),
                      )}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(nbKey); }}
                      onDragLeave={() => dragOver === nbKey && setDragOver(null)}
                      onDrop={(e) => { e.preventDefault(); handleDropOnNotebook(project.slug, notebook.slug); }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleNotebook(nbKey); }}
                        className="p-0.5"
                      >
                        {nbExpanded ? <ChevronDown className={clsx('w-3 h-3', t3)} /> : <ChevronRight className={clsx('w-3 h-3', t3)} />}
                      </button>
                      <FileText className={clsx('w-3 h-3', t3)} />
                      <span
                        className={clsx('text-xs flex-1 truncate', t1)}
                        onClick={() => setMainView({ kind: 'notebook', project: project.slug, notebook: notebook.slug })}
                      >
                        {notebook.name}
                        {notebook.sequenced ? <span className={clsx('ml-1 text-[10px]', t3)}>• seq</span> : null}
                      </span>
                      <span className={clsx('text-xs', t3)}>{notebook.note_count}</span>
                      <button
                        className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                        title="New note"
                        onClick={(e) => { e.stopPropagation(); setCreatingNoteIn({ project: project.slug, notebook: notebook.slug }); }}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      {notebook.note_count === 0 && (
                        <button
                          className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100')}
                          title="Delete empty notebook"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete empty notebook "${notebook.name}"?`)) {
                              deleteNotebook.mutate({ project: project.slug, notebook: notebook.slug });
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      )}
                    </div>

                    {nbExpanded && notebook.notes.map((note: LibraryNote) => {
                      const isSelected =
                        selection?.project === project.slug &&
                        selection?.notebook === notebook.slug &&
                        selection?.slug === note.slug;
                      return (
                        <div
                          key={note.slug}
                          draggable
                          onDragStart={() => setDragging({ project: project.slug, notebook: notebook.slug, slug: note.slug })}
                          onDragEnd={() => { setDragging(null); setDragOver(null); }}
                          onClick={() => {
                            setMainView({ kind: 'note', project: project.slug, notebook: notebook.slug, slug: note.slug });
                            setEditMode(false);
                          }}
                          className={clsx(
                            'pl-10 pr-2 py-1 flex items-center gap-1.5 cursor-pointer',
                            isSelected ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50') : hover,
                          )}
                        >
                          {note.author === 'human' ? (
                            <User className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                          )}
                          <span className={clsx('text-xs truncate', t1)}>{note.title}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── Main pane ───────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {creatingNoteIn && (
          <div className={clsx('px-4 py-3 border-b space-y-2', border)}>
            <div className={clsx('text-xs font-semibold', t1)}>
              New note in {creatingNoteIn.project} / {creatingNoteIn.notebook}
            </div>
            <input autoFocus placeholder="Title" value={newNoteTitle} onChange={(e) => setNewNoteTitle(e.target.value)} className={inputBase} />
            <textarea
              placeholder="Write your note… (use [[slug]] for wikilinks)"
              value={newNoteBody}
              onChange={(e) => setNewNoteBody(e.target.value)}
              rows={6}
              className={inputBase}
            />
            <div className="flex gap-1.5">
              <button onClick={handleCreateNote} disabled={!newNoteTitle.trim() || createNote.isPending} className={btnPrimary}>
                {createNote.isPending ? 'Creating…' : 'Create note'}
              </button>
              <button onClick={() => setCreatingNoteIn(null)} className={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        {mainView.kind === 'empty' && !creatingNoteIn && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <FolderOpen className={clsx('w-10 h-10', t3)} />
            <p className={clsx('text-sm', t2)}>Pick a note from the sidebar</p>
            <p className={clsx('text-xs', t3)}>or use the quick-access links at the top</p>
          </div>
        )}

        {/* All Notes — flat view across every project/notebook */}
        {mainView.kind === 'all-notes' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2', border)}>
              <StickyNote className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1', t1)}>
                All Notes ({allNotesFlat.length})
              </h2>
              <button
                onClick={() => setNewNoteModal({
                  title: '',
                  body: '',
                  project: projects[0]?.slug ?? '',
                  notebook: projects[0]?.notebooks[0]?.slug ?? '',
                  showPreview: false,
                })}
                className={btnPrimary}
              >
                <Plus className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                New Note
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            {/* Flat note list */}
            <div className="flex-1 overflow-y-auto">
              {allNotesFlat.length === 0 ? (
                <div className={clsx('p-8 text-center text-sm', t3)}>
                  No notes yet. Click "New Note" above to create one.
                </div>
              ) : (
                <div className="divide-y">
                  {allNotesFlat.map((n) => (
                    <div
                      key={`${n.project}/${n.notebook}/${n.slug}`}
                      onClick={() => setMainView({
                        kind: 'note',
                        project: n.project,
                        notebook: n.notebook,
                        slug: n.slug,
                      })}
                      className={clsx(
                        'px-4 py-2 cursor-pointer',
                        dark ? 'border-slate-800 hover:bg-slate-800/60' : 'border-gray-100 hover:bg-gray-50',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {n.author === 'human' ? (
                          <User className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
                        )}
                        <span className={clsx('text-sm font-medium truncate flex-1', t1)}>
                          {n.title || n.slug}
                        </span>
                        {n.updated_at && (
                          <span className={clsx('text-xs shrink-0', t3)}>
                            {new Date(n.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className={clsx('text-xs mt-0.5 flex items-center gap-1', t2)}>
                        <FolderOpen className="w-3 h-3" />
                        <span className="truncate">{n.project_name} / {n.notebook_name}</span>
                        {n.tags && n.tags.length > 0 && (
                          <>
                            <span>·</span>
                            <span className="truncate">{n.tags.slice(0, 3).join(', ')}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Archive viewer — long-term keepers (PDFs, reference docs) */}
        {mainView.kind === 'archive' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
              <Archive className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1 truncate', t1)}>
                {archiveDetail.data?.meta.title ?? 'Archive entry'}
              </h2>
              <button
                onClick={() => {
                  if (confirm('Delete this archive entry? The original binary (if any) stays in your workspace.')) {
                    deleteArchive.mutate(mainView.slug, {
                      onSuccess: () => setMainView({ kind: 'empty' }),
                    });
                  }
                }}
                className={btnGhost}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {/* Sidebar sub-list of archive entries */}
              <div className={clsx('flex flex-row gap-0 min-h-full')}>
                <div className={clsx('w-56 border-r shrink-0', border)}>
                  <div className={clsx('px-3 py-1 text-xs font-semibold', t3)}>ARCHIVE</div>
                  {(archiveQuery.data?.archive ?? []).map((a: ArchiveItem) => (
                    <div
                      key={a.slug}
                      onClick={() => setMainView({ kind: 'archive', slug: a.slug })}
                      className={clsx(
                        'px-3 py-1.5 text-xs cursor-pointer flex items-center gap-1',
                        mainView.slug === a.slug
                          ? (dark ? 'bg-indigo-500/15' : 'bg-indigo-50')
                          : hover,
                        t1,
                      )}
                    >
                      <Archive className="w-3 h-3 shrink-0" />
                      <span className="truncate">{a.title}</span>
                    </div>
                  ))}
                </div>
                <div className="flex-1 p-4">
                  {archiveDetail.data?.meta.source_filename && (
                    <div className={clsx('text-xs mb-2', t3)}>
                      Original: {archiveDetail.data.meta.source_filename}
                      {archiveDetail.data.meta.binary_path && (
                        <span className="opacity-70"> @ {archiveDetail.data.meta.binary_path}</span>
                      )}
                    </div>
                  )}
                  {archiveDetail.data?.meta.tags && archiveDetail.data.meta.tags.length > 0 && (
                    <div className={clsx('text-xs mb-2 flex gap-1', t3)}>
                      {archiveDetail.data.meta.tags.map((tag) => (
                        <span key={tag} className={clsx('px-1.5 py-0.5 rounded', dark ? 'bg-slate-700' : 'bg-gray-200')}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
                    <MarkdownContent content={archiveDetail.data?.content ?? 'Loading…'} darkMode={dark} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Schema editor */}
        {mainView.kind === 'schema' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2', border)}>
              <FileCode className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1', t1)}>LIBRARY.md — Schema</h2>
              <button
                onClick={() => {
                  if (schemaDraft !== null) saveSchema.mutate(schemaDraft, { onSuccess: () => alert('Saved.') });
                }}
                className={btnPrimary}
              >
                <Save className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {saveSchema.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            <textarea
              value={schemaDraft ?? ''}
              onChange={(e) => setSchemaDraft(e.target.value)}
              className={clsx(inputBase, 'flex-1 font-mono text-sm m-4')}
              placeholder="Loading…"
            />
          </div>
        )}

        {/* Index viewer */}
        {mainView.kind === 'index' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2', border)}>
              <FileText className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1', t1)}>INDEX.md</h2>
              <button
                onClick={() => rebuildIndex.mutate()}
                disabled={rebuildIndex.isPending}
                className={btnPrimary}
                title="Force-rebuild the index from current notes"
              >
                <RefreshCw
                  className={clsx(
                    'w-3.5 h-3.5 inline mr-1',
                    rebuildIndex.isPending && 'animate-spin',
                  )}
                />
                {rebuildIndex.isPending ? 'Rebuilding…' : 'Rebuild'}
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
                <MarkdownContent content={indexQuery.data?.content ?? 'Loading…'} darkMode={dark} />
              </div>
            </div>
          </div>
        )}

        {/* Raw item viewer */}
        {mainView.kind === 'raw' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
              <Inbox className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1 truncate', t1)}>
                {rawDetail.data?.meta.title ?? 'Inbox item'}
              </h2>
              <button onClick={() => setPromoteTarget({ project: projects[0]?.slug ?? '', notebook: '' })} className={btnPrimary}>
                Promote to notebook
              </button>
              <button
                onClick={() => {
                  if (confirm('Delete this inbox item?')) {
                    deleteRaw.mutate(mainView.slug, { onSuccess: () => setMainView({ kind: 'empty' }) });
                  }
                }}
                className={btnGhost}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            {promoteTarget && (
              <div className={clsx('px-4 py-2 border-b flex items-center gap-2 flex-wrap', border)}>
                <span className={clsx('text-xs', t2)}>Promote to:</span>
                <select
                  value={promoteTarget.project}
                  onChange={(e) => setPromoteTarget({ project: e.target.value, notebook: '' })}
                  className={clsx(inputBase, 'w-40')}
                >
                  {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
                <select
                  value={promoteTarget.notebook}
                  onChange={(e) => setPromoteTarget({ ...promoteTarget, notebook: e.target.value })}
                  className={clsx(inputBase, 'w-40')}
                >
                  <option value="">Pick notebook…</option>
                  {projects.find((p) => p.slug === promoteTarget.project)?.notebooks.map((n) => (
                    <option key={n.slug} value={n.slug}>{n.name}</option>
                  ))}
                </select>
                <button
                  disabled={!promoteTarget.notebook}
                  onClick={() => {
                    promoteRaw.mutate(
                      { slug: mainView.slug, project: promoteTarget.project, notebook: promoteTarget.notebook },
                      {
                        onSuccess: () => {
                          setPromoteTarget(null);
                          setMainView({ kind: 'empty' });
                        },
                      },
                    );
                  }}
                  className={btnPrimary}
                >
                  Promote
                </button>
                <button onClick={() => setPromoteTarget(null)} className={btnGhost}>Cancel</button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4">
              {rawDetail.data?.meta.source_url && (
                <div className={clsx('text-xs mb-2', t3)}>
                  Source: <a href={rawDetail.data.meta.source_url} target="_blank" rel="noreferrer" className="underline">{rawDetail.data.meta.source_url}</a>
                </div>
              )}
              <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
                <MarkdownContent content={rawDetail.data?.content ?? 'Loading…'} darkMode={dark} />
              </div>
            </div>
          </div>
        )}

        {/* Output viewer */}
        {mainView.kind === 'output' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
              <Archive className={clsx('w-4 h-4', t2)} />
              <h2 className={clsx('text-lg font-semibold flex-1 truncate', t1)}>
                {outputDetail.data?.meta.title ?? 'Output'}
              </h2>
              <span className={clsx('text-xs px-1.5 py-0.5 rounded', dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-slate-600')}>
                {outputDetail.data?.meta.kind ?? '?'}
              </span>
              <button
                onClick={() => {
                  if (confirm('Delete this output?')) {
                    deleteOutput.mutate(mainView.slug, { onSuccess: () => setMainView({ kind: 'empty' }) });
                  }
                }}
                className={btnGhost}
                title="Delete output"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
              <button onClick={() => setMainView({ kind: 'empty' })} className={btnGhost}>Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
                <MarkdownContent content={outputDetail.data?.content ?? 'Loading…'} darkMode={dark} />
              </div>
            </div>
          </div>
        )}

        {/* Graph view */}
        {mainView.kind === 'graph' && (
          <LibraryGraphView projects={projects} dark={dark} onSelectNote={(p, n, s) => setMainView({ kind: 'note', project: p, notebook: n, slug: s })} onClose={() => setMainView({ kind: 'empty' })} />
        )}

        {/* Health check */}
        {mainView.kind === 'health' && (
          <HealthCheckView
            dark={dark}
            report={healthReport}
            loading={healthCheck.isPending}
            onRun={runHealthCheck}
            onClose={() => setMainView({ kind: 'empty' })}
            onOpenNote={(p, n, s) => setMainView({ kind: 'note', project: p, notebook: n, slug: s })}
            onSchedule={(cron, channel) => {
              scheduleHealthCheck.mutate(
                { cron_expr: cron, channel },
                {
                  onSuccess: (result) => {
                    if ('error' in result && result.error) {
                      alert(`Failed to schedule: ${String(result.error)}`);
                    } else {
                      alert(`Scheduled! Job id: ${result.schedule?.id ?? '?'}`);
                    }
                  },
                },
              );
            }}
            scheduling={scheduleHealthCheck.isPending}
          />
        )}

        {/* Project detail — metadata editor + Kanban + task side panel */}
        {mainView.kind === 'project' && (
          <LibrarySpaceView
            project={mainView.project}
            dark={dark}
            onClose={() => setMainView({ kind: 'empty' })}
          />
        )}

        {/* Notebook detail — sequenced or normal */}
        {mainView.kind === 'notebook' && (() => {
          const p = projects.find((pp) => pp.slug === (mainView as {project: string}).project);
          const nb = p?.notebooks.find((n) => n.slug === (mainView as {notebook: string}).notebook);
          if (!p || !nb) return null;
          return (
            <NotebookView
              project={p.slug}
              projectName={p.name}
              notebook={nb}
              dark={dark}
              onClose={() => setMainView({ kind: 'empty' })}
              onOpenNote={(slug) => setMainView({ kind: 'note', project: p.slug, notebook: nb.slug, slug })}
              onToggleSequenced={(seq) => updateNotebookMeta.mutate({ project: p.slug, notebook: nb.slug, sequenced: seq })}
              onMarkStatus={(slug, status) => setNoteStatus.mutate({ project: p.slug, notebook: nb.slug, slug, status })}
              onReorder={(slug_order) => reorderNotebook.mutate({ project: p.slug, notebook: nb.slug, slug_order })}
              onSetCurrent={(slug) => updateNotebookMeta.mutate({ project: p.slug, notebook: nb.slug, current_slug: slug })}
            />
          );
        })()}

        {/* Selected note view */}
        {selection && selectedNote.isLoading && (
          <div className={clsx('px-4 py-6 text-sm', t2)}>Loading note…</div>
        )}
        {selection && noteMeta && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
              <div className="flex-1 min-w-0">
                <h2 className={clsx('text-lg font-semibold truncate', t1)}>{noteMeta.title}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={clsx('text-xs', t3)}>{noteMeta.project} / {noteMeta.notebook}</span>
                  <AuthorBadge author={noteMeta.author} dark={dark} />
                  {noteMeta.prax_may_edit ? (
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded flex items-center gap-1', dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}>
                      <Unlock className="w-3 h-3" /> Prax may edit
                    </span>
                  ) : isHumanNote ? (
                    <span className={clsx('text-xs px-1.5 py-0.5 rounded flex items-center gap-1', dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-100 text-slate-600')}>
                      <Lock className="w-3 h-3" /> Locked
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-1">
                {!editMode && (
                  <button onClick={() => { setEditBody(noteContent); setEditMode(true); }} className={btnGhost} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {editMode && (
                  <button onClick={handleSaveEdit} className={btnPrimary} title="Save">
                    <Save className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setMovingNote({ to_project: noteMeta.project, to_notebook: noteMeta.notebook })}
                  className={btnGhost}
                  title="Move to…"
                >
                  <ArrowRightCircle className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Delete this note?')) {
                      deleteNote.mutate(selection, { onSuccess: () => setMainView({ kind: 'empty' }) });
                    }
                  }}
                  className={btnGhost}
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>

            {isHumanNote && (
              <div className={clsx('px-4 py-2 border-b flex items-center gap-2 text-xs flex-wrap', border, dark ? 'bg-slate-800/50' : 'bg-gray-50')}>
                <span className={t2}>Your note.</span>
                <button
                  onClick={() => setEditable.mutate({ ...selection, editable: !noteMeta.prax_may_edit })}
                  className={btnGhost}
                >
                  {noteMeta.prax_may_edit ? 'Lock (stop Prax edits)' : 'Unlock for Prax'}
                </button>
                <button onClick={() => setRefineModal({ instructions: '' })} className={btnGhost}>
                  <Sparkles className="w-3 h-3 inline -mt-0.5 mr-1" />
                  Ask Prax to refine
                </button>
              </div>
            )}

            {movingNote && (
              <div className={clsx('px-4 py-2 border-b flex items-center gap-2 flex-wrap', border)}>
                <span className={clsx('text-xs', t2)}>Move to:</span>
                <select
                  value={movingNote.to_project}
                  onChange={(e) => setMovingNote({ ...movingNote, to_project: e.target.value, to_notebook: '' })}
                  className={clsx(inputBase, 'w-40')}
                >
                  {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
                </select>
                <select
                  value={movingNote.to_notebook}
                  onChange={(e) => setMovingNote({ ...movingNote, to_notebook: e.target.value })}
                  className={clsx(inputBase, 'w-40')}
                >
                  <option value="">Pick notebook…</option>
                  {projects.find((p) => p.slug === movingNote.to_project)?.notebooks.map((n) => (
                    <option key={n.slug} value={n.slug}>{n.name}</option>
                  ))}
                </select>
                <button
                  disabled={!movingNote.to_notebook}
                  onClick={() => {
                    moveNote.mutate(
                      { ...selection, ...movingNote },
                      {
                        onSuccess: () => {
                          setMainView({ kind: 'note', project: movingNote.to_project, notebook: movingNote.to_notebook, slug: selection.slug });
                          setMovingNote(null);
                        },
                      },
                    );
                  }}
                  className={btnPrimary}
                >
                  Move
                </button>
                <button onClick={() => setMovingNote(null)} className={btnGhost}>Cancel</button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {editMode ? (
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className={clsx(inputBase, 'h-full font-mono text-sm min-h-96')}
                />
              ) : (
                <>
                  <WikilinkMarkdown
                    content={noteContent}
                    dark={dark}
                    currentProject={noteMeta.project}
                    currentNotebook={noteMeta.notebook}
                    onLinkClick={(p, n, s) => setMainView({ kind: 'note', project: p, notebook: n, slug: s })}
                  />
                  {(backlinks.data?.backlinks?.length ?? 0) > 0 && (
                    <div className={clsx('mt-6 pt-4 border-t', border)}>
                      <div className={clsx('text-xs font-semibold mb-2 flex items-center gap-1', t3)}>
                        <LinkIcon className="w-3 h-3" /> BACKLINKS ({backlinks.data?.backlinks.length})
                      </div>
                      <div className="space-y-1">
                        {backlinks.data?.backlinks.map((b: LibraryBacklink) => (
                          <div
                            key={`${b.project}/${b.notebook}/${b.slug}`}
                            onClick={() => setMainView({ kind: 'note', project: b.project, notebook: b.notebook, slug: b.slug })}
                            className={clsx('text-xs px-2 py-1 rounded cursor-pointer flex items-center gap-1.5', hover)}
                          >
                            {b.author === 'human' ? (
                              <User className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Sparkles className="w-3 h-3 text-indigo-500" />
                            )}
                            <span className={t1}>{b.title}</span>
                            <span className={t3}>({b.project}/{b.notebook})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New-note modal — full markdown editor with live preview */}
      {newNoteModal && (
        <Modal onClose={() => setNewNoteModal(null)} dark={dark}>
          <div className="p-4 space-y-3 w-[min(900px,95vw)] h-[min(720px,90vh)] flex flex-col">
            <div className="flex items-center gap-2 shrink-0">
              <StickyNote className={clsx('w-4 h-4', dark ? 'text-indigo-400' : 'text-indigo-600')} />
              <h3 className={clsx('text-base font-semibold flex-1', t1)}>New Note</h3>
              <button
                onClick={() => setNewNoteModal({ ...newNoteModal, showPreview: !newNoteModal.showPreview })}
                className={btnGhost}
              >
                {newNoteModal.showPreview ? 'Hide preview' : 'Preview'}
              </button>
              <button onClick={() => setNewNoteModal(null)} className={btnGhost}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Title */}
            <input
              autoFocus
              placeholder="Note title"
              value={newNoteModal.title}
              onChange={(e) => setNewNoteModal({ ...newNoteModal, title: e.target.value })}
              className={clsx(inputBase, 'text-lg font-semibold shrink-0')}
            />
            {/* Target space + notebook */}
            <div className="flex gap-2 items-center shrink-0">
              <label className={clsx('text-xs', t3)}>Space:</label>
              <select
                value={newNoteModal.project}
                onChange={(e) => setNewNoteModal({
                  ...newNoteModal,
                  project: e.target.value,
                  notebook: projects.find((p) => p.slug === e.target.value)?.notebooks[0]?.slug ?? '',
                })}
                className={clsx(inputBase, 'w-48')}
              >
                <option value="">Pick a space…</option>
                {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
              <label className={clsx('text-xs', t3)}>Notebook:</label>
              <select
                value={newNoteModal.notebook}
                onChange={(e) => setNewNoteModal({ ...newNoteModal, notebook: e.target.value })}
                className={clsx(inputBase, 'w-48')}
                disabled={!newNoteModal.project}
              >
                <option value="">Pick a notebook…</option>
                {projects
                  .find((p) => p.slug === newNoteModal.project)
                  ?.notebooks.map((n) => (
                    <option key={n.slug} value={n.slug}>{n.name}</option>
                  ))}
              </select>
            </div>
            {/* Markdown editor + optional live preview (side-by-side) */}
            <div className="flex-1 flex gap-3 min-h-0">
              <textarea
                placeholder={
                  "Write your note in markdown.\n\n"
                  + "Supports:\n"
                  + "- Headings, lists, code blocks\n"
                  + "- LaTeX math via $x$ or $$x$$\n"
                  + "- [[wikilinks]] to other notes (extracted automatically)\n"
                  + "- Mermaid diagrams in ```mermaid blocks"
                }
                value={newNoteModal.body}
                onChange={(e) => setNewNoteModal({ ...newNoteModal, body: e.target.value })}
                className={clsx(
                  inputBase,
                  'flex-1 font-mono text-sm resize-none leading-relaxed',
                )}
              />
              {newNoteModal.showPreview && (
                <div
                  className={clsx(
                    'flex-1 overflow-y-auto border rounded p-4',
                    dark ? 'border-slate-700 bg-slate-800/40' : 'border-gray-200 bg-gray-50',
                  )}
                >
                  {newNoteModal.body.trim() ? (
                    <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
                      <MarkdownContent content={newNoteModal.body} darkMode={dark} />
                    </div>
                  ) : (
                    <div className={clsx('text-xs italic', t3)}>
                      Preview appears here as you type.
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="flex gap-2 justify-end shrink-0">
              <button onClick={() => setNewNoteModal(null)} className={btnGhost}>Cancel</button>
              <button
                disabled={
                  !newNoteModal.title.trim() ||
                  !newNoteModal.project ||
                  !newNoteModal.notebook ||
                  createNote.isPending
                }
                onClick={() => {
                  createNote.mutate(
                    {
                      project: newNoteModal.project,
                      notebook: newNoteModal.notebook,
                      title: newNoteModal.title.trim(),
                      content: newNoteModal.body,
                      author: 'human',
                    },
                    {
                      onSuccess: () => {
                        setNewNoteModal(null);
                      },
                    },
                  );
                }}
                className={btnPrimary}
              >
                <Save className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {createNote.isPending ? 'Saving…' : 'Save Note'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Refine modal */}
      {refineModal && selection && (
        <Modal onClose={() => setRefineModal(null)} dark={dark}>
          <div className="p-4 space-y-3 w-[520px]">
            <h3 className={clsx('text-base font-semibold flex items-center gap-2', t1)}>
              <Sparkles className="w-4 h-4 text-indigo-500" /> Ask Prax to refine
            </h3>
            <p className={clsx('text-xs', t2)}>
              Describe how you'd like Prax to improve this note.
            </p>
            <textarea
              autoFocus
              placeholder="e.g., expand the section on entanglement, add an example, fix grammar, tighten the intro…"
              value={refineModal.instructions}
              onChange={(e) => setRefineModal({ instructions: e.target.value })}
              rows={5}
              className={inputBase}
            />
            <div className={clsx('rounded p-2 text-xs space-y-1', dark ? 'bg-slate-800' : 'bg-gray-50')}>
              <div className={t1}><strong>Quick refine</strong> (recommended)</div>
              <div className={t3}>
                A cheap model rewrites the note using only the existing body.
                Fast, cheap, shows a diff preview before saving.
              </div>
            </div>
            <div className={clsx('rounded p-2 text-xs space-y-1', dark ? 'bg-slate-800' : 'bg-gray-50')}>
              <div className={t1}><strong>Full agent</strong> (has tools)</div>
              <div className={t3}>
                Runs through the chat agent with web search, arxiv lookup,
                knowledge graph, and the full library toolbox.  Use when
                you need fresh facts, citations, or cross-references from
                other notes.  Slower, pricier, no preview — the agent
                saves directly.
              </div>
            </div>
            <div className="flex justify-end gap-1.5">
              <button onClick={() => setRefineModal(null)} className={btnGhost}>Cancel</button>
              <button
                onClick={() => {
                  if (!selection || !refineModal) return;
                  refineViaAgent.mutate(
                    { ...selection, instructions: refineModal.instructions },
                    {
                      onSuccess: () => setRefineModal(null),
                    },
                  );
                }}
                disabled={!refineModal.instructions.trim() || refineViaAgent.isPending}
                className={btnGhost}
              >
                {refineViaAgent.isPending ? 'Agent thinking…' : 'Full agent'}
              </button>
              <button
                onClick={handleRefineSubmit}
                disabled={!refineModal.instructions.trim() || refine.isPending}
                className={btnPrimary}
              >
                {refine.isPending ? 'Refining…' : 'Quick refine'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Refine preview modal */}
      {refinePreview && (
        <Modal onClose={() => setRefinePreview(null)} dark={dark}>
          <div className="p-4 space-y-3 w-[800px] max-h-[80vh] flex flex-col">
            <h3 className={clsx('text-base font-semibold flex items-center gap-2', t1)}>
              <Sparkles className="w-4 h-4 text-indigo-500" /> Review the refinement
            </h3>
            <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
              <div className="flex flex-col min-h-0">
                <div className={clsx('text-xs font-semibold mb-1', t3)}>BEFORE</div>
                <pre className={clsx('flex-1 overflow-auto p-2 rounded text-xs whitespace-pre-wrap font-mono', dark ? 'bg-slate-800' : 'bg-gray-100')}>
                  {refinePreview.before}
                </pre>
              </div>
              <div className="flex flex-col min-h-0">
                <div className={clsx('text-xs font-semibold mb-1', t3)}>AFTER</div>
                <pre className={clsx('flex-1 overflow-auto p-2 rounded text-xs whitespace-pre-wrap font-mono', dark ? 'bg-slate-800' : 'bg-gray-100')}>
                  {refinePreview.after}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-1.5">
              <button onClick={() => setRefinePreview(null)} className={btnGhost}>Cancel</button>
              <button onClick={handleApplyRefine} disabled={applyRefine.isPending} className={btnPrimary}>
                {applyRefine.isPending ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers & sub-components
// ────────────────────────────────────────────────────────────

function SidebarButton({
  icon: Icon, label, active, onClick, dark,
}: { icon: typeof Settings; label: string; active: boolean; onClick: () => void; dark: boolean }) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'px-3 py-2.5 text-sm cursor-pointer flex items-center gap-2.5 font-medium',
        active
          ? (dark ? 'bg-indigo-500/15 text-indigo-300' : 'bg-indigo-50 text-indigo-700')
          : (dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-gray-100'),
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function AuthorBadge({ author, dark }: { author: string; dark: boolean }) {
  if (author === 'human') {
    return (
      <span className={clsx('text-xs px-1.5 py-0.5 rounded flex items-center gap-1', dark ? 'bg-emerald-900/30 text-emerald-400' : 'bg-emerald-50 text-emerald-700')}>
        <User className="w-3 h-3" /> You
      </span>
    );
  }
  return (
    <span className={clsx('text-xs px-1.5 py-0.5 rounded flex items-center gap-1', dark ? 'bg-indigo-900/30 text-indigo-400' : 'bg-indigo-50 text-indigo-700')}>
      <Sparkles className="w-3 h-3" /> Agent
    </span>
  );
}

function Modal({ children, onClose, dark }: { children: React.ReactNode; onClose: () => void; dark: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={clsx('relative rounded-lg shadow-2xl', dark ? 'bg-slate-900 border border-slate-700' : 'bg-white border border-gray-200')}>
        {children}
      </div>
    </div>
  );
}

/**
 * Render markdown with clickable [[wikilink]] pills.
 * We pre-process the body, replacing `[[slug]]` with placeholder tokens
 * that we then render as spans inside the markdown output. For simplicity
 * (since react-markdown customization is already in MarkdownContent), we
 * split the body into segments and interleave markdown chunks + wikilink
 * pills.
 */
function WikilinkMarkdown({
  content,
  dark,
  currentProject,
  currentNotebook,
  onLinkClick,
}: {
  content: string;
  dark: boolean;
  currentProject: string;
  currentNotebook: string;
  onLinkClick: (project: string, notebook: string, slug: string) => void;
}) {
  const segments = useMemo(() => {
    const re = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g;
    const out: Array<{ kind: 'md'; text: string } | { kind: 'link'; target: string; display: string }> = [];
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m.index > lastIndex) {
        out.push({ kind: 'md', text: content.slice(lastIndex, m.index) });
      }
      out.push({ kind: 'link', target: m[1].trim(), display: (m[2] || m[1]).trim() });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < content.length) {
      out.push({ kind: 'md', text: content.slice(lastIndex) });
    }
    return out;
  }, [content]);

  const resolveTarget = (target: string) => {
    const parts = target.split('/');
    if (parts.length === 1) return { project: currentProject, notebook: currentNotebook, slug: parts[0] };
    if (parts.length === 2) return { project: currentProject, notebook: parts[0], slug: parts[1] };
    return { project: parts[0], notebook: parts[1], slug: parts[2] };
  };

  return (
    <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
      {segments.map((seg, i) => {
        if (seg.kind === 'md') {
          return <MarkdownContent key={i} content={seg.text} darkMode={dark} />;
        }
        const resolved = resolveTarget(seg.target);
        return (
          <span
            key={i}
            onClick={(e) => { e.preventDefault(); onLinkClick(resolved.project, resolved.notebook, resolved.slug); }}
            className={clsx(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded text-xs cursor-pointer no-underline',
              dark ? 'bg-indigo-900/40 text-indigo-300 hover:bg-indigo-800/60' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200',
            )}
            title={seg.target}
          >
            <LinkIcon className="w-2.5 h-2.5" />
            {seg.display}
          </span>
        );
      })}
    </div>
  );
}

/**
 * SVG-based graph view of notes + wikilink edges.
 * Uses a simple circular layout per project — not a force simulation.
 * Click a node to open the note.
 */
/**
 * Force-directed graph view of the library's wikilink topology.
 *
 * Runs a lightweight custom physics simulation in React state (no
 * external dependencies) with four forces per tick:
 *   1. Repulsion (Coulomb-like) between every pair of nodes
 *   2. Attraction along each wikilink edge (spring)
 *   3. Weak centering pull toward the viewport center
 *   4. Friction (velocity damping)
 *
 * Features:
 *   - Pan (drag the empty canvas)
 *   - Zoom (mouse wheel)
 *   - Filter by project
 *   - Filter by author (human / prax / both)
 *   - Click a node to open the note
 */
interface ForceNode {
  project: string;
  notebook: string;
  slug: string;
  title: string;
  author: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function LibraryGraphView({
  projects,
  dark,
  onSelectNote,
  onClose,
}: {
  projects: LibrarySpace[];
  dark: boolean;
  onSelectNote: (project: string, notebook: string, slug: string) => void;
  onClose: () => void;
}) {
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const btnGhost = clsx('px-2 py-1 rounded text-xs', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200');
  const inputBase = clsx(
    'px-2 py-1 rounded border text-xs outline-none',
    dark
      ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500'
      : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
  );

  const [projectFilter, setProjectFilter] = useState<string>('');
  const [authorFilter, setAuthorFilter] = useState<'all' | 'human' | 'prax'>('all');

  // Seed nodes + edges
  const { seedNodes, seedEdges } = useMemo(() => {
    const nodes: ForceNode[] = [];
    const nodeKeys = new Set<string>();
    const filteredProjects = projectFilter ? projects.filter((p) => p.slug === projectFilter) : projects;

    filteredProjects.forEach((p, projectIdx) => {
      p.notebooks.forEach((nb) => {
        nb.notes.forEach((n) => {
          if (authorFilter !== 'all' && n.author !== authorFilter) return;
          const key = `${p.slug}/${nb.slug}/${n.slug}`;
          // Scatter initial positions on a loose grid so the simulation
          // has somewhere to start.
          const hash = (projectIdx * 31 + nodes.length) * 47;
          nodes.push({
            project: p.slug,
            notebook: nb.slug,
            slug: n.slug,
            title: n.title,
            author: n.author,
            x: 400 + ((hash * 17) % 400) - 200,
            y: 300 + ((hash * 23) % 400) - 200,
            vx: 0,
            vy: 0,
          });
          nodeKeys.add(key);
        });
      });
    });

    const byKey = new Map<string, ForceNode>();
    for (const n of nodes) byKey.set(`${n.project}/${n.notebook}/${n.slug}`, n);

    const edges: Array<{ a: ForceNode; b: ForceNode }> = [];
    filteredProjects.forEach((p) => {
      p.notebooks.forEach((nb) => {
        nb.notes.forEach((n) => {
          if (authorFilter !== 'all' && n.author !== authorFilter) return;
          const from = byKey.get(`${p.slug}/${nb.slug}/${n.slug}`);
          if (!from) return;
          for (const link of n.wikilinks || []) {
            const parts = link.split('/');
            let targetKey: string;
            if (parts.length === 1) targetKey = `${p.slug}/${nb.slug}/${parts[0]}`;
            else if (parts.length === 2) targetKey = `${p.slug}/${parts[0]}/${parts[1]}`;
            else targetKey = `${parts[0]}/${parts[1]}/${parts[2]}`;
            const to = byKey.get(targetKey);
            if (to) edges.push({ a: from, b: to });
          }
        });
      });
    });

    return { seedNodes: nodes, seedEdges: edges };
  }, [projects, projectFilter, authorFilter]);

  // Live simulated nodes + view transform
  const [simNodes, setSimNodes] = useState<ForceNode[]>(seedNodes);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Node dragging + pinning
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [draggingNode, setDraggingNode] = useState<{
    key: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  // Re-seed when filters change
  useEffect(() => {
    setSimNodes(seedNodes);
  }, [seedNodes]);

  // Simulation loop (requestAnimationFrame)
  useEffect(() => {
    if (simNodes.length === 0) return;
    let raf = 0;
    let iter = 0;
    const MAX_ITER = 400;  // stop the simulation after it settles

    const step = () => {
      iter += 1;
      setSimNodes((prev) => {
        const nodes = prev.map((n) => ({ ...n }));
        const byKey = new Map<string, number>();
        nodes.forEach((n, i) => byKey.set(`${n.project}/${n.notebook}/${n.slug}`, i));

        // Repulsion
        const REPEL = 1800;
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[i].x - nodes[j].x;
            const dy = nodes[i].y - nodes[j].y;
            const distSq = dx * dx + dy * dy + 0.01;
            const force = REPEL / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx += fx;
            nodes[i].vy += fy;
            nodes[j].vx -= fx;
            nodes[j].vy -= fy;
          }
        }

        // Spring attraction along edges
        const SPRING = 0.02;
        const REST = 90;
        for (const edge of seedEdges) {
          const aKey = `${edge.a.project}/${edge.a.notebook}/${edge.a.slug}`;
          const bKey = `${edge.b.project}/${edge.b.notebook}/${edge.b.slug}`;
          const ai = byKey.get(aKey);
          const bi = byKey.get(bKey);
          if (ai === undefined || bi === undefined) continue;
          const dx = nodes[bi].x - nodes[ai].x;
          const dy = nodes[bi].y - nodes[ai].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const disp = dist - REST;
          const fx = SPRING * disp * (dx / dist);
          const fy = SPRING * disp * (dy / dist);
          nodes[ai].vx += fx;
          nodes[ai].vy += fy;
          nodes[bi].vx -= fx;
          nodes[bi].vy -= fy;
        }

        // Weak gravity toward center
        const CX = 400;
        const CY = 300;
        const GRAVITY = 0.005;
        for (const n of nodes) {
          n.vx += (CX - n.x) * GRAVITY;
          n.vy += (CY - n.y) * GRAVITY;
        }

        // Integrate + friction.  Pinned nodes (held by the user) stay
        // fixed so the user's drag is authoritative; everything else
        // responds to them.
        const FRICTION = 0.85;
        for (const n of nodes) {
          const key = `${n.project}/${n.notebook}/${n.slug}`;
          if (pinned.has(key)) {
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          n.vx *= FRICTION;
          n.vy *= FRICTION;
          n.x += n.vx;
          n.y += n.vy;
        }

        return nodes;
      });

      if (iter < MAX_ITER) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedEdges.length, seedNodes.length, projectFilter, authorFilter, pinned]);

  const edgesBySimNodes = useMemo(() => {
    const byKey = new Map<string, ForceNode>();
    for (const n of simNodes) byKey.set(`${n.project}/${n.notebook}/${n.slug}`, n);
    return seedEdges
      .map((e) => {
        const a = byKey.get(`${e.a.project}/${e.a.notebook}/${e.a.slug}`);
        const b = byKey.get(`${e.b.project}/${e.b.notebook}/${e.b.slug}`);
        return a && b ? { a, b } : null;
      })
      .filter((e): e is { a: ForceNode; b: ForceNode } => e !== null);
  }, [simNodes, seedEdges]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
        <Network className={clsx('w-4 h-4', t2)} />
        <h2 className={clsx('text-lg font-semibold flex-1', t1)}>Graph view</h2>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className={clsx(inputBase, 'w-40')}
        >
          <option value="">All spaces</option>
          {projects.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <select
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value as 'all' | 'human' | 'prax')}
          className={clsx(inputBase, 'w-28')}
        >
          <option value="all">All authors</option>
          <option value="human">Human only</option>
          <option value="prax">Agent only</option>
        </select>
        <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className={btnGhost} title="Reset view">
          Reset
        </button>
        <span className={clsx('text-xs', t2)}>{simNodes.length} notes, {edgesBySimNodes.length} links</span>
        <button onClick={onClose} className={btnGhost}>Close</button>
      </div>
      <div
        className={clsx('flex-1 overflow-hidden relative', dark ? 'bg-slate-950' : 'bg-slate-50')}
        onMouseDown={(e) => {
          // Only pan when the mousedown hit the background (not a node)
          const target = e.target as HTMLElement;
          if (target.tagName === 'svg' || target.tagName === 'DIV' || target.tagName === 'g') {
            setPanning({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
          }
        }}
        onMouseMove={(e) => {
          if (draggingNode) {
            // Update the dragged node's position in sim coords.
            const dx = (e.clientX - draggingNode.startX) / zoom;
            const dy = (e.clientY - draggingNode.startY) / zoom;
            const moved = draggingNode.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
            if (moved !== draggingNode.moved) {
              setDraggingNode({ ...draggingNode, moved });
            }
            setSimNodes((prev) =>
              prev.map((n) => {
                const key = `${n.project}/${n.notebook}/${n.slug}`;
                if (key === draggingNode.key) {
                  return { ...n, x: draggingNode.origX + dx, y: draggingNode.origY + dy, vx: 0, vy: 0 };
                }
                return n;
              }),
            );
            return;
          }
          if (panning) {
            setPan({
              x: panning.panX + (e.clientX - panning.startX),
              y: panning.panY + (e.clientY - panning.startY),
            });
          }
        }}
        onMouseUp={() => {
          if (draggingNode) {
            if (draggingNode.moved) {
              // Pin the node where the user dropped it.
              setPinned((prev) => new Set([...prev, draggingNode.key]));
            } else {
              // No drag — this was a click, open the note.
              const parts = draggingNode.key.split('/');
              if (parts.length >= 3) {
                onSelectNote(parts[0], parts[1], parts.slice(2).join('/'));
              }
            }
            setDraggingNode(null);
          }
          setPanning(null);
        }}
        onMouseLeave={() => { setPanning(null); setDraggingNode(null); }}
        onWheel={(e) => {
          e.preventDefault();
          const delta = e.deltaY > 0 ? 0.9 : 1.1;
          setZoom((z) => Math.max(0.2, Math.min(3, z * delta)));
        }}
      >
        {simNodes.length === 0 ? (
          <div className={clsx('p-8 text-sm', t2)}>
            No notes match the current filters. Create some notes with <code>[[wikilinks]]</code> to see the graph.
          </div>
        ) : (
          <svg width="100%" height="100%" className="block" style={{ cursor: panning ? 'grabbing' : draggingNode ? 'grabbing' : 'grab' }}>
            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* Edges */}
              {edgesBySimNodes.map((e, i) => (
                <line
                  key={i}
                  x1={e.a.x}
                  y1={e.a.y}
                  x2={e.b.x}
                  y2={e.b.y}
                  stroke={dark ? '#475569' : '#cbd5e1'}
                  strokeWidth={1}
                />
              ))}
              {/* Nodes */}
              {simNodes.map((n) => {
                const key = `${n.project}/${n.notebook}/${n.slug}`;
                const isPinned = pinned.has(key);
                return (
                  <g
                    key={key}
                    transform={`translate(${n.x},${n.y})`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingNode({
                        key,
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: n.x,
                        origY: n.y,
                        moved: false,
                      });
                    }}
                    onDoubleClick={(e) => {
                      // Double-click a pinned node to unpin it.
                      e.stopPropagation();
                      if (isPinned) {
                        setPinned((prev) => {
                          const next = new Set(prev);
                          next.delete(key);
                          return next;
                        });
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <circle
                      r={8}
                      fill={n.author === 'human' ? '#10b981' : '#6366f1'}
                      stroke={isPinned ? (dark ? '#fbbf24' : '#f59e0b') : (dark ? '#0f172a' : '#fff')}
                      strokeWidth={isPinned ? 3 : 2}
                    />
                    {isPinned && (
                      /* Small lock indicator for pinned nodes */
                      <circle r={2.5} cx={5} cy={-5} fill={dark ? '#fbbf24' : '#f59e0b'} />
                    )}
                    <text
                      x={12}
                      y={4}
                      className={clsx('text-xs pointer-events-none select-none', dark ? 'fill-slate-200' : 'fill-slate-800')}
                    >
                      {n.title.length > 28 ? n.title.slice(0, 26) + '…' : n.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className={clsx('absolute bottom-2 right-2 text-xs', t2)}>
          Scroll = zoom · Drag background = pan · Drag node = pin · Double-click pinned = unpin · Click node = open
        </div>
        {pinned.size > 0 && (
          <button
            onClick={() => setPinned(new Set())}
            className={clsx(
              'absolute top-2 right-2 px-2 py-1 rounded text-xs',
              dark ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-white text-slate-700 hover:bg-gray-100 border border-gray-200',
            )}
          >
            Unpin all ({pinned.size})
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Health check runner & report viewer.
 * Shows the Karpathy-style monthly audit with static findings (dead
 * wikilinks, orphans, empty notebooks) and LLM findings (contradictions,
 * unsourced claims, gap topics).
 */
function HealthCheckView({
  dark,
  report,
  loading,
  onRun,
  onClose,
  onOpenNote,
  onSchedule,
  scheduling,
}: {
  dark: boolean;
  report: HealthCheckReport | null;
  loading: boolean;
  onRun: () => void;
  onClose: () => void;
  onOpenNote: (project: string, notebook: string, slug: string) => void;
  onSchedule: (cron: string, channel: string) => void;
  scheduling: boolean;
}) {
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedCron, setSchedCron] = useState('0 9 * * 1');
  const [schedChannel, setSchedChannel] = useState('all');
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const btnPrimary = 'px-2.5 py-1 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40';
  const btnGhost = clsx('px-2 py-1 rounded text-xs', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200');
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';

  const openFromPath = (path: string) => {
    const parts = path.split('/');
    if (parts.length === 3) onOpenNote(parts[0], parts[1], parts[2]);
  };

  const inputBase = clsx(
    'px-2 py-1 rounded border text-xs outline-none',
    dark
      ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500'
      : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={clsx('px-4 py-3 border-b flex items-center gap-2 flex-wrap', border)}>
        <Stethoscope className={clsx('w-4 h-4', t2)} />
        <h2 className={clsx('text-lg font-semibold flex-1', t1)}>Library health check</h2>
        <button onClick={() => setShowScheduleForm((v) => !v)} className={btnGhost}>
          <Clock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
          Schedule
        </button>
        <button onClick={onRun} disabled={loading} className={btnPrimary}>
          <Play className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
          {loading ? 'Running…' : (report ? 'Run again' : 'Run now')}
        </button>
        <button onClick={onClose} className={btnGhost}>Close</button>
      </div>
      {showScheduleForm && (
        <div className={clsx('px-4 py-3 border-b space-y-2', border, dark ? 'bg-slate-800/50' : 'bg-gray-50')}>
          <div className={clsx('text-xs font-semibold', t1)}>Schedule recurring health check</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={schedCron}
              onChange={(e) => setSchedCron(e.target.value)}
              className={clsx(inputBase, 'w-56')}
            >
              <option value="0 9 * * 1">Mondays at 09:00</option>
              <option value="0 9 * * 0">Sundays at 09:00</option>
              <option value="0 9 1 * *">1st of month at 09:00</option>
              <option value="0 9 * * 1,3,5">Mon / Wed / Fri at 09:00</option>
              <option value="0 18 * * 5">Fridays at 18:00</option>
            </select>
            <select
              value={schedChannel}
              onChange={(e) => setSchedChannel(e.target.value)}
              className={clsx(inputBase, 'w-32')}
            >
              <option value="all">All channels</option>
              <option value="sms">SMS only</option>
              <option value="discord">Discord only</option>
              <option value="teamwork">TeamWork only</option>
            </select>
            <button
              onClick={() => {
                onSchedule(schedCron, schedChannel);
                setShowScheduleForm(false);
              }}
              disabled={scheduling}
              className={btnPrimary}
            >
              {scheduling ? 'Scheduling…' : 'Schedule'}
            </button>
            <button onClick={() => setShowScheduleForm(false)} className={btnGhost}>Cancel</button>
          </div>
          <div className={clsx('text-xs', t3)}>
            Once scheduled, the job shows up in the Scheduler panel alongside your other recurring
            tasks.  You can pause, edit, or delete it there.
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!report && !loading && (
          <div className={clsx('text-sm', t2)}>
            <p>A periodic audit that keeps your library honest as it grows.</p>
            <p className="mt-2">It flags:</p>
            <ul className={clsx('list-disc pl-6 mt-1 space-y-0.5', t3)}>
              <li><strong>Dead wikilinks</strong> — `[[targets]]` that don't resolve to a real note</li>
              <li><strong>Empty notebooks</strong> and <strong>orphan notes</strong> (no links in or out)</li>
              <li><strong>Short notes</strong> (&lt;50 words) that may need fleshing out</li>
              <li><strong>Contradictions</strong> between notes</li>
              <li><strong>Unsourced claims</strong> and <strong>gap topics</strong> (LLM-powered)</li>
            </ul>
            <p className="mt-3">A full report is saved to <code>outputs/</code> each time you run it.</p>
          </div>
        )}
        {loading && <div className={clsx('text-sm', t2)}>Running health check…</div>}
        {report && (
          <>
            <div className={clsx('rounded border p-3', border, cardBg)}>
              <div className={clsx('text-xs font-semibold mb-2', t3)}>STATIC CHECKS</div>
              <div className="grid grid-cols-5 gap-2 text-sm">
                <Stat label="Notes" value={report.static.note_count} t1={t1} t3={t3} />
                <Stat label="Dead links" value={report.static.dead_wikilinks.length} t1={t1} t3={t3} warn={report.static.dead_wikilinks.length > 0} />
                <Stat label="Empty nbs" value={report.static.empty_notebooks.length} t1={t1} t3={t3} />
                <Stat label="Orphans" value={report.static.orphans.length} t1={t1} t3={t3} />
                <Stat label="Short notes" value={report.static.short_notes.length} t1={t1} t3={t3} />
              </div>
            </div>

            {report.static.dead_wikilinks.length > 0 && (
              <div className={clsx('rounded border p-3', border, cardBg)}>
                <div className={clsx('text-xs font-semibold mb-2 flex items-center gap-1', t3)}>
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  DEAD WIKILINKS
                </div>
                <div className="space-y-1 text-xs">
                  {report.static.dead_wikilinks.slice(0, 20).map((dl, i) => (
                    <div
                      key={i}
                      onClick={() => onOpenNote(dl.source_project, dl.source_notebook, dl.source_slug)}
                      className={clsx('px-2 py-1 rounded cursor-pointer', dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200')}
                    >
                      <code className={dark ? 'text-amber-400' : 'text-amber-700'}>[[{dl.dead_target}]]</code>
                      <span className={clsx('ml-2', t3)}>in {dl.source_project}/{dl.source_notebook}/{dl.source_slug}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.static.orphans.length > 0 && (
              <div className={clsx('rounded border p-3', border, cardBg)}>
                <div className={clsx('text-xs font-semibold mb-2', t3)}>ORPHAN NOTES (no links in or out)</div>
                <div className="space-y-1 text-xs">
                  {report.static.orphans.slice(0, 10).map((o, i) => (
                    <div
                      key={i}
                      onClick={() => onOpenNote(o.project, o.notebook, o.slug)}
                      className={clsx('px-2 py-1 rounded cursor-pointer', dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200')}
                    >
                      <span className={t1}>{o.title}</span>
                      <span className={clsx('ml-2', t3)}>({o.project}/{o.notebook})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={clsx('rounded border p-3', border, cardBg)}>
              <div className={clsx('text-xs font-semibold mb-2', t3)}>LLM ANALYSIS</div>
              {'error' in report.llm && report.llm.error ? (
                <div className={clsx('text-xs', t2)}>Failed: {String(report.llm.error)}</div>
              ) : 'skipped' in report.llm && report.llm.skipped ? (
                <div className={clsx('text-xs', t2)}>Skipped: {String(report.llm.reason || 'unknown reason')}</div>
              ) : (
                <div className="space-y-3 text-xs">
                  {'contradictions' in report.llm && Array.isArray(report.llm.contradictions) && report.llm.contradictions.length > 0 && (
                    <div>
                      <div className={clsx('font-semibold mb-1', t1)}>Contradictions</div>
                      {report.llm.contradictions.map((c: {note_a: string; note_b: string; issue: string}, i: number) => (
                        <div key={i} className={clsx('px-2 py-1 rounded mb-1', dark ? 'bg-slate-900' : 'bg-white')}>
                          <div>
                            <code className={clsx('cursor-pointer', dark ? 'text-indigo-400' : 'text-indigo-700')} onClick={() => openFromPath(c.note_a)}>{c.note_a}</code>
                            <span className={t3}> vs </span>
                            <code className={clsx('cursor-pointer', dark ? 'text-indigo-400' : 'text-indigo-700')} onClick={() => openFromPath(c.note_b)}>{c.note_b}</code>
                          </div>
                          <div className={clsx('mt-0.5', t2)}>{c.issue}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {'unsourced' in report.llm && Array.isArray(report.llm.unsourced) && report.llm.unsourced.length > 0 && (
                    <div>
                      <div className={clsx('font-semibold mb-1', t1)}>Unsourced claims</div>
                      {report.llm.unsourced.map((u: {note: string; claim: string}, i: number) => (
                        <div key={i} className={clsx('px-2 py-1 rounded mb-1', dark ? 'bg-slate-900' : 'bg-white')}>
                          <code className={clsx('cursor-pointer', dark ? 'text-indigo-400' : 'text-indigo-700')} onClick={() => openFromPath(u.note)}>{u.note}</code>
                          <div className={clsx('mt-0.5', t2)}>{u.claim}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {'gaps' in report.llm && Array.isArray(report.llm.gaps) && report.llm.gaps.length > 0 && (
                    <div>
                      <div className={clsx('font-semibold mb-1', t1)}>Gap topics</div>
                      {report.llm.gaps.map((g: {topic: string; mentioned_in: string[]}, i: number) => (
                        <div key={i} className={clsx('px-2 py-1 rounded mb-1', dark ? 'bg-slate-900' : 'bg-white')}>
                          <span className={t1}>{g.topic}</span>
                          <div className={clsx('mt-0.5 text-xs', t3)}>
                            mentioned in: {(g.mentioned_in || []).join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, t1, t3, warn }: { label: string; value: number; t1: string; t3: string; warn?: boolean }) {
  return (
    <div className="text-center">
      <div className={clsx('text-2xl font-bold', warn ? 'text-amber-500' : t1)}>{value}</div>
      <div className={clsx('text-xs', t3)}>{label}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Notebook view — sequenced progress or flat list
// ────────────────────────────────────────────────────────────

function NotebookView({
  projectName, notebook, dark, onClose, onOpenNote, onToggleSequenced, onMarkStatus, onReorder, onSetCurrent,
}: {
  project: string;
  projectName: string;
  notebook: LibraryNotebook;
  dark: boolean;
  onClose: () => void;
  onOpenNote: (slug: string) => void;
  onToggleSequenced: (sequenced: boolean) => void;
  onMarkStatus: (slug: string, status: 'todo' | 'done') => void;
  onReorder: (slug_order: string[]) => void;
  onSetCurrent: (slug: string) => void;
}) {
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const btnGhost = clsx('px-2 py-1 rounded text-xs', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200');
  const btnPrimary = 'px-2.5 py-1 rounded text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40';

  const sortedNotes = useMemo(() => {
    if (notebook.sequenced) {
      return [...notebook.notes].sort((a, b) => (a.lesson_order ?? 0) - (b.lesson_order ?? 0));
    }
    return [...notebook.notes].sort((a, b) => a.title.localeCompare(b.title));
  }, [notebook]);

  const progress = notebook.progress_percent ?? 0;
  const currentNote = sortedNotes.find((n) => n.slug === notebook.current_slug)
    ?? sortedNotes.find((n) => n.status === 'todo');
  const nextTodo = sortedNotes.find((n) => n.status === 'todo' && n.slug !== notebook.current_slug);

  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [dragOverSlug, setDragOverSlug] = useState<string | null>(null);

  const handleDrop = (targetSlug: string) => {
    if (!dragSlug || dragSlug === targetSlug) {
      setDragSlug(null);
      setDragOverSlug(null);
      return;
    }
    const order = sortedNotes.map((n) => n.slug);
    const fromIdx = order.indexOf(dragSlug);
    const toIdx = order.indexOf(targetSlug);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, dragSlug);
    onReorder(order);
    setDragSlug(null);
    setDragOverSlug(null);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className={clsx('px-4 py-3 border-b', border)}>
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1">
            <div className={clsx('text-xs', t3)}>{projectName}</div>
            <h2 className={clsx('text-xl font-semibold', t1)}>{notebook.name}</h2>
          </div>
          <label className={clsx('text-xs flex items-center gap-1.5 cursor-pointer', t2)}>
            <input
              type="checkbox"
              checked={!!notebook.sequenced}
              onChange={(e) => onToggleSequenced(e.target.checked)}
            />
            Sequenced
          </label>
          <button onClick={onClose} className={btnGhost}><X className="w-3.5 h-3.5" /></button>
        </div>
        {notebook.description && (
          <p className={clsx('text-xs', t2)}>{notebook.description}</p>
        )}

        {notebook.sequenced && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className={t2}>
                {sortedNotes.filter((n) => n.status === 'done').length} / {sortedNotes.length} done
              </span>
              <span className={t2}>{progress}%</span>
            </div>
            <div className={clsx('h-2 rounded-full overflow-hidden', dark ? 'bg-slate-700' : 'bg-gray-200')}>
              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {currentNote && (
              <div className="flex items-center gap-2 text-xs">
                <span className={t3}>Current:</span>
                <button
                  onClick={() => onOpenNote(currentNote.slug)}
                  className={clsx('underline', t1)}
                >
                  {currentNote.title}
                </button>
                {nextTodo && (
                  <button onClick={() => onOpenNote(nextTodo.slug)} className={btnPrimary}>
                    Next lesson →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {sortedNotes.length === 0 && (
          <div className={clsx('text-sm italic', t3)}>No notes in this notebook yet.</div>
        )}
        {sortedNotes.map((note, idx) => {
          const isCurrent = note.slug === notebook.current_slug;
          const isDragOver = dragOverSlug === note.slug;
          return (
            <div
              key={note.slug}
              draggable={notebook.sequenced}
              onDragStart={() => notebook.sequenced && setDragSlug(note.slug)}
              onDragOver={(e) => { if (notebook.sequenced) { e.preventDefault(); setDragOverSlug(note.slug); } }}
              onDragLeave={() => dragOverSlug === note.slug && setDragOverSlug(null)}
              onDrop={(e) => { e.preventDefault(); handleDrop(note.slug); }}
              className={clsx(
                'flex items-center gap-2 px-2 py-2 rounded group',
                isCurrent && (dark ? 'bg-indigo-500/10 ring-1 ring-indigo-500/40' : 'bg-indigo-50 ring-1 ring-indigo-200'),
                isDragOver && 'ring-2 ring-indigo-500',
                dark ? 'hover:bg-slate-800' : 'hover:bg-gray-100',
              )}
            >
              {notebook.sequenced ? (
                <button
                  onClick={() => onMarkStatus(note.slug, note.status === 'done' ? 'todo' : 'done')}
                  className="shrink-0"
                >
                  {note.status === 'done' ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Circle className={clsx('w-4 h-4', t3)} />
                  )}
                </button>
              ) : (
                <FileText className={clsx('w-3.5 h-3.5 shrink-0', t3)} />
              )}
              {notebook.sequenced && (
                <span className={clsx('text-xs w-6 text-right', t3)}>#{idx + 1}</span>
              )}
              <button
                onClick={() => onOpenNote(note.slug)}
                className={clsx(
                  'flex-1 text-left text-sm truncate',
                  t1,
                  note.status === 'done' && 'line-through opacity-60',
                )}
              >
                {note.title}
              </button>
              {note.author === 'human' ? (
                <User className="w-3 h-3 text-emerald-500 shrink-0" />
              ) : (
                <Sparkles className="w-3 h-3 text-indigo-500 shrink-0" />
              )}
              {notebook.sequenced && !isCurrent && (
                <button
                  onClick={() => onSetCurrent(note.slug)}
                  className={clsx(btnGhost, 'opacity-0 group-hover:opacity-100 text-xs')}
                  title="Set as current lesson"
                >
                  Set current
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
