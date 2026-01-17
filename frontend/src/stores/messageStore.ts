import { create } from 'zustand';
import type { Message } from '@/types';

interface MessageState {
  // Messages by channel
  messagesByChannel: Record<string, Message[]>;
  setMessages: (channelId: string, messages: Message[]) => void;
  addMessage: (channelId: string, message: Message) => void;
  prependMessages: (channelId: string, messages: Message[]) => void;

  // Thread messages
  threadMessages: Record<string, Message[]>;
  setThreadMessages: (threadId: string, messages: Message[]) => void;
  addThreadMessage: (threadId: string, message: Message) => void;

  // Loading states
  loadingChannels: Set<string>;
  setLoading: (channelId: string, loading: boolean) => void;
  hasMore: Record<string, boolean>;
  setHasMore: (channelId: string, hasMore: boolean) => void;

  // Reset
  reset: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messagesByChannel: {},
  threadMessages: {},
  loadingChannels: new Set(),
  hasMore: {},

  setMessages: (channelId, messages) =>
    set((state) => {
      // Merge with any WebSocket messages that might have arrived
      const existing = state.messagesByChannel[channelId] || [];
      const messageIds = new Set(messages.map((m) => m.id));
      // Keep any messages that aren't in the API response (they're newer from WebSocket)
      const newerFromWs = existing.filter((m) => !messageIds.has(m.id));
      // Combine and sort by created_at
      const merged = [...messages, ...newerFromWs].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: merged,
        },
      };
    }),

  addMessage: (channelId, message) =>
    set((state) => {
      const existing = state.messagesByChannel[channelId] || [];
      // Avoid duplicates
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: [...existing, message],
        },
      };
    }),

  prependMessages: (channelId, messages) =>
    set((state) => {
      const existing = state.messagesByChannel[channelId] || [];
      const existingIds = new Set(existing.map((m) => m.id));
      const newMessages = messages.filter((m) => !existingIds.has(m.id));
      return {
        messagesByChannel: {
          ...state.messagesByChannel,
          [channelId]: [...newMessages, ...existing],
        },
      };
    }),

  setThreadMessages: (threadId, messages) =>
    set((state) => ({
      threadMessages: {
        ...state.threadMessages,
        [threadId]: messages,
      },
    })),

  addThreadMessage: (threadId, message) =>
    set((state) => {
      const existing = state.threadMessages[threadId] || [];
      if (existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        threadMessages: {
          ...state.threadMessages,
          [threadId]: [...existing, message],
        },
      };
    }),

  setLoading: (channelId, loading) =>
    set((state) => {
      const newSet = new Set(state.loadingChannels);
      if (loading) {
        newSet.add(channelId);
      } else {
        newSet.delete(channelId);
      }
      return { loadingChannels: newSet };
    }),

  setHasMore: (channelId, hasMore) =>
    set((state) => ({
      hasMore: {
        ...state.hasMore,
        [channelId]: hasMore,
      },
    })),

  reset: () =>
    set({
      messagesByChannel: {},
      threadMessages: {},
      loadingChannels: new Set(),
      hasMore: {},
    }),
}));
