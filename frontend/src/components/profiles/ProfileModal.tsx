import { useState, useRef, useEffect } from 'react';
import { X, MapPin, Briefcase, Code, Shield, Heart, Coffee, MessageSquare, Terminal, Camera, Trash2, Loader2, Edit3, Save, FileText } from 'lucide-react';
import { Avatar, Button } from '@/components/common';
import { ActivityTrace } from './ActivityTrace';
import { AgentLogViewer } from './AgentLogViewer';
import { useUpdateAgentProfileImage, useRemoveAgentProfileImage, useAgentPrompts, useUpdateAgentPrompts } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import type { Agent, ActivityLog } from '@/types';

interface ProfileModalProps {
  agent: Agent;
  activities?: ActivityLog[];
  onClose: () => void;
  onSendMessage?: () => void;
  initialEditMode?: boolean;
}

const roleIcons = {
  pm: Briefcase,
  developer: Code,
  qa: Shield,
};

const roleLabels: Record<string, string> = {
  pm: 'Product Manager',
  developer: 'Developer',
  qa: 'QA Engineer',
};

// Get role label with fallback for unknown roles
const getRoleLabel = (role: string): string => {
  const normalized = role?.toLowerCase()?.trim() || '';
  if (roleLabels[normalized]) return roleLabels[normalized];
  if (normalized.includes('product') || normalized.includes('pm') || normalized.includes('project manager')) return 'Product Manager';
  if (normalized.includes('qa') || normalized.includes('quality') || normalized.includes('test')) return 'QA Engineer';
  if (normalized.includes('dev') || normalized.includes('engineer') || normalized.includes('frontend') || normalized.includes('backend') || normalized.includes('full')) return 'Developer';
  return role?.charAt(0).toUpperCase() + role?.slice(1) || 'Team Member';
};

// Get role icon with fallback
const getRoleIcon = (role: string) => {
  const normalized = role?.toLowerCase()?.trim() || '';
  if (roleIcons[normalized as keyof typeof roleIcons]) return roleIcons[normalized as keyof typeof roleIcons];
  if (normalized.includes('product') || normalized.includes('pm') || normalized.includes('project manager')) return Briefcase;
  if (normalized.includes('qa') || normalized.includes('quality') || normalized.includes('test')) return Shield;
  if (normalized.includes('dev') || normalized.includes('engineer')) return Code;
  return Briefcase;
};

// Convert agent name to a safe directory slug (matches backend)
const slugifyName = (name: string): string => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars (dots, etc.)
    .replace(/[\s_]+/g, '-')       // Replace spaces/underscores with hyphens
    .replace(/-+/g, '-')           // Collapse multiple hyphens
    .replace(/^-|-$/g, '');        // Trim hyphens from ends
};

