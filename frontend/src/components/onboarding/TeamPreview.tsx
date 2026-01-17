import { useState } from 'react';
import { Button, Avatar, Card, CardContent } from '@/components/common';
import { Users, Code, Shield, Briefcase, Shuffle, Pencil, Check, X, Loader2, Camera, Palmtree, Gamepad2, PawPrint, Palette } from 'lucide-react';
import type { TeamMemberSuggestion } from '@/types';

interface TeamPreviewProps {
  teamMembers: TeamMemberSuggestion[];
  teams: string[];
  onContinue: () => void;
  onBack: () => void;
  onUpdateMember?: (index: number, member: TeamMemberSuggestion) => void;
  onShuffleMember?: (index: number) => Promise<TeamMemberSuggestion | null>;
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
}: TeamPreviewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<TeamMemberSuggestion | null>(null);
  const [shufflingIndex, setShufflingIndex] = useState<number | null>(null);

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
          const Icon = roleIcons[member.role] || Users;
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
                          <span className="text-sm text-gray-500">{roleLabels[member.role]}</span>
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
                          <span>{roleLabels[member.role]}</span>
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
