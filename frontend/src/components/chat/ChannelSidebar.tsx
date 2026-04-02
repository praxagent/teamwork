import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Hash,
  Users,
  ChevronDown,
  Plus,
  Settings,
  Check,
  FolderOpen,
} from 'lucide-react';
import { Avatar } from '@/components/common';
import { useProjects } from '@/hooks/useApi';
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
  onCreateChannel,
  onSettingsClick,
  unreadCounts,
}: ChannelSidebarProps) {
  const navigate = useNavigate();
  const darkMode = useUIStore((s) => s.darkMode);
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const { data: projectsData } = useProjects();
  const allProjects = projectsData?.projects || [];
  
  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProjectDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const { publicChannels, teamChannels, dmChannels } = useMemo(() => {
    const pub: Channel[] = [];
    const team: Channel[] = [];
    const dm: Channel[] = [];

    channels.forEach((channel) => {
      if (channel.type === 'dm') {
        dm.push(channel);
      } else if (channel.type === 'team') {
        team.push(channel);
      } else {
        pub.push(channel);
      }
    });

    return { publicChannels: pub, teamChannels: team, dmChannels: dm };
  }, [channels]);

  const handleProjectSwitch = (projectId: string) => {
    setShowProjectDropdown(false);
    navigate(`/project/${projectId}`);
  };

  return (
    <div className={clsx('w-64 flex flex-col h-full', darkMode ? 'bg-tw-bg text-white' : 'bg-gray-50 text-gray-900')}>
      {/* Workspace header */}
      <div className={clsx('px-4 py-3 border-b flex items-center justify-between relative', darkMode ? 'border-white/10' : 'border-gray-200')} ref={dropdownRef}>
        <button
          onClick={() => setShowProjectDropdown(!showProjectDropdown)}
          className={clsx('flex items-center gap-2 min-w-0 rounded px-2 py-1 -mx-2 transition-colors', darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200')}
        >
          <span className="font-bold text-lg truncate">
            {project?.name || 'Virtual Team'}
          </span>
          <ChevronDown className={clsx(
            "w-4 h-4 flex-shrink-0 transition-transform",
            darkMode ? 'text-gray-400' : 'text-gray-500',
            showProjectDropdown && "rotate-180"
          )} />
        </button>
        <button
          onClick={onSettingsClick}
          className={clsx('p-1 rounded', darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-200')}
          title="Project Settings"
        >
          <Settings className={clsx('w-4 h-4', darkMode ? 'text-gray-400' : 'text-gray-500')} />
        </button>

        {/* Project Dropdown */}
        {showProjectDropdown && (
          <div className={clsx('absolute top-full left-0 right-0 mt-1 rounded-lg shadow-xl z-50 overflow-hidden border', darkMode ? 'bg-tw-surface border-tw-border' : 'bg-white border-gray-200')}>
            <div className="py-1 max-h-64 overflow-y-auto">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProjectSwitch(p.id)}
                  className={clsx(
                    "w-full px-4 py-2 text-left flex items-center gap-3 transition-colors",
                    darkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100',
                    p.id === project?.id && (darkMode ? 'bg-white/5' : 'bg-indigo-50'),
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className={clsx('text-xs truncate', darkMode ? 'text-gray-400' : 'text-gray-500')}>{p.description || 'No description'}</div>
                  </div>
                  {p.id === project?.id && (
                    <Check className={clsx('w-4 h-4 flex-shrink-0', darkMode ? 'text-green-400' : 'text-indigo-500')} />
                  )}
                </button>
              ))}
              {allProjects.length === 0 && (
                <div className={clsx('px-4 py-3 text-sm', darkMode ? 'text-gray-400' : 'text-gray-500')}>No projects found</div>
              )}
            </div>
            <div className={clsx('border-t p-2', darkMode ? 'border-white/10' : 'border-gray-200')}>
              <button
                onClick={() => {
                  setShowProjectDropdown(false);
                  navigate('/projects');
                }}
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
        <ChannelSection title="Channels" onAdd={onCreateChannel} darkMode={darkMode}>
          {publicChannels.map((channel) => (
            <ChannelItem
              key={channel.id}
              name={channel.name}
              icon={<Hash className="w-4 h-4" />}
              selected={currentChannelId === channel.id}
              unread={unreadCounts[channel.id] || 0}
              onClick={() => onChannelSelect(channel.id)}
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
                name={channel.name}
                icon={<Users className="w-4 h-4" />}
                selected={currentChannelId === channel.id}
                unread={unreadCounts[channel.id] || 0}
                onClick={() => onChannelSelect(channel.id)}
                darkMode={darkMode}
              />
            ))}
          </ChannelSection>
        )}

        {/* Direct Messages */}
        <ChannelSection title="Direct Messages" darkMode={darkMode}>
          {agents.map((agent) => {
            // Check if there's an existing DM channel with this agent
            const dmChannel = dmChannels.find(
              (c) => c.dm_participants === agent.id
            );
            const isSelected = dmChannel
              ? currentChannelId === dmChannel.id
              : false;
            return (
              <AgentDMItem
                key={agent.id}
                agent={agent}
                selected={isSelected}
                unread={dmChannel ? unreadCounts[dmChannel.id] || 0 : 0}
                onClick={() => onDMSelect?.(agent.id)}
                onProfileClick={() => onAgentProfileClick?.(agent)}
                darkMode={darkMode}
              />
            );
          })}
        </ChannelSection>
      </div>

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
    </div>
  );
}

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
  name: string;
  icon: React.ReactNode;
  selected: boolean;
  unread: number;
  onClick: () => void;
  darkMode: boolean;
}

function ChannelItem({ name, icon, selected, unread, onClick, darkMode }: ChannelItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full mx-2 px-3 py-1.5 flex items-center gap-2 text-left transition-colors rounded-lg',
        selected
          ? darkMode ? 'bg-tw-accent/15 text-white' : 'bg-indigo-50 text-indigo-700'
          : darkMode ? 'text-gray-400 hover:bg-white/5 hover:text-white' : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
      )}
      style={{ width: 'calc(100% - 1rem)' }}
    >
      {icon}
      <span className={clsx(
        'truncate flex-1',
        unread > 0 && (darkMode ? 'font-medium text-white' : 'font-medium text-gray-900'),
      )}>
        {name}
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
        onClick={(e) => {
          e.stopPropagation();
          onProfileClick();
        }}
        className={clsx('flex-shrink-0 hover:ring-2 rounded-full transition-all', darkMode ? 'hover:ring-white/30' : 'hover:ring-indigo-300')}
        title={`View ${agent.name}'s profile`}
      >
        <Avatar
          name={agent.name}
          src={agent.profile_image_url}
          size="md"
          status={agent.status}
        />
      </button>
      <span className={clsx(
        'truncate flex-1',
        unread > 0 && (darkMode ? 'font-medium text-white' : 'font-medium text-gray-900'),
      )}>
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
