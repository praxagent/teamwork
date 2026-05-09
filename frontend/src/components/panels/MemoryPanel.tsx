import { useEffect, useState, useCallback } from 'react';
import {
  Brain,
  Database,
  Network,
  Plus,
  Trash2,
  Edit3,
  Save,
  X,
  Search,
  RefreshCw,
  Tag,
  Clock,
  ChevronRight,
  AlertCircle,
  Sparkles,
  Info,
  BarChart3,
  Cpu,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { useUIStore } from '@/stores';
import { useContextStats, useCompactContext } from '@/hooks/useApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface STMEntry {
  key: string;
  content: string;
  tags: string[];
  created_at: string;
  access_count: number;
  importance: number;
}

interface LTMResult {
  memory_id: string;
  content: string;
  score: number;
  source: string;
  importance: number;
  created_at: string;
  entities: string[];
}

interface MemoryStats {
  memory_enabled: boolean;
  stm_entries: number;
  vector_memories: number;
  graph_store_stats: {
    entities: number;
    relations: number;
    temporal_events: number;
    causal_links: number;
  };
}

interface GraphEntity {
  id: string;
  name: string;
  display_name: string;
  entity_type: string;
  importance: number;
  mention_count: number;
  relations: Array<{
    type: string;
    weight: number;
    direction: string;
    other_name: string;
    other_type: string;
    valid_from?: string;
    valid_until?: string;
  }>;
}

interface MemoryConfig {
  enabled: boolean;
  user_id: string;
}

interface MemoryPanelProps {
  projectId: string;
  isVisible: boolean;
  onClose: () => void;
}

