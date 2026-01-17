import { X } from 'lucide-react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
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
  if (!parentMessage) return null;

  const allMessages = [parentMessage, ...replies];

  return (
    <div className="w-96 border-l border-gray-200 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-900">Thread</h2>
          <p className="text-sm text-gray-500">
            {parentMessage.agent_name || 'CEO'} started this thread
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded text-gray-500"
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
