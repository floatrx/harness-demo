import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** The Claude Code thinking spinner (· ✢ ✳ ✶ ✻ ✽) — on everything that is working. */
export const ClaudeSpinner = ({ className, ...props }: ComponentProps<'span'>) => (
  <span
    role="status"
    aria-label="working"
    className={cn('claude-spinner inline-block w-[1.1em] text-center font-bold text-accent', className)}
    {...props}
  />
);
