import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useToastStore, type Toast } from '@/stores/toastStore';

const icons: Record<string, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const colors: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400', text: 'text-emerald-200' },
  error:   { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'text-red-400',     text: 'text-red-200' },
  info:    { bg: 'bg-blue-500/10',     border: 'border-blue-500/30',    icon: 'text-blue-400',    text: 'text-blue-200' },
  warning: { bg: 'bg-amber-500/10',    border: 'border-amber-500/30',   icon: 'text-amber-400',   text: 'text-amber-200' },
};

const lightColors: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  success: { bg: 'bg-emerald-50',  border: 'border-emerald-200', icon: 'text-emerald-600', text: 'text-emerald-800' },
  error:   { bg: 'bg-red-50',      border: 'border-red-200',     icon: 'text-red-600',     text: 'text-red-800' },
  info:    { bg: 'bg-blue-50',     border: 'border-blue-200',    icon: 'text-blue-600',    text: 'text-blue-800' },
  warning: { bg: 'bg-amber-50',    border: 'border-amber-200',   icon: 'text-amber-600',   text: 'text-amber-800' },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);
  const darkMode = document.documentElement.classList.contains('dark');
  const c = darkMode ? colors[toast.type] : lightColors[toast.type];
  const Icon = icons[toast.type];

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleRemove = () => {
    setVisible(false);
    setTimeout(onRemove, 200);
  };

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-200 max-w-sm',
        c.bg, c.border,
        visible ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'
      )}
    >
      <Icon className={clsx('w-5 h-5 shrink-0', c.icon)} />
      <p className={clsx('text-sm flex-1', c.text)}>{toast.message}</p>
      <button onClick={handleRemove} className={clsx('p-0.5 rounded hover:bg-white/10', c.icon)}>
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
      ))}
    </div>
  );
}
