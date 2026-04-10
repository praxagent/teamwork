import { useNavigate, Navigate } from 'react-router-dom';
import { useProjects } from '@/hooks/useApi';
import { Rocket, Github, Server, Key, Layout, MessageSquare, Brain, Monitor, Globe, BookOpen } from 'lucide-react';

export function Home() {
  const navigate = useNavigate();
  const { data: projectsData, isLoading } = useProjects();
  const projects = projectsData?.projects || [];

  // Skip lander and go straight to projects if any exist
  if (!isLoading && projects.length > 0) {
    return <Navigate to="/projects" replace />;
  }

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 via-slate-900 to-indigo-950 overflow-y-auto">
      {/* Hero */}
      <div className="max-w-3xl mx-auto px-5 pt-16 pb-10 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3 leading-tight">
          <span className="bg-gradient-to-r from-white to-indigo-200 bg-clip-text text-transparent">TeamWork</span>
        </h1>
        <p className="text-xl md:text-2xl text-white/90 font-medium mb-3">
          Human + Agent collaboration, elevated.
        </p>
        <p className="text-base md:text-lg text-white/70 mb-6 leading-relaxed max-w-2xl mx-auto">
          Work side-by-side with your own AI agent.  TeamWork ships with Prax — an agent
          that browses the web, writes code, manages your projects, and learns alongside
          you — but you can bring your own.  Not a chatbot portal. A shared workspace
          where humans and agents have the same tools, desktop, and memory.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-8 text-xs">
          <span className="inline-flex items-center gap-1 bg-white/10 border border-white/20 text-white/80 px-2.5 py-1 rounded-full">
            <Github className="w-3 h-3" /> Open Source
          </span>
          <span className="inline-flex items-center gap-1 bg-white/10 border border-white/20 text-white/80 px-2.5 py-1 rounded-full">
            <Server className="w-3 h-3" /> Self-Hosted
          </span>
          <span className="inline-flex items-center gap-1 bg-white/10 border border-white/20 text-white/80 px-2.5 py-1 rounded-full">
            <Key className="w-3 h-3" /> Bring Your Own Keys
          </span>
        </div>

        <button
          onClick={() => navigate('/new')}
          className="px-8 py-3.5 bg-white text-indigo-600 font-semibold rounded-xl text-base hover:bg-gray-100 transition-colors shadow-lg shadow-indigo-500/20"
        >
          <Rocket className="w-5 h-5 inline -mt-0.5 mr-2" />
          Get Started
        </button>
      </div>

      {/* Features */}
      <div className="max-w-4xl mx-auto px-5 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Feature icon={Layout} title="Spaces"
            desc="Organize work into themed spaces — courses, projects, goals. Each with its own Kanban, notebooks, wiki, and chat." />
          <Feature icon={MessageSquare} title="Chat with Prax"
            desc="AI assistant with 100+ tools. Research, write notes, manage tasks, create presentations — all conversationally." />
          <Feature icon={Globe} title="Live Browser"
            desc="Prax browses the web for you. Watch live, take over to log in, or let him work autonomously." />
          <Feature icon={Monitor} title="Linux Desktop"
            desc="Full graphical desktop via noVNC. Run GUI apps, handle OAuth popups, interact with everything Prax sees." />
          <Feature icon={BookOpen} title="Knowledge Base"
            desc="Library with notes, wiki, archive, wikilinks, and graph view. Prax writes deep-dive notes you can edit." />
          <Feature icon={Brain} title="Memory"
            desc="Prax remembers across sessions. Short-term scratchpad, long-term knowledge graph, and conversation history." />
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/8 transition-colors">
      <div className="w-10 h-10 bg-indigo-400/15 rounded-lg flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-indigo-400" />
      </div>
      <h3 className="font-semibold text-white mb-1">{title}</h3>
      <p className="text-white/60 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}
