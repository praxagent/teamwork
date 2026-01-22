import { X } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { useUIStore } from '@/stores';
import type { Message, Agent } from '@/types';

interface ThreadViewProps {
  parentMessage: Message | null;
  replies: Message[];
  agents: Agent[];
  onSendReply: (content: string) => void;
  onClose: () => void;
  loading?: boolean;
}

export function ThreadView({
  parentMessage,
  replies,
  agents,
  onSendReply,
  onClose,
  loading,
}: ThreadViewProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  
  if (!parentMessage) return null;

  const allMessages = [parentMessage, ...replies];
  
  // Explicit colors based on dark mode
  const containerBg = darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200';
  const titleColor = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtitleColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const buttonColor = darkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100';

  return (
    <div className={`w-96 border-l flex flex-col h-full ${containerBg}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${containerBg}`}>
        <div>
          <h2 className={`font-bold ${titleColor}`}>Thread</h2>
          <p className={`text-sm ${subtitleColor}`}>
            {parentMessage.agent_name || 'You'} started this thread
          </p>
        </div>
        <button
          onClick={onClose}
          className={`p-1 rounded ${buttonColor}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <MessageList messages={allMessages} agents={agents} loading={loading} />

      {/* Input */}
      <MessageInput
        channelName="thread"
        agents={agents}
        onSend={onSendReply}
        placeholder="Reply..."
      />
    </div>
  );
}
