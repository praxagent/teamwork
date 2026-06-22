import { useState, useEffect, useCallback } from 'react';
import {
  Save,
  RotateCcw,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Info,
  Download,
  Archive,
  Database,
  Trash2,
  Sparkles,
  Globe,
} from 'lucide-react';
import {
  useUpdateProject,
  useUpdateProjectConfig,
  usePauseProject,
  useResumeProject,
  useResetProject,
  useUserTimezone,
  useSetUserTimezone,
} from '@/hooks/useApi';
import { PluginsSection } from './PluginsSection';
import { TimezonePicker } from '@/components/common/TimezonePicker';
import { useUIStore } from '@/stores';
import type { Project } from '@/types';

interface SettingsPanelProps {
  project: unknown;
}

export function SettingsPanel({ project: projectProp }: SettingsPanelProps) {
  const project = projectProp as Project;
  const darkMode = useUIStore((s) => s.darkMode);

  // Editable fields
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [nameChanged, setNameChanged] = useState(false);
  const [descChanged, setDescChanged] = useState(false);

  // Config values (read from project.config with safe defaults)
  const config = (project.config || {}) as Record<string, unknown>;
  const [autoExecute, setAutoExecute] = useState<boolean>(
    (config.auto_execute_tasks as boolean) ?? true
  );
  const [runtimeMode, setRuntimeMode] = useState<string>(
    (config.runtime_mode as string) || 'docker'
  );
  const [modelMode, setModelMode] = useState<string>(
    (config.model_mode as string) || 'auto'
  );

  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Toast-like status messages
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Mutations
  const updateProject = useUpdateProject();
  const updateConfig = useUpdateProjectConfig();
  const pauseProject = usePauseProject();
  const resumeProject = useResumeProject();
  const resetProject = useResetProject();

  // Sync local state when project prop changes
  useEffect(() => {
    setName(project.name);
    setDescription(project.description || '');
    setNameChanged(false);
    setDescChanged(false);
    const cfg = (project.config || {}) as Record<string, unknown>;
    setAutoExecute((cfg.auto_execute_tasks as boolean) ?? true);
    setRuntimeMode((cfg.runtime_mode as string) || 'docker');
    setModelMode((cfg.model_mode as string) || 'auto');
  }, [project]);

  const showStatus = useCallback(
    (type: 'success' | 'error', text: string) => {
      setStatusMsg({ type, text });
      setTimeout(() => setStatusMsg(null), 3000);
    },
    []
  );

  // Handlers
  const handleSaveDetails = async () => {
    try {
      await updateProject.mutateAsync({
        projectId: project.id,
        ...(nameChanged ? { name } : {}),
        ...(descChanged ? { description } : {}),
      });
      setNameChanged(false);
      setDescChanged(false);
      showStatus('success', 'Project details saved');
    } catch (err) {
      showStatus('error', `Failed to save: ${(err as Error).message}`);
    }
  };

  const handleConfigChange = async (
    patch: Record<string, unknown>
  ) => {
    try {
      await updateConfig.mutateAsync({
        projectId: project.id,
        ...patch,
      });
      showStatus('success', 'Configuration updated');
    } catch (err) {
      showStatus('error', `Failed to update config: ${(err as Error).message}`);
    }
  };

  const handleToggleAutoExecute = () => {
    const next = !autoExecute;
    setAutoExecute(next);
    handleConfigChange({ auto_execute_tasks: next });
  };

  const handleRuntimeChange = (mode: string) => {
    setRuntimeMode(mode);
    handleConfigChange({ runtime_mode: mode });
  };

  const handleModelModeChange = (mode: string) => {
    setModelMode(mode);
    handleConfigChange({ model_mode: mode });
  };

  const handlePause = async () => {
    try {
      const res = await pauseProject.mutateAsync(project.id);
      showStatus('success', res.message || 'Project paused');
    } catch (err) {
      showStatus('error', `Failed to pause: ${(err as Error).message}`);
    }
  };

  const handleResume = async () => {
    try {
      const res = await resumeProject.mutateAsync(project.id);
      showStatus('success', res.message || 'Project resumed');
    } catch (err) {
      showStatus('error', `Failed to resume: ${(err as Error).message}`);
    }
  };

  const handleReset = async () => {
    try {
      await resetProject.mutateAsync(project.id);
      setShowResetConfirm(false);
      showStatus('success', 'Project reset successfully');
    } catch (err) {
      setShowResetConfirm(false);
      showStatus('error', `Failed to reset: ${(err as Error).message}`);
    }
  };

  // Backup state
  const [backingUp, setBackingUp] = useState(false);
  const [backupInfo, setBackupInfo] = useState<{
    file_count: number;
    total_mb: string;
    too_large: boolean;
    max_mb: number;
  } | null>(null);

  // Fetch backup info on mount
  useEffect(() => {
    fetch(`/api/workspace/${project.id}/backup/info`)
      .then((r) => r.json())
      .then(setBackupInfo)
      .catch(() => setBackupInfo(null));
  }, [project.id]);

  // Deployment / reachability (how people reach Prax + the link base URL).
  const [deployment, setDeployment] = useState<{
    available: boolean;
    in_docker?: boolean;
    tailscale_active?: boolean;
    tailscale_hostname?: string | null;
    ts_hostname_env?: string | null;
    ngrok_url?: string | null;
    public_base_url?: string | null;
    public_via?: string | null;
    teamwork_base_url?: string | null;
    effective_base_url?: string | null;
    effective_via?: string | null;
    autodetect?: boolean;
    advisories?: string[];
  } | null>(null);
  useEffect(() => {
    fetch('/api/prax/deployment')
      .then((r) => r.json())
      .then(setDeployment)
      .catch(() => setDeployment(null));
  }, []);

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const resp = await fetch(`/api/workspace/${project.id}/backup`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: 'Download failed' }));
        throw new Error(err.detail);
      }
      // Trigger browser download from the response blob.
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename from Content-Disposition or use fallback.
      const cd = resp.headers.get('Content-Disposition');
      const match = cd?.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] || 'workspace_backup.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showStatus('success', 'Backup downloaded');
    } catch (err) {
      showStatus('error', (err as Error).message);
    } finally {
      setBackingUp(false);
    }
  };

  // Database management state
  const [msgStats, setMsgStats] = useState<{
    total: number;
    last_7_days: number;
    last_30_days: number;
    last_90_days: number;
    older_than_90_days: number;
    db_size_mb: string | null;
  } | null>(null);
  const [cleanupDays, setCleanupDays] = useState(90);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [compactDays, setCompactDays] = useState(30);
  const [compacting, setCompacting] = useState(false);
  const [showCompactConfirm, setShowCompactConfirm] = useState(false);
  const [compactApiKey, setCompactApiKey] = useState('');
  const [compactModel, setCompactModel] = useState('gpt-4o-mini');
  const [compactApiUrl, setCompactApiUrl] = useState('');

  // Fetch message stats on mount.
  const fetchStats = useCallback(() => {
    fetch(`/api/messages/stats/${project.id}`)
      .then((r) => r.json())
      .then(setMsgStats)
      .catch(() => setMsgStats(null));
  }, [project.id]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleCleanup = async () => {
    setCleaningUp(true);
    try {
      const resp = await fetch('/api/messages/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, older_than_days: cleanupDays }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail);
      showStatus('success', data.message);
      setShowCleanupConfirm(false);
      fetchStats();
    } catch (err) {
      showStatus('error', (err as Error).message);
    } finally {
      setCleaningUp(false);
    }
  };

  const handleCompactify = async () => {
    if (!compactApiKey.trim()) {
      showStatus('error', 'Please enter an API key');
      return;
    }
    setCompacting(true);
    try {
      const body: Record<string, unknown> = {
        project_id: project.id,
        older_than_days: compactDays,
        openai_api_key: compactApiKey.trim(),
        model: compactModel.trim() || 'gpt-4o-mini',
      };
      if (compactApiUrl.trim()) {
        body.api_base_url = compactApiUrl.trim();
      }
      const resp = await fetch('/api/messages/compactify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail);
      showStatus('success', data.message);
      setShowCompactConfirm(false);
      setCompactApiKey('');
      setCompactModel('gpt-4o-mini');
      setCompactApiUrl('');
      fetchStats();
    } catch (err) {
      showStatus('error', (err as Error).message);
    } finally {
      setCompacting(false);
    }
  };

  const isPaused = project.status === 'paused';
  const detailsDirty = nameChanged || descChanged;

  // Tailwind-based classes for dark/light
  const card = darkMode
    ? 'bg-slate-800 border border-slate-700 rounded-lg'
    : 'bg-white border border-gray-200 rounded-lg shadow-sm';
  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const inputCls = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-purple-500/20'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:ring-purple-500/20';

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-8">
      {/* Status toast */}
      {statusMsg && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            statusMsg.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          {statusMsg.text}
        </div>
      )}

      {/* Project Status Banner */}
      <div className={card}>
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                isPaused
                  ? 'bg-yellow-400'
                  : project.status === 'active'
                  ? 'bg-green-400'
                  : 'bg-gray-400'
              }`}
            />
            <div>
              <h3 className={`font-semibold ${heading}`}>Project Status</h3>
              <p className={`text-sm ${subtext}`}>
                {isPaused
                  ? 'Paused -- agents are idle'
                  : project.status === 'active'
                  ? 'Active -- agents are working'
                  : `Status: ${project.status}`}
              </p>
            </div>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wide ${
              isPaused
                ? 'bg-yellow-500/10 text-yellow-500'
                : project.status === 'active'
                ? 'bg-green-500/10 text-green-500'
                : darkMode
                ? 'bg-slate-700 text-gray-300'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {project.status}
          </span>
        </div>
      </div>

      {/* Deployment / Reachability */}
      {deployment?.available && (
        <div className={card}>
          <div className="px-6 py-4 border-b border-inherit flex items-center gap-2">
            <Globe className={`w-4 h-4 ${subtext}`} />
            <div>
              <h3 className={`font-semibold ${heading}`}>Deployment &amp; Reachability</h3>
              <p className={`text-sm mt-1 ${subtext}`}>
                How people reach this Prax, and the base URL it uses for shared links.
              </p>
            </div>
          </div>
          <div className="px-6 py-4 space-y-3 text-sm">
            <div className="flex gap-3">
              <span className={`w-28 flex-shrink-0 ${subtext}`}>Network</span>
              <span className={heading}>
                {deployment.tailscale_active
                  ? `Tailscale — ${deployment.tailscale_hostname}`
                  : deployment.ts_hostname_env
                  ? `Tailscale sidecar (${deployment.ts_hostname_env})`
                  : deployment.ngrok_url
                  ? 'ngrok tunnel'
                  : 'Local only'}
                {deployment.in_docker ? ' · Docker' : ''}
              </span>
            </div>
            <div className="flex gap-3">
              <span className={`w-28 flex-shrink-0 ${subtext}`}>Public URL</span>
              <span className={heading}>
                {deployment.public_base_url ? (
                  <a
                    href={deployment.public_base_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-500 hover:underline break-all"
                  >
                    {deployment.public_base_url}
                  </a>
                ) : (
                  <span className={subtext}>none (not reachable off-network)</span>
                )}
                {deployment.public_via && (
                  <span className={`ml-2 ${subtext}`}>via {deployment.public_via}</span>
                )}
              </span>
            </div>
            <div className="flex gap-3">
              <span className={`w-28 flex-shrink-0 ${subtext}`}>Links use</span>
              <span className={`${heading} break-all`}>
                {deployment.effective_base_url || '—'}
                {deployment.effective_via?.startsWith('auto:') && (
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide bg-green-500/10 text-green-500 align-middle">
                    auto-detected
                  </span>
                )}
              </span>
            </div>
            {deployment.advisories && deployment.advisories.length > 0 && (
              <div
                className={`flex items-start gap-2 text-xs pt-1 ${
                  darkMode ? 'text-yellow-400' : 'text-yellow-600'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>{deployment.advisories[0]}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Project Details */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <h3 className={`font-semibold ${heading}`}>Project Details</h3>
          <p className={`text-sm mt-1 ${subtext}`}>
            Update the project name and description.
          </p>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${heading}`}
            >
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameChanged(e.target.value !== project.name);
              }}
              className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${inputCls}`}
            />
          </div>
          <div>
            <label
              className={`block text-sm font-medium mb-1.5 ${heading}`}
            >
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setDescChanged(
                  e.target.value !== (project.description || '')
                );
              }}
              rows={3}
              className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 resize-none ${inputCls}`}
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSaveDetails}
              disabled={!detailsDirty || updateProject.isPending}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                detailsDirty
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : darkMode
                  ? 'bg-slate-700 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {updateProject.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      </div>

      {/* Configuration */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <h3 className={`font-semibold ${heading}`}>Configuration</h3>
          <p className={`text-sm mt-1 ${subtext}`}>
            Control how agents execute tasks and which runtime to use.
          </p>
        </div>
        <div className="px-6 py-4 space-y-6">
          {/* Auto-execute toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${heading}`}>
                Auto-Execute Tasks
              </p>
              <p className={`text-xs mt-0.5 ${subtext}`}>
                Agents will automatically pick up and execute tasks when enabled.
              </p>
            </div>
            <button
              onClick={handleToggleAutoExecute}
              disabled={updateConfig.isPending}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500/20 ${
                autoExecute ? 'bg-purple-600' : darkMode ? 'bg-slate-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  autoExecute ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Runtime mode */}
          <div>
            <p className={`text-sm font-medium mb-2 ${heading}`}>
              Runtime Mode
            </p>
            <p className={`text-xs mb-3 ${subtext}`}>
              Docker provides isolated sandbox environments. Local runs on your machine directly.
            </p>
            <div className="flex gap-2">
              {(['docker', 'local'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleRuntimeChange(mode)}
                  disabled={updateConfig.isPending}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    runtimeMode === mode
                      ? 'bg-purple-600 text-white'
                      : darkMode
                      ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {mode === 'docker' ? 'Docker' : 'Local'}
                </button>
              ))}
            </div>
            {runtimeMode === 'local' && (
              <div className={`mt-2 flex items-start gap-2 text-xs ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Local mode executes code directly on your machine without sandboxing.
                  Use with caution.
                </span>
              </div>
            )}
          </div>

          {/* Model mode */}
          <div>
            <p className={`text-sm font-medium mb-2 ${heading}`}>
              Model Mode
            </p>
            <p className={`text-xs mb-3 ${subtext}`}>
              Choose which AI model agents use for task execution.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'auto', label: 'Auto' },
                { value: 'sonnet', label: 'Sonnet' },
                { value: 'haiku', label: 'Haiku' },
                { value: 'hybrid', label: 'Hybrid' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleModelModeChange(value)}
                  disabled={updateConfig.isPending}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    modelMode === value
                      ? 'bg-purple-600 text-white'
                      : darkMode
                      ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Timezone */}
          <TimezoneSection darkMode={darkMode} heading={heading} subtext={subtext} />
        </div>
      </div>

      {/* Actions */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <h3 className={`font-semibold ${heading}`}>Actions</h3>
          <p className={`text-sm mt-1 ${subtext}`}>
            Pause, resume, or reset the project.
          </p>
        </div>
        <div className="px-6 py-4 space-y-4">
          {/* Pause / Resume */}
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-sm font-medium ${heading}`}>
                {isPaused ? 'Resume Project' : 'Pause Project'}
              </p>
              <p className={`text-xs mt-0.5 ${subtext}`}>
                {isPaused
                  ? 'Agents will resume working on tasks.'
                  : 'All agents will stop working until resumed.'}
              </p>
            </div>
            <button
              onClick={isPaused ? handleResume : handlePause}
              disabled={
                pauseProject.isPending || resumeProject.isPending
              }
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                isPaused
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-yellow-600 text-white hover:bg-yellow-700'
              }`}
            >
              {pauseProject.isPending || resumeProject.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isPaused ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>

          {/* Reset */}
          <div
            className={`pt-4 border-t ${
              darkMode ? 'border-slate-700' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium ${heading}`}>
                  Reset Project
                </p>
                <p className={`text-xs mt-0.5 ${subtext}`}>
                  Clears all messages, resets tasks to pending, and stops agents.
                  This cannot be undone.
                </p>
              </div>
              {!showResetConfirm ? (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      darkMode
                        ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReset}
                    disabled={resetProject.isPending}
                    className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {resetProject.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                    Confirm Reset
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Backup */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <div className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-blue-400" />
            <h3 className={`font-semibold ${heading}`}>Workspace Backup</h3>
          </div>
          <p className={`text-sm mt-1 ${subtext}`}>
            Download your workspace as a zip file. Includes all project
            files — code, configs, notes, images, and generated content.
          </p>
        </div>
        <div className="px-6 py-4 space-y-3">
          {backupInfo && (
            <div className={`text-xs space-y-1 ${subtext}`}>
              <p>{backupInfo.file_count} files, ~{backupInfo.total_mb} MB</p>
              {backupInfo.too_large && (
                <div className={`flex items-start gap-2 ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Backup exceeds the {backupInfo.max_mb} MB limit.
                    Remove large images or generated files to reduce the size.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className={`flex items-start gap-2 text-xs ${darkMode ? 'text-yellow-400/70' : 'text-yellow-600/70'}`}>
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Git history, caches, and build artifacts are excluded.
                200 MB limit.
              </span>
            </div>
            <button
              onClick={handleBackup}
              disabled={backingUp || (backupInfo?.too_large ?? false) || (backupInfo?.file_count === 0)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ml-4 ${
                backingUp || backupInfo?.too_large || backupInfo?.file_count === 0
                  ? darkMode
                    ? 'bg-slate-700 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {backingUp ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {backingUp ? 'Downloading...' : 'Download Backup'}
            </button>
          </div>
        </div>
      </div>

      {/* Database Management */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            <h3 className={`font-semibold ${heading}`}>Database Management</h3>
          </div>
          <p className={`text-sm mt-1 ${subtext}`}>
            Manage message storage. Delete or summarize old conversations to keep the database lean.
          </p>
        </div>
        <div className="px-6 py-4 space-y-5">
          {/* Stats */}
          {msgStats && (
            <div className={`text-xs space-y-1 ${subtext}`}>
              <p className={heading}>
                {msgStats.total.toLocaleString()} messages total
                {msgStats.db_size_mb && <span className={subtext}> · {msgStats.db_size_mb} MB database</span>}
              </p>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[
                  { label: '< 7 days', value: msgStats.last_7_days },
                  { label: '7–30 days', value: msgStats.last_30_days - msgStats.last_7_days },
                  { label: '30–90 days', value: msgStats.last_90_days - msgStats.last_30_days },
                  { label: '> 90 days', value: msgStats.older_than_90_days },
                ].map(({ label, value }) => (
                  <div key={label} className={`rounded-md px-2 py-1.5 text-center ${darkMode ? 'bg-slate-700' : 'bg-gray-50'}`}>
                    <div className={`text-sm font-medium ${heading}`}>{value.toLocaleString()}</div>
                    <div className="text-[10px] mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delete old messages */}
          <div className={`pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <p className={`text-sm font-medium ${heading}`}>Delete Old Messages</p>
            </div>
            <p className={`text-xs mb-3 ${subtext}`}>
              Permanently delete all messages older than a given number of days. This cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <label className={`text-xs ${subtext}`}>Older than</label>
              <select
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Number(e.target.value))}
                className={`rounded-md border px-2 py-1.5 text-sm ${inputCls}`}
              >
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>1 year</option>
              </select>
              {!showCleanupConfirm ? (
                <button
                  onClick={() => setShowCleanupConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCleanupConfirm(false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCleanup}
                    disabled={cleaningUp}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    {cleaningUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                    Confirm Delete
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Compactify old messages */}
          <div className={`pt-3 border-t ${darkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <p className={`text-sm font-medium ${heading}`}>Compactify Old Messages</p>
            </div>
            <p className={`text-xs mb-3 ${subtext}`}>
              Summarize old conversations using an LLM. Replaces chunks of messages with concise
              summaries, preserving key decisions and outcomes. Works with any OpenAI-compatible API
              (OpenAI, Ollama, LM Studio, Groq, Claude via proxy, etc.).
            </p>
            <div className={`flex items-start gap-2 text-xs mb-3 ${darkMode ? 'text-yellow-400/70' : 'text-yellow-600/70'}`}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                This will make LLM API calls that may incur costs (depends on provider/model).
                Original messages are permanently replaced with summaries.
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className={`text-xs ${subtext}`}>Older than</label>
                <select
                  value={compactDays}
                  onChange={(e) => setCompactDays(Number(e.target.value))}
                  className={`rounded-md border px-2 py-1.5 text-sm ${inputCls}`}
                >
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>
              {!showCompactConfirm ? (
                <button
                  onClick={() => setShowCompactConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  Compactify
                </button>
              ) : (
                <div className="space-y-2">
                  <input
                    type="password"
                    value={compactApiKey}
                    onChange={(e) => setCompactApiKey(e.target.value)}
                    placeholder="API key — used once, not stored"
                    className={`w-full rounded-md border px-3 py-1.5 text-xs ${inputCls}`}
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={compactModel}
                      onChange={(e) => setCompactModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${inputCls}`}
                    />
                    <input
                      type="text"
                      value={compactApiUrl}
                      onChange={(e) => setCompactApiUrl(e.target.value)}
                      placeholder="API URL (blank = OpenAI)"
                      className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${inputCls}`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowCompactConfirm(false); setCompactApiKey(''); setCompactModel('gpt-4o-mini'); setCompactApiUrl(''); }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium ${darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-100 text-gray-700'}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCompactify}
                      disabled={compacting || !compactApiKey.trim()}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        compacting || !compactApiKey.trim()
                          ? darkMode ? 'bg-slate-700 text-gray-500 cursor-not-allowed' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {compacting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {compacting ? 'Summarizing...' : 'Confirm Compactify'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Plugins */}
      <PluginsSection />

      {/* Project Info (read-only) */}
      <div className={card}>
        <div className="px-6 py-4 border-b border-inherit">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            <h3 className={`font-semibold ${heading}`}>Project Info</h3>
          </div>
        </div>
        <div className="px-6 py-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <dt className={subtext}>Project ID</dt>
            <dd className={`font-mono text-xs ${heading}`}>{project.id}</dd>
            <dt className={subtext}>Created</dt>
            <dd className={heading}>
              {new Date(project.created_at).toLocaleString()}
            </dd>
            <dt className={subtext}>Last Updated</dt>
            <dd className={heading}>
              {new Date(project.updated_at).toLocaleString()}
            </dd>
            <dt className={subtext}>Project Type</dt>
            <dd className={heading}>
              {(config.project_type as string) || 'software'}
            </dd>
            <dt className={subtext}>Workspace Type</dt>
            <dd className={heading}>
              {(config.workspace_type as string) || 'local'}
            </dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

function TimezoneSection({ darkMode, heading, subtext }: { darkMode: boolean; heading: string; subtext: string }) {
  const { data } = useUserTimezone();
  const setTimezone = useSetUserTimezone();
  const currentTz = data?.timezone || 'UTC';
  const sel = `px-3 py-1.5 rounded-lg border text-sm cursor-pointer outline-none transition-colors ${darkMode ? 'bg-slate-700 text-slate-100 border-slate-600 focus:border-indigo-500' : 'bg-white text-slate-900 border-slate-300 focus:border-indigo-500'}`;

  return (
    <div>
      <p className={`text-sm font-medium mb-2 ${heading}`}>Timezone</p>
      <p className={`text-xs mb-3 ${subtext}`}>
        Default timezone for all schedules and reminders. Individual jobs can override this.
      </p>
      <div className="flex items-center gap-3">
        <TimezonePicker
          value={currentTz}
          onChange={tz => setTimezone.mutate(tz)}
          className={sel}
        />
        {setTimezone.isPending && (
          <span className={`text-xs ${subtext}`}>Saving...</span>
        )}
      </div>
    </div>
  );
}
