import { useState } from 'react';
import { Button } from '@/components/common';
import {
  GraduationCap,
  ArrowLeft,
  ArrowRight,
  Shuffle,
  User,
  Star,
  BookOpen,
} from 'lucide-react';
import type { TeamMemberSuggestion } from '@/types';

interface CoachPreviewProps {
  teamMembers: TeamMemberSuggestion[];
  topics: string[];
  onContinue: () => void;
  onBack: () => void;
  onShuffleMember: (index: number) => Promise<TeamMemberSuggestion | null>;
  quickLaunching?: boolean;
}

export function CoachPreview({
  teamMembers,
  topics,
  onContinue,
  onBack,
  onShuffleMember,
  quickLaunching,
}: CoachPreviewProps) {
  const [shufflingIndex, setShufflingIndex] = useState<number | null>(null);

  const handleShuffle = async (index: number) => {
    setShufflingIndex(index);
    try {
      await onShuffleMember(index);
    } finally {
      setShufflingIndex(null);
    }
  };

  // Separate personal manager from coaches
  const personalManager = teamMembers.find(m => m.role === 'personal_manager');
  const coaches = teamMembers.filter(m => m.role === 'coach');

  if (quickLaunching) {
    return (
      <div className="max-w-4xl mx-auto text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4 animate-pulse">
          <GraduationCap className="w-8 h-8 text-purple-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Building your coaching team...
        </h2>
        <p className="text-gray-500">Setting up coaches for your learning journey</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
          <GraduationCap className="w-8 h-8 text-purple-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Meet Your Coaching Team
        </h1>
        <p className="text-gray-600">
          Your personalized team of AI coaches ready to help you learn and grow.
        </p>
      </div>

      {/* Topics Overview */}
      <div className="mb-8 text-center">
        <p className="text-sm text-gray-500 mb-2">Topics you'll be learning:</p>
        <div className="flex flex-wrap justify-center gap-2">
          {topics.map((topic, i) => (
            <span
              key={i}
              className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium"
            >
              {topic}
            </span>
          ))}
        </div>
      </div>

      {/* Personal Manager */}
      {personalManager && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" />
            Your Personal Manager
          </h2>
          <CoachCard
            member={personalManager}
            index={teamMembers.indexOf(personalManager)}
            isPersonalManager
            onShuffle={handleShuffle}
            isShuffling={shufflingIndex === teamMembers.indexOf(personalManager)}
          />
        </div>
      )}

      {/* Coaches */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-purple-600" />
          Your Topic Coaches
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {coaches.map((coach, i) => (
            <CoachCard
              key={i}
              member={coach}
              index={teamMembers.indexOf(coach)}
              onShuffle={handleShuffle}
              isShuffling={shufflingIndex === teamMembers.indexOf(coach)}
            />
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onContinue}>
          Continue
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

interface CoachCardProps {
  member: TeamMemberSuggestion;
  index: number;
  isPersonalManager?: boolean;
  onShuffle: (index: number) => void;
  isShuffling: boolean;
}

function CoachCard({ member, index, isPersonalManager, onShuffle, isShuffling }: CoachCardProps) {
  const bgColor = isPersonalManager ? 'bg-yellow-50 border-yellow-200' : 'bg-white border-gray-200';
  const iconBg = isPersonalManager ? 'bg-yellow-100' : 'bg-purple-100';
  const iconColor = isPersonalManager ? 'text-yellow-600' : 'text-purple-600';

  return (
    <div className={`p-4 rounded-lg border ${bgColor}`}>
      <div className="flex items-start gap-4">
        <div className={`flex-shrink-0 w-12 h-12 rounded-full ${iconBg} flex items-center justify-center`}>
          <User className={`w-6 h-6 ${iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{member.name}</h3>
            {isPersonalManager && (
              <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded-full">
                Manager
              </span>
            )}
          </div>
          {member.specialization && (
            <p className="text-sm text-purple-600 font-medium">{member.specialization} Coach</p>
          )}
          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{member.personality_summary}</p>
          {member.teaching_style && (
            <p className="text-xs text-gray-500 mt-1 italic">"{member.teaching_style}"</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onShuffle(index)}
          disabled={isShuffling}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="Get a different coach"
        >
          <Shuffle className={`w-4 h-4 ${isShuffling ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}
