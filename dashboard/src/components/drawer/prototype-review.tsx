'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate, taskActionUrl } from '@/lib/mutate';

interface Props {
  projectId: string;
  taskId: string;
  roundsLeft: number;
}

/* The human gate of a UI task: Accept moves it to ready; a Comment sends the designer another round. */
export const PrototypeReview = ({ projectId, taskId, roundsLeft }: Props) => {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState<'accept' | 'comment' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'accept' | 'comment') => {
    setPending(action);
    setError(null);
    try {
      await mutate(taskActionUrl(projectId, taskId, action), action === 'comment' ? { text } : undefined);
      setText('');
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2 rounded-card bg-surface-secondary p-3" data-testid="prototype-review">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => run('accept')}
          disabled={!!pending}
          className="h-[34px] rounded-[7px] bg-accent px-4 text-[12.5px] font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-60"
        >
          {pending === 'accept' ? 'Accepting…' : 'Accept'}
        </button>
        <span className="self-center text-xs text-muted">
          {roundsLeft ? `or comment for another round · ${roundsLeft} left` : 'no comment rounds left'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!roundsLeft || !!pending}
        rows={3}
        placeholder={
          roundsLeft ? 'What should the next round change?' : 'The round cap is reached — accept it or edit the plan.'
        }
        aria-label="Comment for the designer"
        className="w-full rounded-[8px] border border-border bg-card px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent"
      />
      <button
        type="button"
        onClick={() => run('comment')}
        disabled={!roundsLeft || !text.trim() || !!pending}
        className="h-[30px] rounded-[7px] border border-border px-3 text-[12.5px] hover:bg-surface-tertiary disabled:opacity-50"
      >
        {pending === 'comment' ? 'Sending…' : 'Send comment'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
