import { useState } from 'react';
import { Button, Card, CardContent } from '@/components/common';
import { Settings, Box, Terminal, FolderGit, Globe, Layers, ImageIcon, Zap, Hand } from 'lucide-react';

interface ConfigOptionsProps {
  onSubmit: (config: ConfigValues) => void;
  onBack: () => void;
  loading?: boolean;
  projectName?: string;
  projectDescription?: string;
  onProjectDetailsChange?: (name: string, description: string) => void;
}

export interface ConfigValues {
  runtime_mode: 'subprocess' | 'docker';
  workspace_type: 'local' | 'local_git' | 'browser' | 'hybrid';
  generate_images: boolean;
  auto_execute_tasks: boolean;
}

interface OptionCardProps {
  selected: boolean;
  onClick: () => void;
  icon: typeof Terminal;
  title: string;
  description: string;
  badge?: string;
}

function OptionCard({ selected, onClick, icon: Icon, title, description, badge }: OptionCardProps) {
  return (
    <Card
      hoverable
      onClick={onClick}
      className={`cursor-pointer transition-all ${
        selected
          ? 'border-slack-active bg-blue-50 ring-2 ring-slack-active ring-offset-2'
          : ''
      }`}
    >
      <CardContent className="flex items-start gap-3">
        <div
          className={`p-2 rounded-lg ${
            selected ? 'bg-slack-active text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-gray-900">{title}</h3>
            {badge && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded">
                {badge}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{description}</p>
        </div>
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selected ? 'border-slack-active bg-slack-active' : 'border-gray-300'
          }`}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ConfigOptions({ 
  onSubmit, 
  onBack, 
  loading,
  projectName = '',
  projectDescription = '',
  onProjectDetailsChange,
}: ConfigOptionsProps) {
  const [config, setConfig] = useState<ConfigValues>({
    runtime_mode: 'subprocess',
    workspace_type: 'local_git',
    generate_images: true,
    auto_execute_tasks: true,
  });
  
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState(projectDescription);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onProjectDetailsChange) {
      onProjectDetailsChange(name, description);
    }
    onSubmit(config);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
          <Settings className="w-8 h-8 text-orange-600" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Configure Your Setup</h1>
        <p className="text-gray-600">
          Choose how you want your virtual team to work.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Project Details */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Project Details
          </h2>
          <div className="space-y-4 bg-white border border-gray-200 rounded-lg p-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slack-active focus:border-transparent"
                placeholder="My Awesome Project"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slack-active focus:border-transparent resize-none"
                placeholder="A brief description of your project..."
                rows={2}
              />
            </div>
          </div>
        </div>

        {/* Runtime Mode */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Agent Runtime
          </h2>
          <div className="space-y-3">
            <OptionCard
              selected={config.runtime_mode === 'subprocess'}
              onClick={() => setConfig({ ...config, runtime_mode: 'subprocess' })}
              icon={Terminal}
              title="Local Subprocess"
              description="Run agents as local processes. Faster startup, direct file system access."
              badge="Recommended"
            />
            <OptionCard
              selected={config.runtime_mode === 'docker'}
              onClick={() => setConfig({ ...config, runtime_mode: 'docker' })}
              icon={Box}
              title="Docker Containers"
              description="Run agents in isolated containers. Better security and reproducibility."
            />
          </div>
        </div>

        {/* Workspace Type */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Code Workspace
          </h2>
          <div className="space-y-3">
            <OptionCard
              selected={config.workspace_type === 'local_git'}
              onClick={() => setConfig({ ...config, workspace_type: 'local_git' })}
              icon={FolderGit}
              title="Local Directory with Git"
              description="Code saved locally with git version control. Open in your IDE."
              badge="Recommended"
            />
            <OptionCard
              selected={config.workspace_type === 'local'}
              onClick={() => setConfig({ ...config, workspace_type: 'local' })}
              icon={Terminal}
              title="Local Directory"
              description="Code saved locally without git. Simple setup."
            />
            <OptionCard
              selected={config.workspace_type === 'browser'}
              onClick={() => setConfig({ ...config, workspace_type: 'browser' })}
              icon={Globe}
              title="In-Browser Sandbox"
              description="View and edit code directly in the browser."
            />
            <OptionCard
              selected={config.workspace_type === 'hybrid'}
              onClick={() => setConfig({ ...config, workspace_type: 'hybrid' })}
              icon={Layers}
              title="Hybrid"
              description="Local git repo with in-browser code viewer. Best of both worlds."
            />
          </div>
        </div>

        {/* Task Execution */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Task Execution
          </h2>
          <div className="space-y-3">
            <OptionCard
              selected={config.auto_execute_tasks}
              onClick={() => setConfig({ ...config, auto_execute_tasks: true })}
              icon={Zap}
              title="Auto-Execute Tasks"
              description="Agents automatically start working on tasks when created. Hands-off experience."
              badge="Recommended"
            />
            <OptionCard
              selected={!config.auto_execute_tasks}
              onClick={() => setConfig({ ...config, auto_execute_tasks: false })}
              icon={Hand}
              title="Manual Execution"
              description="Review each task before triggering execution. More control over agent work."
            />
          </div>
        </div>

        {/* Image Generation */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Profile Images
          </h2>
          <div className="space-y-3">
            <OptionCard
              selected={config.generate_images}
              onClick={() => setConfig({ ...config, generate_images: true })}
              icon={ImageIcon}
              title="Generate AI Profile Images"
              description="Create unique profile pictures for each team member using AI."
              badge="Recommended"
            />
            <OptionCard
              selected={!config.generate_images}
              onClick={() => setConfig({ ...config, generate_images: false })}
              icon={Users}
              title="Use Initials Avatars"
              description="Simple colored avatars with initials. Faster setup, no API needed."
            />
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button type="button" variant="ghost" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? 'Creating Team...' : 'Launch Virtual Team'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Need to import Users icon that was used but not imported
import { Users } from 'lucide-react';
