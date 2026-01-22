import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { TeamTypeStep } from './TeamTypeStep';
import { AppDescriptionStep } from './AppDescriptionStep';
import { ClarifyingQuestions } from './ClarifyingQuestions';
import { TeamPreview } from './TeamPreview';
import { CoachPreview } from './CoachPreview';
import { ConfigOptions, type ConfigValues } from './ConfigOptions';
import {
  useStartOnboarding,
  useSubmitAnswers,
  useAutoAnswerQuestions,
  useFinalizeProject,
  useShuffleMember,
  useUpdateMember,
  useUpdateProject,
  useGenerateMoreMembers,
} from '@/hooks/useApi';
import type { TeamMemberSuggestion } from '@/types';

type TeamType = 'software' | 'coaching';
type OnboardingStep = 'type' | 'description' | 'questions' | 'team' | 'config';

interface OnboardingState {
  teamType: TeamType;
  projectId: string | null;
  projectName: string;
  projectDescription: string;
  questions: string[];
  teamMembers: TeamMemberSuggestion[];        // Currently visible team
  allGeneratedMembers: TeamMemberSuggestion[]; // All members ever generated (for restore on slider up)
  teams: string[];  // For software: team names; For coaching: topic names
  error: string | null;
  statusMessage: string | null;
  recommendedTeamSize: number;
  desiredTeamSize: number;
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('type');
  const [state, setState] = useState<OnboardingState>({
    teamType: 'software',
    projectId: null,
    projectName: '',
    projectDescription: '',
    questions: [],
    teamMembers: [],
    allGeneratedMembers: [],
    teams: [],
    error: null,
    statusMessage: null,
    recommendedTeamSize: 5,
    desiredTeamSize: 5,
  });

  const handleTeamTypeSelect = (type: TeamType) => {
    setState(s => ({ ...s, teamType: type }));
    setStep('description');
  };

  const startOnboarding = useStartOnboarding();
  const submitAnswers = useSubmitAnswers();
  const autoAnswerQuestions = useAutoAnswerQuestions();
  const finalizeProject = useFinalizeProject();
  const shuffleMember = useShuffleMember();
  const updateMember = useUpdateMember();
  const updateProject = useUpdateProject();
  const generateMoreMembers = useGenerateMoreMembers();
  const [quickLaunching, setQuickLaunching] = useState(false);

  const clearError = () => {
    setState(s => ({ ...s, error: null }));
  };

