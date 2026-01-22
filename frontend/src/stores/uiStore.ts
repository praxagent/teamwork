import { create } from 'zustand';
import type { Agent } from '@/types';

interface TypingAgent {
  agent_id: string;
  agent_name: string;
}

interface UserProfile {
  name: string;
  photoUrl: string | null;
}

// User role labels based on project type
export type UserRole = 'ceo' | 'student';

interface UIState {
  // Dark mode
  darkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (dark: boolean) => void;

  // User Profile (was CEO Profile)
  userProfile: UserProfile;
  userRole: UserRole;
  setUserName: (name: string) => void;
  setUserPhoto: (url: string | null) => void;
  setUserRole: (role: UserRole) => void;
  
  // Legacy alias for backwards compatibility
  ceoProfile: UserProfile;
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

// Load user profile from localStorage
const loadUserProfile = (): UserProfile => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('userProfile') || localStorage.getItem('ceoProfile');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
  }
  return { name: 'You', photoUrl: null };
};

// Get display label for user based on role
export const getUserLabel = (role: UserRole, name?: string): string => {
  const displayName = name || 'You';
  switch (role) {
    case 'student':
      return displayName === 'You' ? 'You' : `${displayName} (You)`;
    case 'ceo':
    default:
      return displayName === 'You' ? 'CEO (You)' : `${displayName} (You)`;
  }
};

// Load dark mode preference
const loadDarkMode = (): boolean => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) {
      return saved === 'true';
    }
    // Default to system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
};

// Apply dark mode to document
const applyDarkMode = (dark: boolean) => {
  if (typeof document !== 'undefined') {
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
};

// Initialize dark mode on load
if (typeof window !== 'undefined') {
  applyDarkMode(loadDarkMode());
}

export const useUIStore = create<UIState>((set) => ({
  // Dark mode
  darkMode: loadDarkMode(),
  toggleDarkMode: () => set((state) => {
    const newDark = !state.darkMode;
    localStorage.setItem('darkMode', String(newDark));
    applyDarkMode(newDark);
    return { darkMode: newDark };
  }),
  setDarkMode: (dark) => {
    localStorage.setItem('darkMode', String(dark));
    applyDarkMode(dark);
    return set({ darkMode: dark });
  },

  userProfile: loadUserProfile(),
  userRole: 'ceo' as UserRole,
  setUserName: (name) => set((state) => {
    const newProfile = { ...state.userProfile, name };
    localStorage.setItem('userProfile', JSON.stringify(newProfile));
    return { userProfile: newProfile, ceoProfile: newProfile };
  }),
  setUserPhoto: (url) => set((state) => {
    const newProfile = { ...state.userProfile, photoUrl: url };
    localStorage.setItem('userProfile', JSON.stringify(newProfile));
    return { userProfile: newProfile, ceoProfile: newProfile };
  }),
  setUserRole: (role) => set({ userRole: role }),
  
  // Legacy aliases
  ceoProfile: loadUserProfile(),
  setCeoName: (name) => set((state) => {
    const newProfile = { ...state.userProfile, name };
    localStorage.setItem('userProfile', JSON.stringify(newProfile));
    return { userProfile: newProfile, ceoProfile: newProfile };
  }),
  setCeoPhoto: (url) => set((state) => {
    const newProfile = { ...state.userProfile, photoUrl: url };
    localStorage.setItem('userProfile', JSON.stringify(newProfile));
    return { userProfile: newProfile, ceoProfile: newProfile };
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
