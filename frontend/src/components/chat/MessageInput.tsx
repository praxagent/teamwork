import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type DragEvent } from 'react';
import { clsx } from 'clsx';
import { Send, Paperclip, AtSign, Smile, Code, Loader2, X, FileText } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import { useUIStore } from '@/stores';
import { useUploadFile } from '@/hooks/useApi';
import { toast } from '@/stores/toastStore';
import type { Agent, Attachment } from '@/types';

interface MessageInputProps {
  channelName: string;
  channelId?: string;
  projectId?: string;
  agents?: Agent[];
  onSend: (content: string, attachments?: Attachment[]) => void;
  onCodeRequest?: (agentId: string, request: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function TypingIndicatorInline({ channelId }: { channelId?: string }) {
  const typingAgents = useUIStore((state) =>
    channelId ? state.typingAgents[channelId] || [] : []
  );
  const darkMode = useUIStore((state) => state.darkMode);

  if (typingAgents.length === 0) {
    return null;
  }

  const names = typingAgents.map((a) => a.agent_name.split(' ')[0]); // First names only

  let typingText: string;
  if (names.length === 1) {
    typingText = `${names[0]} is typing`;
  } else if (names.length === 2) {
    typingText = `${names[0]} and ${names[1]} are typing`;
  } else {
    typingText = `${names.length} people are typing`;
  }

  const textColor = darkMode ? 'text-gray-400' : 'text-gray-500';
  const dotColor = darkMode ? 'bg-gray-500' : 'bg-gray-400';

  return (
    <div className={`flex items-center gap-1.5 text-xs mr-2 ${textColor}`}>
      <div className="flex gap-0.5">
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '0ms', animationDuration: '1s' }} />
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '150ms', animationDuration: '1s' }} />
        <span className={`w-1 h-1 rounded-full animate-bounce ${dotColor}`} style={{ animationDelay: '300ms', animationDuration: '1s' }} />
      </div>
      <span className="italic whitespace-nowrap">{typingText}</span>
    </div>
  );
}

