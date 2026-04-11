import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Project,
  Agent,
  Attachment,
  Channel,
  Message,
  Task,
  ActivityLog,
  ClarifyingQuestionsResponse,
  OnboardingStatus,
  TeamMemberSuggestion,
} from '@/types';

const API_BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Request failed: ${response.status}`);
  }

  return response.json();
}

// Projects
export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () =>
      fetchJson<{ projects: Project[]; total: number }>('/projects'),
  });
}

export function useProject(projectId: string | null) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchJson<Project>(`/projects/${projectId}`),
    enabled: !!projectId,
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`${API_BASE}/projects/${projectId}`, { 
        method: 'DELETE' 
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `Delete failed: ${response.status}`);
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useResetProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const response = await fetch(`${API_BASE}/projects/${projectId}/reset`, { 
        method: 'POST' 
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `Reset failed: ${response.status}`);
      }
      return response.json();
    },
    onMutate: async (projectId) => {
      // OPTIMISTIC UPDATE: Clear messages immediately before server responds
      // This makes the UI feel instant while the actual reset happens
      
      // Cancel any in-flight queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['messages'] });
      await queryClient.cancelQueries({ queryKey: ['tasks', projectId] });
      
      // Get all query keys that start with 'messages' and clear them
      const queryCache = queryClient.getQueryCache();
      const messageQueries = queryCache.findAll({ queryKey: ['messages'] });
      
      // Clear each message query immediately
      for (const query of messageQueries) {
        queryClient.setQueryData(query.queryKey, { messages: [], total: 0, has_more: false });
      }
      
      // Also reset tasks to pending status optimistically
      const tasksData = queryClient.getQueryData<{ tasks: Task[]; total: number }>(['tasks', projectId]);
      if (tasksData) {
        queryClient.setQueryData(['tasks', projectId], {
          ...tasksData,
          tasks: tasksData.tasks.map((t: Task) => ({ ...t, status: 'pending', assigned_to: null })),
        });
      }
    },
    onSuccess: (_, projectId) => {
      // Force refetch all project-related queries from server
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] });
      // Force refetch messages (they should now be empty from server)
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      // Also clear live sessions
      queryClient.invalidateQueries({ queryKey: ['live-sessions', projectId] });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      fetchJson<Project>('/projects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useUpdateProjectConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      projectId: string;
      auto_execute_tasks?: boolean;
      runtime_mode?: string;
      workspace_type?: string;
      model_mode?: string;  // auto, sonnet, haiku, hybrid
    }) => {
      const { projectId, ...config } = data;
      return fetchJson<Project>(`/projects/${projectId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(config),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      projectId: string;
      name?: string;
      description?: string;
    }) => {
      const { projectId, ...updates } = data;
      return fetchJson<Project>(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

interface PauseResumeResponse {
  success: boolean;
  status: string;
  agents_affected: number;
  message: string;
}

export function usePauseProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      fetchJson<PauseResumeResponse>(`/projects/${projectId}/pause`, {
        method: 'POST',
      }),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] });
    },
  });
}

export function useResumeProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      fetchJson<PauseResumeResponse>(`/projects/${projectId}/resume`, {
        method: 'POST',
      }),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] });
    },
  });
}

// Agents
export function useAgents(projectId: string | null) {
  return useQuery({
    queryKey: ['agents', projectId],
    queryFn: () =>
      fetchJson<{ agents: Agent[]; total: number }>(
        `/agents?project_id=${projectId}`
      ),
    enabled: !!projectId,
    // Poll every 10 seconds to keep agent statuses up-to-date
    refetchInterval: 10000,
  });
}

export function useAgent(agentId: string | null) {
  return useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => fetchJson<Agent>(`/agents/${agentId}`),
    enabled: !!agentId,
  });
}

export function useAgentActivity(agentId: string | null, limit = 50) {
  return useQuery({
    queryKey: ['agent-activity', agentId, limit],
    queryFn: () =>
      fetchJson<ActivityLog[]>(`/agents/${agentId}/activity?limit=${limit}`),
    enabled: !!agentId,
  });
}

// Channels
export function useChannels(projectId: string | null) {
  return useQuery({
    queryKey: ['channels', projectId],
    queryFn: () =>
      fetchJson<{ channels: Channel[]; total: number }>(
        `/channels?project_id=${projectId}`
      ),
    enabled: !!projectId,
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      project_id: string;
      name: string;
      type?: string;
      team?: string;
      description?: string;
    }) =>
      fetchJson<Channel>('/channels', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['channels', variables.project_id],
      });
    },
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...data }: { channelId: string; name?: string; description?: string }) =>
      fetchJson<Channel>(`/channels/${channelId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}

// Backward compat alias
export const useRenameChannel = useUpdateChannel;

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ channelId, purgeMessages = true }: { channelId: string; purgeMessages?: boolean }) => {
      const resp = await fetch(`${API_BASE}/channels/${channelId}?purge_messages=${purgeMessages}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error('Failed to delete channel');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
  });
}

export function useGetOrCreateDMChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { agentId: string; projectId: string }) =>
      fetchJson<Channel>(
        `/channels/dm/${data.agentId}?project_id=${data.projectId}`,
        { method: 'POST' }
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['channels', variables.projectId],
      });
    },
  });
}

export function useGetOrCreatePanelChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { projectId: string; panel: string }) =>
      fetchJson<Channel>(
        '/channels/panels/get-or-create',
        {
          method: 'POST',
          body: JSON.stringify({ project_id: data.projectId, panel: data.panel }),
        }
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['channels', variables.projectId],
      });
    },
  });
}

