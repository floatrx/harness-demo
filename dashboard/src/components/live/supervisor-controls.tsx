'use client';

import { useState } from 'react';
import { type AgentMode, START_LABEL, START_NOTE } from '@/lib/agent-mode';
import type { SupervisorState } from '@/lib/live';
import { mutate } from '@/lib/mutate';

interface Props {
  projectId: string;
  state: SupervisorState;
  /** Who Start runs; Resume continues the supervisor already running, so only Start names it. */
  agent: AgentMode;
}

const COMMANDS: Record<SupervisorState, { command: string; label: string; isPrimary?: boolean }[]> = {
  stopped: [{ command: 'start', label: 'Start', isPrimary: true }],
  running: [
    { command: 'pause', label: 'Pause' },
    { command: 'stop', label: 'Stop' },
  ],
  paused: [
    { command: 'resume', label: 'Resume', isPrimary: true },
    { command: 'stop', label: 'Stop' },
  ],
  stopping: [],
};

/* The same control files the CLI writes; the supervisor reads them at the unit boundary, so nothing is cut mid-turn. */
export const SupervisorControls = ({ projectId, state, agent }: Props) => {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (command: string) => {
    setPending(command);
    setError(null);
    try {
      await mutate(`/api/p/${projectId}/supervisor/${command}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {COMMANDS[state].map((item) => (
          <button
            key={item.command}
            type="button"
            onClick={() => run(item.command)}
            disabled={!!pending}
            data-testid={`supervisor-${item.command}`}
            className={
              item.isPrimary
                ? 'h-[30px] rounded-[7px] bg-accent px-3 text-[12.5px] font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-60'
                : 'h-[30px] rounded-[7px] border border-border px-3 text-[12.5px] hover:bg-surface-secondary disabled:opacity-60'
            }
          >
            {pending === item.command
              ? `${item.label}…`
              : item.command === 'start'
                ? `${item.label} · ${START_LABEL[agent]}`
                : item.label}
          </button>
        ))}
      </div>
      {state === 'stopped' && (
        <p className={`mt-1 text-xs ${agent === 'stand-in' ? 'text-muted' : 'text-accent'}`} data-testid="start-agent">
          {START_NOTE[agent]}
        </p>
      )}
      {state === 'stopping' && <p className="mt-1 text-xs text-muted">Stops after the unit in flight.</p>}
      {state === 'paused' && <p className="mt-1 text-xs text-muted">Paused at the unit boundary.</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
