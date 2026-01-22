import { useState, useEffect } from 'react';
import { Button, TextArea } from '@/components/common';
import { Rocket, Brain, Users, Sparkles, Zap, GraduationCap, ArrowLeft, BookOpen, Target } from 'lucide-react';

type TeamType = 'software' | 'coaching';

interface AppDescriptionStepProps {
  onSubmit: (description: string) => void;
  onQuickLaunch?: (description: string) => void;
  onBack?: () => void;
  loading?: boolean;
  quickLaunching?: boolean;
  teamType?: TeamType;
}

const softwareLoadingSteps = [
  { icon: Brain, text: 'Analyzing your project requirements...' },
  { icon: Sparkles, text: 'Generating clarifying questions...' },
  { icon: Users, text: 'Preparing your virtual team...' },
];

const coachingLoadingSteps = [
  { icon: Brain, text: 'Analyzing your learning goals...' },
  { icon: Target, text: 'Identifying key topics...' },
  { icon: GraduationCap, text: 'Preparing your coaching team...' },
];

export function AppDescriptionStep({ onSubmit, onQuickLaunch, onBack, loading, quickLaunching, teamType = 'software' }: AppDescriptionStepProps) {
  const [description, setDescription] = useState('');
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const isLoading = loading || quickLaunching;
  const isCoaching = teamType === 'coaching';
  const loadingSteps = isCoaching ? coachingLoadingSteps : softwareLoadingSteps;

  // Cycle through loading steps
  useEffect(() => {
    if (!isLoading) {
      setLoadingStepIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % loadingSteps.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isLoading, loadingSteps.length]);

  const handleQuickLaunch = () => {
    if (description.trim() && onQuickLaunch) {
      onQuickLaunch(description.trim());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim()) {
      onSubmit(description.trim());
    }
  };

  const CurrentLoadingIcon = loadingSteps[loadingStepIndex].icon;

  const HeaderIcon = isCoaching ? GraduationCap : Rocket;
  const title = isCoaching ? 'Describe Your Learning Goals' : 'Describe Your App Idea';
  const subtitle = isCoaching
    ? 'Tell us what you want to learn. Your AI coaches will create a personalized learning plan and support you along the way.'
    : 'Tell us about the application you want to build. Our virtual team will analyze your requirements and create a personalized development team.';

  const placeholder = isCoaching
    ? "Example: I'm preparing for FAANG interviews and need help with system design and algorithms. I also want to refresh my calculus for a course I'm taking..."
    : "Example: I want to build a task management app where users can create projects, add tasks with deadlines, assign tasks to team members, and track progress with visual dashboards...";

  return (
    <div className="max-w-2xl mx-auto">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to team type selection</span>
        </button>
      )}

      <div className="text-center mb-8">
        <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isCoaching ? 'bg-purple-100' : 'bg-slack-purple/10'}`}>
          <HeaderIcon className={`w-8 h-8 ${isCoaching ? 'text-purple-600' : 'text-slack-purple'}`} />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {title}
        </h1>
        <p className="text-gray-600">
          {subtitle}
        </p>
      </div>

      {isLoading ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4 animate-pulse">
            <CurrentLoadingIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {quickLaunching ? 'Launching your team...' : loadingSteps[loadingStepIndex].text}
          </h2>
          <p className="text-gray-500 text-sm">
            {quickLaunching ? 'Setting up with defaults...' : 'This may take 10-20 seconds...'}
          </p>
          <div className="mt-6 flex justify-center gap-2">
            {loadingSteps.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === loadingStepIndex ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              />
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <TextArea
            placeholder={placeholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="text-base"
            disabled={isLoading}
          />

          <div className="flex justify-center gap-4">
            {onQuickLaunch && (
              <button
                type="button"
                disabled={!description.trim() || isLoading}
                onClick={handleQuickLaunch}
                className="inline-flex items-center px-6 py-3 text-base font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-rose-600 hover:bg-rose-700 text-white shadow-sm hover:shadow-md"
              >
                {quickLaunching ? (
                  <div className="w-5 h-5 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Zap className="w-5 h-5 mr-2" />
                )}
                Just Launch
              </button>
            )}
            <button
              type="submit"
              disabled={!description.trim() || isLoading}
              className="inline-flex items-center px-6 py-3 text-base font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md"
            >
              {loading ? (
                <div className="w-5 h-5 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Users className="w-5 h-5 mr-2" />
              )}
              Customize Team
            </button>
          </div>
          
          <div className="text-center text-sm text-gray-500 space-y-1">
            <p><span className="text-rose-600 font-medium">Just Launch</span> — AI answers refining questions for you</p>
            <p><span className="text-blue-600 font-medium">Customize Team</span> — you answer questions and configure settings</p>
          </div>
        </form>
      )}

      {!isLoading && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {isCoaching ? (
            <>
              <ExampleCard
                title="Interview Prep"
                description="System design, algorithms, and behavioral preparation"
                onClick={() => setDescription("I'm preparing for FAANG interviews and need help with system design, algorithms, and behavioral questions. I have about 3 months to prepare and can dedicate 2 hours per day.")}
              />
              <ExampleCard
                title="Academic Support"
                description="College courses like calculus, chemistry, or physics"
                onClick={() => setDescription("I'm struggling with my college courses - calculus, organic chemistry, and physics. I have midterms in 6 weeks and need to understand the fundamentals better.")}
              />
              <ExampleCard
                title="Skill Development"
                description="Learn languages, music, photography, or other skills"
                onClick={() => setDescription("I want to learn French for an upcoming trip to Paris, practice guitar for personal enjoyment, and improve my photography skills. I have evenings and weekends available.")}
              />
            </>
          ) : (
            <>
              <ExampleCard
                title="E-commerce Platform"
                description="Online store with product catalog, shopping cart, and checkout"
                onClick={() => setDescription('I want to build an e-commerce platform where businesses can list their products, customers can browse and search items, add them to a cart, and complete purchases with secure payment processing. It should include user accounts, order history, and inventory management.')}
              />
              <ExampleCard
                title="Social Media App"
                description="User profiles, posts, comments, and real-time notifications"
                onClick={() => setDescription('I want to create a social media application where users can create profiles, share posts with text and images, follow other users, like and comment on posts, and receive real-time notifications. It should have a feed algorithm and direct messaging.')}
              />
              <ExampleCard
                title="Project Management"
                description="Tasks, sprints, team collaboration, and progress tracking"
                onClick={() => setDescription('I want to build a project management tool for software teams. It should support creating projects, organizing tasks into sprints, assigning work to team members, tracking progress with kanban boards and burndown charts, and integrating with GitHub for code commits.')}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ExampleCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-4 text-left border border-gray-200 rounded-lg hover:border-slack-active hover:bg-blue-50 transition-colors"
    >
      <h3 className="font-medium text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </button>
  );
}