export function useClearChannelMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (channelId: string) =>
      fetch(`${API_BASE}/channels/${channelId}/messages`, { method: 'DELETE' })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to clear messages: ${res.status}`);
        }),
    onSuccess: (_, channelId) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', channelId],
      });
    },
  });
}

// Messages
export function useMessages(channelId: string | null, skip = 0, limit = 50) {
  return useQuery({
    queryKey: ['messages', channelId, skip, limit],
    queryFn: () =>
      fetchJson<{ messages: Message[]; total: number; has_more: boolean }>(
        `/messages/channel/${channelId}?skip=${skip}&limit=${limit}`
      ),
    enabled: !!channelId,
    staleTime: 30_000, // 30s — WebSocket handles live updates
    refetchOnMount: true,
    refetchOnWindowFocus: false, // WebSocket keeps messages current
  });
}

export function useLoadOlderMessages() {
  return useMutation({
    mutationFn: ({ channelId, skip, limit = 50 }: { channelId: string; skip: number; limit?: number }) =>
      fetchJson<{ messages: Message[]; total: number; has_more: boolean }>(
        `/messages/channel/${channelId}?skip=${skip}&limit=${limit}`
      ),
  });
}

export function useThreadMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['thread', threadId],
    queryFn: () =>
      fetchJson<{ messages: Message[]; total: number; has_more: boolean }>(
        `/messages/${threadId}/thread`
      ),
    enabled: !!threadId,
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      channel_id: string;
      content: string;
      agent_id?: string;
      message_type?: string;
      thread_id?: string;
      active_view?: string;
      extra_data?: Record<string, unknown>;
    }) =>
      fetchJson<Message>('/messages', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (message) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', message.channel_id],
      });
      if (message.thread_id) {
        queryClient.invalidateQueries({
          queryKey: ['thread', message.thread_id],
        });
      }
    },
  });
}

// File uploads
export function useUploadFile() {
  return useMutation({
    mutationFn: async (data: { projectId: string; file: File }): Promise<Attachment> => {
      const formData = new FormData();
      formData.append('file', data.file);
      const response = await fetch(`${API_BASE}/uploads/${data.projectId}`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || `Upload failed: ${response.status}`);
      }
      return response.json();
    },
  });
}

// Search
export interface SearchResult {
  message_id: string;
  channel_id: string;
  channel_name: string;
  agent_name: string | null;
  content: string;
  created_at: string;
}

export async function searchMessages(projectId: string, query: string, limit = 15): Promise<{ results: SearchResult[]; total: number }> {
  return fetchJson<{ results: SearchResult[]; total: number }>(
    `/messages/search?q=${encodeURIComponent(query)}&project_id=${encodeURIComponent(projectId)}&limit=${limit}`
  );
}

// Reactions
export function useToggleReaction() {
  return useMutation({
    mutationFn: (data: { messageId: string; emoji: string; userName: string }) =>
      fetchJson<{ reactions: Record<string, string[]> }>(`/messages/${data.messageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji: data.emoji, user_name: data.userName }),
      }),
  });
}

// Tasks
export function useTasks(projectId: string | null) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () =>
      fetchJson<{ tasks: Task[]; total: number }>(
        `/tasks?project_id=${projectId}&parent_only=false`
      ),
    enabled: !!projectId,
    staleTime: 2000, // Consider data fresh for 2 seconds (WebSocket handles real-time updates)
    refetchInterval: 30000, // Poll every 30 seconds as backup (WebSocket is primary)
    refetchOnMount: true, // Always refetch on mount for fresh data
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      project_id: string;
      title: string;
      description?: string;
      team?: string;
      priority?: number;
    }) =>
      fetchJson<Task>('/tasks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.project_id] });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      ...data
    }: {
      taskId: string;
      title?: string;
      description?: string;
      status?: string;
      assigned_to?: string;
    }) =>
      fetchJson<Task>(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', task.project_id] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, projectId }: { taskId: string; projectId: string }) =>
      fetch(`${API_BASE}/tasks/${taskId}`, {
        method: 'DELETE',
      }).then((res) => {
        if (!res.ok) throw new Error('Failed to delete task');
        return { taskId, projectId };
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] });
    },
  });
}

// Onboarding
export function useStartOnboarding() {
  return useMutation({
    mutationFn: (data: { description: string; team_type?: 'software' | 'coaching' }) =>
      fetchJson<ClarifyingQuestionsResponse>('/onboarding/start', {
        method: 'POST',
        body: JSON.stringify({
          description: data.description,
          team_type: data.team_type || 'software',
        }),
      }),
  });
}

export function useSubmitAnswers() {
  return useMutation({
    mutationFn: (data: { project_id: string; answers: string[] }) =>
      fetchJson<{
        components: Array<Record<string, unknown>>;
        teams: string[];
        suggested_team_members: TeamMemberSuggestion[];
      }>('/onboarding/answers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useAutoAnswerQuestions() {
  return useMutation({
    mutationFn: (projectId: string) =>
      fetchJson<{ answers: string[] }>(`/onboarding/auto-answer?project_id=${projectId}`, {
        method: 'POST',
      }),
  });
}

export function useShuffleMember() {
  return useMutation({
    mutationFn: (data: { project_id: string; member_index: number }) =>
      fetchJson<TeamMemberSuggestion>('/onboarding/shuffle-member', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useUpdateMember() {
  return useMutation({
    mutationFn: (data: { 
      project_id: string; 
      member_index: number;
      name: string;
      personality_summary: string;
      profile_image_type: string;
    }) =>
      fetchJson<TeamMemberSuggestion>('/onboarding/update-member', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useGenerateMoreMembers() {
  return useMutation({
    mutationFn: (data: { project_id: string; count: number }) =>
      fetchJson<{ new_members: TeamMemberSuggestion[]; total_count: number }>('/onboarding/generate-more-members', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  });
}

export function useFinalizeProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      project_id: string;
      config: {
        runtime_mode: string;
        workspace_type: string;
        auto_execute_tasks?: boolean;
        claude_code_mode?: 'terminal' | 'programmatic';
      };
      generate_images?: boolean;
      team_size?: number;
    }) =>
      fetchJson<OnboardingStatus>('/onboarding/finalize', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useOnboardingStatus(projectId: string | null) {
  return useQuery({
    queryKey: ['onboarding-status', projectId],
    queryFn: () => fetchJson<OnboardingStatus>(`/onboarding/status/${projectId}`),
    enabled: !!projectId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Keep polling if still generating
      if (data?.step === 'generating') {
        return 2000;
      }
      return false;
    },
  });
}

// Agent Control
export interface StartAgentResponse {
  success: boolean;
  message: string;
  claude_code_available: boolean;
}

export function useStartAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson<StartAgentResponse>(`/agents/${agentId}/start`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useStartAllAgents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (projectId: string) =>
      fetchJson<StartAgentResponse[]>(`/agents/project/${projectId}/start-all`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

// Agent Takeover
export interface TakeoverResponse {
  success: boolean;
  message: string;
  container_name: string | null;
  workspace_path: string | null;
}

export function useTakeoverAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson<TakeoverResponse>(`/agents/${agentId}/takeover`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['live-sessions'] });
    },
  });
}

export function useReleaseAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) =>
      fetchJson<{ success: boolean; message: string }>(`/agents/${agentId}/release`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['live-sessions'] });
    },
  });
}

// Task Execution
export interface ExecuteTaskResponse {
  success: boolean;
  message: string;
  response: string | null;
}

export function useExecuteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { taskId: string; agentId: string }) =>
      fetchJson<ExecuteTaskResponse>(`/tasks/${data.taskId}/execute`, {
        method: 'POST',
        body: JSON.stringify({ agent_id: data.agentId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
    },
  });
}

// Workspace Files
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  children?: FileNode[];
}

export function useWorkspaceFiles(projectId: string | null) {
  return useQuery({
    queryKey: ['workspace', projectId],
    queryFn: () => fetchJson<{ files: FileNode[] }>(`/workspace/${projectId}/files`),
    enabled: !!projectId,
  });
}

