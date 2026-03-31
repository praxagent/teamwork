import { useEffect } from 'react';

interface ShortcutConfig {
  onToggleDarkMode?: () => void;
  onFocusChat?: () => void;
  onNextChannel?: () => void;
  onPrevChannel?: () => void;
}

export function useKeyboardShortcuts({
  onToggleDarkMode,
  onFocusChat,
  onNextChannel,
  onPrevChannel,
}: ShortcutConfig) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      // Cmd+Shift+D — toggle dark mode (works everywhere)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        onToggleDarkMode?.();
        return;
      }

      // The rest only work when NOT typing
      if (isTyping) return;

      // Alt+Up / Alt+Down — navigate channels
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        onPrevChannel?.();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        onNextChannel?.();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleDarkMode, onFocusChat, onNextChannel, onPrevChannel]);
}
