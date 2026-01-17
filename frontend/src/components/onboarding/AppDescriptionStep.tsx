import { useState, useEffect } from 'react';
import { Button, TextArea } from '@/components/common';
import { Rocket, Brain, Users, Sparkles } from 'lucide-react';

interface AppDescriptionStepProps {
  onSubmit: (description: string) => void;
  loading?: boolean;
}

const loadingSteps = [
  { icon: Brain, text: 'Analyzing your project requirements...' },
  { icon: Sparkles, text: 'Generating clarifying questions...' },
  { icon: Users, text: 'Preparing your virtual team...' },
];

export function AppDescriptionStep({ onSubmit, loading }: AppDescriptionStepProps) {
  const [description, setDescription] = useState('');
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);

  // Cycle through loading steps
  useEffect(() => {
    if (!loading) {
      setLoadingStepIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % loadingSteps.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (description.trim()) {
      onSubmit(description.trim());
    }
  };

  const CurrentLoadingIcon = loadingSteps[loadingStepIndex].icon;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-slack-purple/10 rounded-full mb-4">
          <Rocket className="w-8 h-8 text-slack-purple" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Describe Your App Idea
        </h1>
        <p className="text-gray-600">
          Tell us about the application you want to build. Our virtual team will analyze your
          requirements and create a personalized development team.
        </p>
      </div>

      {loading ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4 animate-pulse">
            <CurrentLoadingIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {loadingSteps[loadingStepIndex].text}
          </h2>
          <p className="text-gray-500 text-sm">
            This may take 10-20 seconds...
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
            placeholder="Example: I want to build a task management app where users can create projects, add tasks with deadlines, assign tasks to team members, and track progress with visual dashboards..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="text-base"
            disabled={loading}
          />

          <div className="flex justify-center">
            <Button
              type="submit"
              size="lg"
              disabled={!description.trim() || loading}
              loading={loading}
            >
              Create My Virtual Team
            </Button>
          </div>
        </form>
      )}

      {!loading && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
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