export function useFileContent(projectId: string | null, filePath: string | null) {
  return useQuery({
    queryKey: ['file-content', projectId, filePath],
    queryFn: () =>
      fetchJson<{ content: string; language: string }>(
        `/workspace/${projectId}/file?path=${encodeURIComponent(filePath || '')}`
      ),
    enabled: !!projectId && !!filePath,
  });
}

// Save file content
export interface SaveFileResponse {
  success: boolean;
  path: string;
  message: string;
}

export function useSaveFile(projectId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { path: string; content: string }) =>
      fetchJson<SaveFileResponse>(`/workspace/${projectId}/file`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      // Invalidate the file content cache for this file
      queryClient.invalidateQueries({ queryKey: ['file-content', projectId, variables.path] });
      // Also invalidate workspace files in case of new file
      queryClient.invalidateQueries({ queryKey: ['workspace', projectId] });
    },
  });
}

// Execute code from chat
export interface CodeResponse {
  success: boolean;
  message: string;
  response: string | null;
}

export function useExecuteCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { agentId: string; request: string; channelId: string }) =>
      fetchJson<CodeResponse>(`/agents/${data.agentId}/code`, {
        method: 'POST',
        body: JSON.stringify({
          request: data.request,
          channel_id: data.channelId,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

// Task Diff (code changes)
export interface FileDiff {
  path: string;
  old_path: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  diff: string;
}

export interface TaskDiffResponse {
  task_id: string;
  task_title: string;
  start_commit: string | null;
  end_commit: string | null;
  files_changed: number;
  total_additions: number;
  total_deletions: number;
  files: FileDiff[];
  commits: {
    hash: string;
    author: string;
    timestamp: number;
    message: string;
  }[];
  error: string | null;
}

export function useTaskDiff(projectId: string | null, taskId: string | null) {
  return useQuery({
    queryKey: ['task-diff', projectId, taskId],
    queryFn: () =>
      fetchJson<TaskDiffResponse>(`/workspace/${projectId}/task/${taskId}/diff`),
    enabled: !!projectId && !!taskId,
  });
}

// Task Execution Logs
export interface TaskLogEntry {
  id: string;
  agent_id: string;
  agent_name: string | null;
  activity_type: string;
  description: string;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

export interface TaskLogsResponse {
  task_id: string;
  task_title: string;
  task_status: string;
  assigned_to: string | null;
  assigned_agent_name: string | null;
  logs: TaskLogEntry[];
}

export function useTaskLogs(taskId: string | null) {
  return useQuery({
    queryKey: ['task-logs', taskId],
    queryFn: () => fetchJson<TaskLogsResponse>(`/tasks/${taskId}/logs`),
    enabled: !!taskId,
  });
}

// Agent Execution Logs
export interface AgentLogEntry {
  id: string;
  activity_type: string;
  description: string;
  extra_data: Record<string, unknown> | null;
  created_at: string;
}

export interface AgentLogsResponse {
  agent_id: string;
  agent_name: string;
  agent_role: string;
  logs: AgentLogEntry[];
}

export function useAgentLogs(agentId: string | null) {
  return useQuery({
    queryKey: ['agent-logs', agentId],
    queryFn: () => fetchJson<AgentLogsResponse>(`/agents/${agentId}/logs`),
    enabled: !!agentId,
  });
}

// Live Claude Code Output
export interface LiveOutputResponse {
  agent_id: string;
  agent_name: string;
  status: 'running' | 'completed' | 'timeout' | 'error' | 'idle' | 'initializing' | 'preparing' | 'invoking' | 'stale_reset' | 'stopped' | 'failed' | 'retry_loop' | 'startup_failed';
  output: string | null;
  last_update: string | null;
  started_at: string | null;
  error: string | null;
}

export function useAgentLiveOutput(agentId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['agent-live-output', agentId],
    queryFn: () => fetchJson<LiveOutputResponse>(`/agents/${agentId}/live-output`),
    enabled: !!agentId && enabled,
    refetchInterval: 5000, // Poll every 5 seconds (was 1s — caused UI jank on mobile)
    staleTime: 3000,
  });
}

// Execution Graphs
export interface GraphNode {
  span_id: string;
  name: string;
  parent_id: string | null;
  status: string;
  spoke_or_category: string;
  started_at: string;
  finished_at: string | null;
  tool_calls: number;
  summary: string;
  duration_s: number;
  trace_id?: string;
}

export interface ExecutionGraph {
  trace_id: string;
  status: string;
  node_count: number;
  nodes: GraphNode[];
  trigger?: string;
  session_id?: string;
}

export function useExecutionGraphs(enabled: boolean = true) {
  return useQuery({
    queryKey: ['execution-graphs'],
    queryFn: () => fetchJson<{ graphs: ExecutionGraph[]; total: number }>('/agents/graphs/active'),
    enabled,
    // Fast poll while any graph is running, slow poll otherwise
    refetchInterval: (query) => {
      const graphs = query.state.data?.graphs;
      const hasRunning = graphs?.some((g: ExecutionGraph) => g.status === 'running');
      return hasRunning ? 2000 : 30000;
    },
    staleTime: 1000,
  });
}

export function useDeleteExecutionGraph() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (traceId: string) =>
      fetchJson<{ ok: boolean }>(`/agents/graphs/${traceId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['execution-graphs'] });
    },
  });
}

export function useMoveGraphSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ traceId, sessionId }: { traceId: string; sessionId: string }) =>
      fetchJson<{ ok: boolean }>(`/agents/graphs/${traceId}/session`, {
        method: 'PATCH',
        body: JSON.stringify({ session_id: sessionId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['execution-graphs'] });
    },
  });
}

// System Capabilities
export interface SystemCapabilities {
  image_generation_available: boolean;
  claude_code_available: boolean;
  anthropic_configured: boolean;
  openai_configured: boolean;
}

export function useSystemCapabilities() {
  return useQuery({
    queryKey: ['system-capabilities'],
    queryFn: () => fetchJson<SystemCapabilities>('/onboarding/capabilities'),
    staleTime: 60000, // Cache for 1 minute
  });
}

// Update Agent Profile Image
export function useUpdateAgentProfileImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      agentId: string;
      imageData: string;  // Base64 data (can include data URL prefix)
      imageType?: string;
    }) => {
      return fetchJson<Agent>(`/agents/${data.agentId}/profile-image`, {
        method: 'PATCH',
        body: JSON.stringify({
          image_data: data.imageData,
          image_type: data.imageType,
        }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', variables.agentId] });
    },
  });
}

export function useRemoveAgentProfileImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) => {
      return fetchJson<Agent>(`/agents/${agentId}/profile-image`, {
        method: 'DELETE',
      });
    },
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Model Picker
// ---------------------------------------------------------------------------

export interface ModelInfo {
  current_model: string;
  current_tier: string;
  override: string | null;
  available: Array<{ tier: string; model: string }>;
}

export function useCurrentModel() {
  return useQuery({
    queryKey: ['current-model'],
    queryFn: () => fetchJson<ModelInfo>('/prax/model'),
    staleTime: 10000,
  });
}

export function useSetModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string) =>
      fetchJson<{ override: string | null; message: string }>('/prax/model', {
        method: 'PUT',
        body: JSON.stringify({ model }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['current-model'] });
      queryClient.invalidateQueries({ queryKey: ['context-stats'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Context Inspector
// ---------------------------------------------------------------------------

export interface ContextStats {
  history_messages: number;
  history_tokens: number;
  system_prompt_tokens: number;
  total_tokens: number;
  context_limit: number;
  current_model: string;
  current_tier: string;
  limits: Record<string, number>;
}

export function useContextStats() {
  return useQuery({
    queryKey: ['context-stats'],
    queryFn: () => fetchJson<ContextStats>('/prax/context/stats'),
    staleTime: 15000,
  });
}

export function useCompactContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchJson<{
        compacted: boolean;
        dry_run?: boolean;
        before_tokens?: number;
        after_tokens?: number;
        messages_before?: number;
        messages_after?: number;
        savings_tokens?: number;
        reason?: string;
      }>('/prax/context/compact', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['context-stats'] });
    },
  });
}

// Agent Prompts - stored in .agents/{agent-name}/ folder
export interface AgentPrompts {
  soul_prompt: string | null;
  skills_prompt: string | null;
  source: 'database' | 'file' | 'mixed';
}

export function useAgentPrompts(agentId: string | null) {
  return useQuery({
    queryKey: ['agent-prompts', agentId],
    queryFn: () => fetchJson<AgentPrompts>(`/agents/${agentId}/prompts`),
    enabled: !!agentId,
  });
}

export function useUpdateAgentPrompts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      agentId: string;
      soul_prompt?: string;
      skills_prompt?: string;
    }) => {
      const { agentId, ...body } = data;
      return fetchJson<{ success: boolean; message: string; path: string }>(
        `/agents/${agentId}/prompts`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        }
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-prompts', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useInitAgentPrompts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: string) => {
      return fetchJson<{ success: boolean; message: string; path: string }>(
        `/agents/${agentId}/prompts/init`,
        { method: 'POST' }
      );
    },
    onSuccess: (_, agentId) => {
      queryClient.invalidateQueries({ queryKey: ['agent-prompts', agentId] });
    },
  });
}

// Coaching Progress
export interface CoachingProgressOverview {
  content: string;
  topics: string[];  // Legacy - topic slugs
  coaches: string[]; // New - coach folder names
}

export interface CoachProgress {
  coach: string;
  soul: string | null;  // Coach's personality prompt (EDITABLE!)
  skills: string | null;  // Coach's skills/expertise prompt (EDITABLE!)
  progress: string | null;
  learnings: string | null;
  strengths: string | null;
  improvements: string | null;
  summary: string | null;
  resources: string | null;
  vocabulary: string | null;
  topics_covered: string | null;
  ratings: string | null;
}

export interface TopicProgress {
  topic: string;
  content: string;
}

export function useCoachingProgress(projectId: string | null) {
  return useQuery({
    queryKey: ['coaching-progress', projectId],
    queryFn: () => fetchJson<CoachingProgressOverview>(`/coaching/progress/${projectId}`),
    enabled: !!projectId,
  });
}

export function useTopicProgress(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: ['topic-progress', projectId, topic],
    queryFn: () => fetchJson<TopicProgress>(`/coaching/progress/${projectId}/${encodeURIComponent(topic || '')}`),
    enabled: !!projectId && !!topic,
  });
}

export function useCoachProgress(projectId: string | null, coachName: string | null) {
  return useQuery({
    queryKey: ['coach-progress', projectId, coachName],
    queryFn: () => fetchJson<CoachProgress>(`/coaching/coach/${projectId}/${encodeURIComponent(coachName || '')}`),
    enabled: !!projectId && !!coachName,
  });
}

export function useRecordSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      projectId: string;
      topic: string;
      summary: string;
      duration_minutes?: number;
      key_learnings?: string[];
      areas_to_review?: string[];
      mood?: string;
    }) => {
      const { projectId, topic, ...body } = data;
      return fetchJson<{ success: boolean; message: string }>(
        `/coaching/session/${projectId}/${encodeURIComponent(topic)}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['coaching-progress', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['topic-progress', variables.projectId, variables.topic] });
    },
  });
}

