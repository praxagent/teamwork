import { useState, useEffect } from 'react';
import { Button, Card, CardContent } from '@/components/common';
import { Settings, Box, Terminal, FolderGit, Globe, Layers, ImageIcon, Zap, Hand, AlertCircle, MonitorPlay, Code2, Key } from 'lucide-react';
import { useSystemCapabilities } from '@/hooks/useApi';

interface ConfigOptionsProps {
  onSubmit: (config: ConfigValues) => void;
  onBack: () => void;
  loading?: boolean;
  projectName?: string;
  projectDescription?: string;
  onProjectDetailsChange?: (name: string, description: string) => void;
  quickLaunching?: boolean;
}

export interface ConfigValues {
  runtime_mode: 'docker';  // Always Docker for security
  workspace_type: 'local_git' | 'browser' | 'hybrid';
  generate_images: boolean;
  auto_execute_tasks: boolean;
  claude_code_mode: 'terminal' | 'programmatic';
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
  quickLaunching = false,
}: ConfigOptionsProps) {
  const { data: capabilities } = useSystemCapabilities();

  // Show simplified loading view during quick launch
  if (quickLaunching) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4 animate-pulse">
            <Zap className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Launching Your Team
          </h1>
          <p className="text-gray-600">
            Configuring workspace and starting your virtual team for <span className="font-semibold">{projectName}</span>...
          </p>
          <div className="mt-6 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        </div>
      </div>
    );
  }
  
  const [config, setConfig] = useState<ConfigValues>({
    runtime_mode: 'docker',  // Always Docker for security
    workspace_type: 'local_git',
    generate_images: true,
    auto_execute_tasks: true,
    claude_code_mode: 'terminal',  // Recommended - real terminal experience
  });
  
  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState(projectDescription);
  
  // Auto-disable image generation if OpenAI is not configured
  useEffect(() => {
    if (capabilities && !capabilities.image_generation_available) {
      setConfig(prev => ({ ...prev, generate_images: false }));
    }
  }, [capabilities]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onProjectDetailsChange) {
      onProjectDetailsChange(name, description);
    }
    onSubmit(config);
  };
  
  const imageGenDisabled = capabilities && !capabilities.image_generation_available;

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

        {/* Docker Runtime Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Box className="w-5 h-5 text-blue-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-800">Secure Docker Environment</h3>
              <p className="text-sm text-blue-700 mt-1">
                Agents run in isolated Docker containers for security. Your workspace is mounted 
                so you can view and edit code in your IDE while agents work.
              </p>
            </div>
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
              description="Code saved to ./workspace/ with git version control. Open in your IDE while agents work."
              badge="Recommended"
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

        {/* Claude Code Mode */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Claude Code Execution
          </h2>
          <div className="space-y-3">
            <OptionCard
              selected={config.claude_code_mode === 'terminal'}
              onClick={() => setConfig({ ...config, claude_code_mode: 'terminal' })}
              icon={MonitorPlay}
              title="Interactive Terminal Mode"
              description="Agents run Claude Code in a real terminal you can watch live and take over."
              badge="Recommended"
            />
            {config.claude_code_mode === 'terminal' && (
              <div className="ml-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Key className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800">Claude Authentication Required</p>
                    <p className="text-green-700 mt-1">
                      This mode gives you a real terminal experience - watch agents code live and 
                      take over if needed. Set <code className="bg-green-100 px-1 rounded">CLAUDE_CONFIG_BASE64</code> in 
                      your .env file with your Claude authentication.
                    </p>
                    <p className="text-green-600 mt-2 text-xs">
                      Generate with: <code className="bg-green-100 px-1 rounded">cat ~/.claude.json | base64</code>
                    </p>
                  </div>
                </div>
              </div>
            )}
            <OptionCard
              selected={config.claude_code_mode === 'programmatic'}
              onClick={() => setConfig({ ...config, claude_code_mode: 'programmatic' })}
              icon={Code2}
              title="Programmatic Mode"
              description="Agents use Claude Code via stdin/stdout piping. Simpler setup, uses ANTHROPIC_API_KEY."
            />
          </div>
        </div>

        {/* Image Generation */}
        <div>
          <h2 className="text-sm font-medium text-gray-700 uppercase tracking-wide mb-3">
            Profile Images
          </h2>
          {imageGenDisabled && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg mb-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800">OpenAI API key not configured</p>
                <p className="text-yellow-700">
                  Add OPENAI_API_KEY to your .env file to enable AI-generated profile images.
                  You can still upload custom images for each agent later.
                </p>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <OptionCard
              selected={config.generate_images && !imageGenDisabled}
              onClick={() => !imageGenDisabled && setConfig({ ...config, generate_images: true })}
              icon={ImageIcon}
              title="Generate AI Profile Images"
              description={imageGenDisabled 
                ? "Unavailable - OpenAI API key required" 
                : "Create unique profile pictures for each team member using AI."}
              badge={imageGenDisabled ? undefined : "Recommended"}
            />
            <OptionCard
              selected={!config.generate_images || imageGenDisabled}
              onClick={() => setConfig({ ...config, generate_images: false })}
              icon={Users}
              title="Use Initials Avatars"
              description="Simple colored avatars with initials. You can upload custom images later."
              badge={imageGenDisabled ? "Selected" : undefined}
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