export function ProfileModal({ agent, activities = [], onClose, onSendMessage, initialEditMode = false }: ProfileModalProps) {
  const [showLogs, setShowLogs] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editedSoulPrompt, setEditedSoulPrompt] = useState('');
  const [editedSkillsPrompt, setEditedSkillsPrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateImage = useUpdateAgentProfileImage();
  const removeImage = useRemoveAgentProfileImage();
  
  // Prompts API
  const { data: prompts, isLoading: promptsLoading } = useAgentPrompts(agent.id);
  const updatePrompts = useUpdateAgentPrompts();
  const darkMode = useUIStore((state) => state.darkMode);
  
  const persona = agent.persona;
  const Icon = getRoleIcon(agent.role);
  
  // Open prompt editor automatically if initialEditMode is true
  useEffect(() => {
    if (initialEditMode && prompts && !promptsLoading) {
      setEditedSoulPrompt(prompts.soul_prompt || '');
      setEditedSkillsPrompt(prompts.skills_prompt || '');
      setShowPromptEditor(true);
    }
  }, [initialEditMode, prompts, promptsLoading]);
  
  // Initialize edit fields when opening editor
  const handleOpenPromptEditor = () => {
    setEditedSoulPrompt(prompts?.soul_prompt || '');
    setEditedSkillsPrompt(prompts?.skills_prompt || '');
    setShowPromptEditor(true);
  };
  
  const handleSavePrompts = async () => {
    await updatePrompts.mutateAsync({
      agentId: agent.id,
      soul_prompt: editedSoulPrompt,
      skills_prompt: editedSkillsPrompt,
    });
    setShowPromptEditor(false);
  };
  
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB');
      return;
    }
    
    // Convert to base64 and upload
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      updateImage.mutate({
        agentId: agent.id,
        imageData: result,
      });
    };
    reader.readAsDataURL(file);
  };
  
  const handleRemoveImage = () => {
    if (confirm('Remove profile image? Agent will show initials instead.')) {
      removeImage.mutate(agent.id);
    }
  };

  // If showing logs, render the log viewer instead
  if (showLogs) {
    return <AgentLogViewer agent={agent} onClose={() => setShowLogs(false)} />;
  }

  // If showing prompt editor, render that instead
  if (showPromptEditor) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className={`${darkMode ? 'bg-slate-800 text-gray-100' : 'bg-white text-gray-900'} rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col`}>
          {/* Header */}
          <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-3">
              <FileText className={`w-5 h-5 ${darkMode ? 'text-purple-400' : 'text-purple-600'}`} />
              <h2 className="text-xl font-bold">Edit {agent.name}'s Personality</h2>
            </div>
            <button
              onClick={() => setShowPromptEditor(false)}
              className={`p-1 rounded ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'}`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Info box */}
            <div className={`p-4 rounded-lg ${darkMode ? 'bg-blue-900/30 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
              <p className={`text-sm ${darkMode ? 'text-blue-200' : 'text-blue-700'}`}>
                These prompts define how {agent.name} thinks and behaves. Changes are saved to 
                <code className={`mx-1 px-1.5 py-0.5 rounded text-xs ${darkMode ? 'bg-slate-700' : 'bg-blue-100'}`}>.agents/{slugifyName(agent.name)}/</code>
                in the workspace.
              </p>
            </div>

            {/* Soul Prompt */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Soul Prompt (Personality & Identity)
              </label>
              <textarea
                value={editedSoulPrompt}
                onChange={(e) => setEditedSoulPrompt(e.target.value)}
                rows={12}
                className={`w-full px-3 py-2 rounded-lg border font-mono text-sm resize-none focus:outline-none focus:ring-2 ${
                  darkMode 
                    ? 'bg-slate-900 border-slate-600 text-gray-100 focus:ring-purple-500' 
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-purple-400'
                }`}
                placeholder="# Agent's Soul Prompt..."
              />
            </div>

            {/* Skills Prompt */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Skills Prompt (Expertise & Responsibilities)
              </label>
              <textarea
                value={editedSkillsPrompt}
                onChange={(e) => setEditedSkillsPrompt(e.target.value)}
                rows={12}
                className={`w-full px-3 py-2 rounded-lg border font-mono text-sm resize-none focus:outline-none focus:ring-2 ${
                  darkMode 
                    ? 'bg-slate-900 border-slate-600 text-gray-100 focus:ring-purple-500' 
                    : 'bg-white border-gray-300 text-gray-900 focus:ring-purple-400'
                }`}
                placeholder="# Agent's Skills Prompt..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className={`flex items-center justify-between px-6 py-4 border-t ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Source: {prompts?.source === 'file' ? 'Files in workspace' : prompts?.source === 'mixed' ? 'Mixed' : 'Database'}
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowPromptEditor(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSavePrompts}
                disabled={updatePrompts.isPending}
              >
                {updatePrompts.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`${darkMode ? 'bg-slate-800' : 'bg-white'} rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col`}>
        {/* Header */}
        <div className="relative bg-gradient-to-r from-slack-purple to-purple-600 h-32">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 hover:bg-white/20 rounded text-white"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="absolute -bottom-16 left-6 group">
            <Avatar
              name={agent.name}
              src={agent.profile_image_url}
              size="2xl"
              status={agent.status}
              className="ring-4 ring-white"
            />
            {/* Image upload overlay */}
            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
              {updateImage.isPending || removeImage.isPending ? (
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              ) : (
                <>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
                    title="Upload new image"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  {agent.profile_image_url && (
                    <button
                      onClick={handleRemoveImage}
                      className="p-2 bg-white/20 hover:bg-red-500/50 rounded-full text-white transition-colors"
                      title="Remove image"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Content */}
        <div className="pt-20 px-6 pb-6 overflow-y-auto flex-1">
          {/* Name and role */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className={`text-2xl font-bold ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>{agent.name}</h2>
              <div className={`flex items-center gap-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'} mt-1`}>
                <Icon className="w-4 h-4" />
                <span>{getRoleLabel(agent.role)}</span>
                {agent.team && (
                  <>
                    <span className={darkMode ? 'text-gray-600' : 'text-gray-300'}>|</span>
                    <span className="text-slack-active">{agent.team}</span>
                  </>
                )}
              </div>
              {persona?.location && (
                <div className={`flex items-center gap-1 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'} mt-1`}>
                  <MapPin className="w-4 h-4" />
                  <span>
                    {persona.location.city}, {persona.location.country}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button onClick={handleOpenPromptEditor} size="sm" variant="secondary">
                <Edit3 className="w-4 h-4 mr-1" />
                Edit Personality
              </Button>
              <Button onClick={() => setShowLogs(true)} size="sm" variant="secondary">
                <Terminal className="w-4 h-4 mr-1" />
                Work Logs
              </Button>
              <Button onClick={onSendMessage} size="sm">
                <MessageSquare className="w-4 h-4 mr-1" />
                Message
              </Button>
            </div>
          </div>

          {/* Personality */}
          {persona?.personality && (
            <div className="mb-6">
              <h3 className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wide mb-2`}>
                Personality
              </h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {persona.personality.traits?.map((trait) => (
                  <span
                    key={trait}
                    className={`px-2 py-1 rounded-full text-sm ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}
                  >
                    {trait}
                  </span>
                ))}
              </div>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {persona.personality.communication_style}
              </p>
            </div>
          )}

          {/* Personal interests */}
          {persona?.personal && (
            <div className="mb-6">
              <h3 className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wide mb-2`}>
                <Heart className="w-4 h-4 inline mr-1" />
                Interests
              </h3>
              <div className="flex flex-wrap gap-2">
                {persona.personal.hobbies?.map((hobby) => (
                  <span
                    key={hobby}
                    className={`px-2 py-1 rounded-full text-sm ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {hobby}
                  </span>
                ))}
              </div>
              {persona.personal.pet && (
                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'} mt-2`}>
                  Has a {persona.personal.pet.type} named {persona.personal.pet.name}
                </p>
              )}
            </div>
          )}

          {/* Work style */}
          {persona?.work_style && (
            <div className="mb-6">
              <h3 className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wide mb-2`}>
                <Coffee className="w-4 h-4 inline mr-1" />
                Work Style
              </h3>
              <p className={`text-sm mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                {persona.work_style.preferences}
              </p>
              {persona.work_style.focus_areas && persona.work_style.focus_areas.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {persona.work_style.focus_areas.map((area) => (
                    <span
                      key={area}
                      className={`px-2 py-1 rounded-full text-sm ${darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'}`}
                    >
                      {area}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Activity trace */}
          {activities.length > 0 && (
            <div>
              <h3 className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase tracking-wide mb-2`}>
                Recent Activity
              </h3>
              <ActivityTrace activities={activities} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
