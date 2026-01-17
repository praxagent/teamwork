import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { AppDescriptionStep } from './AppDescriptionStep';
import { ClarifyingQuestions } from './ClarifyingQuestions';
import { TeamPreview } from './TeamPreview';
import { ConfigOptions, type ConfigValues } from './ConfigOptions';
import {
  useStartOnboarding,
  useSubmitAnswers,
  useAutoAnswerQuestions,
  useFinalizeProject,
  useShuffleMember,
  useUpdateMember,
  useUpdateProject,
} from '@/hooks/useApi';
import type { TeamMemberSuggestion } from '@/types';

type OnboardingStep = 'description' | 'questions' | 'team' | 'config';

interface OnboardingState {
  projectId: string | null;
  projectName: string;
  projectDescription: string;
  questions: string[];
  teamMembers: TeamMemberSuggestion[];
  teams: string[];
  error: string | null;
  statusMessage: string | null;
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>('description');
  const [state, setState] = useState<OnboardingState>({
    projectId: null,
    projectName: '',
    projectDescription: '',
    questions: [],
    teamMembers: [],
    teams: [],
    error: null,
    statusMessage: null,
  });

  const startOnboarding = useStartOnboarding();
  const submitAnswers = useSubmitAnswers();
  const autoAnswerQuestions = useAutoAnswerQuestions();
  const finalizeProject = useFinalizeProject();
  const shuffleMember = useShuffleMember();
  const updateMember = useUpdateMember();
  const updateProject = useUpdateProject();

  const clearError = () => {
    setState(s => ({ ...s, error: null }));
  };

  const handleDescriptionSubmit = async (description: string) => {
    try {
      setState(s => ({ ...s, error: null, statusMessage: 'Analyzing your project description...' }));
      console.log('[Onboarding] Starting analysis...');
      
      const result = await startOnboarding.mutateAsync(description);
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
      
      setState({
        ...state,
        teamMembers: result.suggested_team_members,
        teams: result.teams,
        error: null,
        statusMessage: null,
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
        },
        generate_images: config.generate_images,
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
      
      // Update local state
      const newMembers = [...state.teamMembers];
      newMembers[index] = newMember;
      setState(s => ({ ...s, teamMembers: newMembers }));
      
      return newMember;
    } catch (error) {
      console.error('[Onboarding] Failed to shuffle member:', error);
      return null;
    }
  };

  const stepIndicators = ['description', 'questions', 'team', 'config'];
  const currentStepIndex = stepIndicators.indexOf(step);

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
        {step === 'description' && (
          <AppDescriptionStep
            onSubmit={handleDescriptionSubmit}
            loading={startOnboarding.isPending}
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
          />
        )}

        {step === 'team' && (
          <TeamPreview
            teamMembers={state.teamMembers}
            teams={state.teams}
            onContinue={() => setStep('config')}
            onBack={() => setStep('questions')}
            onUpdateMember={handleUpdateMember}
            onShuffleMember={handleShuffleMember}
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
          />
        )}
      </div>
    </div>
  );
}
