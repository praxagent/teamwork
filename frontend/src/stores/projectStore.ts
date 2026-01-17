import { create } from 'zustand';
import type { Project, Agent, Channel, Task } from '@/types';

interface ProjectState {
  // Current project
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;

  // Agents
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;
  updateAgent: (agentUpdate: Partial<Agent> & { id: string }) => void;

  // Channels
  channels: Channel[];
  setChannels: (channels: Channel[]) => void;
  addChannel: (channel: Channel) => void;
  currentChannelId: string | null;
  setCurrentChannelId: (id: string | null) => void;

  // Tasks
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  updateTask: (task: Task) => void;
  addTask: (task: Task) => void;

  // Reset
  reset: () => void;
}

const initialState = {
  currentProject: null,
  agents: [],
  channels: [],
  currentChannelId: null,
  tasks: [],
};

export const useProjectStore = create<ProjectState>((set) => ({
  ...initialState,

  setCurrentProject: (project) => set({ currentProject: project }),

  setAgents: (agents) => set({ agents }),
  updateAgent: (agentUpdate) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentUpdate.id ? { ...a, ...agentUpdate } : a
      ),
    })),

  setChannels: (channels) => set({ channels }),
  addChannel: (channel) =>
    set((state) => ({
      channels: [...state.channels, channel],
    })),
  setCurrentChannelId: (id) => set({ currentChannelId: id }),

  setTasks: (tasks) => set({ tasks }),
  updateTask: (task) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
    })),
  addTask: (task) =>
    set((state) => ({
      tasks: [...state.tasks, task],
    })),

  reset: () => set(initialState),
}));
