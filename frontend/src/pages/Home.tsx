import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common';
import { useProjects } from '@/hooks/useApi';
import { Users, Rocket, ArrowRight, FolderOpen, RotateCcw, Github, Server, Key, AlertTriangle, Zap, BookOpen, MessageSquare, Layout, Terminal, UserCheck, Eye, FileCode, GraduationCap, Brain, TrendingUp } from 'lucide-react';

type Mode = 'startup' | 'coaching';

import { useState } from 'react';

export function Home() {
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects || [];
  const [activeMode, setActiveMode] = useState<Mode>('startup');

  return (
    <div className="min-h-screen bg-gradient-to-b from-slack-purple to-purple-900">
      {/* Navbar */}
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <a 
          href="http://praxagent.ai" 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-white/80 text-sm hover:text-white transition-colors"
        >
          <Users className="w-4 h-4" />
          by praxagent
        </a>
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
          <span className="text-3xl md:text-4xl font-normal text-white/90">AI-Powered Virtual Teams</span>
        </h1>

        <p className="text-xl text-white/80 max-w-2xl mx-auto mb-6">
          Build startups with AI dev teams or accelerate your learning with personalized AI coaches.
          Two modes, one platform.
        </p>

        {/* Proof of Concept Warning */}
        <div className="max-w-2xl mx-auto mb-8 bg-yellow-500/20 border border-yellow-400/50 rounded-lg px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="text-left">
              <p className="text-yellow-200 font-semibold text-sm">Proof of Concept Only</p>
              <p className="text-yellow-200/80 text-sm">This is an experimental project for demonstration purposes. Do not rely on it for actual product development or production use.</p>
            </div>
          </div>
        </div>

        {/* Open Source Badges */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8 text-sm">
          <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/90 px-3 py-1.5 rounded-full">
            <Github className="w-4 h-4" />
            Open Source
          </span>
          <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/90 px-3 py-1.5 rounded-full">
            <Server className="w-4 h-4" />
            Self-Hosted
          </span>
          <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 text-white/90 px-3 py-1.5 rounded-full">
            <Key className="w-4 h-4" />
            Bring Your Own API Key
          </span>
        </div>

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

      {/* Mode Selector Tabs */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-6">Choose Your Mode</h2>
        
        <div className="flex justify-center gap-4 mb-8">
          <button 
            onClick={() => setActiveMode('startup')}
            className={`px-6 py-3 rounded-lg font-medium text-lg transition-all flex items-center gap-2 ${
              activeMode === 'startup' 
                ? 'bg-yellow-400 text-purple-900 shadow-lg' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            <Zap className="w-5 h-5" />
            Startup Mode
          </button>
          <button 
            onClick={() => setActiveMode('coaching')}
            className={`px-6 py-3 rounded-lg font-medium text-lg transition-all flex items-center gap-2 ${
              activeMode === 'coaching' 
                ? 'bg-green-400 text-purple-900 shadow-lg' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            Coaching Mode
          </button>
        </div>

        {/* Startup Mode Content */}
        {activeMode === 'startup' && (
          <div>
            <div className="text-center mb-8">
              <h3 className="text-xl font-semibold text-white mb-2">Build Your Startup with AI</h3>
              <p className="text-white/70 max-w-2xl mx-auto">
                Describe your app idea and watch as a virtual team of AI developers, product managers, and QA engineers collaborate to bring it to life.
              </p>
            </div>

            {/* How it works - Startup */}
            <div className="hidden md:flex items-center justify-center gap-6 text-white/80 mb-12">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">1</span>
                <span>Describe your app idea</span>
              </div>
              <ArrowRight className="w-5 h-5 text-white/40" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">2</span>
                <span>AI generates your team</span>
              </div>
              <ArrowRight className="w-5 h-5 text-white/40" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">3</span>
                <span>Manage the build</span>
              </div>
              <RotateCcw className="w-5 h-5 text-white/40" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">↺</span>
                <span>Feedback & Direction</span>
              </div>
            </div>

            {/* Startup Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon={MessageSquare}
                title="Real-time Team Chat"
                description="Communicate with your AI team through familiar channels. Each agent has unique personality."
                color="yellow"
              />
              <FeatureCard
                icon={Layout}
                title="Kanban Task Board"
                description="Drag-and-drop task management. Your PM creates tasks and developers execute autonomously."
                color="yellow"
              />
              <FeatureCard
                icon={Terminal}
                title="Executive Access Terminal"
                description="Launch Claude Code or drop to raw terminal. Run locally or in isolated Docker containers."
                color="yellow"
              />
              <FeatureCard
                icon={UserCheck}
                title="Unique AI Personalities"
                description="Each team member has distinct skills and personality. Meet your team before they start building."
                color="yellow"
              />
              <FeatureCard
                icon={Eye}
                title="Live Sessions & Takeover"
                description="Watch agents work in real-time. Take over anytime to work directly, then hand control back."
                color="yellow"
              />
              <FeatureCard
                icon={FileCode}
                title="Built-in File Browser"
                description="Browse generated code, view diffs, and explore your workspace. Code is written locally."
                color="yellow"
              />
            </div>
          </div>
        )}

        {/* Coaching Mode Content */}
        {activeMode === 'coaching' && (
          <div>
            <div className="text-center mb-8">
              <h3 className="text-xl font-semibold text-white mb-2">Accelerate Your Learning</h3>
              <p className="text-white/70 max-w-2xl mx-auto">
                Get personalized AI coaches for any goal. Languages, math, interview prep, fitness, professional skills, and more - learn and grow with adaptive, intelligent tutors.
              </p>
            </div>

            {/* How it works - Coaching */}
            <div className="hidden md:flex items-center justify-center gap-6 text-white/80 mb-12">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-green-400 text-purple-900 rounded-full flex items-center justify-center font-bold">1</span>
                <span>Describe your learning goals</span>
              </div>
              <ArrowRight className="w-5 h-5 text-white/40" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-green-400 text-purple-900 rounded-full flex items-center justify-center font-bold">2</span>
                <span>AI creates your coaches</span>
              </div>
              <ArrowRight className="w-5 h-5 text-white/40" />
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 bg-green-400 text-purple-900 rounded-full flex items-center justify-center font-bold">3</span>
                <span>Learn & track progress</span>
              </div>
            </div>

            {/* Coaching Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <FeatureCard
                icon={GraduationCap}
                title="Personalized Coaching"
                description="Each coach adapts to your level and learning style. Get explanations, practice problems, and instant feedback."
                color="green"
              />
              <FeatureCard
                icon={Users}
                title="Meet Your Coaches"
                description="AI generates personalized coaches for each topic, each with unique teaching styles and expertise."
                color="green"
              />
              <FeatureCard
                icon={TrendingUp}
                title="Progress Tracking"
                description="Track your learning journey with detailed progress metrics, skill ratings, and topic coverage."
                color="green"
              />
              <FeatureCard
                icon={Brain}
                title="Long-term Memory"
                description="Coaches remember your strengths, weaknesses, and learning style across sessions."
                color="green"
              />
              <FeatureCard
                icon={FileCode}
                title="Markdown Notes"
                description="All progress stored in editable markdown files you can view and customize."
                color="green"
              />
              <FeatureCard
                icon={Layout}
                title="Learning Tasks"
                description="Kanban board for tracking learning goals and practice assignments."
                color="green"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  color: 'yellow' | 'green';
}) {
  const iconBgColor = color === 'yellow' ? 'bg-yellow-400/20' : 'bg-green-400/20';
  const iconTextColor = color === 'yellow' ? 'text-yellow-400' : 'text-green-400';
  
  return (
    <div className="bg-white/10 border border-white/20 rounded-xl p-6">
      <div className={`w-12 h-12 ${iconBgColor} rounded-lg flex items-center justify-center mb-4`}>
        <Icon className={`w-6 h-6 ${iconTextColor}`} />
      </div>
      <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
      <p className="text-white/70 text-sm">{description}</p>
    </div>
  );
}
