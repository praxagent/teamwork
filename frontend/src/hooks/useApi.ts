import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  Project,
  Agent,
  Channel,
  Message,
  Task,
  ActivityLog,
  ClarifyingQuestionsResponse,
  OnboardingStatus,
  TeamMemberSuggestion,
  ProjectBreakdown,
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

// Messages
export function useMessages(channelId: string | null, skip = 0, limit = 50) {
  return useQuery({
    queryKey: ['messages', channelId, skip, limit],
    queryFn: () =>
      fetchJson<{ messages: Message[]; total: number; has_more: boolean }>(
        `/messages/channel/${channelId}?skip=${skip}&limit=${limit}`
      ),
    enabled: !!channelId,
    staleTime: 0, // Always refetch when channel changes
    refetchOnMount: 'always', // Force refetch on mount/refresh
    refetchOnWindowFocus: true,
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
    refetchInterval: 1000, // Poll every 1 second when enabled for more responsive updates
    staleTime: 500,
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