export function MessageInput({
  channelName,
  channelId,
  projectId,
  agents = [],
  onSend,
  onCodeRequest,
  disabled,
  placeholder,
}: MessageInputProps) {
  const [content, setContent] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isExecutingCode, setIsExecutingCode] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useUploadFile();

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(mentionFilter.toLowerCase())
  );

  // Check if message mentions a developer and contains coding keywords
  const getMentionedDeveloper = (): Agent | null => {
    const devKeywords = ['implement', 'create', 'build', 'write', 'code', 'make', 'add', 'fix', 'update', 'develop'];
    const hasCodeKeyword = devKeywords.some(kw => content.toLowerCase().includes(kw));

    if (!hasCodeKeyword) return null;

    // Find mentioned agent
    for (const agent of agents) {
      if (content.includes(`@${agent.name}`)) {
        // Check if they're a developer-ish role
        const role = agent.role?.toLowerCase() || '';
        if (role.includes('developer') || role.includes('engineer') || role.includes('dev')) {
          return agent;
        }
      }
    }
    return null;
  };

  const mentionedDeveloper = getMentionedDeveloper();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [content]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).filter((f) => f.size <= 10 * 1024 * 1024);
    if (newFiles.length < Array.from(files).length) {
      toast.warning('Some files exceeded 10 MB limit and were skipped');
    }
    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const hasContent = content.trim().length > 0;
    const hasFiles = pendingFiles.length > 0;
    if ((!hasContent && !hasFiles) || disabled || uploading) return;

    let attachments: Attachment[] | undefined;

    if (hasFiles && projectId) {
      setUploading(true);
      try {
        const uploaded = await Promise.all(
          pendingFiles.map((file) => uploadFile.mutateAsync({ projectId, file }))
        );
        attachments = uploaded;
      } catch (error) {
        toast.error('File upload failed. Please try again.');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const text = hasContent ? content.trim() : (attachments ? `Shared ${attachments.length} file${attachments.length > 1 ? 's' : ''}` : '');
    onSend(text, attachments);
    setContent('');
    setPendingFiles([]);
    setShowMentions(false);
  };

  const handleCodeRequest = async () => {
    if (!mentionedDeveloper || !onCodeRequest || !content.trim()) return;

    setIsExecutingCode(true);
    try {
      // First send the message so it appears in chat
      onSend(content.trim());
      // Then trigger code execution
      await onCodeRequest(mentionedDeveloper.id, content.trim());
      setContent('');
    } catch (error) {
      console.error('Code execution failed:', error);
    } finally {
      setIsExecutingCode(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedMentionIndex((prev) =>
          Math.min(prev + 1, filteredAgents.length - 1)
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedMentionIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (filteredAgents[selectedMentionIndex]) {
          insertMention(filteredAgents[selectedMentionIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setContent(value);

    // Check for @ mentions
    const lastAtIndex = value.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1);
      const hasSpaceAfterAt = textAfterAt.includes(' ');

      if (!hasSpaceAfterAt && lastAtIndex === value.length - 1 - textAfterAt.length) {
        setShowMentions(true);
        setMentionFilter(textAfterAt);
        setSelectedMentionIndex(0);
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (agent: Agent) => {
    const lastAtIndex = content.lastIndexOf('@');
    const newContent = content.slice(0, lastAtIndex) + `@${agent.name} `;
    setContent(newContent);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  // Drag and drop handlers
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // Paste handler for images
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      addFiles(imageFiles);
    }
  }, [addFiles]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.addEventListener('paste', handlePaste as EventListener);
    return () => el.removeEventListener('paste', handlePaste as EventListener);
  }, [handlePaste]);

  const darkMode = useUIStore((state) => state.darkMode);

  // Explicit colors based on dark mode
  const containerBg = darkMode ? 'bg-slate-900' : 'bg-white';
  const popupBg = darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200';
  const popupHeaderBg = darkMode ? 'bg-slate-700 text-gray-400' : 'bg-gray-50 text-gray-500';
  const popupItemBg = darkMode ? 'hover:bg-slate-700 text-gray-100' : 'hover:bg-gray-100 text-gray-900';
  const popupItemRole = darkMode ? 'text-gray-500' : 'text-gray-400';
  const inputContainerBorder = darkMode ? 'border-slate-600 focus-within:border-slate-500 focus-within:ring-slate-500' : 'border-gray-300 focus-within:border-gray-400 focus-within:ring-gray-400';
  const inputContainerBg = darkMode ? 'bg-slate-800' : 'bg-white';
  const inputTextColor = darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-gray-900 placeholder-gray-400';
  const toolbarBorder = darkMode ? 'border-slate-700' : 'border-gray-100';
  const toolbarButtonColor = darkMode ? 'text-gray-400 hover:bg-slate-700' : 'text-gray-500 hover:bg-gray-100';
  const sendButtonInactive = darkMode ? 'bg-slate-700 text-gray-500' : 'bg-gray-100 text-gray-400';
  const chipBg = darkMode ? 'bg-slate-700 text-gray-200' : 'bg-gray-100 text-gray-700';

  const canSend = content.trim().length > 0 || pendingFiles.length > 0;

  return (
    <div className={`px-3 md:px-5 pt-2 pb-5 ${containerBg}`}>
      <div
        className="relative max-w-4xl mx-auto"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Mention popup */}
        {showMentions && filteredAgents.length > 0 && (
          <div className={`absolute bottom-full left-0 w-64 mb-2 border rounded-lg shadow-lg overflow-hidden ${popupBg}`}>
            <div className={`px-3 py-2 text-xs font-medium ${popupHeaderBg}`}>
              Team Members
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  onClick={() => insertMention(agent)}
                  className={clsx(
                    'w-full px-3 py-2 flex items-center gap-2 text-left',
                    index === selectedMentionIndex
                      ? 'bg-tw-accent text-white'
                      : popupItemBg
                  )}
                >
                  <span className="font-medium">{agent.name}</span>
                  <span
                    className={clsx(
                      'text-xs',
                      index === selectedMentionIndex ? 'text-white/70' : popupItemRole
                    )}
                  >
                    {agent.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input container */}
        <div className={clsx(
          'border rounded-2xl focus-within:ring-1 shadow-sm transition-colors',
          dragOver ? 'border-tw-accent ring-1 ring-tw-accent bg-tw-accent/5' : `${inputContainerBorder} ${inputContainerBg}`,
        )}>
          {/* File preview chips */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {pendingFiles.map((file, i) => (
                <FileChip key={`${file.name}-${i}`} file={file} onRemove={() => removeFile(i)} chipBg={chipBg} darkMode={darkMode} />
              ))}
            </div>
          )}

          {/* Drag overlay hint */}
          {dragOver && (
            <div className="px-3 py-2 text-sm text-tw-accent font-medium">
              Drop files to attach
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || `Message #${channelName}`}
            disabled={disabled || uploading}
            rows={1}
            className={`w-full px-3 py-2 resize-none bg-transparent focus:outline-none disabled:opacity-50 ${inputTextColor}`}
          />

          {/* Bottom toolbar */}
          <div className={`flex items-center justify-between px-2 py-1 border-t ${toolbarBorder}`}>
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className={`p-2.5 md:p-1.5 rounded ${toolbarButtonColor}`}
                title="Attach file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={`p-2.5 md:p-1.5 rounded ${toolbarButtonColor}`}
                title="Mention someone"
                onClick={() => {
                  setContent(content + '@');
                  setShowMentions(true);
                  setMentionFilter('');
                  textareaRef.current?.focus();
                }}
              >
                <AtSign className="w-4 h-4" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  className={`p-2.5 md:p-1.5 rounded ${toolbarButtonColor}`}
                  title="Add emoji"
                  onClick={() => setShowEmojiPicker((v) => !v)}
                >
                  <Smile className="w-4 h-4" />
                </button>
                {showEmojiPicker && (
                  <EmojiPicker
                    position="above"
                    onSelect={(emoji) => {
                      setContent((c) => c + emoji);
                      textareaRef.current?.focus();
                    }}
                    onClose={() => setShowEmojiPicker(false)}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Typing indicator - shows who's typing */}
              <TypingIndicatorInline channelId={channelId} />

              {/* Code button - appears when mentioning a developer with coding keywords */}
              {mentionedDeveloper && onCodeRequest && (
                <button
                  onClick={handleCodeRequest}
                  disabled={!content.trim() || disabled || isExecutingCode}
                  className={clsx(
                    'px-2 py-1 rounded transition-colors text-xs font-medium flex items-center gap-1',
                    'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                  )}
                  title={`Ask ${mentionedDeveloper.name} to code this`}
                >
                  {isExecutingCode ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Code className="w-3 h-3" />
                  )}
                  Code it
                </button>
              )}

              <button
                onClick={handleSend}
                disabled={!canSend || disabled || uploading}
                className={clsx(
                  'p-2.5 md:p-1.5 rounded transition-colors',
                  uploading
                    ? 'bg-tw-accent/50 text-white'
                    : canSend
                      ? 'bg-tw-accent text-white hover:bg-indigo-600'
                      : sendButtonInactive
                )}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── File preview chip ──
function FileChip({ file, onRemove, chipBg, darkMode }: { file: File; onRemove: () => void; chipBg: string; darkMode: boolean }) {
  const isImage = file.type.startsWith('image/');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  const sizeLabel = file.size < 1024 ? `${file.size} B`
    : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <div className={`flex items-center gap-2 px-2 py-1 rounded-lg text-xs ${chipBg}`}>
      {preview ? (
        <img src={preview} alt={file.name} className="w-6 h-6 rounded object-cover" />
      ) : (
        <FileText className="w-4 h-4 shrink-0 opacity-60" />
      )}
      <span className="truncate max-w-[120px]">{file.name}</span>
      <span className={`opacity-50 shrink-0`}>{sizeLabel}</span>
      <button onClick={onRemove} className={`p-0.5 rounded hover:${darkMode ? 'bg-slate-600' : 'bg-gray-200'}`}>
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
