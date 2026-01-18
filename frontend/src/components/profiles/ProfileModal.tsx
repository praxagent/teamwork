import { useState, useRef } from 'react';
import { X, MapPin, Briefcase, Code, Shield, Heart, Coffee, MessageSquare, Terminal, Camera, Trash2, Loader2 } from 'lucide-react';
import { Avatar, Button } from '@/components/common';
import { ActivityTrace } from './ActivityTrace';
import { AgentLogViewer } from './AgentLogViewer';
import { useUpdateAgentProfileImage, useRemoveAgentProfileImage } from '@/hooks/useApi';
import type { Agent, ActivityLog } from '@/types';

interface ProfileModalProps {
  agent: Agent;
  activities?: ActivityLog[];
  onClose: () => void;
  onSendMessage?: () => void;
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

export function ProfileModal({ agent, activities = [], onClose, onSendMessage }: ProfileModalProps) {
  const [showLogs, setShowLogs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateImage = useUpdateAgentProfileImage();
  const removeImage = useRemoveAgentProfileImage();
  
  const persona = agent.persona;
  const Icon = getRoleIcon(agent.role);
  
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
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
              <h2 className="text-2xl font-bold text-gray-900">{agent.name}</h2>
              <div className="flex items-center gap-2 text-gray-500 mt-1">
                <Icon className="w-4 h-4" />
                <span>{getRoleLabel(agent.role)}</span>
                {agent.team && (
                  <>
                    <span className="text-gray-300">|</span>
                    <span className="text-slack-active">{agent.team}</span>
                  </>
                )}
              </div>
              {persona?.location && (
                <div className="flex items-center gap-1 text-sm text-gray-400 mt-1">
                  <MapPin className="w-4 h-4" />
                  <span>
                    {persona.location.city}, {persona.location.country}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setShowLogs(true)} size="sm" variant="secondary">
                <Terminal className="w-4 h-4 mr-1" />
                Inspect Work Logs
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
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                Personality
              </h3>
              <div className="flex flex-wrap gap-2 mb-2">
                {persona.personality.traits?.map((trait) => (
                  <span
                    key={trait}
                    className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                  >
                    {trait}
                  </span>
                ))}
              </div>
              <p className="text-gray-600 text-sm">
                {persona.personality.communication_style}
              </p>
            </div>
          )}

          {/* Personal interests */}
          {persona?.personal && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                <Heart className="w-4 h-4 inline mr-1" />
                Interests
              </h3>
              <div className="flex flex-wrap gap-2">
                {persona.personal.hobbies?.map((hobby) => (
                  <span
                    key={hobby}
                    className="px-2 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                  >
                    {hobby}
                  </span>
                ))}
              </div>
              {persona.personal.pet && (
                <p className="text-sm text-gray-500 mt-2">
                  Has a {persona.personal.pet.type} named {persona.personal.pet.name}
                </p>
              )}
            </div>
          )}

          {/* Work style */}
          {persona?.work_style && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                <Coffee className="w-4 h-4 inline mr-1" />
                Work Style
              </h3>
              <p className="text-gray-600 text-sm mb-2">
                {persona.work_style.preferences}
              </p>
              {persona.work_style.focus_areas && persona.work_style.focus_areas.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {persona.work_style.focus_areas.map((area) => (
                    <span
                      key={area}
                      className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
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
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
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
