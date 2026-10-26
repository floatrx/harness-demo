'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate, taskActionUrl } from '@/lib/mutate';

type Gate = 'plan' | 'prototype';

interface Props {
  gate: Gate;
  projectId: string;
  taskId: string;
  /** Comment rounds the prototype has left; a plan can be sent back any number of times. */
  roundsLeft?: number;
}

/* The two human gates: pass moves the task on; send returns it to its agent with the human's comment, which the next
   round reads from the `### Review` block of its section. */
const GATES = {
  plan: {
    pass: { action: 'approve', label: 'Approve', pending: 'Approving…' },
    send: { action: 'revise', label: 'Request changes', pending: 'Sending…' },
    hint: 'or send it back to the planner',
    placeholder: 'What should the plan change? The planner reads this on its next round.',
    ariaLabel: 'Comment for the planner',
  },
  prototype: {
    pass: { action: 'accept', label: 'Accept', pending: 'Accepting…' },
    send: { action: 'comment', label: 'Send comment', pending: 'Sending…' },
    hint: 'or comment for another round',
    placeholder: 'What should the next round change?',
    ariaLabel: 'Comment for the designer',
  },
} as const;

export const GateReview = ({ gate, projectId, taskId, roundsLeft }: Props) => {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<'pass' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = GATES[gate];
  const canSend = roundsLeft === undefined || roundsLeft > 0;

  const run = async (step: 'pass' | 'send') => {
    setPending(step);
    setError(null);
    try {
      await mutate(taskActionUrl(projectId, taskId, config[step].action), step === 'send' ? { text } : undefined);
      setText('');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2 rounded-card bg-surface-secondary p-3" data-testid={`${gate}-review`}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run('pass')}
          disabled={!!pending}
          className="h-[34px] rounded-[7px] bg-accent px-4 text-[12.5px] font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-60"
        >
          {pending === 'pass' ? config.pass.pending : config.pass.label}
        </button>
        <span className="self-center text-xs text-muted">
          {!canSend
            ? 'no comment rounds left'
            : roundsLeft === undefined
              ? config.hint
              : `${config.hint} · ${roundsLeft} left`}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!canSend || !!pending}
        rows={3}
        placeholder={canSend ? config.placeholder : 'The round cap is reached — accept it or edit the plan.'}
        aria-label={config.ariaLabel}
        className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent"
      />
      <button
        type="button"
        onClick={() => run('send')}
        disabled={!canSend || !text.trim() || !!pending}
        className="h-[30px] rounded-[7px] border border-border px-3 text-[12.5px] hover:bg-surface-tertiary disabled:opacity-50"
      >
        {pending === 'send' ? config.send.pending : config.send.label}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
