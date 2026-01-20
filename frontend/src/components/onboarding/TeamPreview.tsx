import { useState } from 'react';
import { Button, Avatar, Card, CardContent } from '@/components/common';
import { Users, Code, Shield, Briefcase, Shuffle, Pencil, Check, X, Loader2, Camera, Palmtree, Gamepad2, PawPrint, Palette, RefreshCw } from 'lucide-react';
import type { TeamMemberSuggestion } from '@/types';

interface TeamPreviewProps {
  teamMembers: TeamMemberSuggestion[];
  teams: string[];
  onContinue: () => void;
  onBack: () => void;
  onUpdateMember?: (index: number, member: TeamMemberSuggestion) => void;
  onShuffleMember?: (index: number) => Promise<TeamMemberSuggestion | null>;
  recommendedTeamSize?: number;
  desiredTeamSize?: number;
  maxGeneratedSize?: number;
  onTeamSizeChange?: (size: number) => void;
  onRegenerateTeam?: () => Promise<void>;
  isRegenerating?: boolean;
  quickLaunching?: boolean;
}

const roleIcons: Record<string, typeof Users> = {
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
  // Handle common variations
  if (normalized.includes('product') || normalized.includes('pm') || normalized.includes('project manager')) return 'Product Manager';
  if (normalized.includes('qa') || normalized.includes('quality') || normalized.includes('test')) return 'QA Engineer';
  if (normalized.includes('dev') || normalized.includes('engineer') || normalized.includes('frontend') || normalized.includes('backend') || normalized.includes('full')) return 'Developer';
  // Fallback to capitalized role
  return role?.charAt(0).toUpperCase() + role?.slice(1) || 'Team Member';
};

// Get role icon with fallback
const getRoleIcon = (role: string): typeof Users => {
  const normalized = role?.toLowerCase()?.trim() || '';
  if (roleIcons[normalized]) return roleIcons[normalized];
  if (normalized.includes('product') || normalized.includes('pm') || normalized.includes('project manager')) return Briefcase;
  if (normalized.includes('qa') || normalized.includes('quality') || normalized.includes('test')) return Shield;
  if (normalized.includes('dev') || normalized.includes('engineer')) return Code;
  return Users;
};

const profileImageTypeInfo: Record<string, { icon: typeof Camera; label: string; description: string }> = {
  professional: { icon: Camera, label: 'Professional', description: 'Formal headshot' },
  vacation: { icon: Palmtree, label: 'Vacation', description: 'Travel photo' },
  hobby: { icon: Gamepad2, label: 'Hobby', description: 'Doing something fun' },
  pet: { icon: PawPrint, label: 'With Pet', description: 'With their pet' },
  artistic: { icon: Palette, label: 'Artistic', description: 'Creative style' },
};

const profileImageTypes = Object.keys(profileImageTypeInfo);

