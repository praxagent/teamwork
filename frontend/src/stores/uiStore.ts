import { create } from 'zustand';
import type { Agent } from '@/types';

interface TypingAgent {
  agent_id: string;
  agent_name: string;
}

interface CEOProfile {
  name: string;
  photoUrl: string | null;
}

interface UIState {
  // CEO Profile
  ceoProfile: CEOProfile;
  setCeoName: (name: string) => void;
  setCeoPhoto: (url: string | null) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Profile modal
  selectedAgent: Agent | null;
  setSelectedAgent: (agent: Agent | null) => void;

  // Thread panel
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;

  // Onboarding
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;

  // Notifications
  unreadCounts: Record<string, number>;
  setUnreadCount: (channelId: string, count: number) => void;
  incrementUnread: (channelId: string) => void;
  clearUnread: (channelId: string) => void;

  // Activity panel
  showActivityPanel: boolean;
  toggleActivityPanel: () => void;

  // Typing indicators - maps channel_id to list of typing agents
  typingAgents: Record<string, TypingAgent[]>;
  setAgentTyping: (channelId: string, agentId: string, agentName: string, isTyping: boolean) => void;
}

// Load CEO profile from localStorage
const loadCeoProfile = (): CEOProfile => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('ceoProfile');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
  }
  return { name: 'CEO', photoUrl: null };
};

export const useUIStore = create<UIState>((set) => ({
  ceoProfile: loadCeoProfile(),
  setCeoName: (name) => set((state) => {
    const newProfile = { ...state.ceoProfile, name };
    localStorage.setItem('ceoProfile', JSON.stringify(newProfile));
    return { ceoProfile: newProfile };
  }),
  setCeoPhoto: (url) => set((state) => {
    const newProfile = { ...state.ceoProfile, photoUrl: url };
    localStorage.setItem('ceoProfile', JSON.stringify(newProfile));
    return { ceoProfile: newProfile };
  }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  selectedAgent: null,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  activeThreadId: null,
  setActiveThreadId: (id) => set({ activeThreadId: id }),

  onboardingStep: 0,
  setOnboardingStep: (step) => set({ onboardingStep: step }),

  unreadCounts: {},
  setUnreadCount: (channelId, count) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [channelId]: count },
    })),
  incrementUnread: (channelId) =>
    set((state) => ({
      unreadCounts: {
        ...state.unreadCounts,
        [channelId]: (state.unreadCounts[channelId] || 0) + 1,
      },
    })),
  clearUnread: (channelId) =>
    set((state) => ({
      unreadCounts: { ...state.unreadCounts, [channelId]: 0 },
    })),

  showActivityPanel: false,
  toggleActivityPanel: () =>
    set((state) => ({ showActivityPanel: !state.showActivityPanel })),

  typingAgents: {},
  setAgentTyping: (channelId, agentId, agentName, isTyping) =>
    set((state) => {
      const currentTyping = state.typingAgents[channelId] || [];
      
      if (isTyping) {
        // Add agent if not already typing
        if (!currentTyping.some((a) => a.agent_id === agentId)) {
          return {
            typingAgents: {
              ...state.typingAgents,
              [channelId]: [...currentTyping, { agent_id: agentId, agent_name: agentName }],
            },
          };
        }
      } else {
        // Remove agent from typing
        return {
          typingAgents: {
            ...state.typingAgents,
            [channelId]: currentTyping.filter((a) => a.agent_id !== agentId),
          },
        };
      }
      return state;
    }),
}));
