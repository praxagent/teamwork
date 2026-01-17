import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent } from '@/components/common';
import { useProjects } from '@/hooks/useApi';
import { Users, Rocket, ArrowRight, Kanban, MessageSquare, Code, Zap, Eye, FolderOpen, RotateCcw } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slack-purple to-purple-900">
      {/* Navbar */}
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white/80 text-sm">
          <Users className="w-4 h-4" />
          by praxagent
        </div>
        {projects.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => navigate('/projects')}
            className="!text-white/80 hover:!text-white hover:!bg-white/10"
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            My Projects ({projects.length})
          </Button>
        )}
      </div>

      {/* Hero section */}
      <div className="max-w-6xl mx-auto px-4 pt-12 pb-16 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
          <span className="text-yellow-400">TeamWork</span>
          <span className="ml-3 text-xs font-medium bg-yellow-400/20 text-yellow-400 px-2 py-1 rounded-full align-middle">BETA</span>
          <br />
          <span className="text-3xl md:text-4xl font-normal text-white/90">AI-Powered Development Teams</span>
        </h1>

        <p className="text-xl text-white/80 max-w-2xl mx-auto mb-8">
          Describe your app idea and watch as a virtual team of AI developers, product managers,
          and QA engineers collaborate to bring it to life.
        </p>

        <Button
          variant="secondary"
          size="lg"
          onClick={() => navigate('/new')}
          className="!bg-white !text-slack-purple hover:!bg-gray-100 text-lg px-8 py-4"
        >
          <Rocket className="w-5 h-5 mr-2" />
          Start Building
        </Button>
      </div>

      {/* How it works */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        <h2 className="text-2xl font-bold text-white text-center mb-8">How It Works</h2>
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 text-white/80 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">1</span>
            <span>Describe your app idea</span>
          </div>
          <ArrowRight className="hidden md:block w-5 h-5 text-white/40" />
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">2</span>
            <span>AI generates your team</span>
          </div>
          <ArrowRight className="hidden md:block w-5 h-5 text-white/40" />
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">3</span>
            <span>Watch them build it</span>
          </div>
          <RotateCcw className="hidden md:block w-5 h-5 text-white/40" />
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">↺</span>
            <span>Feedback & Direction</span>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-8">Everything You Need</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={MessageSquare}
            title="Slack-like Chat"
            description="Communicate with your AI team through familiar channels. DM developers, post in #general, or chat in #random."
          />
          <FeatureCard
            icon={Kanban}
            title="Kanban Task Board"
            description="Drag-and-drop task management. Create tickets, track progress from To Do to Done, and restart stuck tasks."
          />
          <FeatureCard
            icon={Code}
            title="Real Code Generation"
            description="Powered by Claude Code. Your AI developers write actual code to a local workspace you can run and deploy."
          />
          <FeatureCard
            icon={Users}
            title="Unique Personalities"
            description="Each team member has a distinct personality, skills, and communication style. They chat, joke, and collaborate naturally."
          />
          <FeatureCard
            icon={Eye}
            title="Live Work Logs"
            description="Watch your agents work in real-time. Inspect Claude Code output, view execution logs, and see code diffs."
          />
          <FeatureCard
            icon={Zap}
            title="Autonomous Execution"
            description="Your PM creates tasks, assigns work, and drives the project. Developers pick up tasks and execute automatically."
          />
        </div>
      </div>

    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <Card className="bg-white/10 border-white/20">
      <CardContent>
        <div className="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center mb-4">
          <Icon className="w-6 h-6 text-white" />
        </div>
        <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
        <p className="text-white/70">{description}</p>
      </CardContent>
    </Card>
  );
}
