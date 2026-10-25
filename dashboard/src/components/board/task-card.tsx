'use client';

import { useDraggable } from '@dnd-kit/core';
import Link from 'next/link';
import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { CardAction } from './card-action';
import type { DragData } from './drag.helpers';
import { TaskCardBody } from './task-card-body';

interface Props {
  card: CardModel;
  projectId: string;
  isSelected: boolean;
}

export const cardClass = (card: CardModel) =>
  cn(
    '@container relative flex min-w-0 flex-col gap-1.5 rounded-card border border-border/70 bg-card p-2 transition-colors hover:border-border',
    card.action && 'border-accent-line',
    card.working && 'claude-breathe border-accent bg-card-run',
  );

/* The whole card opens the task (a stretched link); the action button sits above the link. A card the human may
   move is draggable — only along the moves the core allows (card.moves). */
export const TaskCard = ({ card, projectId, isSelected }: Props) => {
  const data: DragData = { card };
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: card.id,
    data,
    disabled: !card.moves.length,
  });
  return (
    <article
      ref={setNodeRef}
      data-testid="task-card"
      data-task={card.id}
      className={cn(
        cardClass(card),
        isSelected && 'ring-2 ring-accent',
        isDragging && 'opacity-30',
        !!card.moves.length && 'cursor-grab',
      )}
      {...attributes}
      {...listeners}
    >
      <Link
        href={`/p/${projectId}?t=${card.id}`}
        scroll={false}
        className="absolute inset-0 rounded-card"
        aria-label={`Open ${card.id}`}
      />
      <TaskCardBody card={card} projectId={projectId} />
      {!card.working && <CardAction card={card} projectId={projectId} />}
    </article>
  );
};
