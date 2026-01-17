import {
  Play,
  FileCode,
  GitCommit,
  MessageSquare,
  CheckCircle,
  AlertCircle,
  Cog,
  Zap,
} from 'lucide-react';
import type { ActivityLog } from '@/types';

interface ActivityTraceProps {
  activities: ActivityLog[];
  compact?: boolean;
}

const activityIcons: Record<string, typeof Play> = {
  task_started: Play,
  file_edited: FileCode,
  commit: GitCommit,
  message: MessageSquare,
  task_completed: CheckCircle,
  error: AlertCircle,
  thinking: Cog,
  tool_use: Zap,
  agent_started: Play,
  agent_stopped: AlertCircle,
  processing_message: MessageSquare,
};

const activityColors: Record<string, string> = {
  task_started: 'bg-blue-100 text-blue-600',
  file_edited: 'bg-purple-100 text-purple-600',
  commit: 'bg-green-100 text-green-600',
  message: 'bg-gray-100 text-gray-600',
  task_completed: 'bg-green-100 text-green-600',
  error: 'bg-red-100 text-red-600',
  thinking: 'bg-yellow-100 text-yellow-600',
  tool_use: 'bg-orange-100 text-orange-600',
  agent_started: 'bg-green-100 text-green-600',
  agent_stopped: 'bg-gray-100 text-gray-500',
  processing_message: 'bg-blue-100 text-blue-600',
};

export function ActivityTrace({ activities, compact }: ActivityTraceProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {activities.map((activity, index) => {
        const Icon = activityIcons[activity.activity_type] || Cog;
        const colorClass = activityColors[activity.activity_type] || 'bg-gray-100 text-gray-600';
        const time = new Date(activity.created_at).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });

        return (
          <div
            key={activity.id}
            className={`flex items-start gap-3 ${compact ? 'py-1' : 'py-2'}`}
          >
            {/* Timeline */}
            <div className="flex flex-col items-center">
              <div className={`p-1.5 rounded-full ${colorClass}`}>
                <Icon className="w-3 h-3" />
              </div>
              {index < activities.length - 1 && (
                <div className="w-0.5 h-full bg-gray-200 mt-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={`text-gray-900 ${compact ? 'text-sm' : ''}`}>
                {activity.description}
              </p>
              {activity.metadata && Object.keys(activity.metadata).length > 0 && !compact && (
                <div className="mt-1 text-xs text-gray-500">
                  {activity.metadata.files && (
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded">
                      {(activity.metadata.files as string[]).length} files
                    </span>
                  )}
                  {activity.metadata.task_id && (
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded ml-1">
                      Task #{(activity.metadata.task_id as string).slice(0, 8)}
                    </span>
                  )}
                </div>
              )}
              <span className="text-xs text-gray-400">{time}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface LiveActivityIndicatorProps {
  agentName: string;
  activity: string;
}

export function LiveActivityIndicator({ agentName, activity }: LiveActivityIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 bg-yellow-50 px-3 py-2 rounded-lg border border-yellow-200">
      <div className="flex space-x-1">
        <div className="w-2 h-2 bg-yellow-500 rounded-full typing-dot" />
        <div className="w-2 h-2 bg-yellow-500 rounded-full typing-dot" />
        <div className="w-2 h-2 bg-yellow-500 rounded-full typing-dot" />
      </div>
      <span>
        <span className="font-medium text-gray-700">{agentName}</span> is {activity}
      </span>
    </div>
  );
}
