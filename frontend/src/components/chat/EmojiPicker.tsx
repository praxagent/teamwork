import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { useUIStore } from '@/stores';

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '👀', '🔥', '💯', '✅', '👏', '🚀', '💡'];

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: 'Reactions', emojis: QUICK_EMOJIS },
  { label: 'Faces', emojis: ['😀', '😃', '😄', '😁', '😅', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😜', '🤓', '😎', '🤩', '🥳', '😤', '😱', '🤯', '😴', '🤗'] },
  { label: 'Hands', emojis: ['👋', '🤚', '✋', '🖐️', '🤞', '🤝', '🙏', '💪', '🫡', '🤙', '👆', '👇', '👈', '👉'] },
  { label: 'Objects', emojis: ['💻', '🖥️', '📱', '⌨️', '🔧', '🛠️', '📝', '📌', '📎', '🗂️', '📊', '🏆', '🎯', '💎', '⚡', '🌟'] },
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  position?: 'above' | 'below';
}

export function EmojiPicker({ onSelect, onClose, position = 'above' }: EmojiPickerProps) {
  const darkMode = useUIStore((s) => s.darkMode);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={clsx(
        'absolute z-50 w-72 rounded-xl shadow-xl border overflow-hidden',
        position === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
        darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
      )}
    >
      <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
        {EMOJI_CATEGORIES.map((cat) => (
          <div key={cat.label}>
            <div className={clsx('text-xs font-medium mb-1.5', darkMode ? 'text-gray-500' : 'text-gray-400')}>
              {cat.label}
            </div>
            <div className="flex flex-wrap gap-1">
              {cat.emojis.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { onSelect(emoji); onClose(); }}
                  className={clsx(
                    'w-8 h-8 flex items-center justify-center rounded-lg text-lg hover:scale-110 transition-transform',
                    darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Quick reaction bar that appears on hover
export function QuickReactions({ onReact }: { onReact: (emoji: string) => void }) {
  const darkMode = useUIStore((s) => s.darkMode);

  return (
    <div className={clsx(
      'flex items-center gap-0.5 px-1 py-0.5 rounded-lg border shadow-sm',
      darkMode ? 'bg-slate-800 border-slate-600' : 'bg-white border-gray-200'
    )}>
      {QUICK_EMOJIS.slice(0, 6).map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReact(emoji)}
          className={clsx(
            'w-7 h-7 flex items-center justify-center rounded text-sm hover:scale-125 transition-transform',
            darkMode ? 'hover:bg-slate-700' : 'hover:bg-gray-100'
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

// Display reactions on a message
export function ReactionDisplay({
  reactions,
  onToggle,
}: {
  reactions: Record<string, string[]>; // emoji → list of user/agent names
  onToggle: (emoji: string) => void;
}) {
  const darkMode = useUIStore((s) => s.darkMode);
  const entries = Object.entries(reactions).filter(([, names]) => names.length > 0);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {entries.map(([emoji, names]) => (
        <button
          key={emoji}
          onClick={() => onToggle(emoji)}
          title={names.join(', ')}
          className={clsx(
            'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors',
            darkMode
              ? 'bg-slate-700/60 border-slate-600 hover:border-indigo-500/50 text-gray-300'
              : 'bg-gray-100 border-gray-200 hover:border-indigo-300 text-gray-600'
          )}
        >
          <span className="text-sm">{emoji}</span>
          <span>{names.length}</span>
        </button>
      ))}
    </div>
  );
}