export function useUpdateSkillLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      projectId: string;
      topic: string;
      level: string;
      notes?: string;
    }) => {
      const { projectId, topic, ...body } = data;
      return fetchJson<{ success: boolean; message: string }>(
        `/coaching/skill/${projectId}/${encodeURIComponent(topic)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        }
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['coaching-progress', variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ['topic-progress', variables.projectId, variables.topic] });
    },
  });
}

// Vocabulary Tracking
export interface VocabularyData {
  topic: string;
  content: string | null;
  has_vocabulary: boolean;
}

export function useVocabulary(projectId: string | null, topic: string | null) {
  return useQuery({
    queryKey: ['vocabulary', projectId, topic],
    queryFn: () => fetchJson<VocabularyData>(`/coaching/vocabulary/${projectId}/${encodeURIComponent(topic || '')}`),
    enabled: !!projectId && !!topic,
  });
}

// Plugins
export interface PluginInfo {
  name: string;
  url: string;
  subfolder_filter: string | null;
  plugins_found: string[];
  trust_tier: string;
  active_version: string | null;
  security_warnings_acknowledged: boolean;
}

export interface SecurityWarning {
  severity: string;
  pattern: string;
  file: string;
  line: number;
  code: string;
}

export interface PluginImportResult {
  status: string;
  name: string;
  path?: string;
  url?: string;
  security_warnings?: SecurityWarning[];
  requires_acknowledgement?: boolean;
  error?: string;
}

export interface PluginSecurityResult {
  name: string;
  warnings: SecurityWarning[];
}

export function usePlugins() {
  return useQuery({
    queryKey: ['plugins'],
    queryFn: () => fetchJson<PluginInfo[]>('/plugins'),
  });
}

export function useImportPlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      repo_url: string;
      name?: string;
      plugin_subfolder?: string;
    }) =>
      fetchJson<PluginImportResult>('/plugins/import', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });
}

export function useRemovePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      fetch(`${API_BASE}/plugins/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }).then((res) => {
        if (!res.ok) throw new Error('Failed to remove plugin');
        return res.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });
}

export function useUpdatePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      fetchJson<{ status: string; name: string }>(
        `/plugins/${encodeURIComponent(name)}/update`,
        { method: 'POST' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin-check-updates'] });
    },
  });
}

export function useAcknowledgePlugin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) =>
      fetchJson<{ status: string; name: string }>(
        `/plugins/${encodeURIComponent(name)}/acknowledge`,
        { method: 'POST' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });
}

