'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/mutate';

interface Props {
  projectId: string;
  lessonKey: string;
  /** The draft rule from the evidence; the human edits it before Apply. */
  draft: string;
}

const lessonUrl = (projectId: string, action: string) => `/api/p/${projectId}/lessons/${action}`;

/* Apply turns the candidate into a rule every later unit reads; Reject blocks it for good. */
export const LessonDecision = ({ projectId, lessonKey, draft }: Props) => {
  const router = useRouter();
  const [text, setText] = useState(draft);
  const [pending, setPending] = useState<'apply' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'apply' | 'reject') => {
    setPending(action);
    setError(null);
    try {
      await mutate(lessonUrl(projectId, action), { key: lessonKey, text });
      router.push(`/p/${projectId}/learning${action === 'apply' ? '?tab=applied' : ''}`, { scroll: false });
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2" data-testid="lesson-decision">
      <label htmlFor="lesson-rule" className="block text-xs font-semibold text-muted">
        Rule every later unit reads
      </label>
      <textarea
        id="lesson-rule"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!!pending}
        rows={4}
        className="w-full rounded-card border border-line-soft bg-surface-secondary px-3 py-2 text-[13px] leading-relaxed focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run('apply')}
          disabled={!!pending || !text.trim()}
          className="min-h-11 rounded-[7px] bg-accent px-4 text-[13px] font-semibold text-accent-foreground hover:brightness-110 disabled:opacity-60"
          data-testid="lesson-apply"
        >
          {pending === 'apply' ? 'Applying…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={() => run('reject')}
          disabled={!!pending}
          className="min-h-11 rounded-[7px] border border-border px-4 text-[13px] font-semibold text-muted hover:text-foreground disabled:opacity-60"
          data-testid="lesson-reject"
        >
          {pending === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <span className="text-xs text-muted">Reject: never proposed again.</span>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

/* Undo of an applied rule: it leaves every unit's Memory, stays in LESSONS.md as history. */
export const LessonUndo = ({ projectId, id }: { projectId: string; id: string }) => {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await mutate(lessonUrl(projectId, 'withdraw'), { id });
            router.refresh();
          } catch (caught) {
            setError((caught as Error).message);
          } finally {
            setPending(false);
          }
        }}
        className="min-h-11 px-2 text-xs font-semibold text-muted hover:text-accent disabled:opacity-60"
        data-testid="lesson-undo"
      >
        {pending ? 'Undoing…' : 'Undo'}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
};
