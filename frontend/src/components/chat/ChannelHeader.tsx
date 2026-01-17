import { Hash, Users, Star, Info, Settings } from 'lucide-react';
import type { Channel } from '@/types';

interface ChannelHeaderProps {
  channel: Channel | null;
  memberCount?: number;
  onInfoClick?: () => void;
}

export function ChannelHeader({ channel, memberCount, onInfoClick }: ChannelHeaderProps) {
  if (!channel) {
    return (
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="h-6 bg-gray-100 rounded w-32 animate-pulse" />
      </div>
    );
  }

  const Icon = channel.type === 'team' ? Users : Hash;

  return (
    <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <Icon className="w-5 h-5 text-gray-500" />
          <h1 className="font-bold text-lg text-gray-900">{channel.name}</h1>
        </div>
        <button className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600">
          <Star className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {memberCount !== undefined && (
          <span className="text-sm text-gray-500 flex items-center gap-1">
            <Users className="w-4 h-4" />
            {memberCount}
          </span>
        )}
        <button
          onClick={onInfoClick}
          className="p-1.5 hover:bg-gray-100 rounded text-gray-500"
        >
          <Info className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
