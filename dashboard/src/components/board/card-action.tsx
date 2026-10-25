'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { mutate, taskActionUrl } from '@/lib/mutate';

interface Props {
  card: CardModel;
  projectId: string;
}

/* Answer and Review open the task where the human acts; the others fire the human transition directly. */
const DIRECT: Partial<Record<NonNullable<CardModel['action']>, string>> = {
  Submit: 'submit',
  Approve: 'approve',
  Reopen: 'reopen',
};

const buttonClass = (isBad: boolean) =>
  cn(
    'relative z-10 flex h-7 w-full items-center rounded-[7px] px-2.5 text-left text-[12.5px] font-semibold transition-colors disabled:opacity-60',
    isBad
      ? 'bg-surface-secondary text-foreground hover:bg-surface-tertiary'
      : 'bg-accent-soft text-accent hover:bg-accent/25',
  );

export const CardAction = ({ card, projectId }: Props) => {
  const router = useRouter();
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!card.action) return null;
  const action = DIRECT[card.action];
  if (!action)
    return (
      <Link
        href={`/p/${projectId}?t=${card.id}`}
        scroll={false}
        className={buttonClass(card.isBad)}
        data-testid="card-action"
      >
        {card.action}
      </Link>
    );
  const handlePress = async () => {
    setPending(true);
    setError(null);
    try {
      await mutate(taskActionUrl(projectId, card.id, action));
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={handlePress}
        disabled={isPending}
        className={buttonClass(card.isBad)}
        data-testid="card-action"
      >
        {isPending ? `${card.action}…` : card.action}
      </button>
      {error && (
        <p role="alert" className="relative z-10 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
};
