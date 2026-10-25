import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { ROLE_IDENTITY } from './roles.config';

interface Props {
  role: string;
  state?: 'idle' | 'done' | 'live';
  className?: string;
}

export const RoleAvatar = ({ role, state = 'idle', className }: Props) => {
  if (role === 'you')
    return (
      <span
        className={cn(
          'inline-flex h-5 flex-none items-center rounded-full bg-accent-soft px-2 text-[10.5px] font-bold text-accent',
          className,
        )}
      >
        You
      </span>
    );
  const identity = ROLE_IDENTITY[role] ?? { label: role.slice(0, 2), hue: 0 };
  const style = { '--h': identity.hue } as CSSProperties;
  return (
    <span
      title={role}
      style={style}
      className={cn(
        'inline-grid size-5 flex-none place-items-center rounded-full text-[9.5px] font-bold tracking-tight',
        'bg-[hsl(var(--h)_38%_21%)] text-[hsl(var(--h)_75%_76%)]',
        state === 'done' && 'opacity-55',
        state === 'live' && 'ring-[1.5px] ring-accent',
        className,
      )}
    >
      {identity.label}
    </span>
  );
};