  const handleDescriptionSubmit = async (description: string) => {
    try {
      const statusMsg = state.teamType === 'coaching'
        ? 'Analyzing your learning goals...'
        : 'Analyzing your project description...';
      setState(s => ({ ...s, error: null, statusMessage: statusMsg }));
      console.log(`[Onboarding] Starting ${state.teamType} analysis...`);

      const result = await startOnboarding.mutateAsync({
        description,
        team_type: state.teamType,
      });
      console.log('[Onboarding] Analysis complete:', result);

      setState({
        ...state,
        projectId: result.initial_analysis.project_id,
        projectName: result.initial_analysis.suggested_name,
        projectDescription: description,
        questions: result.questions,
        error: null,
        statusMessage: null,
      });
      setStep('questions');
    } catch (error) {
      console.error('[Onboarding] Failed to start onboarding:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setState(s => ({
        ...s,
        error: `Failed to analyze project: ${errorMessage}. Please check that ANTHROPIC_API_KEY is set correctly.`,
        statusMessage: null,
      }));
    }
  };

  // Quick launch - skip all interactive steps and use defaults
  // Visually progresses through each step for better UX
  const handleQuickLaunch = async (description: string) => {
    setQuickLaunching(true);

    try {
      // Step 1: Start onboarding (stay on description step)
      const statusMsg = state.teamType === 'coaching'
        ? 'Analyzing your learning goals...'
        : 'Analyzing your project...';
      setState(s => ({ ...s, error: null, statusMessage: statusMsg }));
      console.log(`[Onboarding] Quick launch (${state.teamType}) - starting analysis...`);

      const startResult = await startOnboarding.mutateAsync({
        description,
        team_type: state.teamType,
      });
      const projectId = startResult.initial_analysis.project_id;
      console.log('[Onboarding] Quick launch - project created:', projectId);
      
      // Move to Step 2: Questions (auto-answering)
      setState(s => ({ 
        ...s, 
        projectId,
        projectName: startResult.initial_analysis.suggested_name,
        projectDescription: description,
        questions: startResult.questions,
        statusMessage: 'AI is answering refining questions...' 
      }));
      setStep('questions');
      
      const answersResult = await autoAnswerQuestions.mutateAsync(projectId);
      console.log('[Onboarding] Quick launch - questions answered');
      
      // Move to Step 3: Team (generating)
      setState(s => ({ ...s, statusMessage: 'Generating your virtual team...' }));
      setStep('team');
      
      const teamResult = await submitAnswers.mutateAsync({
        project_id: projectId,
        answers: answersResult.answers,
      });
      console.log('[Onboarding] Quick launch - team generated:', teamResult.suggested_team_members.length, 'members');
      
      // Update state with team info
      setState(s => ({ 
        ...s, 
        teamMembers: teamResult.suggested_team_members,
        allGeneratedMembers: teamResult.suggested_team_members,
        teams: teamResult.teams,
        recommendedTeamSize: teamResult.suggested_team_members.length,
        desiredTeamSize: teamResult.suggested_team_members.length,
        statusMessage: 'Configuring and launching...' 
      }));
      
      // Move to Step 4: Config (finalizing)
      setStep('config');
      
      await finalizeProject.mutateAsync({
        project_id: projectId,
        config: {
          runtime_mode: 'docker',  // Always Docker for security
          workspace_type: 'local_git',  // Code saved locally with git
          auto_execute_tasks: true,
          claude_code_mode: 'terminal',
        },
        generate_images: true,
        team_size: teamResult.suggested_team_members.length,
      });
      console.log('[Onboarding] Quick launch - project finalized!');
      
      // Navigate to the project
      navigate(`/project/${projectId}`);
      
    } catch (error) {
      console.error('[Onboarding] Quick launch failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setState(s => ({ 
        ...s, 
        error: `Quick launch failed: ${errorMessage}`,
        statusMessage: null,
      }));
    } finally {
      setQuickLaunching(false);
    }
  };

  const handleQuestionsSubmit = async (answers: string[]) => {
    if (!state.projectId) return;

    try {
      setState(s => ({ ...s, error: null, statusMessage: 'Analyzing your answers and building team...' }));
      console.log('[Onboarding] Submitting answers...');
      
      const result = await submitAnswers.mutateAsync({
        project_id: state.projectId,
        answers,
      });
      console.log('[Onboarding] Team generated:', result);
      
      const teamSize = result.suggested_team_members.length;
      setState({
        ...state,
        teamMembers: result.suggested_team_members,
        allGeneratedMembers: result.suggested_team_members,
        teams: result.teams,
        error: null,
        statusMessage: null,
        recommendedTeamSize: teamSize,
        desiredTeamSize: teamSize,
      });
      setStep('team');
    } catch (error) {
      console.error('[Onboarding] Failed to submit answers:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setState(s => ({ 
        ...s, 
        error: `Failed to generate team: ${errorMessage}`,
        statusMessage: null,
      }));
    }
  };

  const handleAutoAnswer = async (): Promise<string[]> => {
    if (!state.projectId) {
      console.error('[Onboarding] No project ID for auto-answer');
      setState(s => ({ ...s, error: 'No project found. Please start over.' }));
      return [];
    }

    try {
      setState(s => ({ ...s, statusMessage: 'AI is generating answers...', error: null }));
      console.log('[Onboarding] Auto-answering questions for project:', state.projectId);
      
      const result = await autoAnswerQuestions.mutateAsync(state.projectId);
      console.log('[Onboarding] Auto-answers generated:', result);
      
      if (!result.answers || result.answers.length === 0) {
        setState(s => ({ ...s, statusMessage: null, error: 'AI returned empty answers. Please try again.' }));
        return [];
      }
      
      setState(s => ({ ...s, statusMessage: null }));
      return result.answers;
    } catch (error) {
      console.error('[Onboarding] Failed to auto-answer questions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState(s => ({ 
        ...s, 
        statusMessage: null,
        error: `Failed to generate answers: ${errorMessage}. The session may have expired - try starting over.`
      }));
      return [];
    }
  };

  const handleConfigSubmit = async (config: ConfigValues) => {
    if (!state.projectId) return;

    try {
      setState(s => ({ ...s, error: null, statusMessage: 'Creating your virtual team...' }));
      console.log('[Onboarding] Finalizing project...');
      
      await finalizeProject.mutateAsync({
        project_id: state.projectId,
        config: {
          runtime_mode: config.runtime_mode,
          workspace_type: config.workspace_type,
          auto_execute_tasks: config.auto_execute_tasks,
          claude_code_mode: config.claude_code_mode,
        },
        generate_images: config.generate_images,
        team_size: state.desiredTeamSize,
      });
      console.log('[Onboarding] Project finalized, navigating...');
      
      // Navigate to the project
      navigate(`/project/${state.projectId}`);
    } catch (error) {
      console.error('[Onboarding] Failed to finalize project:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setState(s => ({ 
        ...s, 
        error: `Failed to create team: ${errorMessage}`,
        statusMessage: null,
      }));
    }
  };

  const handleUpdateMember = async (index: number, member: TeamMemberSuggestion) => {
    if (!state.projectId) return;
    
    try {
      await updateMember.mutateAsync({
        project_id: state.projectId,
        member_index: index,
        name: member.name,
        personality_summary: member.personality_summary,
        profile_image_type: member.profile_image_type,
      });
      
      // Update local state
      const newMembers = [...state.teamMembers];
      newMembers[index] = member;
      setState(s => ({ ...s, teamMembers: newMembers }));
    } catch (error) {
      console.error('[Onboarding] Failed to update member:', error);
    }
  };

  const handleShuffleMember = async (index: number): Promise<TeamMemberSuggestion | null> => {
    if (!state.projectId) return null;
    
    try {
      const newMember = await shuffleMember.mutateAsync({
        project_id: state.projectId,
        member_index: index,
      });
      
      // Update local state - both visible and all generated
      const newMembers = [...state.teamMembers];
      const newAllMembers = [...state.allGeneratedMembers];
      newMembers[index] = newMember;
      newAllMembers[index] = newMember;
      setState(s => ({ ...s, teamMembers: newMembers, allGeneratedMembers: newAllMembers }));
      
      return newMember;
    } catch (error) {
      console.error('[Onboarding] Failed to shuffle member:', error);
      return null;
    }
  };

  // Smart team size adjustment - keeps members in memory
  const handleTeamSizeChange = (newSize: number) => {
    setState(s => {
      const currentAllMembers = s.allGeneratedMembers;
      
      if (newSize <= currentAllMembers.length) {
        // Reducing: intelligently select which members to keep
        // Priority: PM first, then QA, then developers
        const sortedMembers = [...currentAllMembers].map((m, i) => ({ member: m, originalIndex: i }));
        
        // Score members: PM=100, QA=50, Developer=10 (plus index for stable ordering)
        const scoreMember = (m: TeamMemberSuggestion, idx: number) => {
          const role = m.role?.toLowerCase() || '';
          if (role.includes('pm') || role.includes('product')) return 100 + (100 - idx);
          if (role.includes('qa') || role.includes('quality') || role.includes('test')) return 50 + (100 - idx);
          return 10 + (100 - idx); // Developers - prefer earlier ones
        };
        
        sortedMembers.sort((a, b) => scoreMember(b.member, b.originalIndex) - scoreMember(a.member, a.originalIndex));
        
        // Keep the top N members
        const keptMembers = sortedMembers.slice(0, newSize).map(m => m.member);
        
        return {
          ...s,
          desiredTeamSize: newSize,
          teamMembers: keptMembers,
        };
      } else {
        // Increasing: restore from allGeneratedMembers if available
        const visibleMembers = currentAllMembers.slice(0, Math.min(newSize, currentAllMembers.length));
        
        return {
          ...s,
          desiredTeamSize: newSize,
          teamMembers: visibleMembers,
        };
      }
    });
  };

  // Regenerate team to match desired size
  const handleRegenerateTeam = async () => {
    if (!state.projectId) return;
    
    const currentCount = state.allGeneratedMembers.length;
    const desiredCount = state.desiredTeamSize;
    
    if (desiredCount > currentCount) {
      // Need to generate more members
      const countNeeded = desiredCount - currentCount;
      
      try {
        setState(s => ({ ...s, statusMessage: `Generating ${countNeeded} additional team member(s)...` }));
        
        const result = await generateMoreMembers.mutateAsync({
          project_id: state.projectId!,
          count: countNeeded,
        });
        
        // Add new members to both arrays
        const newAllMembers = [...state.allGeneratedMembers, ...result.new_members];
        const newVisibleMembers = newAllMembers.slice(0, desiredCount);
        
        setState(s => ({
          ...s,
          allGeneratedMembers: newAllMembers,
          teamMembers: newVisibleMembers,
          statusMessage: null,
        }));
      } catch (error) {
        console.error('[Onboarding] Failed to generate more members:', error);
        setState(s => ({ 
          ...s, 
          error: 'Failed to generate additional team members',
          statusMessage: null,
        }));
      }
    } else {
      // Just update visible members from allGeneratedMembers
      handleTeamSizeChange(desiredCount);
    }
  };

  // Step indicators differ based on team type and current step
  const getStepIndicators = () => {
    if (step === 'type') {
      // On type selection, show generic 4 steps
      return ['type', 'description', 'questions', 'team'];
    }
    // After type is selected, show the 4-step flow
    return ['description', 'questions', 'team', 'config'];
  };

  const stepIndicators = getStepIndicators();
  const currentStepIndex = step === 'type' ? 0 : stepIndicators.indexOf(step);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Progress indicator */}
      <div className="bg-white border-b border-gray-200 py-4">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-center gap-2">
            {stepIndicators.map((s, i) => (
              <div key={s} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    i <= currentStepIndex
                      ? 'bg-slack-active text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {i + 1}
                </div>
                {i < stepIndicators.length - 1 && (
                  <div
                    className={`w-12 h-1 mx-1 ${
                      i < currentStepIndex ? 'bg-slack-active' : 'bg-gray-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Error message */}
      {state.error && (
        <div className="max-w-2xl mx-auto mt-4 px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-red-800">Error</h3>
              <p className="text-sm text-red-700 mt-1">{state.error}</p>
              <button 
                onClick={clearError}
                className="text-sm text-red-600 hover:text-red-800 underline mt-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status message */}
      {state.statusMessage && (
        <div className="max-w-2xl mx-auto mt-4 px-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm text-blue-700">{state.statusMessage}</p>
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="py-12 px-4">
        {step === 'type' && (
          <TeamTypeStep onSelect={handleTeamTypeSelect} />
        )}

        {step === 'description' && (
          <AppDescriptionStep
            onSubmit={handleDescriptionSubmit}
            onQuickLaunch={handleQuickLaunch}
            onBack={() => setStep('type')}
            loading={startOnboarding.isPending}
            quickLaunching={quickLaunching}
            teamType={state.teamType}
          />
        )}

        {step === 'questions' && (
          <ClarifyingQuestions
            questions={state.questions}
            projectName={state.projectName}
            onSubmit={handleQuestionsSubmit}
            onBack={() => setStep('description')}
            onAutoAnswer={handleAutoAnswer}
            loading={submitAnswers.isPending}
            autoAnswerLoading={autoAnswerQuestions.isPending}
            quickLaunching={quickLaunching}
          />
        )}

        {step === 'team' && state.teamType === 'coaching' && (
          <CoachPreview
            teamMembers={state.teamMembers}
            topics={state.teams}
            onContinue={() => setStep('config')}
            onBack={() => setStep('questions')}
            onShuffleMember={handleShuffleMember}
            quickLaunching={quickLaunching}
          />
        )}

        {step === 'team' && state.teamType === 'software' && (
          <TeamPreview
            teamMembers={state.teamMembers}
            teams={state.teams}
            onContinue={() => setStep('config')}
            onBack={() => setStep('questions')}
            onUpdateMember={handleUpdateMember}
            onShuffleMember={handleShuffleMember}
            recommendedTeamSize={state.recommendedTeamSize}
            desiredTeamSize={state.desiredTeamSize}
            maxGeneratedSize={state.allGeneratedMembers.length}
            onTeamSizeChange={handleTeamSizeChange}
            onRegenerateTeam={handleRegenerateTeam}
            isRegenerating={generateMoreMembers.isPending}
            quickLaunching={quickLaunching}
          />
        )}

        {step === 'config' && (
          <ConfigOptions
            onSubmit={handleConfigSubmit}
            onBack={() => setStep('team')}
            loading={finalizeProject.isPending}
            projectName={state.projectName}
            projectDescription={state.projectDescription}
            onProjectDetailsChange={async (name, description) => {
              setState(s => ({ ...s, projectName: name, projectDescription: description }));
              // Also update in backend
              if (state.projectId) {
                try {
                  await updateProject.mutateAsync({
                    projectId: state.projectId,
                    name,
                    description,
                  });
                } catch (error) {
                  console.error('Failed to update project details:', error);
                }
              }
            }}
            quickLaunching={quickLaunching}
          />
        )}
      </div>
    </div>
  );
}
