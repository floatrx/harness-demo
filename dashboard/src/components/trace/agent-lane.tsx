import { cn } from '@/lib/cn';
import { clockDuration } from '@/lib/format';
import type { TraceStep } from '@/lib/unit-trace';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { RoleAvatar } from '@/components/ui/role-avatar';

interface Props {
  role: string;
  state: 'running' | 'done' | 'failed' | 'coordinator';
  steps: TraceStep[];
  origin: string | null;
  durationMs: number | null;
  className?: string;
}

/* Seconds with a decimal under 10 s (the fake agent is that fast), m:ss above. */
const offset = (origin: string | null, at: string | null) => {
  if (!origin || !at) return '';
  const ms = new Date(at).getTime() - new Date(origin).getTime();
  return ms < 10_000 ? `+${(ms / 1000).toFixed(1)}s` : `+${clockDuration(ms)}`;
};

/* One actor of a unit: its calls in order, each with the tool, the file (basename) and when, from the unit's start. */
export const AgentLane = ({ role, state, steps, origin, durationMs, className }: Props) => (
  <section className={cn('rounded-panel border border-line-soft bg-surface p-3', className)} data-testid="agent-lane">
    <header className="mb-2 flex items-center gap-2 text-[13px]">
      <RoleAvatar role={role} state={state === 'running' ? 'live' : 'idle'} />
      <b className={state === 'running' ? 'text-accent' : state === 'failed' ? 'text-danger' : ''}>
        {state === 'coordinator' ? `${role} (coordinator)` : role}
      </b>
      {state === 'running' && <ClaudeSpinner size="sm" />}
      {state === 'done' && <span className="text-muted">✓</span>}
      {state === 'failed' && <span className="text-danger">✕</span>}
      <span className="ml-auto text-xs text-muted tabular-nums">
        {steps.length} call{steps.length === 1 ? '' : 's'}
        {durationMs != null && ` · ${clockDuration(durationMs)}`}
      </span>
    </header>
    {steps.length ? (
      <ol className="space-y-0.5 text-xs">
        {steps.map((step, index) => (
          <li key={index} className="flex gap-2">
            <span className="w-12 flex-none text-right text-faint tabular-nums">{offset(origin, step.at)}</span>
            <span className="font-semibold">{step.tool}</span>
            {step.file && <span className="truncate text-muted">{step.file}</span>}
          </li>
        ))}
      </ol>
    ) : (
      <p className="text-xs text-muted">No tool calls.</p>
    )}
  </section>
);