export function usePluginSecurity(name: string | null) {
  return useQuery({
    queryKey: ['plugin-security', name],
    queryFn: () =>
      fetchJson<PluginSecurityResult>(
        `/plugins/${encodeURIComponent(name || '')}/security`
      ),
    enabled: !!name,
  });
}

export interface PluginSkillEntry {
  subfolder: string | null;
  content: string;
  version?: string;
  description?: string;
  tools?: string[];
}

export interface PluginSkillsResult {
  name: string;
  skills?: PluginSkillEntry[];
  // Single-subfolder response shape:
  subfolder?: string;
  content?: string;
  version?: string;
  description?: string;
  tools?: string[];
}

export function usePluginSkills(name: string | null) {
  return useQuery({
    queryKey: ['plugin-skills', name],
    queryFn: () =>
      fetchJson<PluginSkillsResult>(
        `/plugins/${encodeURIComponent(name || '')}/skills`
      ),
    enabled: !!name,
  });
}

export interface PluginUpdateCheck {
  name: string;
  local_commit: string;
  remote_commit: string | null;
  update_available: boolean;
  commits_behind: number;
}

export function useCheckPluginUpdates(name: string | null) {
  return useQuery({
    queryKey: ['plugin-check-updates', name],
    queryFn: () =>
      fetchJson<PluginUpdateCheck>(
        `/plugins/${encodeURIComponent(name || '')}/check-updates`
      ),
    enabled: !!name,
  });
}

export function useCheckAllPluginUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchJson<PluginUpdateCheck[]>('/plugins/check-updates'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });
}

export function useUpdateAllPlugins() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<Array<{ name: string; status?: string; error?: string }>>(
        '/plugins/update-all',
        { method: 'POST' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin-check-updates'] });
    },
  });
}

// Library — Project → Notebook → Note hierarchy
// See docs/library.md in the Prax repo for the design.

export interface LibraryNote {
  slug: string;
  title: string;
  author: 'human' | 'prax';
  project: string;
  notebook: string;
  prax_may_edit: boolean;
  last_edited_by?: string;
  tags?: string[];
  wikilinks?: string[];
  lesson_order?: number;
  status?: 'todo' | 'done';
  created_at?: string;
  updated_at?: string;
}

export interface LibraryNotebook {
  slug: string;
  name: string;
  description?: string;
  project: string;
  note_count: number;
  sequenced?: boolean;
  current_slug?: string;
  progress_percent?: number;
  notes: LibraryNote[];
}

export interface LibrarySpace {
  slug: string;
  name: string;
  description?: string;
  kind?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  target_date?: string;
  started_at?: string;
  pinned?: boolean;
  tasks_enabled?: boolean;
  reminder_channel?: 'all' | 'sms' | 'discord' | 'teamwork';
  /** Optional cover image — relative URL like
   *  /library/spaces/{slug}/cover rendered at runtime. */
  cover_image?: string;
  /** Color theme — hue value (0–360) that shifts all accent colors
   *  for this space.  null = use the global default (indigo = 240). */
  theme_hue?: number | null;
  notebook_count: number;
  progress_percent?: number;
  notebooks: LibraryNotebook[];
}

export interface LibraryTree {
  /** Renamed from `projects` in 2026-04 — the hierarchy is now
   *  TeamWork > Project > Space > Notebook > Note. */
  spaces: LibrarySpace[];
}

export function useLibrary() {
  return useQuery({
    queryKey: ['library'],
    queryFn: () => fetchJson<LibraryTree>('/library'),
  });
}

export function useCreateLibrarySpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      fetchJson('/library/spaces', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useDeleteLibrarySpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, archiveNotes }: { slug: string; archiveNotes?: boolean }) => {
      const qs = archiveNotes ? '?archive_notes=true' : '';
      return fetchJson(`/library/spaces/${encodeURIComponent(slug)}${qs}`, { method: 'DELETE' });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useCreateLibraryNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, ...data }: { project: string; name: string; description?: string }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/notebooks`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useDeleteLibraryNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook }: { project: string; notebook: string }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(project)}/notebooks/${encodeURIComponent(notebook)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useCreateLibraryNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      project: string;
      notebook: string;
      title: string;
      content: string;
      author?: 'human' | 'prax';
      tags?: string[];
      prax_may_edit?: boolean;
    }) => fetchJson('/library/notes', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useLibraryNote(project: string | null, notebook: string | null, slug: string | null) {
  return useQuery({
    queryKey: ['library-note', project, notebook, slug],
    queryFn: () =>
      fetchJson<{ meta: LibraryNote; content: string }>(
        `/library/notes/${encodeURIComponent(project || '')}/${encodeURIComponent(
          notebook || '',
        )}/${encodeURIComponent(slug || '')}`,
      ),
    enabled: !!project && !!notebook && !!slug,
  });
}

export function useUpdateLibraryNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      project,
      notebook,
      slug,
      ...data
    }: {
      project: string;
      notebook: string;
      slug: string;
      content?: string;
      title?: string;
      tags?: string[];
      editor?: 'human' | 'prax';
      override_permission?: boolean;
    }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({
        queryKey: ['library-note', variables.project, variables.notebook, variables.slug],
      });
    },
  });
}

export function useDeleteLibraryNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook, slug }: { project: string; notebook: string; slug: string }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useMoveLibraryNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      project,
      notebook,
      slug,
      to_project,
      to_notebook,
    }: {
      project: string;
      notebook: string;
      slug: string;
      to_project: string;
      to_notebook: string;
    }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}/move`,
        { method: 'PATCH', body: JSON.stringify({ to_project, to_notebook }) },
      ),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useSetLibraryNoteEditable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      project,
      notebook,
      slug,
      editable,
    }: {
      project: string;
      notebook: string;
      slug: string;
      editable: boolean;
    }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}/editable`,
        { method: 'PATCH', body: JSON.stringify({ editable }) },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({
        queryKey: ['library-note', variables.project, variables.notebook, variables.slug],
      });
    },
  });
}

// Library Phase 2: schema, index, backlinks, refine, raw, outputs, health

export function useLibrarySchema() {
  return useQuery({
    queryKey: ['library-schema'],
    queryFn: () => fetchJson<{ content: string }>('/library/schema'),
  });
}

export function useSaveLibrarySchema() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      fetchJson('/library/schema', { method: 'PUT', body: JSON.stringify({ content }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library-schema'] }); },
  });
}

export function useLibraryIndex() {
  return useQuery({
    queryKey: ['library-index'],
    queryFn: () => fetchJson<{ content: string }>('/library/index'),
  });
}

export function useRebuildLibraryIndex() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ status: string; content: string }>('/library/index/rebuild', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-index'] });
    },
  });
}

// --- Library Space cover images ---

/** Returns an absolute URL for a space's cover image with a
 *  cache-busting token.  Prefers the filename from the space
 *  metadata; falls back to a null return when no cover is set. */
export function spaceCoverUrl(space: { slug: string; cover_image?: string }): string | null {
  if (!space.cover_image) return null;
  return `/api/library/spaces/${encodeURIComponent(space.slug)}/cover?v=${encodeURIComponent(space.cover_image)}`;
}

export function useUploadSpaceCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ space, file }: { space: string; file: File }) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `/api/library/spaces/${encodeURIComponent(space)}/cover`,
        { method: 'POST', body, credentials: 'include' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['library-space'] });
    },
  });
}

export function useGenerateSpaceCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ space, prompt_hint, dark_mode }: { space: string; prompt_hint?: string; dark_mode?: boolean }) =>
      fetchJson<{ status: string; filename: string; prompt: string }>(
        `/library/spaces/${encodeURIComponent(space)}/cover/generate`,
        { method: 'POST', body: JSON.stringify({ prompt_hint: prompt_hint || '', dark_mode: dark_mode ?? true }) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['library-space'] });
    },
  });
}

export function useDeleteSpaceCover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (space: string) =>
      fetchJson(`/library/spaces/${encodeURIComponent(space)}/cover`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['library-space'] });
    },
  });
}


// --- Library Archive (long-term keepers: PDFs, reference docs) ---

export interface ArchiveItem {
  slug: string;
  title: string;
  kind?: string;
  archived_at?: string;
  source_url?: string;
  source_filename?: string;
  binary_path?: string;
  tags?: string[];
}

export function useLibraryArchive() {
  return useQuery({
    queryKey: ['library-archive'],
    queryFn: () => fetchJson<{ archive: ArchiveItem[] }>('/library/archive'),
  });
}

export function useGetLibraryArchive(slug: string | null) {
  return useQuery({
    queryKey: ['library-archive', slug],
    queryFn: () =>
      fetchJson<{ meta: ArchiveItem; content: string }>(
        `/library/archive/${encodeURIComponent(slug || '')}`,
      ),
    enabled: !!slug,
  });
}

export function useDeleteLibraryArchive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      fetchJson(`/library/archive/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-archive'] });
    },
  });
}

