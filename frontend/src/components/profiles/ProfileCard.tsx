import { Avatar } from '@/components/common';
import { MapPin, Briefcase, Code, Shield, Clock, MessageSquare } from 'lucide-react';
import type { Agent } from '@/types';

interface ProfileCardProps {
  agent: Agent;
  onClick?: () => void;
}

const roleIcons = {
  pm: Briefcase,
  developer: Code,
  qa: Shield,
};

const roleLabels = {
  pm: 'Product Manager',
  developer: 'Developer',
  qa: 'QA Engineer',
};

const statusLabels = {
  idle: 'Available',
  working: 'Working',
  offline: 'Offline',
};

export function ProfileCard({ agent, onClick }: ProfileCardProps) {
  const Icon = roleIcons[agent.role] || Briefcase;
  const location = agent.persona?.location;

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start gap-4">
        <Avatar
          name={agent.name}
          src={agent.profile_image_url}
          size="xl"
          status={agent.status}
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 truncate">{agent.name}</h3>
          <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
            <Icon className="w-4 h-4" />
            <span>{roleLabels[agent.role]}</span>
            {agent.team && (
              <>
                <span className="text-gray-300">|</span>
                <span>{agent.team}</span>
              </>
            )}
          </div>
          {location && (
            <div className="flex items-center gap-1 text-sm text-gray-400 mt-1">
              <MapPin className="w-3 h-3" />
              <span>
                {location.city}, {location.country}
              </span>
            </div>
          )}
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                agent.status === 'idle'
                  ? 'bg-green-100 text-green-700'
                  : agent.status === 'working'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  agent.status === 'idle'
                    ? 'bg-green-500'
                    : agent.status === 'working'
                    ? 'bg-yellow-500'
                    : 'bg-gray-400'
                }`}
              />
              {statusLabels[agent.status]}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
