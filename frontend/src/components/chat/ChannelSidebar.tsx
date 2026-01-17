import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Hash,
  Users,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Plus,
  Settings,
  Check,
  FolderOpen,
} from 'lucide-react';
import { Avatar } from '@/components/common';
import { useProjects } from '@/hooks/useApi';
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
    <div className="w-64 bg-slack-sidebar flex flex-col h-full text-white">
      {/* Workspace header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between relative" ref={dropdownRef}>
        <button 
          onClick={() => setShowProjectDropdown(!showProjectDropdown)}
          className="flex items-center gap-2 min-w-0 hover:bg-white/10 rounded px-2 py-1 -mx-2 transition-colors"
        >
          <span className="font-bold text-lg truncate">
            {project?.name || 'Virtual Team'}
          </span>
          <ChevronDown className={clsx(
            "w-4 h-4 flex-shrink-0 text-gray-400 transition-transform",
            showProjectDropdown && "rotate-180"
          )} />
        </button>
        <button 
          onClick={onSettingsClick}
          className="p-1 hover:bg-white/10 rounded"
          title="Project Settings"
        >
          <Settings className="w-4 h-4 text-gray-400" />
        </button>
        
        {/* Project Dropdown */}
        {showProjectDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-slack-sidebar border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="py-1 max-h-64 overflow-y-auto">
              {allProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleProjectSwitch(p.id)}
                  className={clsx(
                    "w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-white/10 transition-colors",
                    p.id === project?.id && "bg-white/5"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-gray-400 truncate">{p.description || 'No description'}</div>
                  </div>
                  {p.id === project?.id && (
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                  )}
                </button>
              ))}
              {allProjects.length === 0 && (
                <div className="px-4 py-3 text-sm text-gray-400">No projects found</div>
              )}
            </div>
            <div className="border-t border-white/10 p-2">
              <button
                onClick={() => {
                  setShowProjectDropdown(false);
                  navigate('/projects');
                }}
                className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-white/10 rounded transition-colors text-gray-300"
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
        <ChannelSection title="Channels" onAdd={onCreateChannel}>
          {publicChannels.map((channel) => (
            <ChannelItem
              key={channel.id}
              name={channel.name}
              icon={<Hash className="w-4 h-4" />}
              selected={currentChannelId === channel.id}
              unread={unreadCounts[channel.id] || 0}
              onClick={() => onChannelSelect(channel.id)}
            />
          ))}
        </ChannelSection>

        {/* Team Channels */}
        {teamChannels.length > 0 && (
          <ChannelSection title="Teams">
            {teamChannels.map((channel) => (
              <ChannelItem
                key={channel.id}
                name={channel.name}
                icon={<Users className="w-4 h-4" />}
                selected={currentChannelId === channel.id}
                unread={unreadCounts[channel.id] || 0}
                onClick={() => onChannelSelect(channel.id)}
              />
            ))}
          </ChannelSection>
        )}

        {/* Direct Messages */}
        <ChannelSection title="Direct Messages">
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
              />
            );
          })}
        </ChannelSection>
      </div>

      {/* Status Legend */}
      <div className="px-4 py-3 border-t border-white/10">
        <div className="text-xs text-gray-500 mb-2">Agent Status</div>
        <div className="flex flex-wrap gap-3 text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500" />
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
}

function ChannelSection({ title, children, onAdd }: ChannelSectionProps) {
  return (
    <div className="mb-4">
      <div className="px-4 mb-1 flex items-center justify-between group">
        <button className="flex items-center gap-1 text-sm text-gray-400 hover:text-white">
          <ChevronDown className="w-3 h-3" />
          <span>{title}</span>
        </button>
        {onAdd && (
          <button
            onClick={onAdd}
            className="p-1 hover:bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Plus className="w-3 h-3 text-gray-400" />
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
}

function ChannelItem({ name, icon, selected, unread, onClick }: ChannelItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full px-4 py-1 flex items-center gap-2 text-left transition-colors',
        selected
          ? 'bg-slack-active text-white'
          : 'text-gray-400 hover:bg-white/10 hover:text-white'
      )}
    >
      {icon}
      <span className={clsx('truncate flex-1', unread > 0 && 'font-semibold text-white')}>
        {name}
      </span>
      {unread > 0 && (
        <span className="bg-slack-red text-white text-xs px-1.5 rounded-full">
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
}

function AgentDMItem({ agent, selected, unread, onClick, onProfileClick }: AgentDMItemProps) {
  return (
    <div
      className={clsx(
        'w-full px-4 py-1 flex items-center gap-2 text-left transition-colors cursor-pointer',
        selected
          ? 'bg-slack-active text-white'
          : 'text-gray-400 hover:bg-white/10 hover:text-white'
      )}
      onClick={onClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onProfileClick();
        }}
        className="flex-shrink-0 hover:ring-2 hover:ring-white/50 rounded-md transition-all"
        title={`View ${agent.name}'s profile`}
      >
        <Avatar
          name={agent.name}
          src={agent.profile_image_url}
          size="md"
          status={agent.status}
        />
      </button>
      <span className={clsx('truncate flex-1', unread > 0 && 'font-semibold text-white')}>
        {agent.name}
      </span>
      {unread > 0 && (
        <span className="bg-slack-red text-white text-xs px-1.5 rounded-full">
          {unread}
        </span>
      )}
    </div>
  );
}
