import { clsx } from 'clsx';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  status?: 'idle' | 'working' | 'blocked' | 'offline';
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorFromName(name: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ];

  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export function Avatar({ src, name, size = 'md', status, className }: AvatarProps) {
  const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
    xl: 'w-16 h-16 text-xl',
    '2xl': 'w-32 h-32 text-4xl',
  };

  const statusSizes = {
    sm: 'w-3 h-3',      // Was w-2, now bigger for visibility
    md: 'w-3.5 h-3.5',  // Was w-2.5
    lg: 'w-4 h-4',      // Was w-3
    xl: 'w-5 h-5',      // Was w-4
    '2xl': 'w-6 h-6',   // Was w-5
  };

  const statusColors = {
    idle: 'bg-green-500',           // Green = done/ready, no active work
    working: 'bg-red-500 status-pulse', // Red = actively working
    blocked: 'bg-yellow-500',       // Yellow = has a question/needs input
    offline: 'bg-gray-400',
  };

  return (
    <div className={clsx('relative inline-flex', className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          className={clsx(
            'rounded-md object-cover',
            sizeClasses[size]
          )}
        />
      ) : (
        <div
          className={clsx(
            'rounded-md flex items-center justify-center font-semibold text-white',
            sizeClasses[size],
            getColorFromName(name)
          )}
        >
          {getInitials(name)}
        </div>
      )}
      {status && (
        <span
          className={clsx(
            'absolute bottom-0 right-0 rounded-full border-2 border-white',
            statusSizes[size],
            statusColors[status]
          )}
        />
      )}
    </div>
  );
}
