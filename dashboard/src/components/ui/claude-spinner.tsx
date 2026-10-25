import type { ComponentProps } from 'react';
import { tv, type VariantProps } from 'tailwind-variants';

const spinner = tv({
  base: 'inline-block w-[1.1em] flex-none text-center leading-none font-bold',
  variants: {
    state: {
      /* An agent works right now. */
      live: 'claude-spinner text-accent',
      /* The task waits for an agent: the same glyph, still and faint. */
      idle: 'claude-spinner-idle text-faint',
    },
    size: {
      sm: 'text-[12px]',
      md: 'text-[14px]',
      lg: 'text-[18px]',
    },
  },
  defaultVariants: { state: 'live', size: 'md' },
});

interface Props extends ComponentProps<'span'>, VariantProps<typeof spinner> {}

/**
 * The Claude Code thinking spinner (· ✢ ✳ ✶ ✻ ✽). `live` animates; `idle` is the still glyph of a queued task.
 * @example <ClaudeSpinner /> · <ClaudeSpinner state="idle" size="sm" />
 */
export const ClaudeSpinner = ({ state, size, className, ...props }: Props) => (
  <span
    role={state === 'idle' ? undefined : 'status'}
    aria-label={state === 'idle' ? 'waiting for an agent' : 'working'}
    className={spinner({ state, size, className })}
    {...props}
  />
);