type Tab = 'stm' | 'ltm' | 'graph' | 'stats' | 'context';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function memoryFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`/api/memory${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ImportanceBadge({ value }: { value: number; darkMode: boolean }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const pct = Math.round(safeValue * 100);
  const color =
    pct >= 80
      ? 'bg-red-500/15 text-red-400'
      : pct >= 50
        ? 'bg-yellow-500/15 text-yellow-400'
        : 'bg-gray-500/15 text-gray-400';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      <Sparkles className="w-3 h-3" />
      {pct}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// STM Tab
// ---------------------------------------------------------------------------

function STMTab({ userId, darkMode }: { userId: string; darkMode: boolean }) {
  const [entries, setEntries] = useState<STMEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editImportance, setEditImportance] = useState(0.5);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');

  const fetchEntries = useCallback(async () => {
    try {
      const data = await memoryFetch<{ entries: STMEntry[] }>(`/stm/${userId}`);
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleSave = async (key: string) => {
    await memoryFetch(`/stm/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ key, content: editContent, tags: editTags.split(',').map((t) => t.trim()).filter(Boolean), importance: editImportance }),
    });
    setEditingKey(null);
    fetchEntries();
  };

  const handleDelete = async (key: string) => {
    await memoryFetch(`/stm/${userId}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    fetchEntries();
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newContent.trim()) return;
    await memoryFetch(`/stm/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ key: newKey.trim(), content: newContent.trim(), tags: newTags.split(',').map((t) => t.trim()).filter(Boolean), importance: 0.5 }),
    });
    setShowAdd(false);
    setNewKey('');
    setNewContent('');
    setNewTags('');
    fetchEntries();
  };

  const startEdit = (entry: STMEntry) => {
    setEditingKey(entry.key);
    setEditContent(entry.content);
    setEditTags((Array.isArray(entry.tags) ? entry.tags : []).join(', '));
    setEditImportance(entry.importance);
  };

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';
  const inputBg = darkMode ? 'bg-slate-700 border-slate-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  if (loading) return <div className={`flex-1 flex items-center justify-center ${subtext}`}><RefreshCw className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <div className="flex items-center justify-between mb-4">
          <p className={`text-sm ${subtext}`}>
            Scratchpad entries — fast working memory visible to the agent every turn.
          </p>
          <button onClick={() => setShowAdd(!showAdd)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${darkMode ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}>
            <Plus className="w-4 h-4" />
            Add Entry
          </button>
        </div>

        {showAdd && (
          <div className={`p-4 rounded-lg border ${cardBg} space-y-3`}>
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="Key (e.g. user_preference)" className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Content..." rows={3} className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
            <input value={newTags} onChange={(e) => setNewTags(e.target.value)} placeholder="Tags (comma-separated)" className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
            <div className="flex gap-2">
              <button onClick={handleAdd} className="px-3 py-1.5 rounded bg-purple-600 text-white text-sm hover:bg-purple-500">Save</button>
              <button onClick={() => setShowAdd(false)} className={`px-3 py-1.5 rounded text-sm ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>Cancel</button>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <div className={`text-center py-12 ${subtext}`}>
            <Database className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No scratchpad entries yet.</p>
          </div>
        ) : entries.map((entry) => (
          <div key={entry.key} className={`p-4 rounded-lg border ${cardBg} transition-colors`}>
            {editingKey === entry.key ? (
              <div className="space-y-2">
                <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
                <input value={editTags} onChange={(e) => setEditTags(e.target.value)} placeholder="Tags" className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
                <div className="flex items-center gap-2">
                  <label className={`text-xs ${subtext}`}>Importance:</label>
                  <input type="range" min={0} max={1} step={0.1} value={editImportance} onChange={(e) => setEditImportance(parseFloat(e.target.value))} className="w-32" />
                  <span className={`text-xs ${subtext}`}>{Math.round(editImportance * 100)}%</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleSave(entry.key)} className="flex items-center gap-1 px-2 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-500"><Save className="w-3 h-3" />Save</button>
                  <button onClick={() => setEditingKey(null)} className={`px-2 py-1 rounded text-xs ${subtext}`}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <code className={`text-sm font-semibold ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>{entry.key}</code>
                      <ImportanceBadge value={entry.importance} darkMode={darkMode} />
                      {entry.access_count > 0 && <span className={`text-xs ${subtext}`}>accessed {entry.access_count}x</span>}
                    </div>
                    <p className={`text-sm ${text}`}>{entry.content}</p>
                    {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {entry.tags.map((t) => (
                          <span key={t} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                            <Tag className="w-2.5 h-2.5" />{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(entry)} className={`p-1.5 rounded transition-colors ${darkMode ? 'hover:bg-slate-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`} title="Edit"><Edit3 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(entry.key)} className={`p-1.5 rounded transition-colors ${darkMode ? 'hover:bg-red-500/20 text-gray-400 hover:text-red-400' : 'hover:bg-red-100 text-gray-500 hover:text-red-600'}`} title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LTM Tab
// ---------------------------------------------------------------------------

function LTMTab({ userId, darkMode }: { userId: string; darkMode: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LTMResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newImportance, setNewImportance] = useState(0.5);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await memoryFetch<{ memories: LTMResult[] }>(`/ltm/${userId}?q=${encodeURIComponent(query)}&top_k=10`);
      setResults(data.memories || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleStore = async () => {
    if (!newContent.trim()) return;
    await memoryFetch(`/ltm/${userId}`, {
      method: 'POST',
      body: JSON.stringify({ content: newContent.trim(), importance: newImportance, source: 'manual' }),
    });
    setShowStore(false);
    setNewContent('');
    if (query) handleSearch();
  };

  const handleForget = async (memoryId: string) => {
    await memoryFetch(`/ltm/${userId}/${memoryId}`, { method: 'DELETE' });
    setResults((prev) => prev.filter((r) => r.memory_id !== memoryId));
  };

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';
  const inputBg = darkMode ? 'bg-slate-700 border-slate-600 text-gray-100' : 'bg-white border-gray-300 text-gray-900';

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <p className={`text-sm ${subtext}`}>
          Semantic search across long-term memory. Results are ranked by weighted RRF fusion (dense + sparse + graph).
        </p>

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${subtext}`} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search memories... (e.g. 'What language does the user prefer?')"
              className={`w-full pl-10 pr-3 py-2.5 rounded-lg border text-sm ${inputBg}`}
            />
          </div>
          <button onClick={handleSearch} disabled={loading} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-500 disabled:opacity-50">
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Search'}
          </button>
          <button onClick={() => setShowStore(!showStore)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${darkMode ? 'bg-slate-700 text-gray-300 hover:bg-slate-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {showStore && (
          <div className={`p-4 rounded-lg border ${cardBg} space-y-3`}>
            <textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="Memory to store..." rows={3} className={`w-full px-3 py-2 rounded border text-sm ${inputBg}`} />
            <div className="flex items-center gap-3">
              <label className={`text-xs ${subtext}`}>Importance:</label>
              <input type="range" min={0} max={1} step={0.1} value={newImportance} onChange={(e) => setNewImportance(parseFloat(e.target.value))} className="w-32" />
              <span className={`text-xs ${subtext}`}>{Math.round(newImportance * 100)}%</span>
              <div className="flex-1" />
              <button onClick={handleStore} className="px-3 py-1.5 rounded bg-purple-600 text-white text-sm hover:bg-purple-500">Store Memory</button>
              <button onClick={() => setShowStore(false)} className={`px-3 py-1.5 rounded text-sm ${subtext}`}>Cancel</button>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.memory_id} className={`p-4 rounded-lg border ${cardBg}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${text}`}>{r.content}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <ImportanceBadge value={r.importance} darkMode={darkMode} />
                      <span className={`text-xs ${subtext}`}>
                        <Clock className="w-3 h-3 inline mr-1" />
                        {r.created_at?.slice(0, 10) || '?'}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                        {r.source}
                      </span>
                      <span className={`text-xs ${subtext}`}>
                        score: {r.score.toFixed(4)}
                      </span>
                      {Array.isArray(r.entities) && r.entities.length > 0 && (
                        <span className={`text-xs ${subtext}`}>
                          <Network className="w-3 h-3 inline mr-1" />
                          {r.entities.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleForget(r.memory_id)} className={`p-1.5 rounded shrink-0 transition-colors ${darkMode ? 'hover:bg-red-500/20 text-gray-400 hover:text-red-400' : 'hover:bg-red-100 text-gray-500 hover:text-red-600'}`} title="Forget">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !loading && query && (
          <div className={`text-center py-8 ${subtext}`}>No memories found for that query.</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph Tab
// ---------------------------------------------------------------------------

function GraphTab({ userId, darkMode }: { userId: string; darkMode: boolean }) {
  const [entities, setEntities] = useState<Array<{ name: string; type: string; importance: number; mentions: number }>>([]);
  const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    memoryFetch<{ entities?: Array<{ id?: string; name?: string; display_name?: string; type?: string; importance?: number; mentions?: number }> }>(`/graph/${userId}`)
      .then((data) => {
        const safeEntities = Array.isArray(data.entities) ? data.entities : [];
        setEntities(
          safeEntities
            .map((ent) => {
              const name = ent.name || ent.display_name || ent.id || '';
              return {
                name,
                type: ent.type || 'concept',
                importance: typeof ent.importance === 'number' && Number.isFinite(ent.importance) ? ent.importance : 0,
                mentions: typeof ent.mentions === 'number' && Number.isFinite(ent.mentions) ? ent.mentions : 0,
              };
            })
            .filter((ent) => ent.name.length > 0),
        );
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false));
  }, [userId]);

  const handleEntityClick = async (name: string) => {
    try {
      const data = await memoryFetch<Partial<GraphEntity> & { error?: string }>(`/graph/${userId}/entity/${encodeURIComponent(name)}`);
      if (!data || data.error) {
        setSelectedEntity(null);
        return;
      }
      const entityName = data.name || data.display_name || name;
      if (!entityName) {
        setSelectedEntity(null);
        return;
      }
      setSelectedEntity({
        id: data.id || entityName,
        name: entityName,
        display_name: data.display_name || entityName,
        entity_type: data.entity_type || 'concept',
        importance: typeof data.importance === 'number' && Number.isFinite(data.importance) ? data.importance : 0,
        mention_count: typeof data.mention_count === 'number' && Number.isFinite(data.mention_count) ? data.mention_count : 0,
        relations: Array.isArray(data.relations) ? data.relations : [],
      });
    } catch {
      setSelectedEntity(null);
    }
  };

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';

  const typeColors: Record<string, string> = {
    person: 'bg-blue-500/15 text-blue-400',
    project: 'bg-green-500/15 text-green-400',
    topic: 'bg-purple-500/15 text-purple-400',
    tool: 'bg-orange-500/15 text-orange-400',
    organization: 'bg-cyan-500/15 text-cyan-400',
    concept: 'bg-pink-500/15 text-pink-400',
    url: 'bg-gray-500/15 text-gray-400',
  };

  if (loading) return <div className={`flex-1 flex items-center justify-center ${subtext}`}><RefreshCw className="w-5 h-5 animate-spin" /></div>;

  const selectedRelations = Array.isArray(selectedEntity?.relations)
    ? selectedEntity.relations
    : [];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Entity list */}
      <div className={`w-72 shrink-0 flex flex-col border-r overflow-hidden ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200'}`}>
        <div className={`px-4 py-3 border-b shrink-0 ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <Network className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            <span className={`text-sm font-semibold ${text}`}>Entities</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
              {entities.length}
            </span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {entities.length === 0 ? (
            <div className={`p-4 text-sm text-center ${subtext}`}>No entities in the knowledge graph yet.</div>
          ) : (
            entities.sort((a, b) => b.mentions - a.mentions).map((ent) => (
              <button
                key={ent.name}
                onClick={() => handleEntityClick(ent.name)}
                className={`w-full text-left px-4 py-3 border-b transition-colors ${
                  darkMode
                    ? `border-slate-700/50 ${selectedEntity?.name === ent.name ? 'bg-slate-700' : 'hover:bg-slate-700/50'}`
                    : `border-gray-100 ${selectedEntity?.name === ent.name ? 'bg-white shadow-sm' : 'hover:bg-gray-100'}`
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${text}`}>{ent.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${typeColors[ent.type] || typeColors.concept}`}>
                    {ent.type}
                  </span>
                </div>
                <div className={`text-xs mt-0.5 ${subtext}`}>
                  mentioned {ent.mentions}x &middot; importance {Math.round(ent.importance * 100)}%
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Entity detail */}
      <div className={`flex-1 overflow-y-auto p-6 ${darkMode ? 'bg-slate-900' : 'bg-white'}`}>
        {selectedEntity ? (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-6">
              <h2 className={`text-xl font-bold ${text}`}>{selectedEntity.display_name}</h2>
              <span className={`text-sm px-2 py-1 rounded-full ${typeColors[selectedEntity.entity_type] || typeColors.concept}`}>
                {selectedEntity.entity_type}
              </span>
              <ImportanceBadge value={selectedEntity.importance} darkMode={darkMode} />
            </div>

            <div className={`text-sm mb-4 ${subtext}`}>
              Mentioned {selectedEntity.mention_count} times
            </div>

            {selectedRelations.length > 0 && (
              <div>
                <h3 className={`text-sm font-semibold mb-3 ${text}`}>Relations</h3>
                <div className="space-y-2">
                  {selectedRelations.map((rel, i) => (
                    <div key={i} className={`flex items-center gap-2 p-3 rounded-lg border ${cardBg}`}>
                      <ChevronRight className={`w-4 h-4 shrink-0 ${rel.direction === 'outgoing' ? 'text-green-400' : 'text-blue-400'}`} />
                      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}>
                        {rel.type}
                      </span>
                      <span className={`text-sm ${text}`}>{rel.other_name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${typeColors[rel.other_type] || typeColors.concept}`}>
                        {rel.other_type}
                      </span>
                      <span className={`text-xs ml-auto ${subtext}`}>weight: {rel.weight?.toFixed(1)}</span>
                      {rel.valid_until && <span className="text-xs text-red-400">(superseded)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${subtext}`}>
            <Network className="w-12 h-12 opacity-30" />
            <p className="text-sm">Select an entity to view its relations</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Tab
// ---------------------------------------------------------------------------

function StatsTab({ userId, darkMode }: { userId: string; darkMode: boolean }) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    memoryFetch<MemoryStats>(`/stats/${userId}`)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [userId]);

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';

  if (loading) return <div className={`flex-1 flex items-center justify-center ${subtext}`}><RefreshCw className="w-5 h-5 animate-spin" /></div>;

  if (!stats) {
    return (
      <div className={`flex-1 flex items-center justify-center ${subtext}`}>
        <div className="text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Could not load memory stats.</p>
        </div>
      </div>
    );
  }

  const cards = [
    { label: 'STM Entries', value: stats.stm_entries, icon: Database, color: 'text-purple-400',
      info: 'Short-Term Memory — fast scratchpad visible to Prax every turn. Stores recent facts, preferences, and context. Automatically consolidated into long-term memory by the hourly cycle.' },
    { label: 'Vector Memories', value: stats.vector_memories, icon: Brain, color: 'text-blue-400',
      info: 'Semantic memories stored as vector embeddings in Qdrant. Enables "fuzzy recall" — Prax can find related memories even without exact keyword matches. Built from conversation summaries and consolidated STM entries.' },
    { label: 'Graph Entities', value: stats.graph_store_stats?.entities ?? 0, icon: Network, color: 'text-green-400',
      info: 'People, places, concepts, and things stored in the Neo4j knowledge graph. Extracted from conversations during consolidation. Enables structured queries like "what do I know about Alice?"' },
    { label: 'Relations', value: stats.graph_store_stats?.relations ?? 0, icon: ChevronRight, color: 'text-cyan-400',
      info: 'Connections between entities in the knowledge graph — e.g. "Alice works-at Acme", "Python is-used-for ML". Gives Prax understanding of how concepts relate to each other.' },
    { label: 'Temporal Events', value: stats.graph_store_stats?.temporal_events ?? 0, icon: Clock, color: 'text-yellow-400',
      info: 'Time-stamped events stored in the knowledge graph — things that happened at a specific time. Enables "what happened last Tuesday?" and timeline reasoning.' },
    { label: 'Causal Links', value: stats.graph_store_stats?.causal_links ?? 0, icon: Sparkles, color: 'text-red-400',
      info: 'Cause-and-effect relationships in the knowledge graph — e.g. "deploying X caused Y to break". Helps Prax understand consequences and avoid repeating mistakes.' },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <span className={`px-2 py-1 rounded text-xs font-medium ${stats.memory_enabled ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
            {stats.memory_enabled ? 'Memory Enabled' : 'Memory Disabled'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((c) => (
            <div key={c.label} className={`p-4 rounded-lg border ${cardBg} group relative`}>
              <div className="flex items-center gap-2 mb-2">
                <c.icon className={`w-5 h-5 ${c.color}`} />
                <span className={`text-sm ${subtext}`}>{c.label}</span>
                {'info' in c && (
                  <div className="relative ml-auto">
                    <Info className={`w-3.5 h-3.5 ${subtext} opacity-40 hover:opacity-100 cursor-help`} />
                    <div className={`absolute top-full right-0 mt-2 w-64 p-3 rounded-lg text-xs leading-relaxed shadow-lg border z-50 hidden group-hover:block ${
                      darkMode ? 'bg-slate-700 border-slate-600 text-gray-200' : 'bg-white border-gray-200 text-gray-700'
                    }`}>
                      {(c as any).info}
                    </div>
                  </div>
                )}
              </div>
              <div className={`text-3xl font-bold ${text}`}>{c.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context Tab
// ---------------------------------------------------------------------------

function ContextTab({ darkMode }: { darkMode: boolean }) {
  const { data: stats, isLoading, refetch } = useContextStats();
  const compactMutation = useCompactContext();

  const text = darkMode ? 'text-gray-200' : 'text-gray-800';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-slate-800 border-slate-700' : 'bg-gray-50 border-gray-200';

  if (isLoading) return <div className={`flex-1 flex items-center justify-center ${subtext}`}><RefreshCw className="w-5 h-5 animate-spin" /></div>;

  if (!stats || 'error' in stats) {
    return (
      <div className={`flex-1 flex items-center justify-center ${subtext}`}>
        <div className="text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Could not load context stats.</p>
        </div>
      </div>
    );
  }

  const limit = stats.context_limit || 128000;
  const systemPct = Math.round((stats.system_prompt_tokens / limit) * 100);
  const historyPct = Math.round((stats.history_tokens / limit) * 100);
  const usedPct = Math.round((stats.total_tokens / limit) * 100);
  const freePct = Math.max(0, 100 - usedPct);
  const freeTokens = Math.max(0, limit - stats.total_tokens);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Current model + context limit */}
        <div className={`flex items-center gap-3 flex-wrap`}>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${darkMode ? 'bg-slate-800 border border-slate-700' : 'bg-gray-50 border border-gray-200'}`}>
            <Cpu className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
            <span className={`text-sm font-medium ${text}`}>{stats.current_model}</span>
            <span className={`text-xs uppercase px-1.5 py-0.5 rounded ${darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
              {stats.current_tier}
            </span>
          </div>
          <span className={`text-sm ${subtext}`}>
            {limit.toLocaleString()} token context window
          </span>
          <div className="flex-1" />
          <button
            onClick={() => refetch()}
            className={`p-1.5 rounded transition-colors ${darkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-slate-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Visual token usage bar */}
        <div className={`p-4 rounded-lg border ${cardBg}`}>
          <div className="flex items-center justify-between mb-3">
            <span className={`text-sm font-semibold ${text}`}>Token Usage</span>
            <span className={`text-sm ${subtext}`}>
              {stats.total_tokens.toLocaleString()} / {limit.toLocaleString()} ({usedPct}%)
            </span>
          </div>

          {/* Segmented progress bar */}
          <div className={`w-full h-6 rounded-full overflow-hidden flex ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
            {systemPct > 0 && (
              <div
                className="h-full bg-blue-500 flex items-center justify-center"
                style={{ width: `${systemPct}%` }}
                title={`System prompt: ${stats.system_prompt_tokens.toLocaleString()} tokens`}
              >
                {systemPct > 5 && <span className="text-[10px] text-white font-medium">System</span>}
              </div>
            )}
            {historyPct > 0 && (
              <div
                className="h-full bg-green-500 flex items-center justify-center"
                style={{ width: `${historyPct}%` }}
                title={`History: ${stats.history_tokens.toLocaleString()} tokens`}
              >
                {historyPct > 5 && <span className="text-[10px] text-white font-medium">History</span>}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-500" />
              <span className={`text-xs ${subtext}`}>System prompt ({stats.system_prompt_tokens.toLocaleString()})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-green-500" />
              <span className={`text-xs ${subtext}`}>History ({stats.history_tokens.toLocaleString()})</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`} />
              <span className={`text-xs ${subtext}`}>Free ({freeTokens.toLocaleString()})</span>
            </div>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className={`p-3 rounded-lg border ${cardBg}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <MessageSquare className="w-4 h-4 text-green-400" />
              <span className={`text-xs ${subtext}`}>Messages</span>
            </div>
            <div className={`text-2xl font-bold ${text}`}>{stats.history_messages}</div>
          </div>
          <div className={`p-3 rounded-lg border ${cardBg}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className={`text-xs ${subtext}`}>System</span>
            </div>
            <div className={`text-2xl font-bold ${text}`}>{(stats.system_prompt_tokens / 1000).toFixed(1)}k</div>
          </div>
          <div className={`p-3 rounded-lg border ${cardBg}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-4 h-4 text-purple-400" />
              <span className={`text-xs ${subtext}`}>History</span>
            </div>
            <div className={`text-2xl font-bold ${text}`}>{(stats.history_tokens / 1000).toFixed(1)}k</div>
          </div>
          <div className={`p-3 rounded-lg border ${cardBg}`}>
            <div className="flex items-center gap-1.5 mb-1">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className={`text-xs ${subtext}`}>Free</span>
            </div>
            <div className={`text-2xl font-bold ${text}`}>{(freeTokens / 1000).toFixed(1)}k</div>
            <div className={`text-xs ${subtext}`}>{freePct}%</div>
          </div>
        </div>

        {/* Compact button */}
        <div className={`p-4 rounded-lg border ${cardBg}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-semibold ${text}`}>Context Compaction</p>
              <p className={`text-xs mt-0.5 ${subtext}`}>
                Analyze how much space could be reclaimed by summarizing older messages.
              </p>
            </div>
            <button
              onClick={() => compactMutation.mutate()}
              disabled={compactMutation.isPending}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                darkMode ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
              } disabled:opacity-50`}
            >
              {compactMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Compact Now
            </button>
          </div>
          {compactMutation.data && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${darkMode ? 'bg-slate-700/50' : 'bg-gray-100'}`}>
              {compactMutation.data.compacted ? (
                <div className={text}>
                  <p>Analysis complete{compactMutation.data.dry_run ? ' (dry run)' : ''}:</p>
                  <p className={subtext}>
                    {compactMutation.data.messages_before} messages ({compactMutation.data.before_tokens?.toLocaleString()} tokens)
                    {' -> '}
                    {compactMutation.data.messages_after} messages ({compactMutation.data.after_tokens?.toLocaleString()} tokens)
                  </p>
                  <p className="text-green-400 font-medium">
                    Could save {compactMutation.data.savings_tokens?.toLocaleString()} tokens
                  </p>
                </div>
              ) : (
                <p className={subtext}>{compactMutation.data.reason || 'Nothing to compact.'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function MemoryPanel({ isVisible, onClose }: MemoryPanelProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('stm');

  useEffect(() => {
    memoryFetch<MemoryConfig>('/config')
      .then(setConfig)
      .catch(() => setConfig({ enabled: false, user_id: '' }))
      .finally(() => setLoading(false));
  }, []);

  if (!isVisible) return null;

  const bg = darkMode ? 'bg-slate-900' : 'bg-white';
  const text = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const borderColor = darkMode ? 'border-slate-700' : 'border-gray-200';

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${bg}`}>
        <RefreshCw className={`w-6 h-6 animate-spin ${subtext}`} />
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <div className={`flex-1 flex items-center justify-center ${bg}`}>
        <div className="text-center max-w-md">
          <Brain className={`w-12 h-12 mx-auto mb-4 ${subtext}`} />
          <h2 className={`text-lg font-bold mb-2 ${text}`}>Memory Disabled</h2>
          <p className={subtext}>
            Set <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>MEMORY_ENABLED=true</code> and
            run <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>docker compose --profile memory up</code> to
            enable the memory system.
          </p>
        </div>
      </div>
    );
  }

  const userId = config.user_id;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'stm', label: 'Scratchpad', icon: <Database className="w-4 h-4" /> },
    { key: 'ltm', label: 'Long-Term', icon: <Brain className="w-4 h-4" /> },
    { key: 'graph', label: 'Knowledge Graph', icon: <Network className="w-4 h-4" /> },
    { key: 'context', label: 'Context', icon: <Cpu className="w-4 h-4" /> },
    { key: 'stats', label: 'Stats', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${bg}`}>
      {/* Tab bar */}
      <div className={`flex items-center gap-1 px-4 pt-3 pb-0 border-b ${borderColor}`}>
        <Brain className={`w-5 h-5 mr-2 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
        <span className={`text-sm font-bold mr-4 ${text}`}>Memory</span>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? darkMode
                  ? 'border-purple-400 text-purple-400'
                  : 'border-purple-600 text-purple-700'
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
      {activeTab === 'stm' && <STMTab userId={userId} darkMode={darkMode} />}
      {activeTab === 'ltm' && <LTMTab userId={userId} darkMode={darkMode} />}
      {activeTab === 'graph' && <GraphTab userId={userId} darkMode={darkMode} />}
      {activeTab === 'context' && <ContextTab darkMode={darkMode} />}
      {activeTab === 'stats' && <StatsTab userId={userId} darkMode={darkMode} />}
    </div>
  );
}
