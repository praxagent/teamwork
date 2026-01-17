import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/common';
import { useProjects } from '@/hooks/useApi';
import { Users, Rocket, ArrowRight, FolderOpen, RotateCcw, X } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const { data: projectsData } = useProjects();
  const projects = projectsData?.projects || [];
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null);

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
        
        {/* Desktop: horizontal flow */}
        <div className="hidden md:flex items-center justify-center gap-6 text-white/80">
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
            <span>Watch them build it</span>
          </div>
          <RotateCcw className="w-5 h-5 text-white/40" />
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold">↺</span>
            <span>Feedback & Direction</span>
          </div>
        </div>

        {/* Mobile: vertical timeline */}
        <div className="md:hidden grid grid-cols-2 gap-4 text-white/80">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm">1</span>
            <span>Describe your idea</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm">2</span>
            <span>AI builds your team</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm">3</span>
            <span>Watch them build it</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 bg-yellow-400 text-purple-900 rounded-full flex items-center justify-center font-bold flex-shrink-0 text-sm">↺</span>
            <span>Feedback & iterate</span>
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl font-bold text-white text-center mb-8">Your Virtual Startup</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            image="/screenshots/example_chat.png"
            title="Real-time Team Chat"
            description="Communicate with your AI team through familiar channels. Each agent has unique personality - they chat, joke, and collaborate naturally."
            onImageClick={setEnlargedImage}
          />
          <FeatureCard
            image="/screenshots/kanban_board.png"
            title="Kanban Task Board"
            description="Drag-and-drop task management. Your PM creates tasks, assigns work, and developers execute autonomously."
            onImageClick={setEnlargedImage}
          />
          <FeatureCard
            image="/screenshots/executive_access.png"
            title="Executive Access Terminal"
            description="Drop into an in-browser terminal with Claude Code. Direct access to your workspace with vim, python, and dev tools."
            onImageClick={setEnlargedImage}
          />
          <FeatureCard
            image="/screenshots/step3_meant_your_team.png"
            title="Unique AI Personalities"
            description="Each team member has distinct skills, personality, and communication style. Meet your team before they start building."
            onImageClick={setEnlargedImage}
          />
          <FeatureCard
            image="/screenshots/example_work_log.png"
            title="Live Work Logs"
            description="Watch your agents work in real-time. Inspect Claude Code output, view execution logs, and monitor progress."
            onImageClick={setEnlargedImage}
          />
          <FeatureCard
            image="/screenshots/example_file_viewer.png"
            title="Built-in File Browser"
            description="Browse generated code, view diffs, and explore your workspace. All code is written locally and ready to deploy."
            onImageClick={setEnlargedImage}
          />
        </div>
      </div>

      {/* Image Lightbox */}
      {enlargedImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setEnlargedImage(null)}
        >
          <button 
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            onClick={() => setEnlargedImage(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={enlargedImage} 
            alt="Enlarged view"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

    </div>
  );
}

function FeatureCard({
  image,
  title,
  description,
  onImageClick,
}: {
  image: string;
  title: string;
  description: string;
  onImageClick: (image: string) => void;
}) {
  return (
    <div className="bg-white/10 border border-white/20 rounded-xl overflow-hidden">
      <div 
        className="aspect-video bg-gray-900/50 overflow-hidden cursor-pointer group relative"
        onClick={() => onImageClick(image)}
      >
        <img 
          src={image} 
          alt={title}
          className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <span className="text-white opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
            Click to enlarge
          </span>
        </div>
      </div>
      <div className="p-5">
        <h3 className="font-bold text-white text-lg mb-2">{title}</h3>
        <p className="text-white/70 text-sm">{description}</p>
      </div>
    </div>
  );
}
