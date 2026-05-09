import { useState, useMemo, useCallback } from 'react';
import { clsx } from 'clsx';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Terminal,
  RefreshCw,
  AlertCircle,
  FileText,
  Search,
  X,
  Pencil,
  Save,
  MessageSquare,
  Download,
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useUIStore } from '@/stores';
import { useWorkspaceFiles, useFileContent, useSaveFile } from '@/hooks/useApi';
import type { FileNode } from '@/hooks/useApi';
import { BrowserChatSidebar } from './BrowserChatSidebar';

interface FileBrowserProps {
  projectId: string;
  onOpenClaudePanel: () => void;
}

// Map file extensions to syntax highlighter language identifiers
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    dockerfile: 'docker',
    toml: 'toml',
    ini: 'ini',
    env: 'bash',
    graphql: 'graphql',
    proto: 'protobuf',
    lua: 'lua',
    r: 'r',
    dart: 'dart',
    vue: 'markup',
    svelte: 'markup',
  };
  return map[ext] || 'text';
}

// Format file size for display
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Flatten the file tree for search
function flattenTree(nodes: FileNode[], results: FileNode[] = []): FileNode[] {
  for (const node of nodes) {
    results.push(node);
    if (node.children) {
      flattenTree(node.children, results);
    }
  }
  return results;
}

