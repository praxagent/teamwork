import { useState } from 'react';
import {
  Package,
  RefreshCw,
  Trash2,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  X,
  BookOpen,
  Download,
} from 'lucide-react';
import {
  usePlugins,
  useImportPlugin,
  useRemovePlugin,
  useUpdatePlugin,
  useAcknowledgePlugin,
  usePluginSecurity,
  usePluginSkills,
  useCheckPluginUpdates,
  useCheckAllPluginUpdates,
  useUpdateAllPlugins,
} from '@/hooks/useApi';
import type { SecurityWarning, PluginUpdateCheck } from '@/hooks/useApi';
import { useUIStore } from '@/stores';
import { MarkdownContent } from '@/components/common/MarkdownContent';

export function PluginsSection() {
  const darkMode = useUIStore((s) => s.darkMode);
  const { data: plugins, isLoading } = usePlugins();
  const importPlugin = useImportPlugin();
  const removePlugin = useRemovePlugin();
  const updatePlugin = useUpdatePlugin();
  const acknowledgePlugin = useAcknowledgePlugin();

  // Import form state
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importName, setImportName] = useState('');
  const [importSubfolder, setImportSubfolder] = useState('');

  // Security scan state
  const [scanningPlugin, setScanningPlugin] = useState<string | null>(null);
  const { data: securityData } = usePluginSecurity(scanningPlugin);

  // Skills viewer state
  const [skillsPlugin, setSkillsPlugin] = useState<string | null>(null);
  const { data: skillsData, isLoading: skillsLoading } = usePluginSkills(skillsPlugin);

  // Check-for-updates state
  const [checkingPlugin, setCheckingPlugin] = useState<string | null>(null);
  const { data: updateCheckData, isLoading: updateCheckLoading } = useCheckPluginUpdates(checkingPlugin);

  // Bulk update operations
  const checkAllUpdates = useCheckAllPluginUpdates();
  const updateAllPlugins = useUpdateAllPlugins();
  const [bulkCheckResults, setBulkCheckResults] = useState<PluginUpdateCheck[] | null>(null);

  // Confirm remove
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // Expanded warnings
  const [expandedWarnings, setExpandedWarnings] = useState<string | null>(null);

  // Status message
  const [statusMsg, setStatusMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMsg({ type, text });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    try {
      const result = await importPlugin.mutateAsync({
        repo_url: importUrl.trim(),
        ...(importName.trim() ? { name: importName.trim() } : {}),
        ...(importSubfolder.trim()
          ? { plugin_subfolder: importSubfolder.trim() }
          : {}),
      });
      if (result.error) {
        showStatus('error', result.error);
      } else {
        showStatus('success', `Plugin "${result.name}" imported successfully`);
        setShowImport(false);
        setImportUrl('');
        setImportName('');
        setImportSubfolder('');
      }
    } catch (err) {
      showStatus('error', `Import failed: ${(err as Error).message}`);
    }
  };

  const handleRemove = async (name: string) => {
    try {
      await removePlugin.mutateAsync(name);
      showStatus('success', `Plugin "${name}" removed`);
      setConfirmRemove(null);
    } catch (err) {
      showStatus('error', `Remove failed: ${(err as Error).message}`);
    }
  };

  const handleUpdate = async (name: string) => {
    try {
      await updatePlugin.mutateAsync(name);
      showStatus('success', `Plugin "${name}" updated`);
    } catch (err) {
      showStatus('error', `Update failed: ${(err as Error).message}`);
    }
  };

  const handleAcknowledge = async (name: string) => {
    try {
      await acknowledgePlugin.mutateAsync(name);
      showStatus('success', `Security warnings acknowledged for "${name}"`);
    } catch (err) {
      showStatus('error', `Acknowledge failed: ${(err as Error).message}`);
    }
  };

  // Style helpers
  const card = darkMode
    ? 'bg-slate-800 border border-slate-700 rounded-lg'
    : 'bg-white border border-gray-200 rounded-lg shadow-sm';
  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const inputCls = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-purple-500/20'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:border-purple-500 focus:ring-purple-500/20';
  const rowBg = darkMode
    ? 'hover:bg-slate-700/50'
    : 'hover:bg-gray-50';

  const tierBadge = (tier: string) => {
    const styles: Record<string, string> = {
      builtin: 'bg-green-500/10 text-green-500',
      workspace: 'bg-blue-500/10 text-blue-500',
      imported: 'bg-amber-500/10 text-amber-500',
    };
    return styles[tier] || styles.imported;
  };

  return (
    <div className={card}>
      {/* Status toast */}
      {statusMsg && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
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

      {/* Header */}
      <div className="px-6 py-4 border-b border-inherit flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-400" />
            <h3 className={`font-semibold ${heading}`}>Plugins</h3>
          </div>
          <p className={`text-sm mt-1 ${subtext}`}>
            Manage imported plugins. Plugins extend Prax with new tools and capabilities.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {plugins && plugins.length > 0 && (
            <>
              <button
                onClick={async () => {
                  try {
                    const results = await checkAllUpdates.mutateAsync();
                    setBulkCheckResults(results);
                    const withUpdates = results.filter((r) => r.update_available);
                    if (withUpdates.length === 0) {
                      showStatus('success', 'All plugins are up to date');
                    } else {
                      showStatus(
                        'success',
                        `${withUpdates.length} plugin${withUpdates.length !== 1 ? 's have' : ' has'} updates available`
                      );
                    }
                  } catch (err) {
                    showStatus('error', `Check failed: ${(err as Error).message}`);
                  }
                }}
                disabled={checkAllUpdates.isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  darkMode
                    ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {checkAllUpdates.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Check All
              </button>
              <button
                onClick={async () => {
                  try {
                    const results = await updateAllPlugins.mutateAsync();
                    const updated = results.filter((r) => r.status === 'updated');
                    const errors = results.filter((r) => r.error);
                    setBulkCheckResults(null);
                    if (errors.length > 0) {
                      showStatus('error', `${errors.length} plugin${errors.length !== 1 ? 's' : ''} failed to update`);
                    } else if (updated.length === 0) {
                      showStatus('success', 'All plugins already up to date');
                    } else {
                      showStatus('success', `${updated.length} plugin${updated.length !== 1 ? 's' : ''} updated`);
                    }
                  } catch (err) {
                    showStatus('error', `Update all failed: ${(err as Error).message}`);
                  }
                }}
                disabled={updateAllPlugins.isPending}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  darkMode
                    ? 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {updateAllPlugins.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Update All
              </button>
            </>
          )}
          <button
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
          >
            {showImport ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {showImport ? 'Cancel' : 'Import Plugin'}
          </button>
        </div>
      </div>

      {/* Import form */}
      {showImport && (
        <div
          className={`px-6 py-4 border-b ${
            darkMode ? 'border-slate-700 bg-slate-750' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="space-y-3">
            <div>
              <label className={`block text-sm font-medium mb-1 ${heading}`}>
                Git Repository URL <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://github.com/user/plugin-repo.git"
                className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${inputCls}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={`block text-sm font-medium mb-1 ${heading}`}>
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="Auto-detected from URL"
                  className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${inputCls}`}
                />
              </div>
              <div>
                <label className={`block text-sm font-medium mb-1 ${heading}`}>
                  Subfolder (optional)
                </label>
                <input
                  type="text"
                  value={importSubfolder}
                  onChange={(e) => setImportSubfolder(e.target.value)}
                  placeholder="e.g. plugins/weather"
                  className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${inputCls}`}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={!importUrl.trim() || importPlugin.isPending}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  importUrl.trim() && !importPlugin.isPending
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : darkMode
                    ? 'bg-slate-700 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {importPlugin.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Import
              </button>
              {importPlugin.isPending && (
                <span className={`text-xs ${subtext}`}>
                  Cloning repository...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bulk check results */}
      {bulkCheckResults && bulkCheckResults.length > 0 && (
        <div
          className={`mx-6 mt-4 rounded-lg border text-xs ${
            darkMode ? 'border-slate-600 bg-slate-750' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className={`px-3 py-2 flex items-center justify-between border-b ${
            darkMode ? 'border-slate-600' : 'border-gray-200'
          }`}>
            <span className={`font-medium ${heading}`}>Update status</span>
            <button
              onClick={() => setBulkCheckResults(null)}
              className={`p-0.5 rounded ${darkMode ? 'hover:bg-slate-600 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="px-3 py-2 space-y-1">
            {bulkCheckResults.map((r) => (
              <div key={r.name} className="flex items-center gap-2">
                {r.update_available ? (
                  <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                ) : (
                  <CheckCircle2 className={`w-3 h-3 shrink-0 ${darkMode ? 'text-green-400' : 'text-green-600'}`} />
                )}
                <span className={`font-medium ${heading}`}>{r.name}</span>
                {r.update_available ? (
                  <span className="text-amber-500">
                    {r.commits_behind} commit{r.commits_behind !== 1 ? 's' : ''} behind
                    <span className={`ml-1 font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {r.local_commit} → {r.remote_commit}
                    </span>
                  </span>
                ) : (
                  <span className={subtext}>up to date</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plugin list */}
      <div className="px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className={`w-5 h-5 animate-spin ${subtext}`} />
          </div>
        ) : !plugins || plugins.length === 0 ? (
          <div className={`text-center py-8 ${subtext}`}>
            <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No plugins installed.</p>
            <p className="text-xs mt-1">
              Import a plugin from a git repository to extend Prax's capabilities.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <div key={plugin.name}>
                <div
                  className={`rounded-lg px-4 py-3 transition-colors ${rowBg}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium text-sm ${heading}`}>
                          {plugin.name}
                        </span>
                        {plugin.active_version && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              darkMode
                                ? 'bg-slate-600 text-gray-300'
                                : 'bg-gray-200 text-gray-600'
                            }`}
                          >
                            v{plugin.active_version}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge(
                            plugin.trust_tier
                          )}`}
                        >
                          {plugin.trust_tier}
                        </span>
                        {!plugin.security_warnings_acknowledged && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-500">
                            warnings
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <a
                          href={plugin.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`text-xs truncate max-w-[300px] hover:underline ${subtext}`}
                        >
                          {plugin.url}
                          <ExternalLink className="w-3 h-3 inline ml-1" />
                        </a>
                        {plugin.plugins_found.length > 0 && (
                          <span className={`text-xs ${subtext}`}>
                            ({plugin.plugins_found.length} tool
                            {plugin.plugins_found.length !== 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 ml-3">
                      {!plugin.security_warnings_acknowledged && (
                        <button
                          onClick={() => handleAcknowledge(plugin.name)}
                          disabled={acknowledgePlugin.isPending}
                          title="Acknowledge security warnings"
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setSkillsPlugin(
                            skillsPlugin === plugin.name
                              ? null
                              : plugin.name
                          )
                        }
                        title="View Skills"
                        className={`p-1.5 rounded transition-colors ${
                          skillsPlugin === plugin.name
                            ? darkMode
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-purple-100 text-purple-600'
                            : darkMode
                            ? 'hover:bg-slate-600 text-gray-400'
                            : 'hover:bg-gray-200 text-gray-500'
                        }`}
                      >
                        <BookOpen className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          setScanningPlugin(
                            scanningPlugin === plugin.name
                              ? null
                              : plugin.name
                          )
                        }
                        title="Security scan"
                        className={`p-1.5 rounded transition-colors ${
                          darkMode
                            ? 'hover:bg-slate-600 text-gray-400'
                            : 'hover:bg-gray-200 text-gray-500'
                        }`}
                      >
                        <Shield className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          setCheckingPlugin(
                            checkingPlugin === plugin.name
                              ? null
                              : plugin.name
                          )
                        }
                        title="Check for updates"
                        className={`p-1.5 rounded transition-colors ${
                          checkingPlugin === plugin.name
                            ? darkMode
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-blue-100 text-blue-600'
                            : darkMode
                            ? 'hover:bg-slate-600 text-gray-400'
                            : 'hover:bg-gray-200 text-gray-500'
                        }`}
                      >
                        {updateCheckLoading && checkingPlugin === plugin.name ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleUpdate(plugin.name)}
                        disabled={updatePlugin.isPending}
                        title="Pull latest version"
                        className={`p-1.5 rounded transition-colors ${
                          darkMode
                            ? 'hover:bg-slate-600 text-gray-400'
                            : 'hover:bg-gray-200 text-gray-500'
                        }`}
                      >
                        {updatePlugin.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                      </button>
                      {confirmRemove === plugin.name ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setConfirmRemove(null)}
                            className={`px-2 py-1 rounded text-xs ${
                              darkMode
                                ? 'bg-slate-700 text-gray-300'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRemove(plugin.name)}
                            disabled={removePlugin.isPending}
                            className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700"
                          >
                            {removePlugin.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              'Remove'
                            )}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmRemove(plugin.name)}
                          title="Remove plugin"
                          className={`p-1.5 rounded transition-colors ${
                            darkMode
                              ? 'hover:bg-red-500/20 text-gray-400 hover:text-red-400'
                              : 'hover:bg-red-50 text-gray-500 hover:text-red-500'
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Security scan results */}
                  {scanningPlugin === plugin.name && (
                    <SecurityWarnings
                      warnings={securityData?.warnings || []}
                      darkMode={darkMode}
                      expanded={expandedWarnings === plugin.name}
                      onToggle={() =>
                        setExpandedWarnings(
                          expandedWarnings === plugin.name
                            ? null
                            : plugin.name
                        )
                      }
                    />
                  )}

                  {/* Skills viewer */}
                  {skillsPlugin === plugin.name && (
                    <SkillsViewer
                      data={skillsData}
                      isLoading={skillsLoading}
                      darkMode={darkMode}
                    />
                  )}

                  {/* Update check result */}
                  {checkingPlugin === plugin.name && !updateCheckLoading && updateCheckData && (
                    <div
                      className={`mt-2 flex items-center gap-2 text-xs ${
                        updateCheckData.update_available
                          ? darkMode ? 'text-amber-400' : 'text-amber-600'
                          : darkMode ? 'text-green-400' : 'text-green-600'
                      }`}
                    >
                      {updateCheckData.update_available ? (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>
                            Update available — {updateCheckData.commits_behind} commit{updateCheckData.commits_behind !== 1 ? 's' : ''} behind
                            <span className={`ml-2 font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              {updateCheckData.local_commit} → {updateCheckData.remote_commit}
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Up to date ({updateCheckData.local_commit})</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillsViewer({
  data,
  isLoading,
  darkMode,
}: {
  data: {
    name: string;
    skills?: { subfolder: string | null; content: string; version?: string; description?: string; tools?: string[] }[];
    subfolder?: string;
    content?: string;
    version?: string;
    description?: string;
    tools?: string[];
  } | undefined;
  isLoading: boolean;
  darkMode: boolean;
}) {
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const heading = darkMode ? 'text-gray-100' : 'text-gray-900';
  const [activeTab, setActiveTab] = useState(0);

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs">
        <Loader2 className={`w-3.5 h-3.5 animate-spin ${subtext}`} />
        <span className={subtext}>Loading skills...</span>
      </div>
    );
  }

  // Normalize — handle both multi-skill and single-skill response shapes.
  const skills = data?.skills || (data?.content
    ? [{ subfolder: data.subfolder || null, content: data.content, version: data.version, description: data.description, tools: data.tools }]
    : []);

  if (skills.length === 0) {
    return (
      <div className={`mt-3 flex items-center gap-2 text-xs ${subtext}`}>
        <BookOpen className="w-3.5 h-3.5 opacity-50" />
        No Skills.md found for this plugin.
      </div>
    );
  }

  const active = skills[activeTab];

  return (
    <div className="mt-3">
      {/* Tabs for multi-plugin repos */}
      {skills.length > 1 && (
        <div className="flex gap-1 mb-2">
          {skills.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                activeTab === i
                  ? darkMode
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-purple-100 text-purple-700'
                  : darkMode
                  ? 'bg-slate-700 text-gray-400 hover:text-gray-300'
                  : 'bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.subfolder || 'root'}
            </button>
          ))}
        </div>
      )}

      <div
        className={`rounded-lg border text-sm overflow-hidden ${
          darkMode
            ? 'border-slate-600 bg-slate-750'
            : 'border-gray-200 bg-gray-50'
        }`}
      >
        {/* Live metadata header — version + tools from plugin.py */}
        {(active?.version || active?.tools?.length) && (
          <div
            className={`px-4 py-2.5 flex items-center gap-3 border-b text-xs ${
              darkMode
                ? 'border-slate-600 bg-slate-700/50'
                : 'border-gray-200 bg-gray-100'
            }`}
          >
            {active.version && (
              <span className={`font-medium ${heading}`}>
                v{active.version}
              </span>
            )}
            {active.description && (
              <span className={subtext}>{active.description}</span>
            )}
            {active.tools && active.tools.length > 0 && (
              <div className="flex gap-1 ml-auto">
                {active.tools.map((t) => (
                  <span
                    key={t}
                    className={`px-1.5 py-0.5 rounded font-mono ${
                      darkMode
                        ? 'bg-slate-600 text-purple-300'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Markdown content */}
        <div className="p-4 max-h-[500px] overflow-y-auto">
          <MarkdownContent content={active?.content || ''} />
        </div>
      </div>
    </div>
  );
}

function SecurityWarnings({
  warnings,
  darkMode,
  expanded,
  onToggle,
}: {
  warnings: SecurityWarning[];
  darkMode: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';

  if (warnings.length === 0) {
    return (
      <div
        className={`mt-2 flex items-center gap-2 text-xs ${
          darkMode ? 'text-green-400' : 'text-green-600'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        No security warnings found.
      </div>
    );
  }

  return (
    <div className="mt-2">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 text-xs font-medium ${
          darkMode ? 'text-amber-400' : 'text-amber-600'
        }`}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <AlertTriangle className="w-3 h-3" />
        {warnings.length} security warning{warnings.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div
          className={`mt-2 rounded border text-xs overflow-hidden ${
            darkMode ? 'border-slate-600' : 'border-gray-200'
          }`}
        >
          <table className="w-full">
            <thead>
              <tr
                className={
                  darkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-50 text-gray-600'
                }
              >
                <th className="px-3 py-1.5 text-left font-medium">File</th>
                <th className="px-3 py-1.5 text-left font-medium">Line</th>
                <th className="px-3 py-1.5 text-left font-medium">Pattern</th>
                <th className="px-3 py-1.5 text-left font-medium">Code</th>
              </tr>
            </thead>
            <tbody>
              {warnings.map((w, i) => (
                <tr
                  key={i}
                  className={`border-t ${
                    darkMode ? 'border-slate-600' : 'border-gray-200'
                  }`}
                >
                  <td className={`px-3 py-1.5 font-mono ${subtext}`}>
                    {w.file}
                  </td>
                  <td className={`px-3 py-1.5 ${subtext}`}>{w.line}</td>
                  <td className="px-3 py-1.5 text-amber-500">{w.pattern}</td>
                  <td className={`px-3 py-1.5 font-mono truncate max-w-[200px] ${subtext}`}>
                    {w.code}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
