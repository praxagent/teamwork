/**
 * SpacePage — focused view for a single library space.
 *
 * Opened when the user clicks a space card on the Spaces landing page.
 * Shows the space's cover, metadata, notebooks with notes, and Kanban
 * board in a self-contained page with the space's color theme applied.
 *
 * This is NOT the Library panel — the Library is the "all-in-one shop"
 * for every space, notebook, note, inbox, archive, etc.  SpacePage is
 * the focused, distraction-free entry point for working in a single
 * space.
 *
 * The space's `theme_hue` is applied as CSS custom properties on the
 * root container so every accent color inside shifts to the space's
 * chosen hue.
 */
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  ArrowLeft, ChevronRight, ChevronDown, Plus,
  FileText, Sparkles, CheckCircle2, Circle,
  Trash2, Upload, Wand2, Loader2, X, SendHorizontal,
  Download, File as FileIcon, Image, Film, Music, FileArchive,
} from 'lucide-react';
import {
  useLibrarySpace,
  useUpdateLibrarySpace,
  useDeleteLibrarySpace,
  useProjectTasks,
  useUploadSpaceCover,
  useGenerateSpaceCover,
  useDeleteSpaceCover,
  useCreateLibraryNotebook,
  useLibraryNote,
  useUpdateLibraryNote,
  useFlashcardDecks,
  useFlashcardDeck,
  useCreateFlashcardDeck,
  useDeleteFlashcardDeck,
  useAddFlashcard,
  useUpdateFlashcard,
  useDeleteFlashcard,
  spaceCoverUrl,
  useSpaceFiles,
  useUploadSpaceFile,
  useDeleteSpaceFile,
  spaceFileUrl,
} from '@/hooks/useApi';
import type { LibrarySpace, LibraryNotebook, LibraryNote, FlashcardCard, SpaceFile } from '@/hooks/useApi';
import { MarkdownContent } from '@/components/common';
import { useUIStore } from '@/stores';
import { getSpaceTheme, THEME_PRESETS, accentColor, progressColor } from '@/utils/spaceTheme';
import { LibrarySpaceView } from './LibrarySpaceView';

interface Props {
  spaceSlug: string;
  onBack: () => void;
}