export function FileBrowser({ projectId, onOpenClaudePanel }: FileBrowserProps) {
  const darkMode = useUIStore((state) => state.darkMode);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showChat, setShowChat] = useState(false);
  const saveFile = useSaveFile(projectId);

  const {
    data: filesData,
    isLoading: filesLoading,
    error: filesError,
    refetch: refetchFiles,
  } = useWorkspaceFiles(projectId);

  const {
    data: fileContentData,
    isLoading: contentLoading,
    error: contentError,
  } = useFileContent(projectId, selectedFilePath);

  const files = filesData?.files || [];

  // Filter files based on search query
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const allFiles = flattenTree(files);
    const query = searchQuery.toLowerCase();
    return allFiles.filter(
      (f) => f.type === 'file' && f.name.toLowerCase().includes(query)
    );
  }, [files, searchQuery]);

  const toggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    setSelectedFilePath(path);
    setSearchQuery('');
    setShowSearch(false);
    setEditing(false);
  }, []);

  const startEditing = useCallback(() => {
    if (fileContentData?.content != null) {
      setEditContent(fileContentData.content);
      setEditing(true);
    }
  }, [fileContentData]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditContent('');
  }, []);

  const handleSave = useCallback(() => {
    if (!selectedFilePath) return;
    saveFile.mutate(
      { path: selectedFilePath, content: editContent },
      { onSuccess: () => setEditing(false) },
    );
  }, [selectedFilePath, editContent, saveFile]);

  // Dark mode style variables (following ChannelHeader pattern)
  const panelBg = darkMode ? 'bg-slate-900' : 'bg-white';
  const treeBg = darkMode ? 'bg-slate-800' : 'bg-gray-50';
  const borderColor = darkMode ? 'border-slate-700' : 'border-gray-200';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-gray-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-gray-500';
  const textMuted = darkMode ? 'text-gray-500' : 'text-gray-400';
  const hoverBg = darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100';
  const selectedBg = darkMode ? 'bg-slate-700' : 'bg-blue-50';
  const selectedText = darkMode ? 'text-blue-400' : 'text-blue-700';
  const buttonBg = darkMode
    ? 'bg-slate-700 hover:bg-slate-600 text-gray-300'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-700';
  const inputBg = darkMode
    ? 'bg-slate-700 border-slate-600 text-gray-100 placeholder-gray-500'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400';
  const emptyBg = darkMode ? 'bg-slate-800/50' : 'bg-gray-50';

  // Loading state
  if (filesLoading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${panelBg}`}>
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className={`w-8 h-8 animate-spin ${textSecondary}`} />
          <p className={`text-sm ${textSecondary}`}>Loading files...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (filesError) {
    return (
      <div className={`flex-1 flex items-center justify-center ${panelBg}`}>
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <AlertCircle className="w-8 h-8 text-red-400" />
          <p className={`text-sm font-medium ${textPrimary}`}>
            Failed to load files
          </p>
          <p className={`text-xs ${textSecondary}`}>
            {filesError instanceof Error
              ? filesError.message
              : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => refetchFiles()}
            className={`mt-2 px-4 py-2 text-sm rounded-lg transition-colors ${buttonBg}`}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${panelBg}`}>
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <FolderOpen className={`w-12 h-12 ${textMuted}`} />
          <p className={`text-sm font-medium ${textPrimary}`}>
            No files yet
          </p>
          <p className={`text-xs ${textSecondary}`}>
            Files will appear here once agents start working on the project.
          </p>
          <button
            onClick={onOpenClaudePanel}
            className="mt-2 px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors flex items-center gap-2"
          >
            <Terminal className="w-4 h-4" />
            Open Executive Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex min-h-0 ${panelBg}`}>
      {/* Left: Tree view */}
      <div
        className={`w-72 flex-shrink-0 flex flex-col border-r ${borderColor} ${treeBg}`}
      >
        {/* Tree header */}
        <div
          className={`px-3 py-2 flex items-center justify-between border-b ${borderColor}`}
        >
          <span className={`text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
            Explorer
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`p-1 rounded transition-colors ${hoverBg} ${textSecondary}`}
              title="Search files"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => refetchFiles()}
              className={`p-1 rounded transition-colors ${hoverBg} ${textSecondary}`}
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Search input */}
        {showSearch && (
          <div className={`px-3 py-2 border-b ${borderColor}`}>
            <div className="relative">
              <Search
                className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${textMuted}`}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                autoFocus
                className={`w-full pl-8 pr-8 py-1.5 text-sm rounded border outline-none focus:ring-1 focus:ring-blue-500 ${inputBg}`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 ${textMuted} hover:${textSecondary}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* File tree or search results */}
        <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
          {filteredFiles ? (
            filteredFiles.length > 0 ? (
              filteredFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => handleFileSelect(file.path)}
                  className={clsx(
                    'w-full px-3 py-1 flex items-center gap-2 text-left text-sm transition-colors truncate',
                    selectedFilePath === file.path
                      ? `${selectedBg} ${selectedText}`
                      : `${textPrimary} ${hoverBg}`
                  )}
                >
                  <FileIcon fileName={file.name} />
                  <span className="truncate" title={file.path}>
                    {file.name}
                  </span>
                  <span className={`ml-auto text-xs flex-shrink-0 ${textMuted}`}>
                    {file.path
                      .split('/')
                      .slice(0, -1)
                      .join('/')}
                  </span>
                </button>
              ))
            ) : (
              <div className={`px-3 py-4 text-center text-sm ${textSecondary}`}>
                No files matching &quot;{searchQuery}&quot;
              </div>
            )
          ) : (
            files.map((node) => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                expandedDirs={expandedDirs}
                selectedFilePath={selectedFilePath}
                onToggleDir={toggleDir}
                onSelectFile={handleFileSelect}
                darkMode={darkMode}
              />
            ))
          )}
        </div>
      </div>

      {/* Right: File content viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedFilePath ? (
          <>
            {/* File header */}
            <div
              className={`px-4 py-2 flex items-center gap-2 border-b ${borderColor} flex-shrink-0`}
            >
              <FileIcon fileName={selectedFilePath.split('/').pop() || ''} />
              <span className={`text-sm font-medium truncate ${textPrimary}`}>
                {selectedFilePath}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {fileContentData?.language && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      darkMode
                        ? 'bg-slate-700 text-gray-400'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {fileContentData.language}
                  </span>
                )}
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saveFile.isPending}
                      className={clsx(
                        'flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors',
                        'bg-green-600 hover:bg-green-700 text-white',
                      )}
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saveFile.isPending ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={cancelEditing}
                      className={`px-2.5 py-1 text-xs rounded transition-colors ${buttonBg}`}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEditing}
                    disabled={!fileContentData}
                    className={`p-1.5 rounded transition-colors ${hoverBg} ${textSecondary}`}
                    title="Edit file"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <a
                  href={`/api/workspace/${projectId}/download?path=${encodeURIComponent(selectedFilePath)}`}
                  download={selectedFilePath.split('/').pop() || 'download'}
                  className={`p-1.5 rounded transition-colors ${hoverBg} ${textSecondary}`}
                  title="Download file"
                >
                  <Download className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => setShowChat((v) => !v)}
                  className={clsx(
                    'p-1.5 rounded transition-colors',
                    showChat
                      ? darkMode ? 'bg-purple-600/30 text-purple-400' : 'bg-purple-100 text-purple-600'
                      : `${hoverBg} ${textSecondary}`,
                  )}
                  title="Chat with Prax about this file"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* File content + optional chat */}
            <div className="flex-1 flex min-h-0">
              {/* Editor / Viewer */}
              <div className="flex-1 overflow-auto min-w-0">
                {contentLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3">
                      <RefreshCw
                        className={`w-6 h-6 animate-spin ${textSecondary}`}
                      />
                      <p className={`text-sm ${textSecondary}`}>
                        Loading file...
                      </p>
                    </div>
                  </div>
                ) : contentError ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex flex-col items-center gap-3 max-w-md text-center">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                      <p className={`text-sm ${textPrimary}`}>
                        Failed to load file content
                      </p>
                      <p className={`text-xs ${textSecondary}`}>
                        {contentError instanceof Error
                          ? contentError.message
                          : 'An unexpected error occurred'}
                      </p>
                    </div>
                  </div>
                ) : editing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    spellCheck={false}
                    className={clsx(
                      'w-full h-full resize-none p-4 outline-none font-mono text-sm leading-relaxed',
                      darkMode
                        ? 'bg-slate-900 text-gray-100 caret-blue-400'
                        : 'bg-white text-gray-900 caret-blue-600',
                    )}
                    style={{ tabSize: 2 }}
                    onKeyDown={(e) => {
                      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSave();
                      }
                      if (e.key === 'Escape') cancelEditing();
                      // Tab inserts spaces instead of losing focus
                      if (e.key === 'Tab') {
                        e.preventDefault();
                        const target = e.currentTarget;
                        const start = target.selectionStart;
                        const end = target.selectionEnd;
                        setEditContent(editContent.substring(0, start) + '  ' + editContent.substring(end));
                        requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; });
                      }
                    }}
                  />
                ) : fileContentData ? (
                  <SyntaxHighlighter
                    language={
                      fileContentData.language ||
                      getLanguageFromPath(selectedFilePath)
                    }
                    style={darkMode ? oneDark : oneLight}
                    showLineNumbers
                    wrapLongLines
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      background: darkMode ? '#0f172a' : '#ffffff',
                      fontSize: '0.8125rem',
                      lineHeight: '1.6',
                      minHeight: '100%',
                    }}
                    lineNumberStyle={{
                      minWidth: '3em',
                      paddingRight: '1em',
                      color: darkMode ? '#475569' : '#cbd5e1',
                      userSelect: 'none',
                    }}
                    codeTagProps={{
                      style: {
                        fontFamily:
                          'Monaco, Menlo, Consolas, "Courier New", monospace',
                      },
                    }}
                  >
                    {fileContentData.content}
                  </SyntaxHighlighter>
                ) : null}
              </div>

              {/* Chat sidebar */}
              {showChat && (
                <BrowserChatSidebar
                  projectId={projectId}
                  activeView="files"
                  contentContext={selectedFilePath ? { category: 'file', slug: selectedFilePath, title: selectedFilePath.split('/').pop() || '' } : null}
                />
              )}
            </div>
          </>
        ) : (
          // No file selected placeholder
          <div
            className={`flex-1 flex items-center justify-center ${emptyBg}`}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <FileText className={`w-12 h-12 ${textMuted}`} />
              <p className={`text-sm ${textSecondary}`}>
                Select a file to view its contents
              </p>
              <p className={`text-xs ${textMuted}`}>
                Browse the file tree on the left, or use search to find files
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- Sub-components -----

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  expandedDirs: Set<string>;
  selectedFilePath: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  darkMode: boolean;
}

function TreeNode({
  node,
  depth,
  expandedDirs,
  selectedFilePath,
  onToggleDir,
  onSelectFile,
  darkMode,
}: TreeNodeProps) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = !isDir && selectedFilePath === node.path;
  const paddingLeft = 12 + depth * 16;

  const hoverBg = darkMode ? 'hover:bg-slate-700/50' : 'hover:bg-gray-200/70';
  const selectedBg = darkMode ? 'bg-slate-700' : 'bg-blue-50';
  const selectedText = darkMode ? 'text-blue-400' : 'text-blue-700';
  const textColor = darkMode ? 'text-gray-300' : 'text-gray-700';
  const dirTextColor = darkMode ? 'text-gray-200' : 'text-gray-800';
  const sizeColor = darkMode ? 'text-gray-600' : 'text-gray-400';

  const handleClick = () => {
    if (isDir) {
      onToggleDir(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className={clsx(
          'w-full py-0.5 flex items-center gap-1.5 text-left text-sm transition-colors group',
          isSelected ? `${selectedBg} ${selectedText}` : `${textColor} ${hoverBg}`
        )}
        style={{ paddingLeft }}
        title={node.path}
      >
        {isDir ? (
          <>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 flex-shrink-0 text-yellow-500" />
            ) : (
              <Folder className="w-4 h-4 flex-shrink-0 text-yellow-500" />
            )}
            <span className={clsx('truncate font-medium', isDir && dirTextColor)}>
              {node.name}
            </span>
          </>
        ) : (
          <>
            {/* Spacer to align with directory chevrons */}
            <span className="w-3.5 flex-shrink-0" />
            <FileIcon fileName={node.name} />
            <span className="truncate">{node.name}</span>
            {node.size !== undefined && (
              <span className={`ml-auto pr-3 text-xs flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${sizeColor}`}>
                {formatFileSize(node.size)}
              </span>
            )}
          </>
        )}
      </button>

      {/* Render children if directory is expanded */}
      {isDir && isExpanded && node.children && (
        <>
          {/* Sort: directories first, then files, alphabetically within each group */}
          {[...node.children]
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name);
              return a.type === 'directory' ? -1 : 1;
            })
            .map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                selectedFilePath={selectedFilePath}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                darkMode={darkMode}
              />
            ))}
        </>
      )}
    </>
  );
}

// File icon component that picks an icon/color based on file extension
function FileIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  // Color coding by file type
  let colorClass = 'text-gray-400';
  if (['ts', 'tsx'].includes(ext)) colorClass = 'text-blue-400';
  else if (['js', 'jsx'].includes(ext)) colorClass = 'text-yellow-400';
  else if (['py'].includes(ext)) colorClass = 'text-green-400';
  else if (['json', 'yaml', 'yml', 'toml'].includes(ext))
    colorClass = 'text-orange-400';
  else if (['css', 'scss', 'less'].includes(ext)) colorClass = 'text-pink-400';
  else if (['html', 'xml', 'svg'].includes(ext)) colorClass = 'text-red-400';
  else if (['md', 'mdx', 'txt'].includes(ext)) colorClass = 'text-gray-400';
  else if (['rs'].includes(ext)) colorClass = 'text-orange-500';
  else if (['go'].includes(ext)) colorClass = 'text-cyan-400';
  else if (['rb'].includes(ext)) colorClass = 'text-red-500';
  else if (['java', 'kt'].includes(ext)) colorClass = 'text-amber-500';
  else if (['sh', 'bash', 'zsh'].includes(ext)) colorClass = 'text-green-500';
  else if (['sql'].includes(ext)) colorClass = 'text-blue-500';
  else if (['dockerfile'].includes(ext) || fileName === 'Dockerfile')
    colorClass = 'text-blue-400';

  return <File className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />;
}