export interface LibraryBacklink {
  project: string;
  notebook: string;
  slug: string;
  title: string;
  author: 'human' | 'prax';
}

export function useLibraryBacklinks(
  project: string | null,
  notebook: string | null,
  slug: string | null,
) {
  return useQuery({
    queryKey: ['library-backlinks', project, notebook, slug],
    queryFn: () =>
      fetchJson<{ backlinks: LibraryBacklink[] }>(
        `/library/notes/${encodeURIComponent(project || '')}/${encodeURIComponent(
          notebook || '',
        )}/${encodeURIComponent(slug || '')}/backlinks`,
      ),
    enabled: !!project && !!notebook && !!slug,
  });
}

export interface RefineResult {
  status?: string;
  before: string;
  after: string;
  title: string;
  error?: string;
}

export function useRefineLibraryNote() {
  return useMutation({
    mutationFn: ({
      project,
      notebook,
      slug,
      instructions,
    }: {
      project: string;
      notebook: string;
      slug: string;
      instructions: string;
    }) =>
      fetchJson<RefineResult>(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}/refine`,
        { method: 'POST', body: JSON.stringify({ instructions }) },
      ),
  });
}

export function useRefineViaAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook, slug, instructions }: {
      project: string;
      notebook: string;
      slug: string;
      instructions: string;
    }) =>
      fetchJson<{ status: string; response: string }>(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}/refine-via-agent`,
        { method: 'POST', body: JSON.stringify({ instructions }) },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({
        queryKey: ['library-note', variables.project, variables.notebook, variables.slug],
      });
    },
  });
}

export function useApplyLibraryRefine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      project,
      notebook,
      slug,
      content,
    }: {
      project: string;
      notebook: string;
      slug: string;
      content: string;
    }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(
          notebook,
        )}/${encodeURIComponent(slug)}/apply-refine`,
        { method: 'POST', body: JSON.stringify({ content }) },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({
        queryKey: ['library-note', variables.project, variables.notebook, variables.slug],
      });
    },
  });
}

export interface RawItem {
  slug: string;
  title: string;
  source_url?: string;
  captured_at?: string;
  kind?: string;
}

export function useLibraryRaw() {
  return useQuery({
    queryKey: ['library-raw'],
    queryFn: () => fetchJson<{ raw: RawItem[] }>('/library/raw'),
  });
}

export function useCaptureRaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; content: string; source_url?: string }) =>
      fetchJson('/library/raw', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library-raw'] }); },
  });
}

export function useGetRaw(slug: string | null) {
  return useQuery({
    queryKey: ['library-raw-item', slug],
    queryFn: () =>
      fetchJson<{ meta: RawItem; content: string }>(
        `/library/raw/${encodeURIComponent(slug || '')}`,
      ),
    enabled: !!slug,
  });
}

export function useDeleteRaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      fetchJson(`/library/raw/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library-raw'] }); },
  });
}

export function usePromoteRaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      project,
      notebook,
      title,
    }: {
      slug: string;
      project: string;
      notebook: string;
      title?: string;
    }) =>
      fetchJson(`/library/raw/${encodeURIComponent(slug)}/promote`, {
        method: 'POST',
        body: JSON.stringify({ project, notebook, title }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-raw'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
}

export interface OutputItem {
  slug: string;
  title: string;
  kind: string;
  generated_at?: string;
}

export function useLibraryOutputs() {
  return useQuery({
    queryKey: ['library-outputs'],
    queryFn: () => fetchJson<{ outputs: OutputItem[] }>('/library/outputs'),
  });
}

export function useGetOutput(slug: string | null) {
  return useQuery({
    queryKey: ['library-output-item', slug],
    queryFn: () =>
      fetchJson<{ meta: OutputItem; content: string }>(
        `/library/outputs/${encodeURIComponent(slug || '')}`,
      ),
    enabled: !!slug,
  });
}

export interface HealthCheckReport {
  generated_at: string;
  static: {
    note_count: number;
    dead_wikilinks: Array<{
      source_project: string;
      source_notebook: string;
      source_slug: string;
      dead_target: string;
    }>;
    empty_notebooks: Array<{ project: string; notebook: string; name: string }>;
    orphans: Array<{ project: string; notebook: string; slug: string; title: string }>;
    short_notes: Array<{ project: string; notebook: string; slug: string; title: string }>;
  };
  llm:
    | {
        skipped?: boolean;
        error?: string;
        reason?: string;
        contradictions?: Array<{ note_a: string; note_b: string; issue: string }>;
        unsourced?: Array<{ note: string; claim: string }>;
        gaps?: Array<{ topic: string; mentioned_in: string[] }>;
      }
    | Record<string, unknown>;
}

export function useLibraryHealthCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<HealthCheckReport>('/library/health-check', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library-outputs'] });
    },
  });
}

export function useScheduleLibraryHealthCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { cron_expr?: string; channel?: string; timezone?: string }) =>
      fetchJson<{ status: string; schedule: { id: string } }>(
        '/library/health-check/schedule',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

// Library Phase 3: project metadata, notebook sequencing, Kanban tasks

export interface LibrarySpaceDetail extends LibrarySpace {
  status: 'active' | 'paused' | 'completed' | 'archived';
  kind: string;
  target_date: string;
  started_at: string;
  pinned: boolean;
  tasks_enabled: boolean;
  reminder_channel: 'all' | 'sms' | 'discord' | 'teamwork';
  note_count: number;
  progress_percent: number;
}

export function useLibrarySpace(project: string | null) {
  return useQuery({
    queryKey: ['library-space', project],
    queryFn: () => fetchJson<LibrarySpaceDetail>(`/library/spaces/${encodeURIComponent(project || '')}`),
    enabled: !!project,
  });
}

export function useUpdateLibrarySpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, ...data }: {
      project: string;
      name?: string;
      description?: string;
      kind?: string;
      status?: 'active' | 'paused' | 'completed' | 'archived';
      target_date?: string;
      pinned?: boolean;
      tasks_enabled?: boolean;
      reminder_channel?: 'all' | 'sms' | 'discord' | 'teamwork';
    }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['library-space', variables.project] });
    },
  });
}

export function useUpdateLibraryNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook, ...data }: {
      project: string;
      notebook: string;
      name?: string;
      description?: string;
      sequenced?: boolean;
      current_slug?: string;
    }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(project)}/notebooks/${encodeURIComponent(notebook)}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useReorderNotebook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook, slug_order }: {
      project: string;
      notebook: string;
      slug_order: string[];
    }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(project)}/notebooks/${encodeURIComponent(notebook)}/reorder`,
        { method: 'POST', body: JSON.stringify({ slug_order }) },
      ),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['library'] }); },
  });
}

export function useSetNoteStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, notebook, slug, status }: {
      project: string;
      notebook: string;
      slug: string;
      status: 'todo' | 'done';
    }) =>
      fetchJson(
        `/library/notes/${encodeURIComponent(project)}/${encodeURIComponent(notebook)}/${encodeURIComponent(slug)}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      ),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({
        queryKey: ['library-note', variables.project, variables.notebook, variables.slug],
      });
    },
  });
}

// --- Tasks ---

export interface TaskActivity {
  actor: 'human' | 'prax' | string;
  at: string;
  action: 'created' | 'updated' | 'moved' | 'commented' | 'deleted' | string;
  from?: string;
  to?: string;
  fields?: string[];
  text?: string;
}

export interface TaskComment {
  actor: string;
  at: string;
  text: string;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export type TaskSource = 'user_request' | 'agent_derived' | 'tool_output';
export type Confidence = 'low' | 'medium' | 'high';

export interface LibraryTask {
  id: string;
  title: string;
  description: string;
  column: string;
  author: 'human' | 'prax';
  /** Where the request to create this task came from.  See P1 in
   * docs/research/prax-changes-from-todo-research.md. */
  source?: TaskSource;
  source_justification?: string;
  /** Prax's self-reported confidence the task is well-scoped.  Not
   * calibrated — shown as a colored dot in the UI. */
  confidence?: Confidence;
  assignees: string[];
  due_date: string;
  reminder_enabled: boolean;
  reminder_id: string | null;
  reminder_channel: string;
  checklist: ChecklistItem[];
  activity: TaskActivity[];
  comments: TaskComment[];
  created_at: string;
  updated_at: string;
}

export interface LibraryTaskColumn {
  id: string;
  name: string;
}

export function useProjectTasks(project: string | null) {
  return useQuery({
    queryKey: ['library-tasks', project],
    queryFn: () => fetchJson<{ tasks: LibraryTask[] }>(`/library/spaces/${encodeURIComponent(project || '')}/tasks`),
    enabled: !!project,
  });
}

export function useProjectTaskColumns(project: string | null) {
  return useQuery({
    queryKey: ['library-task-columns', project],
    queryFn: () => fetchJson<{ columns: LibraryTaskColumn[] }>(`/library/spaces/${encodeURIComponent(project || '')}/tasks/columns`),
    enabled: !!project,
  });
}

export function useCreateLibraryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, ...data }: {
      project: string;
      title: string;
      description?: string;
      column?: string;
      author?: 'human' | 'prax';
      assignees?: string[];
      due_date?: string;
      reminder_enabled?: boolean;
      reminder_channel?: string;
      checklist?: ChecklistItem[];
      source?: TaskSource;
      source_justification?: string;
      confidence?: Confidence;
    }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-tasks', variables.project] });
    },
  });
}

export function useGetLibraryTask(project: string | null, taskId: string | null) {
  return useQuery({
    queryKey: ['library-task', project, taskId],
    queryFn: () => fetchJson<LibraryTask>(
      `/library/spaces/${encodeURIComponent(project || '')}/tasks/${encodeURIComponent(taskId || '')}`,
    ),
    enabled: !!project && !!taskId,
  });
}

export function useUpdateLibraryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, task_id, ...data }: {
      project: string;
      task_id: string;
      title?: string;
      description?: string;
      due_date?: string;
      reminder_enabled?: boolean;
      reminder_channel?: string;
      assignees?: string[];
      checklist?: ChecklistItem[];
      confidence?: Confidence;
      editor?: 'human' | 'prax';
    }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task_id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-tasks', variables.project] });
      queryClient.invalidateQueries({ queryKey: ['library-task', variables.project, variables.task_id] });
    },
  });
}

export function useDeleteLibraryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, task_id }: { project: string; task_id: string }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task_id)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-tasks', variables.project] });
    },
  });
}

export function useMoveLibraryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, task_id, column, editor }: {
      project: string;
      task_id: string;
      column: string;
      editor?: 'human' | 'prax';
    }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task_id)}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ column, editor }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-tasks', variables.project] });
      queryClient.invalidateQueries({ queryKey: ['library-task', variables.project, variables.task_id] });
    },
  });
}

export function useCommentLibraryTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, task_id, text, actor }: {
      project: string;
      task_id: string;
      text: string;
      actor?: 'human' | 'prax';
    }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/${encodeURIComponent(task_id)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ text, actor }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-task', variables.project, variables.task_id] });
    },
  });
}