export function TeamPreview({ 
  teamMembers, 
  teams, 
  onContinue, 
  onBack,
  onUpdateMember,
  onShuffleMember,
  recommendedTeamSize = 5,
  desiredTeamSize,
  maxGeneratedSize = 0,
  onTeamSizeChange,
  onRegenerateTeam,
  isRegenerating = false,
  quickLaunching = false,
}: TeamPreviewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TeamMemberSuggestion | null>(null);
  const [shufflingIndex, setShufflingIndex] = useState<number | null>(null);
  
  // Use external state if provided, otherwise local
  const currentTeamSize = desiredTeamSize ?? teamMembers.length;

  // Show simplified loading view during quick launch
  if (quickLaunching) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-slack-purple/10 rounded-full mb-4 animate-pulse">
            <Users className="w-8 h-8 text-slack-purple" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Assembling Your Team
          </h1>
          <p className="text-gray-600">
            Creating {teamMembers.length || 'your'} virtual team members...
          </p>
          <div className="mt-6 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slack-purple border-t-transparent" />
          </div>
          {teamMembers.length > 0 && (
            <div className="mt-8 flex justify-center gap-4 flex-wrap">
              {teamMembers.slice(0, 5).map((member, i) => (
                <div key={i} className="text-center animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-medium text-gray-600">
                    {member.name.charAt(0)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{member.name.split(' ')[0]}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  
  const handleTeamSizeChange = (newSize: number) => {
    if (onTeamSizeChange) {
      onTeamSizeChange(newSize);
    }
  };
  
  // Check if regeneration is needed
  const needsRegeneration = currentTeamSize > maxGeneratedSize;
  const needsRefresh = currentTeamSize !== teamMembers.length;

  const handleEditStart = (index: number, member: TeamMemberSuggestion) => {
    setEditingIndex(index);
    setEditForm({ ...member });
  };

  const handleEditSave = () => {
    if (editingIndex !== null && editForm && onUpdateMember) {
      onUpdateMember(editingIndex, editForm);
    }
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleEditCancel = () => {
    setEditingIndex(null);
    setEditForm(null);
  };

  const handleShuffle = async (index: number) => {
    if (!onShuffleMember) return;
    setShufflingIndex(index);
    try {
      const newMember = await onShuffleMember(index);
      if (newMember && onUpdateMember) {
        onUpdateMember(index, newMember);
      }
    } finally {
      setShufflingIndex(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
          <Users className="w-8 h-8 text-purple-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Meet Your Team</h1>
        <p className="text-gray-600">
          Here's the virtual development team we've assembled for your project.
          Click the pencil to edit or shuffle to get a new team member.
        </p>
      </div>

      {/* Team Size Selection */}
      <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-blue-900">Team Size</h3>
              {currentTeamSize === recommendedTeamSize && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                  Recommended
                </span>
              )}
            </div>
            <p className="text-sm text-blue-700 mb-3">
              Based on your project, we recommend <strong>{recommendedTeamSize} agents</strong>. 
              You can adjust this to control costs - fewer agents = lower API usage.
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={2}
                max={10}
                value={currentTeamSize}
                onChange={(e) => handleTeamSizeChange(parseInt(e.target.value))}
                className="flex-1 h-2 bg-blue-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                disabled={isRegenerating}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTeamSizeChange(Math.max(2, currentTeamSize - 1))}
                  className="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-lg font-medium disabled:opacity-50"
                  disabled={currentTeamSize <= 2 || isRegenerating}
                >
                  -
                </button>
                <span className="w-8 text-center font-bold text-blue-900">{currentTeamSize}</span>
                <button
                  onClick={() => handleTeamSizeChange(Math.min(10, currentTeamSize + 1))}
                  className="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-lg font-medium disabled:opacity-50"
                  disabled={currentTeamSize >= 10 || isRegenerating}
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-blue-600">
                Min: 2 (PM + 1 Dev) • Max: 10 • Showing: {teamMembers.length} of {currentTeamSize} agents
              </p>
              
              {/* Regenerate Button - show when size changed */}
              {(needsRegeneration || needsRefresh) && onRegenerateTeam && (
                <button
                  onClick={onRegenerateTeam}
                  disabled={isRegenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isRegenerating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {needsRegeneration ? 'Generate New Members' : 'Apply Changes'}
                </button>
              )}
            </div>
            
            {needsRegeneration && (
              <p className="text-xs text-amber-600 mt-2">
                ⚠️ You've selected {currentTeamSize} agents but only {maxGeneratedSize} have been generated. 
                Click "Generate New Members" to add {currentTeamSize - maxGeneratedSize} more.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Teams overview */}
      {teams.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            Teams
          </h2>
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => (
              <span
                key={team}
                className="px-3 py-1 bg-slack-purple/10 text-slack-purple rounded-full text-sm font-medium"
              >
                {team}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Team members grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {teamMembers.map((member, index) => {
          const Icon = getRoleIcon(member.role);
          const isEditing = editingIndex === index;
          const isShuffling = shufflingIndex === index;
          
          return (
            <Card key={index} className={isShuffling ? 'opacity-50' : ''}>
              <CardContent className="relative">
                {/* Action buttons */}
                <div className="absolute top-2 right-2 flex gap-1">
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => handleEditStart(index, member)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title="Edit team member"
                        disabled={isShuffling}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleShuffle(index)}
                        className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors"
                        title="Shuffle - get a new team member"
                        disabled={isShuffling}
                      >
                        {isShuffling ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Shuffle className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  )}
                </div>

                <div className="flex gap-4">
                  {/* Avatar with profile type indicator */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="relative">
                      <Avatar 
                        name={isEditing && editForm ? editForm.name : member.name} 
                        size="xl" 
                      />
                      {/* Photo style badge */}
                      {(() => {
                        const imageType = isEditing && editForm ? editForm.profile_image_type : member.profile_image_type;
                        const typeInfo = profileImageTypeInfo[imageType] || profileImageTypeInfo.professional;
                        const TypeIcon = typeInfo.icon;
                        return (
                          <div 
                            className="absolute -bottom-1 -right-1 bg-white border border-gray-200 rounded-full p-1 shadow-sm"
                            title={`AI photo style: ${typeInfo.description}`}
                          >
                            <TypeIcon className="w-3 h-3 text-gray-500" />
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    {isEditing && editForm ? (
                      // Edit mode
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-semibold"
                          placeholder="Name"
                        />
                        <div className="flex items-center gap-2">
                          <Icon className="w-4 h-4 text-gray-500" />
                          <span className="text-sm text-gray-500">{getRoleLabel(member.role)}</span>
                          {member.team && (
                            <>
                              <span className="text-gray-300">|</span>
                              <span className="text-sm text-gray-500">{member.team}</span>
                            </>
                          )}
                        </div>
                        <textarea
                          value={editForm.personality_summary}
                          onChange={(e) => setEditForm({ ...editForm, personality_summary: e.target.value })}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none"
                          rows={2}
                          placeholder="Personality description"
                        />
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">AI Photo Style:</label>
                          <select
                            value={editForm.profile_image_type}
                            onChange={(e) => setEditForm({ ...editForm, profile_image_type: e.target.value })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          >
                            {profileImageTypes.map((type) => {
                              const info = profileImageTypeInfo[type];
                              return (
                                <option key={type} value={type}>
                                  {info.label} - {info.description}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button size="sm" onClick={handleEditSave}>
                            <Check className="w-3 h-3 mr-1" />
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={handleEditCancel}>
                            <X className="w-3 h-3 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <>
                        <div className="flex items-center gap-2 mb-1 pr-16">
                          <h3 className="font-semibold text-gray-900 truncate">
                            {member.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                          <Icon className="w-4 h-4" />
                          <span>{getRoleLabel(member.role)}</span>
                          {member.team && (
                            <>
                              <span className="text-gray-300">|</span>
                              <span>{member.team}</span>
                            </>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-3">
                          {member.personality_summary}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info note about AI photos */}
      <div className="mb-6 p-4 bg-purple-50 border border-purple-100 rounded-lg">
        <div className="flex items-start gap-3">
          <Camera className="w-5 h-5 text-purple-500 mt-0.5" />
          <div>
            <p className="text-sm text-purple-800 font-medium">AI-Generated Profile Photos</p>
            <p className="text-sm text-purple-600 mt-1">
              The icon on each avatar shows the photo style that will be used when generating AI profile pictures. 
              You can enable this in the next step.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Configure & Launch</Button>
      </div>
    </div>
  );
}
