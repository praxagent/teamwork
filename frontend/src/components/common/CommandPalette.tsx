import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  Search, Hash, MessageSquare, User, Moon, Sun, Settings, ListTodo,
  Code, TerminalSquare, Globe, Activity, ArrowRight, FileText, Loader2,
} from 'lucide-react';
import { useUIStore, useProjectStore } from '@/stores';
import { searchMessages, type SearchResult } from '@/hooks/useApi';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'channel' | 'agent' | 'action' | 'message';
  action: () => void;
}

interface CommandPaletteProps {
  onChannelSelect?: (channelId: string) => void;
  onDMSelect?: (agentId: string) => void;
  onSwitchView?: (view: string) => void;
}

export function CommandPalette({ onChannelSelect, onDMSelect, onSwitchView }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [messageResults, setMessageResults] = useState<SearchResult[]>([]);
  const [messageTotal, setMessageTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchLimit, setSearchLimit] = useState(15);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const darkMode = useUIStore((s) => s.darkMode);
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode);
  const channels = useProjectStore((s) => s.channels);
  const agents = useProjectStore((s) => s.agents);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Global keyboard shortcut: Cmd+K / Ctrl+K + custom event for programmatic open
  useEffect(() => {
    const openPalette = () => {
      setOpen(true);
      setQuery('');
      setSelectedIndex(0);
      setMessageResults([]);
    };
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => { if (!v) { setQuery(''); setSelectedIndex(0); setMessageResults([]); setSearchLimit(15); } return !v; });
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    const customHandler = () => openPalette();
    window.addEventListener('keydown', handler);
    window.addEventListener('open-command-palette', customHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('open-command-palette', customHandler);
    };
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Debounced message search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);

    if (!query.trim() || query.trim().length < 2 || !currentProject?.id) {
      setMessageResults([]);
      setMessageTotal(0);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const { results, total } = await searchMessages(currentProject.id, query.trim(), searchLimit);
        setMessageResults(results);
        setMessageTotal(total);
      } catch {
        setMessageResults([]);
        setMessageTotal(0);
      }
      setSearching(false);
    }, 300);

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, currentProject?.id, searchLimit]);

  const localItems = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = [];

    // Channels (exclude panel channels — those are accessed via their panels)
    channels.filter((ch) => ch.type !== 'panel').forEach((ch) => {
      result.push({
        id: `ch-${ch.id}`,
        label: ch.type === 'dm' ? ch.name : `#${ch.name}`,
        description: ch.description || (ch.type === 'dm' ? 'Direct message' : ch.type === 'team' ? `${ch.team} team` : 'Channel'),
        icon: ch.type === 'dm' ? MessageSquare : Hash,
        category: 'channel',
        action: () => { onChannelSelect?.(ch.id); setOpen(false); },
      });
    });

    // Agents
    agents.forEach((ag) => {
      result.push({
        id: `ag-${ag.id}`,
        label: ag.name,
        description: `${ag.role}${ag.team ? ` · ${ag.team}` : ''}${ag.status === 'working' ? ' · Working' : ''}`,
        icon: User,
        category: 'agent',
        action: () => { onDMSelect?.(ag.id); setOpen(false); },
      });
    });

    // Actions
    result.push(
      { id: 'act-dark', label: darkMode ? 'Switch to light mode' : 'Switch to dark mode', icon: darkMode ? Sun : Moon, category: 'action', action: () => { toggleDarkMode(); setOpen(false); } },
      { id: 'act-settings', label: 'Open settings', icon: Settings, category: 'action', action: () => { onSwitchView?.('settings'); setOpen(false); } },
      { id: 'act-tasks', label: 'Open task board', icon: ListTodo, category: 'action', action: () => { onSwitchView?.('tasks'); setOpen(false); } },
      { id: 'act-files', label: 'Open file browser', icon: Code, category: 'action', action: () => { onSwitchView?.('files'); setOpen(false); } },
      { id: 'act-terminal', label: 'Open terminal', icon: TerminalSquare, category: 'action', action: () => { onSwitchView?.('terminal'); setOpen(false); } },
      { id: 'act-browser', label: 'Open browser', icon: Globe, category: 'action', action: () => { onSwitchView?.('browser'); setOpen(false); } },
      { id: 'act-observability', label: 'Open observability', icon: Activity, category: 'action', action: () => { onSwitchView?.('observability'); setOpen(false); } },
    );

    return result;
  }, [channels, agents, darkMode, toggleDarkMode, onChannelSelect, onDMSelect, onSwitchView]);

  // Filter local items + combine with message search results
  const allItems = useMemo<CommandItem[]>(() => {
    let filtered = localItems;
    if (query.trim()) {
      const q = query.toLowerCase();
      filtered = localItems.filter((i) =>
        i.label.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.category.includes(q)
      );
    }

    // Add message search results
    const msgItems: CommandItem[] = messageResults.map((r) => ({
      id: `msg-${r.message_id}`,
      label: r.content,
      description: `#${r.channel_name}${r.agent_name ? ` · ${r.agent_name}` : ''}`,
      icon: FileText,
      category: 'message' as const,
      action: () => { onChannelSelect?.(r.channel_id); setOpen(false); },
    }));

    return [...filtered, ...msgItems];
  }, [localItems, messageResults, query, onChannelSelect]);

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(0); }, [allItems.length, query]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      allItems[selectedIndex]?.action();
    }
  }, [allItems, selectedIndex]);

  if (!open) return null;

  // Group by category
  const grouped: { label: string; items: (CommandItem & { globalIndex: number })[] }[] = [];
  const messageLabel = messageTotal > messageResults.length
    ? `Messages (showing ${messageResults.length} of ${messageTotal})`
    : 'Messages';
  const categoryLabels: Record<string, string> = { channel: 'Channels', agent: 'People', action: 'Actions', message: messageLabel };
  let globalIdx = 0;
  const byCategory: Record<string, (CommandItem & { globalIndex: number })[]> = {};
  for (const item of allItems) {
    if (!byCategory[item.category]) byCategory[item.category] = [];
    byCategory[item.category].push({ ...item, globalIndex: globalIdx++ });
  }
  for (const cat of ['channel', 'agent', 'message', 'action']) {
    if (byCategory[cat]?.length) {
      grouped.push({ label: categoryLabels[cat], items: byCategory[cat] });
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className={clsx(
        'fixed top-[20%] left-1/2 -translate-x-1/2 z-[91] w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden',
        darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'
      )}>
        {/* Search input */}
        <div className={clsx('flex items-center gap-3 px-4 py-3 border-b', darkMode ? 'border-slate-700' : 'border-gray-200')}>
          {searching ? (
            <Loader2 className={clsx('w-5 h-5 shrink-0 animate-spin', darkMode ? 'text-gray-500' : 'text-gray-400')} />
          ) : (
            <Search className={clsx('w-5 h-5 shrink-0', darkMode ? 'text-gray-500' : 'text-gray-400')} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search messages, channels, people, actions..."
            className={clsx(
              'flex-1 bg-transparent outline-none text-sm',
              darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'
            )}
          />
          <kbd className={clsx(
            'text-xs px-1.5 py-0.5 rounded border',
            darkMode ? 'border-slate-600 text-gray-500' : 'border-gray-300 text-gray-400'
          )}>esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {allItems.length === 0 && !searching && (
            <div className={clsx('px-4 py-8 text-center text-sm', darkMode ? 'text-gray-500' : 'text-gray-400')}>
              {query.trim().length > 0 ? 'No results found' : 'Start typing to search...'}
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label}>
              <div className={clsx('px-4 py-1.5 text-xs font-medium uppercase tracking-wider', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                {group.label}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isSelected = item.globalIndex === selectedIndex;
                return (
                  <button
                    key={item.id}
                    data-index={item.globalIndex}
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIndex(item.globalIndex)}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                      isSelected
                        ? (darkMode ? 'bg-tw-accent/15 text-indigo-300' : 'bg-indigo-50 text-indigo-700')
                        : (darkMode ? 'text-gray-300 hover:bg-slate-800' : 'text-gray-700 hover:bg-gray-50')
                    )}
                  >
                    <Icon className={clsx('w-4 h-4 shrink-0', isSelected ? (darkMode ? 'text-indigo-400' : 'text-indigo-500') : 'opacity-50')} />
                    <span className={clsx('flex-1 truncate', item.category === 'message' && 'text-xs')}>{item.label}</span>
                    {item.description && (
                      <span className={clsx('text-xs truncate max-w-[140px]', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                        {item.description}
                      </span>
                    )}
                    {isSelected && <ArrowRight className="w-3.5 h-3.5 opacity-40" />}
                  </button>
                );
              })}
              {/* Show all results button for messages */}
              {group.label.startsWith('Messages') && messageTotal > messageResults.length && (
                <button
                  onClick={() => setSearchLimit(500)}
                  className={clsx(
                    'w-full px-4 py-2 text-xs text-center transition-colors',
                    darkMode ? 'text-indigo-400 hover:bg-slate-800' : 'text-indigo-500 hover:bg-indigo-50'
                  )}
                >
                  Show all {messageTotal} results
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className={clsx('px-4 py-2 border-t text-xs flex items-center gap-4', darkMode ? 'border-slate-700 text-gray-500' : 'border-gray-200 text-gray-400')}>
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
