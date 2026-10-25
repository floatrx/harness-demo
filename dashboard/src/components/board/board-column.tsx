'use client';

import { useDndContext, useDroppable } from '@dnd-kit/core';
import type { Status } from '@harness/core/task/transitions';
import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { type DragData, type DropData, moveFor } from './drag.helpers';
import { TaskCard } from './task-card';

interface Props {
  status: Status;
  name: string;
  cards: CardModel[];
  projectId: string;
  selectedId: string | null;
}

export type DropState = 'idle' | 'allowed' | 'refused';

/** While a card is dragged: 'allowed' when this column is one of its moves, 'refused' otherwise. */
export const useDropState = (id: string, statuses: Status[]) => {
  const data: DropData = { statuses };
  const { setNodeRef, isOver } = useDroppable({ id, data });
  const { active } = useDndContext();
  const dragged = (active?.data.current as DragData | undefined)?.card;
  const state: DropState =
    !dragged || dragged.status === statuses[0] ? 'idle' : moveFor(dragged, statuses) ? 'allowed' : 'refused';
  return { setNodeRef, isOver, state };
};

export const dropClass = (state: DropState, isOver: boolean) =>
  cn(
    state === 'allowed' && 'ring-1 ring-accent-line',
    state === 'allowed' && isOver && 'bg-accent-soft ring-2 ring-accent',
    state === 'refused' && 'opacity-40',
  );

export const BoardColumn = ({ status, name, cards, projectId, selectedId }: Props) => {
  const { setNodeRef, isOver, state } = useDropState(`column-${status}`, [status]);
  return (
    <section
      ref={setNodeRef}
      data-testid={`column-${status}`}
      className={cn(
        'flex min-w-[118px] flex-1 basis-0 flex-col gap-1.5 rounded-panel bg-lane p-1.5 transition',
        dropClass(state, isOver),
      )}
    >
      <header className="flex min-w-0 items-center gap-1.5 px-1 pt-1">
        <span className="truncate text-[13px] font-semibold">{name}</span>
        <span className="text-muted tabular-nums">{cards.length}</span>
        {cards.some((card) => card.working) && <ClaudeSpinner size="sm" className="ml-auto" />}
      </header>
      {cards.map((card) => (
        <TaskCard key={card.id} card={card} projectId={projectId} isSelected={card.id === selectedId} />
      ))}
    </section>
  );
};
