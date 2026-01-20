import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WebSocketEvent } from '@/types';
import { useProjectStore, useMessageStore, useUIStore } from '@/stores';

type MessageHandler = (event: WebSocketEvent) => void;

const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimeout: number | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private subscribedProjects: Set<string> = new Set();
  private subscribedChannels: Set<string> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      // Re-subscribe to previous subscriptions
      this.subscribedProjects.forEach((id) => this.subscribeToProject(id));
      this.subscribedChannels.forEach((id) => this.subscribeToChannel(id));
    };

    this.ws.onmessage = (event) => {
      try {
        const data: WebSocketEvent = JSON.parse(event.data);
        this.handlers.forEach((handler) => handler(data));
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  addHandler(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribeToProject(projectId: string) {
    this.subscribedProjects.add(projectId);
    this.send({ action: 'subscribe_project', id: projectId });
  }

  unsubscribeFromProject(projectId: string) {
    this.subscribedProjects.delete(projectId);
    this.send({ action: 'unsubscribe_project', id: projectId });
  }

  subscribeToChannel(channelId: string) {
    this.subscribedChannels.add(channelId);
    this.send({ action: 'subscribe_channel', id: channelId });
  }

  unsubscribeFromChannel(channelId: string) {
    this.subscribedChannels.delete(channelId);
    this.send({ action: 'unsubscribe_channel', id: channelId });
  }

  private send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
}

// Singleton instance
const wsManager = new WebSocketManager();

export function useWebSocket() {
  const queryClient = useQueryClient();
  const updateAgent = useProjectStore((state) => state.updateAgent);
  const addChannel = useProjectStore((state) => state.addChannel);
  const updateTask = useProjectStore((state) => state.updateTask);
  const addTask = useProjectStore((state) => state.addTask);
  const addMessage = useMessageStore((state) => state.addMessage);
  const setAgentTyping = useUIStore((state) => state.setAgentTyping);

  useEffect(() => {
    wsManager.connect();

    const removeHandler = wsManager.addHandler((event) => {
      switch (event.type) {
        case 'message:new': {
          const channelId = event.channelId || (event.data.channel_id as string);
          if (channelId) {
            addMessage(channelId, {
              id: event.data.id as string,
              channel_id: channelId,
              agent_id: event.data.agent_id as string | null,
              agent_name: event.data.agent_name as string | null,
              agent_role: null,
              content: event.data.content as string,
              message_type: (event.data.message_type as string) || 'chat',
              metadata: null,
              thread_id: event.data.thread_id as string | null,
              reply_count: 0,
              created_at: event.data.created_at as string,
              updated_at: null,
            });
          }
          break;
        }

        case 'agent:status': {
          const agentData = event.data;
          updateAgent({
            id: agentData.agent_id as string,
            status: agentData.status as 'idle' | 'working' | 'blocked' | 'offline',
          } as any);
          break;
        }

        case 'agent:typing': {
          const typingData = event.data;
          const channelId = typingData.channel_id as string;
          const agentId = typingData.agent_id as string;
          const agentName = typingData.agent_name as string;
          const isTyping = typingData.is_typing as boolean;
          
          setAgentTyping(channelId, agentId, agentName, isTyping);
          break;
        }

        case 'channel:new': {
          addChannel(event.data as any);
          break;
        }

        case 'task:update': {
          updateTask(event.data as any);
          // Invalidate React Query cache for immediate UI update
          const projectId = event.data.project_id;
          if (projectId) {
            queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
          }
          break;
        }

        case 'task:new': {
          addTask(event.data as any);
          // Invalidate React Query cache for immediate UI update
          const projectId = event.data.project_id;
          if (projectId) {
            queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
          }
          break;
        }
      }
    });

    return () => {
      removeHandler();
    };
  }, [queryClient, updateAgent, addChannel, updateTask, addTask, addMessage, setAgentTyping]);

  const subscribeToProject = useCallback((projectId: string) => {
    wsManager.subscribeToProject(projectId);
    return () => wsManager.unsubscribeFromProject(projectId);
  }, []);

  const subscribeToChannel = useCallback((channelId: string) => {
    wsManager.subscribeToChannel(channelId);
    return () => wsManager.unsubscribeFromChannel(channelId);
  }, []);

  return {
    subscribeToProject,
    subscribeToChannel,
  };
}

export function useChannelSubscription(channelId: string | null) {
  const { subscribeToChannel } = useWebSocket();

  useEffect(() => {
    if (!channelId) return;
    return subscribeToChannel(channelId);
  }, [channelId, subscribeToChannel]);
}

export function useProjectSubscription(projectId: string | null) {
  const { subscribeToProject } = useWebSocket();

  useEffect(() => {
    if (!projectId) return;
    return subscribeToProject(projectId);
  }, [projectId, subscribeToProject]);
}