export function SpacePage({ spaceSlug, onBack }: Props) {
  const dark = useUIStore((s) => s.darkMode);
  const queryClient = useQueryClient();
  const spaceQuery = useLibrarySpace(spaceSlug);
  const tasksQuery = useProjectTasks(spaceSlug);
  const updateSpace = useUpdateLibrarySpace();
  const deleteSpace = useDeleteLibrarySpace();
  const uploadCover = useUploadSpaceCover();
  const generateCover = useGenerateSpaceCover();
  const deleteCover = useDeleteSpaceCover();
  const createNotebook = useCreateLibraryNotebook();

  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<'ask' | null>(null);
  type TabId = 'tasks' | 'notebooks' | 'wiki' | 'files' | 'flashcards' | 'quiz' | 'presentations' | 'settings';
  const [activeTab, setActiveTab] = useState<TabId>('tasks');
  const [chatOpen, setChatOpen] = useState(true);  // open by default
  const [viewingNote, setViewingNote] = useState<{ notebook: string; slug: string } | null>(null);
  const [noteChatVisible, setNoteChatVisible] = useState(false);
  const [editingNoteBody, setEditingNoteBody] = useState<string | null>(null);
  const noteQuery = useLibraryNote(
    viewingNote ? spaceSlug : null,
    viewingNote?.notebook ?? null,
    viewingNote?.slug ?? null,
  );
  const updateNote = useUpdateLibraryNote();
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatLoadedRef = useRef(false);

  // Load chat history from the database on first open
  useEffect(() => {
    if (!chatOpen || chatLoadedRef.current) return;
    chatLoadedRef.current = true;
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/chat/history`)
      .then((r) => r.json())
      .then((data) => {
        if (data.messages?.length) setChatMessages(data.messages);
      })
      .catch(() => {});
  }, [chatOpen, spaceSlug]);

  const space = spaceQuery.data;
  const theme = getSpaceTheme(space?.theme_hue, dark);

  const bg = dark ? 'bg-slate-900' : 'bg-white';
  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';

  if (spaceQuery.isLoading || !space) {
    return (
      <div className={clsx('flex-1 flex items-center justify-center', bg)}>
        <span className={t2}>Loading space…</span>
      </div>
    );
  }

  const coverSrc = spaceCoverUrl(space);

  const toggleNotebook = (slug: string) => {
    const next = new Set(expandedNotebooks);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    setExpandedNotebooks(next);
  };

  const openNotebookNote = (notebook: string, slug: string) => {
    setViewingNote({ notebook, slug });
    setEditingNoteBody(null);
    setNoteChatVisible(false);
  };

  const closeNotebookNote = () => {
    setViewingNote(null);
    setEditingNoteBody(null);
    setNoteChatVisible(false);
  };

  const tasks = tasksQuery.data?.tasks ?? [];
  const readingNotebookNote = activeTab === 'notebooks' && viewingNote !== null;
  const showingSpaceChat = chatOpen && (!readingNotebookNote || noteChatVisible);

  const handleUploadClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) uploadCover.mutate({ space: spaceSlug, file });
    };
    input.click();
  };

  const handleDelete = () => {
    setDeleteConfirm('ask');
  };

  const executeDelete = (archiveNotes: boolean) => {
    setDeleteConfirm(null);
    deleteSpace.mutate(
      { slug: spaceSlug, archiveNotes },
      { onSuccess: onBack },
    );
  };

  const sendSpaceChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const resp = await fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await resp.json();
      setChatMessages((prev) => [...prev, { role: 'assistant', text: data.response || data.error || 'No response' }]);
      // Refetch space data — Prax may have created tasks, notes, etc.
      queryClient.invalidateQueries({ queryKey: ['library-tasks', spaceSlug] });
      queryClient.invalidateQueries({ queryKey: ['library-space', spaceSlug] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', text: 'Failed to reach Prax.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ ...theme.vars, backgroundColor: 'var(--space-page-bg)' }}>

      {/* Compact header */}
      <div className={clsx('px-4 py-3 flex items-center gap-3 shrink-0')}
        style={{ borderBottom: '1px solid var(--space-accent-border)' }}>
        <button
          onClick={onBack}
          className={clsx('p-1.5 rounded-lg', dark ? 'hover:bg-slate-800' : 'hover:bg-gray-100')}
          title="Back to Spaces"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
        />
        <h1 className={clsx('text-lg font-bold flex-1 truncate', t1)}>{space.name}</h1>
        {space.kind && (
          <span className={clsx('text-xs px-1.5 py-0.5 rounded hidden sm:inline', dark ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-slate-700')}>
            {space.kind}
          </span>
        )}
        <button
          onClick={() => {
            if (readingNotebookNote) {
              const next = !showingSpaceChat;
              setNoteChatVisible(next);
              setChatOpen(next);
            } else {
              setChatOpen((v) => !v);
            }
          }}
          className={clsx(
            'px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5',
            showingSpaceChat
              ? 'text-white'
              : (dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100'),
          )}
          style={showingSpaceChat ? { backgroundColor: accentColor(space.theme_hue, dark) } : undefined}
          title={showingSpaceChat ? 'Hide space chat' : 'Open space chat with Prax'}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Chat
        </button>
      </div>

      {/* Tab bar — educational spaces get extra tabs */}
      <div className="flex items-center gap-0 shrink-0 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--space-accent-border)' }}>
        {(() => {
          const isEducational = ['learning', 'educational', 'course'].includes(
            (space.kind ?? '').toLowerCase(),
          );
          const baseTabs: TabId[] = ['tasks', 'notebooks', 'wiki', 'files'];
          const eduTabs: TabId[] = isEducational ? ['flashcards', 'quiz', 'presentations'] : [];
          return [...baseTabs, ...eduTabs, 'settings' as TabId];
        })().map((tab) => {
          const labels: Record<TabId, string> = {
            tasks: `Tasks (${tasks.length})`,
            notebooks: `Notebooks (${(space.notebooks ?? []).length})`,
            wiki: 'Wiki',
            files: 'Files',
            flashcards: 'Flashcards',
            quiz: 'Quiz',
            presentations: 'Presentations',
            settings: 'Settings',
          };
          const label = labels[tab] || tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab
                  ? 'border-current'
                  : clsx('border-transparent', dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'),
              )}
              style={activeTab === tab ? { color: accentColor(space.theme_hue, dark) } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Main content area: tab content + optional chat panel */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {activeTab === 'tasks' && (
            <LibrarySpaceView project={spaceSlug} dark={dark} onClose={() => {}} embedded />
          )}

          {activeTab === 'notebooks' && (
            viewingNote ? (
              <div className="flex-1 overflow-y-auto">
                <div className="min-h-full px-4 py-6 sm:px-6 lg:px-10">
                  <div className="mx-auto w-full max-w-3xl">
                    <button
                      onClick={closeNotebookNote}
                      className={clsx(
                        'mb-4 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
                        dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100',
                      )}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to notes
                    </button>
                    <article className={clsx(
                      'overflow-hidden rounded-2xl border shadow-sm',
                      border,
                      dark ? 'bg-slate-900/70' : 'bg-white',
                    )}>
                      <div className="px-5 py-4 sm:px-7"
                        style={{ borderBottom: '1px solid var(--space-accent-border)' }}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className={clsx('mb-1 text-xs', t3)}>
                              {space.name} / {viewingNote.notebook}
                            </div>
                            <h2 className={clsx('text-2xl font-semibold leading-tight', t1)}>
                              {noteQuery.data?.meta?.title || viewingNote.slug}
                            </h2>
                          </div>
                          <button
                            onClick={() => {
                              const next = !showingSpaceChat;
                              setNoteChatVisible(next);
                              if (next) setChatOpen(true);
                            }}
                            className={clsx(
                              'rounded px-2.5 py-1.5 text-xs font-medium',
                              showingSpaceChat
                                ? 'text-white'
                                : (dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100'),
                            )}
                            style={showingSpaceChat ? { backgroundColor: accentColor(space.theme_hue, dark) } : undefined}
                          >
                            <Sparkles className="mr-1 inline h-3 w-3 -translate-y-px" />
                            {showingSpaceChat ? 'Hide chat' : 'Discuss'}
                          </button>
                          {editingNoteBody === null ? (
                            <button
                              onClick={() => setEditingNoteBody(noteQuery.data?.content ?? '')}
                              disabled={noteQuery.isLoading}
                              className={clsx(
                                'rounded px-2.5 py-1.5 text-xs font-medium disabled:opacity-40',
                                dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100',
                              )}
                            >
                              Edit
                            </button>
                          ) : (
                            <div className="flex gap-1">
                              <button
                                onClick={() => {
                                  updateNote.mutate({
                                    project: spaceSlug,
                                    notebook: viewingNote.notebook,
                                    slug: viewingNote.slug,
                                    content: editingNoteBody,
                                    editor: 'human',
                                  }, {
                                    onSuccess: () => {
                                      setEditingNoteBody(null);
                                      queryClient.invalidateQueries({ queryKey: ['library-space', spaceSlug] });
                                    },
                                  });
                                }}
                                className="rounded px-2.5 py-1.5 text-xs font-medium text-white"
                                style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingNoteBody(null)}
                                className={clsx('rounded px-2.5 py-1.5 text-xs font-medium', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100')}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="px-5 py-6 sm:px-7 sm:py-8">
                        {noteQuery.isLoading ? (
                          <p className={clsx('text-sm', t3)}>Loading…</p>
                        ) : editingNoteBody !== null ? (
                          <textarea
                            value={editingNoteBody}
                            onChange={(e) => setEditingNoteBody(e.target.value)}
                            className={clsx(
                              'min-h-[60vh] w-full resize-y rounded-xl border p-4 font-mono text-sm outline-none',
                              dark ? 'border-slate-700 bg-slate-950 text-slate-100' : 'border-gray-200 bg-white text-slate-900',
                            )}
                          />
                        ) : (
                          <MarkdownContent
                            content={noteQuery.data?.content ?? ''}
                            darkMode={dark}
                            className="mx-auto max-w-none"
                          />
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
                {/* New notebook */}
                <div className="flex items-center gap-2">
                  {creatingNotebook ? (
                    <div className="flex gap-2 flex-1">
                      <input
                        autoFocus
                        placeholder="Notebook name"
                        value={newNotebookName}
                        onChange={(e) => setNewNotebookName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newNotebookName.trim()) {
                            createNotebook.mutate({ project: spaceSlug, name: newNotebookName.trim() }, {
                              onSuccess: () => { setNewNotebookName(''); setCreatingNotebook(false); },
                            });
                          }
                          if (e.key === 'Escape') { setNewNotebookName(''); setCreatingNotebook(false); }
                        }}
                        className={clsx(
                          'flex-1 px-3 py-2 rounded border text-sm outline-none',
                          dark ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500' : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
                        )}
                      />
                      <button
                        disabled={!newNotebookName.trim()}
                        onClick={() => {
                          if (newNotebookName.trim()) {
                            createNotebook.mutate({ project: spaceSlug, name: newNotebookName.trim() }, {
                              onSuccess: () => { setNewNotebookName(''); setCreatingNotebook(false); },
                            });
                          }
                        }}
                        className="px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
                      >Create</button>
                      <button onClick={() => { setNewNotebookName(''); setCreatingNotebook(false); }}
                        className={clsx('p-2 rounded', dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200')}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setCreatingNotebook(true)}
                      className="px-3 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-1.5"
                      style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
                    >
                      <Plus className="w-3.5 h-3.5" /> New Notebook
                    </button>
                  )}
                </div>

                {(space.progress_percent ?? 0) > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className={t3}>Overall progress</span>
                      <span className={t2}>{space.progress_percent}%</span>
                    </div>
                    <div className={clsx('h-2 rounded-full overflow-hidden', dark ? 'bg-slate-700' : 'bg-gray-200')}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${space.progress_percent}%`, backgroundColor: progressColor(space.theme_hue, dark) }} />
                    </div>
                  </div>
                )}
                {(space.notebooks ?? []).length === 0 ? (
                  <p className={clsx('text-sm py-8 text-center', t3)}>No notebooks yet.</p>
                ) : (
                  <div className="space-y-2">
                    {space.notebooks.map((nb: LibraryNotebook) => (
                      <div key={nb.slug} className={clsx('rounded-lg border', border, cardBg)}>
                        <button onClick={() => toggleNotebook(nb.slug)}
                          className={clsx('w-full px-4 py-3 flex items-center gap-2 text-left', t1)}>
                          {expandedNotebooks.has(nb.slug)
                            ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: accentColor(space.theme_hue, dark) }} />
                            : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: accentColor(space.theme_hue, dark) }} />}
                          <span className="font-medium flex-1">{nb.name}</span>
                          <span className={clsx('text-xs', t3)}>{nb.note_count} note{nb.note_count === 1 ? '' : 's'}</span>
                        </button>
                        {expandedNotebooks.has(nb.slug) && nb.notes && (
                          <div className={clsx('border-t px-4 py-2 space-y-1', border)}>
                            {nb.notes.map((note: LibraryNote) => (
                              <div key={note.slug} onClick={() => openNotebookNote(nb.slug, note.slug)}
                                className={clsx('flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm', dark ? 'hover:bg-slate-700/50' : 'hover:bg-gray-100', t1)}>
                                {nb.sequenced ? (note.status === 'done'
                                  ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: progressColor(space.theme_hue, dark) }} />
                                  : <Circle className={clsx('w-3.5 h-3.5 shrink-0', t3)} />
                                ) : <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor(space.theme_hue, dark) }} />}
                                <span className={clsx('truncate flex-1', note.status === 'done' && 'line-through opacity-60')}>
                                  {note.title || note.slug}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {/* Wiki tab — per-space knowledge base with auto-linking */}
          {activeTab === 'wiki' && (
            <SpaceWiki spaceSlug={spaceSlug} dark={dark} />
          )}

          {/* Files tab — per-space reference file store */}
          {activeTab === 'files' && (
            <SpaceFiles spaceSlug={spaceSlug} dark={dark} />
          )}

          {/* Flashcards — educational spaces only */}
          {activeTab === 'flashcards' && (
            <SpaceFlashcards spaceSlug={spaceSlug} dark={dark} themeHue={space.theme_hue} />
          )}

          {/* Quiz — educational spaces only */}
          {activeTab === 'quiz' && (
            <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
              <div className="flex items-center justify-between mb-4">
                <p className={clsx('text-sm', t3)}>
                  Test yourself with quizzes generated from your space content.
                </p>
                <button className="px-3 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-1.5 shrink-0"
                  style={{ backgroundColor: accentColor(space.theme_hue, dark) }}>
                  <Plus className="w-3.5 h-3.5" /> New Quiz
                </button>
              </div>
              <div className={clsx('rounded-lg border p-8 text-center', border, cardBg)}>
                <p className={clsx('text-sm mb-2', t2)}>No quizzes yet.</p>
                <p className={clsx('text-xs', t3)}>
                  Ask Prax: "Quiz me on the grammar lessons"
                </p>
              </div>
            </div>
          )}

          {/* Presentations — educational spaces only */}
          {activeTab === 'presentations' && (
            <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
              <div className="flex items-center justify-between mb-4">
                <p className={clsx('text-sm', t3)}>
                  Video lectures and slide presentations generated by Prax.
                </p>
                <button className="px-3 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-1.5 shrink-0"
                  style={{ backgroundColor: accentColor(space.theme_hue, dark) }}>
                  <Plus className="w-3.5 h-3.5" /> New Presentation
                </button>
              </div>
              <div className={clsx('rounded-lg border p-8 text-center', border, cardBg)}>
                <p className={clsx('text-sm mb-2', t2)}>No presentations yet.</p>
                <p className={clsx('text-xs', t3)}>
                  Ask Prax: "Create a presentation on French verb conjugation"
                </p>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
              <SpaceSettings
                space={space}
                dark={dark}
                spaceSlug={spaceSlug}
                onDelete={handleDelete}
                onUpdateTheme={(hue) => updateSpace.mutate({ project: spaceSlug, task_id: '', theme_hue: hue } as any)}
                onUpdateName={(name) => updateSpace.mutate({ project: spaceSlug, task_id: '', name } as any)}
                uploadCover={uploadCover}
                generateCover={generateCover}
                deleteCover={deleteCover}
                coverSrc={coverSrc}
                onUploadClick={handleUploadClick}
              />
            </div>
          )}
        </div>

        {/* Space-scoped chat — sidebar on desktop, bottom panel on mobile */}
        {showingSpaceChat && (
          <div className={clsx(
            'w-full md:w-80 flex flex-col shrink-0',
            'border-t md:border-t-0 md:border-l',
            'h-[40vh] md:h-auto',
          )}
            style={{ borderColor: 'var(--space-accent-border)', backgroundColor: 'var(--space-chat-bg)' }}>
            <div className={clsx('px-3 py-2 border-b flex items-center gap-2', border)}>
              <Sparkles className="w-3.5 h-3.5" style={{ color: accentColor(space.theme_hue, dark) }} />
              <span className={clsx('text-sm font-medium flex-1', t1)}>Chat — {space.name}</span>
              <button onClick={() => setChatOpen(false)} className={clsx('p-1 rounded', dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200')}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {chatMessages.length === 0 && (
                <div className="flex-1" />
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={clsx('text-sm rounded-lg px-3 py-2', msg.role === 'user'
                  ? (dark ? 'bg-slate-700 text-slate-100 ml-6' : 'bg-white text-slate-900 ml-6 border border-gray-200')
                  : (dark ? 'bg-slate-800 text-slate-200 mr-6' : 'bg-gray-100 text-slate-800 mr-6'),
                )}>
                  {msg.text}
                </div>
              ))}
              {chatLoading && (
                <div className={clsx('text-xs flex items-center gap-1.5', t3)}>
                  <Loader2 className="w-3 h-3 animate-spin" /> Prax is thinking…
                </div>
              )}
            </div>
            <div className={clsx('p-2 border-t', border)}>
              <div className="flex gap-2">
                <input
                  placeholder={`Ask Prax about ${space.name}…`}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSpaceChat(); } }}
                  onFocus={(e) => { setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 300); }}
                  className={clsx(
                    'flex-1 px-3 py-2 rounded-lg border text-sm outline-none',
                    dark ? 'bg-slate-800 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
                  )}
                />
                <button
                  onClick={sendSpaceChat}
                  disabled={!chatInput.trim() || chatLoading}
                  className="p-2 rounded-lg text-white disabled:opacity-40"
                  style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
                  title="Send"
                >
                  <SendHorizontal className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete choice dialog */}
      {deleteConfirm === 'ask' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDeleteConfirm(null)} />
          <div className={clsx('relative w-[420px] rounded-xl shadow-2xl border p-6', dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200')}>
            <h3 className={clsx('text-lg font-semibold mb-3', t1)}>Delete "{space.name}"?</h3>
            <p className={clsx('text-sm mb-5', t2)}>Tasks will be deleted with the space. What about notebooks and notes?</p>
            <div className="space-y-2">
              <button onClick={() => executeDelete(true)} className={clsx('w-full px-4 py-3 rounded-lg border text-left', dark ? 'border-slate-600 hover:bg-slate-800' : 'border-gray-200 hover:bg-gray-50')}>
                <div className={clsx('text-sm font-medium', t1)}>Archive notes, then delete</div>
                <div className={clsx('text-xs mt-0.5', t3)}>Moves notes to Archive for safekeeping.</div>
              </button>
              <button onClick={() => executeDelete(false)} className={clsx('w-full px-4 py-3 rounded-lg border text-left border-red-300 dark:border-red-800', dark ? 'hover:bg-red-950/30' : 'hover:bg-red-50')}>
                <div className="text-sm font-medium text-red-500">Delete everything permanently</div>
                <div className={clsx('text-xs mt-0.5', t3)}>Cannot be undone.</div>
              </button>
              <button onClick={() => setDeleteConfirm(null)} className={clsx('w-full px-4 py-2 rounded-lg text-sm', dark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-gray-100')}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Wiki tab — per-space knowledge base with CRUD + auto-linking
// ---------------------------------------------------------------------------

function SpaceWiki({ spaceSlug, dark }: { spaceSlug: string; dark: boolean }) {
  const [entries, setEntries] = useState<Array<{ slug: string; title: string; tags?: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [viewSlug, setViewSlug] = useState<string | null>(null);
  const [viewData, setViewData] = useState<{ meta: any; content: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState('');

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';

  const loadEntries = () => {
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/wiki`)
      .then(r => r.json())
      .then(d => setEntries(d.entries || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEntries(); }, [spaceSlug]);

  const loadEntry = (slug: string) => {
    setViewSlug(slug);
    setEditing(false);
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/wiki/${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => setViewData(d))
      .catch(() => {});
  };

  const handleCreate = () => {
    if (!draftTitle.trim()) return;
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/wiki`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: draftTitle.trim(), content: draftBody, author: 'human' }),
    })
      .then(r => r.json())
      .then(() => { setDraftTitle(''); setDraftBody(''); setCreating(false); loadEntries(); })
      .catch(() => {});
  };

  const handleSaveEdit = () => {
    if (!viewSlug) return;
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/wiki/${encodeURIComponent(viewSlug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editBody, editor: 'human' }),
    })
      .then(r => r.json())
      .then(() => { setEditing(false); loadEntry(viewSlug!); loadEntries(); })
      .catch(() => {});
  };

  const handleDelete = (slug: string) => {
    if (!confirm('Delete this wiki entry?')) return;
    fetch(`/api/library/spaces/${encodeURIComponent(spaceSlug)}/wiki/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      .then(() => { if (viewSlug === slug) { setViewSlug(null); setViewData(null); } loadEntries(); })
      .catch(() => {});
  };

  // Viewing a single entry
  if (viewSlug && viewData) {
    return (
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => { setViewSlug(null); setViewData(null); }}
            className={clsx('px-2 py-1 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>
            ← Back
          </button>
          <h2 className={clsx('text-lg font-semibold flex-1', t1)}>{viewData.meta?.title || viewSlug}</h2>
          {!editing && (
            <button onClick={() => { setEditing(true); setEditBody(viewData.content); }}
              className={clsx('px-2 py-1 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>
              Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={handleSaveEdit}
                className="px-2.5 py-1 rounded text-sm font-medium text-white"
                style={{ backgroundColor: accentColor(undefined, dark) }}>Save</button>
              <button onClick={() => setEditing(false)}
                className={clsx('px-2 py-1 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>Cancel</button>
            </>
          )}
          <button onClick={() => handleDelete(viewSlug)}
            className={clsx('px-2 py-1 rounded text-sm text-red-500', dark ? 'hover:bg-slate-800' : 'hover:bg-red-50')}>
            Delete
          </button>
        </div>
        {editing ? (
          <textarea value={editBody} onChange={e => setEditBody(e.target.value)}
            className={clsx('w-full min-h-[400px] font-mono text-sm rounded border p-3 resize-none outline-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300')} />
        ) : (
          <div className={clsx('prose max-w-none', dark && 'prose-invert')}>
            <MarkdownContent content={viewData.content} darkMode={dark} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className={clsx('text-sm', t3)}>
            Deep reference material — concepts, specs, guides. Auto-links entries that mention each other.
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-1.5 shrink-0"
          style={{ backgroundColor: accentColor(undefined, dark) }}>
          <Plus className="w-3.5 h-3.5" /> New Entry
        </button>
      </div>

      {creating && (
        <div className={clsx('rounded-lg border p-4 mb-4 space-y-3', border, cardBg)}>
          <input autoFocus placeholder="Entry title (e.g., French Verb Conjugation, API Architecture)"
            value={draftTitle} onChange={e => setDraftTitle(e.target.value)}
            className={clsx('w-full px-3 py-2 rounded border text-sm outline-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300')} />
          <textarea placeholder="Content (markdown, [[wikilinks]] to other entries supported)"
            value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={8}
            className={clsx('w-full px-3 py-2 rounded border text-sm font-mono outline-none resize-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300')} />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!draftTitle.trim()}
              className="px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: accentColor(undefined, dark) }}>Create</button>
            <button onClick={() => { setCreating(false); setDraftTitle(''); setDraftBody(''); }}
              className={clsx('px-3 py-2 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <p className={clsx('text-sm', t3)}>Loading…</p>}
      {!loading && entries.length === 0 && !creating && (
        <div className={clsx('rounded-lg border p-8 text-center', border, cardBg)}>
          <p className={clsx('text-sm mb-2', t2)}>No wiki entries yet.</p>
          <p className={clsx('text-xs', t3)}>
            Click "New Entry" above, or ask Prax in the chat to create wiki entries for key concepts.
          </p>
        </div>
      )}
      {entries.length > 0 && (
        <div className="space-y-1">
          {entries.map(e => (
            <div key={e.slug} onClick={() => loadEntry(e.slug)}
              className={clsx('px-4 py-3 rounded-lg cursor-pointer flex items-center gap-2',
                dark ? 'hover:bg-slate-800/60' : 'hover:bg-gray-50')}>
              <FileText className="w-4 h-4 shrink-0" style={{ color: accentColor(undefined, dark) }} />
              <span className={clsx('text-sm font-medium flex-1', t1)}>{e.title || e.slug}</span>
              {e.tags && e.tags.length > 0 && (
                <span className={clsx('text-xs', t3)}>{e.tags.slice(0, 3).join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Files tab — per-space reference file store with upload, preview, download
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function fileTypeIcon(mime: string) {
  if (mime.startsWith('image/')) return Image;
  if (mime.startsWith('video/')) return Film;
  if (mime.startsWith('audio/')) return Music;
  if (mime === 'application/pdf') return FileText;
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('compress')) return FileArchive;
  return FileIcon;
}

function SpaceFiles({ spaceSlug, dark }: { spaceSlug: string; dark: boolean }) {
  const filesQuery = useSpaceFiles(spaceSlug);
  const uploadFile = useUploadSpaceFile(spaceSlug);
  const deleteFile = useDeleteSpaceFile(spaceSlug);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<SpaceFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';

  const files: SpaceFile[] = filesQuery.data?.files ?? [];

  const handleUpload = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((f) => uploadFile.mutate(f));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-4">
      {/* Upload dropzone */}
      <div
        className={clsx(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          dragOver
            ? (dark ? 'border-blue-400 bg-blue-900/20' : 'border-blue-500 bg-blue-50')
            : (dark ? 'border-slate-600 hover:border-slate-400' : 'border-gray-300 hover:border-gray-400'),
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className={clsx('w-8 h-8 mx-auto mb-2', t3)} />
        <p className={clsx('text-sm font-medium', t1)}>
          Drop files here or click to upload
        </p>
        <p className={clsx('text-xs mt-1', t3)}>
          PDFs, images, audio, video, and other reference files (max 50 MB)
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {uploadFile.isPending && (
        <div className={clsx('flex items-center gap-2 text-sm', t2)}>
          <Loader2 className="w-4 h-4 animate-spin" />
          Uploading...
        </div>
      )}

      {/* File list */}
      {filesQuery.isLoading ? (
        <div className={clsx('text-sm', t2)}>Loading files...</div>
      ) : files.length === 0 ? (
        <div className={clsx('text-sm', t3)}>No files uploaded yet.</div>
      ) : (
        <div className="space-y-2">
          {files.map((file) => {
            const Icon = fileTypeIcon(file.mime_type);
            const isImage = file.mime_type.startsWith('image/');
            const isPdf = file.mime_type === 'application/pdf';
            const isAudio = file.mime_type.startsWith('audio/');
            const isVideo = file.mime_type.startsWith('video/');
            const isPreviewable = isImage || isPdf || isAudio || isVideo;
            const url = spaceFileUrl(spaceSlug, file.name);

            return (
              <div key={file.name}>
                <div
                  className={clsx(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    border, cardBg,
                    isPreviewable && 'cursor-pointer',
                  )}
                  onClick={() => isPreviewable && setPreviewFile(
                    previewFile?.name === file.name ? null : file,
                  )}
                >
                  <Icon className={clsx('w-5 h-5 shrink-0', t2)} />
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-sm font-medium truncate', t1)}>{file.name}</p>
                    <p className={clsx('text-xs', t3)}>
                      {formatFileSize(file.size)} &middot; {file.mime_type}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={url}
                      download={file.name}
                      className={clsx(
                        'p-1.5 rounded transition-colors',
                        dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200',
                      )}
                      onClick={(e) => e.stopPropagation()}
                      title="Download"
                    >
                      <Download className={clsx('w-4 h-4', t2)} />
                    </a>
                    <button
                      className={clsx(
                        'p-1.5 rounded transition-colors text-red-400 hover:text-red-300',
                        dark ? 'hover:bg-slate-700' : 'hover:bg-gray-200',
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete ${file.name}?`)) deleteFile.mutate(file.name);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Inline preview */}
                {previewFile?.name === file.name && (
                  <div className={clsx('mt-2 rounded-lg overflow-hidden border', border)}>
                    {isImage && (
                      <img src={url} alt={file.name} className="max-w-full max-h-96 mx-auto" />
                    )}
                    {isPdf && (
                      <iframe src={url} className="w-full h-[600px]" title={file.name} />
                    )}
                    {isAudio && (
                      <audio controls className="w-full p-4" src={url}>
                        Your browser does not support the audio element.
                      </audio>
                    )}
                    {isVideo && (
                      <video controls className="w-full max-h-96" src={url}>
                        Your browser does not support the video element.
                      </video>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Flashcards tab — deck list + study mode with flip cards
// ---------------------------------------------------------------------------

function SpaceFlashcards({ spaceSlug, dark, themeHue }: { spaceSlug: string; dark: boolean; themeHue?: number | null }) {
  const decksQuery = useFlashcardDecks(spaceSlug);
  const createDeck = useCreateFlashcardDeck(spaceSlug);
  const deleteDeckMut = useDeleteFlashcardDeck(spaceSlug);

  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [studyDeck, setStudyDeck] = useState<string | null>(null);

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';
  const accent = accentColor(themeHue, dark);

  const handleCreate = () => {
    if (!draftTitle.trim()) return;
    createDeck.mutate({ title: draftTitle.trim() }, {
      onSuccess: () => { setDraftTitle(''); setCreating(false); },
    });
  };

  const handleDeleteDeck = (slug: string) => {
    if (!confirm('Delete this flashcard deck?')) return;
    deleteDeckMut.mutate(slug);
  };

  // Study mode — separate view
  if (studyDeck) {
    return (
      <FlashcardStudy
        spaceSlug={spaceSlug}
        deckSlug={studyDeck}
        dark={dark}
        themeHue={themeHue}
        onBack={() => setStudyDeck(null)}
      />
    );
  }

  const decks = decksQuery.data?.decks ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <p className={clsx('text-sm', t3)}>
          Study with flip cards generated from your lessons and wiki entries.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-2 rounded-lg text-sm font-medium text-white flex items-center gap-1.5 shrink-0"
          style={{ backgroundColor: accent }}
        >
          <Plus className="w-3.5 h-3.5" /> New Deck
        </button>
      </div>

      {/* New deck form */}
      {creating && (
        <div className={clsx('rounded-lg border p-4 mb-4 space-y-3', border, cardBg)}>
          <input
            autoFocus
            placeholder="Deck title (e.g., French Verb Conjugation)"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') { setDraftTitle(''); setCreating(false); }
            }}
            className={clsx(
              'w-full px-3 py-2 rounded border text-sm outline-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300',
            )}
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!draftTitle.trim() || createDeck.isPending}
              className="px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: accent }}>
              {createDeck.isPending ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setCreating(false); setDraftTitle(''); }}
              className={clsx('px-3 py-2 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {decksQuery.isLoading && <p className={clsx('text-sm', t3)}>Loading...</p>}

      {!decksQuery.isLoading && decks.length === 0 && !creating && (
        <div className={clsx('rounded-lg border p-8 text-center', border, cardBg)}>
          <p className={clsx('text-sm mb-2', t2)}>No flashcard decks yet.</p>
          <p className={clsx('text-xs', t3)}>
            Ask Prax: &quot;Create flashcards from the verb conjugation lesson&quot;
          </p>
        </div>
      )}

      {decks.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {decks.map((deck) => (
            <div key={deck.slug} className={clsx('rounded-lg border p-4 flex flex-col gap-3', border, cardBg)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className={clsx('text-sm font-semibold truncate', t1)}>{deck.title}</h3>
                  <p className={clsx('text-xs mt-0.5', t3)}>{deck.card_count} card{deck.card_count === 1 ? '' : 's'}</p>
                </div>
                <button onClick={() => handleDeleteDeck(deck.slug)}
                  className={clsx('p-1 rounded shrink-0', dark ? 'text-slate-500 hover:text-red-400 hover:bg-slate-700' : 'text-slate-400 hover:text-red-500 hover:bg-red-50')}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => setStudyDeck(deck.slug)}
                disabled={deck.card_count === 0}
                className="w-full px-3 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: accent }}
              >
                {deck.card_count === 0 ? 'No cards to study' : 'Study'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Flashcard study mode — flip cards with confidence tracking
// ---------------------------------------------------------------------------

function FlashcardStudy({
  spaceSlug, deckSlug, dark, themeHue, onBack,
}: {
  spaceSlug: string;
  deckSlug: string;
  dark: boolean;
  themeHue?: number | null;
  onBack: () => void;
}) {
  const deckQuery = useFlashcardDeck(spaceSlug, deckSlug);
  const updateCard = useUpdateFlashcard(spaceSlug, deckSlug);
  const addCard = useAddFlashcard(spaceSlug, deckSlug);
  const deleteCard = useDeleteFlashcard(spaceSlug, deckSlug);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftFront, setDraftFront] = useState('');
  const [draftBack, setDraftBack] = useState('');

  const t1 = dark ? 'text-slate-100' : 'text-slate-900';
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const cardBg = dark ? 'bg-slate-800/60' : 'bg-gray-50';
  const accent = accentColor(themeHue, dark);

  const cards: FlashcardCard[] = deckQuery.data?.cards ?? [];
  const card = cards[currentIndex];

  const goTo = (idx: number) => {
    setFlipped(false);
    setCurrentIndex(idx);
  };

  const markConfidence = (level: number) => {
    if (!card) return;
    updateCard.mutate({ cardId: card.id, confidence: level });
    // Advance to next card
    if (currentIndex < cards.length - 1) {
      goTo(currentIndex + 1);
    } else {
      // Wrap around
      goTo(0);
    }
  };

  const handleAddCard = () => {
    if (!draftFront.trim() || !draftBack.trim()) return;
    addCard.mutate({ front: draftFront.trim(), back: draftBack.trim() }, {
      onSuccess: () => { setDraftFront(''); setDraftBack(''); setAdding(false); },
    });
  };

  const handleDeleteCard = () => {
    if (!card || !confirm('Delete this card?')) return;
    deleteCard.mutate(card.id, {
      onSuccess: () => {
        if (currentIndex >= cards.length - 1 && currentIndex > 0) {
          setCurrentIndex(currentIndex - 1);
        }
        setFlipped(false);
      },
    });
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 shrink-0" style={{ borderBottom: `1px solid ${dark ? '#334155' : '#e5e7eb'}` }}>
        <button onClick={onBack} className={clsx('px-2 py-1 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>
          <ArrowLeft className="w-4 h-4 inline -mt-0.5 mr-1" /> Back to decks
        </button>
        <h2 className={clsx('text-base font-semibold flex-1 truncate', t1)}>
          {deckQuery.data?.title ?? deckSlug}
        </h2>
        <button
          onClick={() => setAdding(true)}
          className="px-2.5 py-1.5 rounded text-xs font-medium text-white flex items-center gap-1"
          style={{ backgroundColor: accent }}
        >
          <Plus className="w-3 h-3" /> Add Card
        </button>
      </div>

      {/* Add card form */}
      {adding && (
        <div className={clsx('mx-4 mt-4 rounded-lg border p-4 space-y-3', border, cardBg)}>
          <input
            autoFocus
            placeholder="Front (question / term)"
            value={draftFront}
            onChange={(e) => setDraftFront(e.target.value)}
            className={clsx(
              'w-full px-3 py-2 rounded border text-sm outline-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300',
            )}
          />
          <textarea
            placeholder="Back (answer / definition)"
            value={draftBack}
            onChange={(e) => setDraftBack(e.target.value)}
            rows={3}
            className={clsx(
              'w-full px-3 py-2 rounded border text-sm outline-none resize-none',
              dark ? 'bg-slate-800 text-slate-100 border-slate-700' : 'bg-white text-slate-900 border-gray-300',
            )}
          />
          <div className="flex gap-2">
            <button onClick={handleAddCard} disabled={!draftFront.trim() || !draftBack.trim() || addCard.isPending}
              className="px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: accent }}>
              {addCard.isPending ? 'Adding...' : 'Add Card'}
            </button>
            <button onClick={() => { setAdding(false); setDraftFront(''); setDraftBack(''); }}
              className={clsx('px-3 py-2 rounded text-sm', dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-200')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deckQuery.isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className={clsx('w-5 h-5 animate-spin', t3)} />
        </div>
      )}

      {!deckQuery.isLoading && cards.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className={clsx('rounded-lg border p-8 text-center max-w-sm', border, cardBg)}>
            <p className={clsx('text-sm mb-2', t2)}>This deck has no cards yet.</p>
            <p className={clsx('text-xs', t3)}>
              Click "Add Card" above or ask Prax to generate cards.
            </p>
          </div>
        </div>
      )}

      {!deckQuery.isLoading && cards.length > 0 && card && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          {/* Progress indicator */}
          <div className={clsx('text-sm font-medium', t2)}>
            Card {currentIndex + 1} of {cards.length}
          </div>

          {/* Progress bar */}
          <div className="w-full max-w-md">
            <div className={clsx('h-1.5 rounded-full overflow-hidden', dark ? 'bg-slate-700' : 'bg-gray-200')}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / cards.length) * 100}%`, backgroundColor: accent }}
              />
            </div>
          </div>

          {/* Flip card */}
          <div
            className="w-full max-w-md cursor-pointer"
            style={{ perspective: '1000px' }}
            onClick={() => setFlipped(!flipped)}
          >
            <div
              className="relative w-full transition-transform duration-500"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                minHeight: '240px',
              }}
            >
              {/* Front face */}
              <div
                className={clsx(
                  'absolute inset-0 rounded-xl border-2 p-6 flex flex-col items-center justify-center',
                  dark ? 'bg-slate-800' : 'bg-white',
                )}
                style={{
                  backfaceVisibility: 'hidden',
                  borderColor: accent,
                }}
              >
                <span className={clsx('text-xs font-medium mb-3', t3)}>FRONT</span>
                <p className={clsx('text-lg text-center font-medium leading-relaxed', t1)}>{card.front}</p>
                <span className={clsx('text-xs mt-4', t3)}>Tap to flip</span>
              </div>

              {/* Back face */}
              <div
                className={clsx(
                  'absolute inset-0 rounded-xl border-2 p-6 flex flex-col items-center justify-center',
                  dark ? 'bg-slate-800' : 'bg-white',
                )}
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  borderColor: accent,
                }}
              >
                <span className={clsx('text-xs font-medium mb-3', t3)}>BACK</span>
                <p className={clsx('text-lg text-center leading-relaxed', t1)}>{card.back}</p>
              </div>
            </div>
          </div>

          {/* Confidence buttons — only show when flipped */}
          {flipped && (
            <div className="flex gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); markConfidence(0); }}
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors"
              >
                Don't Know
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); markConfidence(1); }}
                className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-green-500 hover:bg-green-600 transition-colors"
              >
                Know
              </button>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => goTo(Math.max(0, currentIndex - 1))}
              disabled={currentIndex === 0}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30',
                dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100',
              )}
            >
              Previous
            </button>
            <div className="flex gap-1">
              {cards.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={clsx('w-2 h-2 rounded-full transition-all',
                    i === currentIndex ? '' : (dark ? 'bg-slate-600' : 'bg-gray-300'),
                  )}
                  style={i === currentIndex ? { backgroundColor: accent } : undefined}
                />
              ))}
            </div>
            <button
              onClick={() => goTo(Math.min(cards.length - 1, currentIndex + 1))}
              disabled={currentIndex === cards.length - 1}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30',
                dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-gray-100',
              )}
            >
              Next
            </button>
          </div>

          {/* Delete current card */}
          <button
            onClick={handleDeleteCard}
            className={clsx('text-xs flex items-center gap-1', dark ? 'text-slate-500 hover:text-red-400' : 'text-slate-400 hover:text-red-500')}
          >
            <Trash2 className="w-3 h-3" /> Delete this card
          </button>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Settings tab (inline, not a modal)
// ---------------------------------------------------------------------------

function SpaceSettings({
  space, dark, spaceSlug, onDelete, onUpdateTheme, onUpdateName,
  uploadCover, generateCover, deleteCover, coverSrc, onUploadClick,
}: {
  space: LibrarySpace;
  dark: boolean;
  spaceSlug: string;
  onDelete: () => void;
  onUpdateTheme: (hue: number) => void;
  onUpdateName: (name: string) => void;
  uploadCover: { mutate: (v: any) => void; isPending: boolean };
  generateCover: { mutate: (v: any) => void; isPending: boolean };
  deleteCover: { mutate: (v: any) => void };
  coverSrc: string | null;
  onUploadClick: () => void;
}) {
  const [draftName, setDraftName] = useState(space.name);
  const t2 = dark ? 'text-slate-400' : 'text-slate-500';
  const t3 = dark ? 'text-slate-500' : 'text-slate-400';
  const border = dark ? 'border-slate-700' : 'border-gray-200';
  const inputBase = clsx(
    'px-3 py-2 rounded border text-sm outline-none w-full',
    dark ? 'bg-slate-800 text-slate-100 border-slate-700 focus:border-indigo-500'
      : 'bg-white text-slate-900 border-gray-300 focus:border-indigo-500',
  );

  return (
    <div className="space-y-8">
      {/* Name */}
      <div>
        <label className={clsx('text-xs font-semibold block mb-1.5', t3)}>NAME</label>
        <div className="flex gap-2">
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} className={inputBase} />
          <button
            onClick={() => { if (draftName.trim() && draftName !== space.name) onUpdateName(draftName.trim()); }}
            disabled={!draftName.trim() || draftName === space.name}
            className="px-3 py-2 rounded text-sm font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: accentColor(space.theme_hue, dark) }}
          >Save</button>
        </div>
      </div>

      {/* Cover image */}
      <div>
        <label className={clsx('text-xs font-semibold block mb-2', t3)}>COVER IMAGE</label>
        {coverSrc && (
          <div className="mb-3 rounded-lg overflow-hidden border" style={{ borderColor: dark ? '#334155' : '#e5e7eb' }}>
            <img src={coverSrc} alt="Cover" className="w-full h-32 object-cover" />
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          <button onClick={onUploadClick} disabled={uploadCover.isPending}
            className={clsx('px-3 py-2 rounded text-sm flex items-center gap-1.5', dark ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-gray-200 hover:bg-gray-300 text-slate-800')}>
            {uploadCover.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </button>
          <button onClick={() => generateCover.mutate({ space: spaceSlug, prompt_hint: '', dark_mode: dark })} disabled={generateCover.isPending}
            className="px-3 py-2 rounded text-sm text-white flex items-center gap-1.5"
            style={{ backgroundColor: accentColor(space.theme_hue, dark) }}>
            {generateCover.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {generateCover.isPending ? 'Generating…' : 'Generate with Prax'}
          </button>
          {coverSrc && (
            <button onClick={() => { if (confirm('Remove cover?')) deleteCover.mutate(spaceSlug); }}
              className={clsx('px-3 py-2 rounded text-sm flex items-center gap-1.5', dark ? 'text-red-400 hover:bg-slate-700' : 'text-red-600 hover:bg-red-50')}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>
      </div>

      {/* Color theme */}
      <div>
        <label className={clsx('text-xs font-semibold block mb-2', t3)}>COLOR THEME</label>
        <div className="grid grid-cols-5 gap-2">
          {THEME_PRESETS.map((preset) => (
            <button key={preset.hue} onClick={() => onUpdateTheme(preset.hue)}
              className={clsx('flex flex-col items-center gap-1 p-2 rounded-lg border transition-all',
                (space.theme_hue ?? 240) === preset.hue
                  ? (dark ? 'border-white/40 bg-slate-800' : 'border-slate-400 bg-gray-50')
                  : (dark ? 'border-slate-700 hover:border-slate-500' : 'border-gray-200 hover:border-gray-400'))}>
              <div className="w-8 h-8 rounded-full" style={{ backgroundColor: accentColor(preset.hue, dark) }} />
              <span className={clsx('text-[10px]', t2)}>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Danger zone */}
      <div className={clsx('border-t pt-6', border)}>
        <label className={clsx('text-xs font-semibold block mb-2', t3)}>DANGER ZONE</label>
        <button onClick={onDelete} className="px-3 py-2 rounded text-sm font-medium text-white bg-red-600 hover:bg-red-500">
          <Trash2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> Delete Space
        </button>
        <p className={clsx('text-xs mt-1.5', t3)}>Deletes the space. You'll be asked whether to archive or permanently delete notes.</p>
      </div>
    </div>
  );
}
