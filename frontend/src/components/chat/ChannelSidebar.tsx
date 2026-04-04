import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Hash,
  Users,
  ChevronDown,
  Plus,
  Settings,
  FolderOpen,
  Pencil,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { Avatar } from '@/components/common';
import { useProjects, useCreateChannel, useUpdateChannel, useDeleteChannel } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import type { Channel, Agent, Project } from '@/types';

interface ChannelSidebarProps {
  project: Project | null;
  channels: Channel[];
  agents: Agent[];
  currentChannelId: string | null;
  onChannelSelect: (channelId: string) => void;
  onDMSelect?: (agentId: string) => void;
  onAgentProfileClick?: (agent: Agent) => void;
  onCreateChannel?: () => void;
  onSettingsClick?: () => void;
  unreadCounts: Record<string, number>;
}

export function ChannelSidebar({
  project,
  channels,
  agents,
  currentChannelId,
  onChannelSelect,
  onDMSelect,
  onAgentProfileClick,
  unreadCounts,
}: ChannelSidebarProps) {
  const navigate = useNavigate();
  const darkMode = useUIStore((s) => s.darkMode);
  const { data: projectsData } = useProjects();
  const createChannel = useCreateChannel();
  const updateChannel = useUpdateChannel();
  const deleteChannel = useDeleteChannel();

  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Channel management state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<Channel | null>(null);
  const [purgeMessages, setPurgeMessages] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelPurpose, setNewChannelPurpose] = useState('');
  const [editPurposeId, setEditPurposeId] = useState<string | null>(null);
  const [editPurposeValue, setEditPurposeValue] = useState('');

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false);
      }
      setContextMenu(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allProjects = projectsData?.projects ?? [];

  const { publicChannels, teamChannels, dmChannels } = useMemo(() => {
    const pub = channels.filter((c) => c.type === 'public');
    const team = channels.filter((c) => c.type === 'team');
    const dm = channels.filter((c) => c.type === 'dm');
    return { publicChannels: pub, teamChannels: team, dmChannels: dm };
  }, [channels]);

  const handleContextMenu = (e: React.MouseEvent, channel: Channel) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  };

  const startRename = (channel: Channel) => {
    setRenamingId(channel.id);
    setRenameValue(channel.name);
    setContextMenu(null);
  };

  const submitRename = () => {
    if (renamingId && renameValue.trim()) {
      updateChannel.mutate({ channelId: renamingId, name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const startEditPurpose = (channel: Channel) => {
    setEditPurposeId(channel.id);
    setEditPurposeValue(channel.description || '');
    setContextMenu(null);
  };

  const submitEditPurpose = () => {
    if (editPurposeId) {
      updateChannel.mutate({ channelId: editPurposeId, description: editPurposeValue.trim() });
    }
    setEditPurposeId(null);
  };

  // Check which mirror channels exist
  const hasSmsChannel = publicChannels.some(c => c.name === 'sms');
  const hasDiscordChannel = publicChannels.some(c => c.name === 'discord');
  const canRestoreSms = !hasSmsChannel;
  const canRestoreDiscord = !hasDiscordChannel;

  const restoreChannel = (name: string, description: string) => {
    if (!project) return;
    createChannel.mutate({ project_id: project.id, name, type: 'public', description });
  };

  const confirmDelete = (channel: Channel) => {
    setDeleteConfirm(channel);
    setPurgeMessages(true);
    setContextMenu(null);
  };

  const executeDelete = () => {
    if (deleteConfirm) {
      deleteChannel.mutate({ channelId: deleteConfirm.id, purgeMessages });
      if (currentChannelId === deleteConfirm.id) {
        const firstChannel = channels.find(c => c.id !== deleteConfirm.id);
        if (firstChannel) onChannelSelect(firstChannel.id);
      }
    }
    setDeleteConfirm(null);
  };

  const handleCreateChannel = () => {
    if (!newChannelName.trim() || !project) return;
    createChannel.mutate({
      project_id: project.id,
      name: newChannelName.trim().toLowerCase().replace(/\s+/g, '-'),
      type: 'public',
      description: newChannelPurpose.trim() || undefined,
    });
    setNewChannelName('');
    setNewChannelPurpose('');
    setShowCreateDialog(false);
  };

  return (
    <div className={clsx(
      'w-60 flex flex-col shrink-0 border-r',
      darkMode ? 'bg-tw-sidebar border-white/10' : 'bg-gray-50 border-gray-200',
    )}>
      {/* Project selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setShowProjectDropdown(!showProjectDropdown)}
          className={clsx(
            'w-full px-4 py-3 flex items-center justify-between text-left border-b',
            darkMode ? 'border-white/10 hover:bg-white/5' : 'border-gray-200 hover:bg-gray-100'
          )}
        >
          <div>
            <div className={clsx('font-semibold text-sm truncate', darkMode ? 'text-white' : 'text-gray-900')}>
              {project?.name || 'Select Project'}
            </div>
          </div>
          <ChevronDown className={clsx('w-4 h-4', darkMode ? 'text-gray-400' : 'text-gray-500')} />
        </button>

        {showProjectDropdown && (
          <div className={clsx(
            'absolute top-full left-0 right-0 z-50 shadow-lg border',
            darkMode ? 'bg-tw-sidebar border-white/10' : 'bg-white border-gray-200',
          )}>
            <div className="max-h-[200px] overflow-y-auto py-1">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setShowProjectDropdown(false);
                    navigate(`/projects/${p.id}`);
                  }}
                  className={clsx(
                    'w-full px-4 py-2 text-sm text-left flex items-center gap-2 transition-colors',
                    p.id === project?.id
                      ? darkMode ? 'bg-tw-accent/15 text-white' : 'bg-indigo-50 text-indigo-700'
                      : darkMode ? 'text-gray-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-100',
                  )}
                >
                  {p.id === project?.id && <Check className="w-4 h-4" />}
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
            <div className={clsx('border-t p-2', darkMode ? 'border-white/10' : 'border-gray-200')}>
              <button
                onClick={() => { setShowProjectDropdown(false); navigate('/projects'); }}
                className={clsx('w-full px-3 py-2 text-sm text-left flex items-center gap-2 rounded transition-colors', darkMode ? 'hover:bg-white/10 text-gray-300' : 'hover:bg-gray-100 text-gray-600')}
              >
                <FolderOpen className="w-4 h-4" />
                View All Projects
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Channels list */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {/* Public Channels */}
        <ChannelSection title="Channels" onAdd={() => setShowCreateDialog(true)} darkMode={darkMode}>
          {publicChannels.map((channel) => (
            <ChannelItem
              key={channel.id}
              channel={channel}
              icon={<Hash className="w-4 h-4" />}
              selected={currentChannelId === channel.id}
              unread={unreadCounts[channel.id] || 0}
              onClick={() => onChannelSelect(channel.id)}
              onContextMenu={(e) => handleContextMenu(e, channel)}
              renaming={renamingId === channel.id}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameSubmit={submitRename}
              onRenameCancel={() => setRenamingId(null)}
              darkMode={darkMode}
            />
          ))}
        </ChannelSection>

        {/* Team Channels */}
        {teamChannels.length > 0 && (
          <ChannelSection title="Teams" darkMode={darkMode}>
            {teamChannels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                icon={<Users className="w-4 h-4" />}
                selected={currentChannelId === channel.id}
                unread={unreadCounts[channel.id] || 0}
                onClick={() => onChannelSelect(channel.id)}
                onContextMenu={(e) => handleContextMenu(e, channel)}
                renaming={renamingId === channel.id}
                renameValue={renameValue}
                onRenameChange={setRenameValue}
                onRenameSubmit={submitRename}
                onRenameCancel={() => setRenamingId(null)}
                darkMode={darkMode}
              />
            ))}
          </ChannelSection>
        )}

        {/* Direct Messages */}
        <ChannelSection title="Direct Messages" darkMode={darkMode}>
          {agents.map((agent) => {
            const dmChannel = dmChannels.find((c) => c.dm_participants === agent.id);
            return (
              <AgentDMItem
                key={agent.id}
                agent={agent}
                selected={dmChannel ? currentChannelId === dmChannel.id : false}
                unread={dmChannel ? unreadCounts[dmChannel.id] || 0 : 0}
                onClick={() => onDMSelect?.(agent.id)}
                onProfileClick={() => onAgentProfileClick?.(agent)}
                darkMode={darkMode}
              />
            );
          })}
        </ChannelSection>
      </div>

      {/* Restore deleted mirror channels */}
      {(canRestoreSms || canRestoreDiscord) && (
        <div className={clsx('px-4 py-2 border-t', darkMode ? 'border-white/10' : 'border-gray-200')}>
          <div className={clsx('text-xs mb-1.5', darkMode ? 'text-gray-500' : 'text-gray-400')}>Restore Channel</div>
          <div className="flex gap-1.5">
            {canRestoreSms && (
              <button
                onClick={() => restoreChannel('sms', 'Mirrored SMS conversations')}
                className={clsx('px-2 py-1 rounded text-xs', darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
              >
                + #sms
              </button>
            )}
            {canRestoreDiscord && (
              <button
                onClick={() => restoreChannel('discord', 'Mirrored Discord conversations')}
                className={clsx('px-2 py-1 rounded text-xs', darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
              >
                + #discord
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status Legend */}
      <div className={clsx('px-4 py-3 border-t', darkMode ? 'border-white/10' : 'border-gray-200')}>
        <div className={clsx('text-xs mb-2', darkMode ? 'text-gray-500' : 'text-gray-400')}>Agent Status</div>
        <div className={clsx('flex flex-wrap gap-3 text-xs', darkMode ? 'text-gray-400' : 'text-gray-500')}>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span>Working</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            <span>Blocked</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span>Ready</span>
          </div>
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className={clsx(
            'fixed z-50 rounded-lg shadow-lg border py-1 min-w-[140px]',
            darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200',
          )}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onMouseDown={() => startRename(contextMenu.channel)}
            className={clsx('w-full px-3 py-1.5 text-sm text-left flex items-center gap-2', darkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-gray-100 text-gray-700')}
          >
            <Pencil className="w-3.5 h-3.5" /> Rename
          </button>
          <button
            onMouseDown={() => startEditPurpose(contextMenu.channel)}
            className={clsx('w-full px-3 py-1.5 text-sm text-left flex items-center gap-2', darkMode ? 'hover:bg-slate-700 text-slate-200' : 'hover:bg-gray-100 text-gray-700')}
          >
            <Settings className="w-3.5 h-3.5" /> Edit Purpose
          </button>
          <button
            onMouseDown={() => confirmDelete(contextMenu.channel)}
            className={clsx('w-full px-3 py-1.5 text-sm text-left flex items-center gap-2', darkMode ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-600')}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={clsx('rounded-lg shadow-xl p-5 w-80', darkMode ? 'bg-slate-800' : 'bg-white')}>
            <h3 className={clsx('font-semibold mb-2', darkMode ? 'text-slate-100' : 'text-gray-900')}>
              Delete #{deleteConfirm.name}?
            </h3>
            <p className={clsx('text-sm mb-4', darkMode ? 'text-slate-400' : 'text-gray-500')}>
              This cannot be undone.
            </p>
            <label className={clsx('flex items-center gap-2 mb-4 text-sm cursor-pointer', darkMode ? 'text-slate-300' : 'text-gray-700')}>
              <input
                type="checkbox"
                checked={purgeMessages}
                onChange={e => setPurgeMessages(e.target.checked)}
                className="rounded"
              />
              Permanently delete all message history
            </label>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className={clsx('px-3 py-1.5 rounded text-sm', darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                className="px-3 py-1.5 rounded text-sm bg-red-600 text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Purpose Modal ── */}
      {editPurposeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={clsx('rounded-lg shadow-xl p-5 w-80', darkMode ? 'bg-slate-800' : 'bg-white')}>
            <h3 className={clsx('font-semibold mb-2', darkMode ? 'text-slate-100' : 'text-gray-900')}>
              Edit Channel Purpose
            </h3>
            <p className={clsx('text-xs mb-3', darkMode ? 'text-slate-500' : 'text-gray-400')}>
              Prax sees this when responding in this channel.
            </p>
            <input
              value={editPurposeValue}
              onChange={e => setEditPurposeValue(e.target.value)}
              placeholder="What is this channel for?"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && submitEditPurpose()}
              className={clsx('w-full px-2 py-1.5 rounded border text-sm outline-none mb-3',
                darkMode ? 'bg-slate-700 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-gray-900 border-gray-300 focus:border-indigo-500'
              )}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditPurposeId(null)}
                className={clsx('px-3 py-1.5 rounded text-sm', darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                Cancel
              </button>
              <button onClick={submitEditPurpose}
                className="px-3 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-500">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Channel Dialog ── */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={clsx('rounded-lg shadow-xl p-5 w-80', darkMode ? 'bg-slate-800' : 'bg-white')}>
            <h3 className={clsx('font-semibold mb-3', darkMode ? 'text-slate-100' : 'text-gray-900')}>
              New Channel
            </h3>
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-1">
                <Hash className={clsx('w-4 h-4 shrink-0', darkMode ? 'text-slate-500' : 'text-gray-400')} />
                <input
                  value={newChannelName}
                  onChange={e => setNewChannelName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="channel-name"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && newChannelName.trim() && handleCreateChannel()}
                  className={clsx('flex-1 px-2 py-1.5 rounded border text-sm outline-none',
                    darkMode ? 'bg-slate-700 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-gray-900 border-gray-300 focus:border-indigo-500'
                  )}
                />
              </div>
              <input
                value={newChannelPurpose}
                onChange={e => setNewChannelPurpose(e.target.value)}
                placeholder="Purpose (e.g. Daily standups, project updates)"
                className={clsx('w-full px-2 py-1.5 rounded border text-sm outline-none',
                  darkMode ? 'bg-slate-700 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-gray-900 border-gray-300 focus:border-indigo-500'
                )}
              />
              <p className={clsx('text-xs', darkMode ? 'text-slate-500' : 'text-gray-400')}>
                Prax will see the channel name and purpose when responding here.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCreateDialog(false); setNewChannelName(''); setNewChannelPurpose(''); }}
                className={clsx('px-3 py-1.5 rounded text-sm', darkMode ? 'bg-slate-700 text-slate-300 hover:bg-slate-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateChannel}
                disabled={!newChannelName.trim() || createChannel.isPending}
                className="px-3 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

interface ChannelSectionProps {
  title: string;
  children: React.ReactNode;
  onAdd?: () => void;
  darkMode: boolean;
}

function ChannelSection({ title, children, onAdd, darkMode }: ChannelSectionProps) {
  return (
    <div className="mb-4">
      <div className="px-4 mb-1 flex items-center justify-between group">
        <button className={clsx('flex items-center gap-1 text-sm', darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')}>
          <ChevronDown className="w-3 h-3" />
          <span>{title}</span>
        </button>
        {onAdd && (
          <button
            onClick={onAdd}
            className={clsx('p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity', darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200')}
          >
            <Plus className={clsx('w-3 h-3', darkMode ? 'text-gray-400' : 'text-gray-500')} />
          </button>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

interface ChannelItemProps {
  channel: Channel;
  icon: React.ReactNode;
  selected: boolean;
  unread: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  renaming: boolean;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  darkMode: boolean;
}

function ChannelItem({
  channel, icon, selected, unread, onClick, onContextMenu,
  renaming, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, darkMode,
}: ChannelItemProps) {
  if (renaming) {
    return (
      <div className="mx-2 px-3 py-1 flex items-center gap-1.5" style={{ width: 'calc(100% - 1rem)' }}>
        {icon}
        <input
          value={renameValue}
          onChange={e => onRenameChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel(); }}
          className={clsx('flex-1 px-1.5 py-0.5 rounded border text-sm outline-none',
            darkMode ? 'bg-slate-700 text-white border-slate-600' : 'bg-white text-gray-900 border-gray-300'
          )}
        />
        <button onClick={onRenameSubmit} className="text-green-500"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={onRenameCancel} className={darkMode ? 'text-gray-500' : 'text-gray-400'}><X className="w-3.5 h-3.5" /></button>
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        'w-full mx-2 px-3 py-1.5 flex items-center gap-2 text-left transition-colors rounded-lg',
        selected
          ? darkMode ? 'bg-tw-accent/15 text-white' : 'bg-indigo-50 text-indigo-700'
          : darkMode ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      )}
      style={{ width: 'calc(100% - 1rem)' }}
    >
      {icon}
      <span className={clsx('truncate flex-1', unread > 0 && (darkMode ? 'font-medium text-white' : 'font-medium text-gray-900'))}>
        {channel.name}
      </span>
      {unread > 0 && (
        <span className="bg-tw-badge text-white text-xs px-1.5 rounded-full min-w-[1.25rem] text-center">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

interface AgentDMItemProps {
  agent: Agent;
  selected: boolean;
  unread: number;
  onClick: () => void;
  onProfileClick: () => void;
  darkMode: boolean;
}

function AgentDMItem({ agent, selected, unread, onClick, onProfileClick, darkMode }: AgentDMItemProps) {
  return (
    <div
      className={clsx(
        'w-full mx-2 px-3 py-1.5 flex items-center gap-2 text-left transition-colors cursor-pointer rounded-lg',
        selected
          ? darkMode ? 'bg-tw-accent/15 text-white' : 'bg-indigo-50 text-indigo-700'
          : darkMode ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      )}
      style={{ width: 'calc(100% - 1rem)' }}
      onClick={onClick}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onProfileClick(); }}
        className={clsx('flex-shrink-0 hover:ring-2 rounded-full transition-all', darkMode ? 'hover:ring-white/30' : 'hover:ring-indigo-300')}
        title={`View ${agent.name}'s profile`}
      >
        <Avatar name={agent.name} src={agent.profile_image_url} size="md" status={agent.status} />
      </button>
      <span className={clsx('truncate flex-1', unread > 0 && (darkMode ? 'font-medium text-white' : 'font-medium text-gray-900'))}>
        {agent.name}
      </span>
      {unread > 0 && (
        <span className="bg-tw-badge text-white text-xs px-1.5 rounded-full min-w-[1.25rem] text-center">
          {unread}
        </span>
      )}
    </div>
  );
}