export function useAddColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, name }: { project: string; name: string }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/columns`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-task-columns', variables.project] });
    },
  });
}

export function useRenameColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, column_id, name }: { project: string; column_id: string; name: string }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/columns/${encodeURIComponent(column_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-task-columns', variables.project] });
    },
  });
}

export function useRemoveColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ project, column_id }: { project: string; column_id: string }) =>
      fetchJson(`/library/spaces/${encodeURIComponent(project)}/tasks/columns/${encodeURIComponent(column_id)}`, {
        method: 'DELETE',
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['library-task-columns', variables.project] });
    },
  });
}


// Agent plan — Prax's private working-memory to-do list (NOT the Library Kanban)

export interface AgentPlanStep {
  step: number;
  description: string;
  done: boolean;
}

export interface AgentPlan {
  id: string;
  goal: string;
  /** Prax's self-reported confidence the plan is correct/complete.
   * Not calibrated — shown as a colored dot in AgentPlanCard. */
  confidence?: Confidence;
  steps: AgentPlanStep[];
  done_count: number;
  total: number;
  current_step: AgentPlanStep | null;
  created_at?: string;
}

/**
 * Poll for Prax's current agent_plan.  Returns `null` when no plan is
 * active (Prax isn't mid-task) and the full plan object otherwise.
 *
 * This is read-only on purpose — mid-execution editing of plans was
 * shown to *reduce* quality in the CHI 2025 Plan-Then-Execute study
 * when the model's initial plan was already correct.  See
 * `docs/library.md` and `docs/research/agentic-todo-flows.md` in the
 * Prax repo.
 */
export function useAgentPlan(enabled: boolean = true) {
  return useQuery({
    queryKey: ['agent-plan'],
    queryFn: () => fetchJson<AgentPlan | null>('/agent-plan'),
    enabled,
    refetchInterval: 10_000,  // poll every 10s (was 3s — caused jank)
    staleTime: 5_000,         // consider fresh for 5s (was 0 — refetched every render)
  });
}


// Claude Code Sessions

export interface ClaudeCodeSession {
  session_id: string;
  turn_count: number;
  idle_seconds: number;
}

export function useClaudeCodeSessions() {
  return useQuery({
    queryKey: ['claude-code-sessions'],
    queryFn: () => fetchJson<{ sessions: ClaudeCodeSession[]; bridge_available: boolean }>('/claude-code/sessions'),
    refetchInterval: 10000,
  });
}

export function useKillClaudeCodeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      fetchJson(`/claude-code/sessions/${sessionId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claude-code-sessions'] });
    },
  });
}


// Scheduler

export interface Schedule {
  id: string;
  description: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  created_at: string;
  last_run: string | null;
  next_run: string | null;
}

export interface Reminder {
  id: string;
  description: string;
  prompt: string;
  fire_at: string;
  timezone: string;
  channel?: string;
}

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: () => fetchJson<{ schedules: Schedule[]; reminders: Reminder[] }>('/scheduler/schedules'),
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { description: string; prompt: string; cron: string; timezone?: string; channel?: string }) =>
      fetchJson('/scheduler/schedules', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; description?: string; prompt?: string; cron?: string; timezone?: string; enabled?: boolean }) =>
      fetchJson(`/scheduler/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/scheduler/schedules/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

export function useCreateReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { description: string; prompt: string; fire_at: string; timezone?: string; channel?: string }) =>
      fetchJson('/scheduler/reminders', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

export function useUpdateReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; description?: string; prompt?: string; fire_at?: string; timezone?: string; channel?: string }) =>
      fetchJson(`/scheduler/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/scheduler/reminders/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedules'] }); },
  });
}

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

export interface FlashcardCard {
  id: string;
  front: string;
  back: string;
  confidence?: number;
  last_reviewed?: string;
}

export interface FlashcardDeck {
  slug: string;
  title: string;
  card_count: number;
  created_at?: string;
  cards?: FlashcardCard[];
}

export function useFlashcardDecks(spaceSlug: string | null) {
  return useQuery({
    queryKey: ['flashcard-decks', spaceSlug],
    queryFn: () =>
      fetchJson<{ decks: FlashcardDeck[] }>(
        `/library/spaces/${encodeURIComponent(spaceSlug || '')}/flashcards`,
      ),
    enabled: !!spaceSlug,
  });
}

export function useFlashcardDeck(spaceSlug: string | null, deckSlug: string | null) {
  return useQuery({
    queryKey: ['flashcard-deck', spaceSlug, deckSlug],
    queryFn: () =>
      fetchJson<FlashcardDeck>(
        `/library/spaces/${encodeURIComponent(spaceSlug || '')}/flashcards/${encodeURIComponent(deckSlug || '')}`,
      ),
    enabled: !!spaceSlug && !!deckSlug,
  });
}

export function useCreateFlashcardDeck(spaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/flashcards`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks', spaceSlug] });
    },
  });
}

export function useDeleteFlashcardDeck(spaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckSlug: string) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/flashcards/${encodeURIComponent(deckSlug)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks', spaceSlug] });
    },
  });
}

export function useAddFlashcard(spaceSlug: string, deckSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { front: string; back: string }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/flashcards/${encodeURIComponent(deckSlug)}/cards`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', spaceSlug, deckSlug] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks', spaceSlug] });
    },
  });
}

export function useUpdateFlashcard(spaceSlug: string, deckSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, ...data }: { cardId: string; front?: string; back?: string; confidence?: number }) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/flashcards/${encodeURIComponent(deckSlug)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'PATCH', body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', spaceSlug, deckSlug] });
    },
  });
}

export function useDeleteFlashcard(spaceSlug: string, deckSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/flashcards/${encodeURIComponent(deckSlug)}/cards/${encodeURIComponent(cardId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', spaceSlug, deckSlug] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks', spaceSlug] });
    },
  });
}

// --- Space Files (per-space reference-file store) ---

export interface SpaceFile {
  name: string;
  size: number;
  mime_type: string;
  uploaded_at: string;
}

export function spaceFileUrl(space: string, filename: string): string {
  return `${API_BASE}/library/spaces/${encodeURIComponent(space)}/files/${encodeURIComponent(filename)}`;
}

export function useSpaceFiles(spaceSlug: string | null) {
  return useQuery({
    queryKey: ['space-files', spaceSlug],
    queryFn: () =>
      fetchJson<{ files: SpaceFile[] }>(
        `/library/spaces/${encodeURIComponent(spaceSlug || '')}/files`,
      ),
    enabled: !!spaceSlug,
  });
}

export function useUploadSpaceFile(spaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(
        `${API_BASE}/library/spaces/${encodeURIComponent(spaceSlug)}/files`,
        { method: 'POST', body, credentials: 'include' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<SpaceFile>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-files', spaceSlug] });
    },
  });
}

export function useDeleteSpaceFile(spaceSlug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      fetchJson(
        `/library/spaces/${encodeURIComponent(spaceSlug)}/files/${encodeURIComponent(filename)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-files', spaceSlug] });
    },
  });
}


// Timezone

export function useUserTimezone() {
  return useQuery({
    queryKey: ['user-timezone'],
    queryFn: () => fetchJson<{ timezone: string }>('/scheduler/timezone'),
  });
}

export function useSetUserTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timezone: string) =>
      fetchJson('/scheduler/timezone', { method: 'PUT', body: JSON.stringify({ timezone }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['user-timezone'] }); },
  });
}
