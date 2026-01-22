// Core types for the Virtual Dev Team Simulator

export interface Project {
  id: string;
  name: string;
  description: string | null;
  config: ProjectConfig | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectConfig {
  status?: string;
  runtime_mode?: 'docker';  // Always Docker for security
  workspace_type?: 'local' | 'local_git' | 'browser' | 'hybrid';
  analysis?: ProjectAnalysis;
  breakdown?: ProjectBreakdown;
  team_suggestions?: TeamMemberSuggestion[];
  project_type?: 'software' | 'coaching';
  coaching_topics?: string[];
}

export interface ProjectAnalysis {
  suggested_name: string;
  app_type: string;
  complexity: 'simple' | 'moderate' | 'complex';
  core_features: string[];
  tech_suggestions: {
    frontend?: string;
    backend?: string;
    database?: string;
    other?: string;
  };
}

export interface ProjectBreakdown {
  components: ProjectComponent[];
  teams: string[];
  architecture?: string;
  mvp_scope?: string;
}

export interface ProjectComponent {
  name: string;
  description: string;
  team: string;
  priority: number;
  estimated_complexity: 'simple' | 'moderate' | 'complex';
  dependencies: string[];
}

export interface Agent {
  id: string;
  project_id: string;
  name: string;
  role: 'pm' | 'developer' | 'qa' | 'coach' | 'personal_manager';
  specialization?: string | null;  // Topic for coaches (e.g., "calculus", "system-design")
  team: string | null;
  status: 'idle' | 'working' | 'blocked' | 'offline';
  persona: AgentPersona | null;
  profile_image_type: string | null;
  profile_image_url: string | null;
  created_at: string;
}

export interface AgentPersona {
  name: string;
  role: string;
  team?: string;
  location?: {
    city: string;
    country: string;
  };
  personality?: {
    traits: string[];
    communication_style: string;
    strengths: string[];
    quirks: string[];
  };
  personal?: {
    hobbies: string[];
    favorite_topics: string[];
    pet?: {
      type: string;
      name: string;
    } | null;
    family?: string;
  };
  work_style?: {
    preferences: string;
    code_style: string;
    focus_areas: string[];
  };
  profile_image_type?: string;
  profile_image_description?: string;
}

export interface TeamMemberSuggestion {
  name: string;
  role: 'pm' | 'developer' | 'qa' | 'coach' | 'personal_manager';
  specialization?: string | null;  // Topic for coaches
  team: string | null;
  personality_summary: string;
  profile_image_type: string;
  teaching_style?: string;  // For coaches
}

export interface Channel {
  id: string;
  project_id: string;
  name: string;
  type: 'public' | 'team' | 'dm';
  team: string | null;
  description: string | null;
  dm_participants: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_role: string | null;
  content: string;
  message_type: 'chat' | 'status_update' | 'task_update' | 'system';
  metadata: Record<string, unknown> | null;
  thread_id: string | null;
  reply_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  team: string | null;
  assigned_to: string | null;
  assigned_agent_name: string | null;
  status: 'pending' | 'in_progress' | 'blocked' | 'review' | 'completed';
  priority: number;
  parent_task_id: string | null;
  subtask_count: number;
  blocked_by: string[];  // Task IDs this task depends on
  blocked_by_titles: string[];  // Human-readable titles of blocking tasks
  is_blocked: boolean;  // True if any blocker is not completed
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  agent_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// WebSocket event types
export type WebSocketEventType =
  | 'message:new'
  | 'message:update'
  | 'agent:status'
  | 'agent:activity'
  | 'task:update'
  | 'task:new'
  | 'project:update'
  | 'channel:new'
  | 'error'
  | 'connected';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: Record<string, unknown>;
  timestamp: string;
  projectId?: string;
  channelId?: string;
}

// API response types
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  has_more: boolean;
}

export interface OnboardingStatus {
  project_id: string;
  step: 'description' | 'questions' | 'breakdown' | 'config' | 'generating' | 'complete' | 'unknown';
  data: Record<string, unknown> | null;
}

export interface ClarifyingQuestionsResponse {
  questions: string[];
  initial_analysis: {
    project_id: string;
    suggested_name: string;
    app_type: string;
    complexity: string;
  };
}
