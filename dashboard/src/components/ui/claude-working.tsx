import { cn } from '@/lib/cn';
import { ClaudeSpinner } from './claude-spinner';
import { Elapsed } from './elapsed';

interface Props {
  /** The verb, e.g. "implementer working". */
  label: string;
  /** ISO start time; shows a ticking m:ss. */
  since?: string;
  className?: string;
}

/** Claude Code's status line: the live spinner, a shimmering verb, and how long it has run. */
export const ClaudeWorking = ({ label, since, className }: Props) => (
  <span className={cn('inline-flex min-w-0 items-center gap-1 font-semibold', className)}>
    <ClaudeSpinner size="sm" />
    <span className="claude-shimmer truncate">{label}</span>
    {since && (
      <span className="text-muted">
        · <Elapsed since={since} />
      </span>
    )}
  </span>
);
