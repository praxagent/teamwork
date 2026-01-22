import { Hash, Users, Star, Info, Settings } from 'lucide-react';
import { useUIStore } from '@/stores';
import type { Channel } from '@/types';

interface ChannelHeaderProps {
  channel: Channel | null;
  memberCount?: number;
  onInfoClick?: () => void;
}

export function ChannelHeader({ channel, memberCount, onInfoClick }: ChannelHeaderProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  
  // Explicit colors based on dark mode
  const containerBg = darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200';
  const iconColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const titleColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const buttonHover = darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100';
  const starColor = darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600';
  const memberCountColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const loadingBg = darkMode ? 'bg-slate-700' : 'bg-gray-100';

  if (!channel) {
    return (
      <div className={`px-4 py-3 border-b ${containerBg}`}>
        <div className={`h-6 rounded w-32 animate-pulse ${loadingBg}`} />
      </div>
    );
  }

  const Icon = channel.type === 'team' ? Users : Hash;

  return (
    <div className={`px-4 py-3 border-b flex items-center justify-between ${containerBg}`}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Icon className={`w-5 h-5 ${iconColor}`} />
          <h1 className={`font-bold text-lg ${titleColor}`}>{channel.name}</h1>
        </div>
        <button className={`p-1 rounded ${buttonHover} ${starColor}`}>
          <Star className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {memberCount !== undefined && (
          <span className={`text-sm flex items-center gap-1 ${memberCountColor}`}>
            <Users className="w-4 h-4" />
            {memberCount}
          </span>
        )}
        <button
          onClick={onInfoClick}
          className={`p-1.5 rounded ${buttonHover} ${iconColor}`}
        >
          <Info className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
