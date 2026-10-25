'use client';

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Status } from '@harness/core/task/transitions';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { mutate, taskActionUrl } from '@/lib/mutate';
import { BoardColumn } from './board-column';
import { COLUMN_NAMES, PHASES } from './board.config';
import { type DragData, type DropData, moveFor } from './drag.helpers';
import { EmptyRail } from './empty-rail';
import { TaskCardBody } from './task-card-body';
import { cardClass } from './task-card';

interface Props {
  cards: CardModel[];
  projectId: string;
  selectedId: string | null;
}

type Slot = { kind: 'column'; status: Status; cards: CardModel[] } | { kind: 'rail'; statuses: Status[] };

/* Consecutive empty columns of a phase share one rail, so the populated ones get the width. */
const slotsOf = (columns: Status[], cards: CardModel[]): Slot[] =>
  columns.reduce<Slot[]>((slots, status) => {
    const own = cards.filter((card) => card.status === status);
    const last = slots.at(-1);
    if (own.length) return [...slots, { kind: 'column', status, cards: own }];
    if (last?.kind === 'rail') return [...slots.slice(0, -1), { kind: 'rail', statuses: [...last.statuses, status] }];
    return [...slots, { kind: 'rail', statuses: [status] }];
  }, []);

/* Columns are fluid: each populated column takes an equal share (min ~118px), rails stay 24px. The board fits a
   1440px screen with the dock open and grows on wider ones; below its minimum it scrolls sideways. */
/* The column under the pointer wins. Rect overlap (dnd-kit's default) lets a wide card dropped on a 24 px empty rail
   land on its own column instead, which overlaps it more. The keyboard has no pointer: it falls back to overlap. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/* Empty rails widen once a drag starts; measure the drop targets while dragging, not only before. */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

export const BoardView = ({ cards, projectId, selectedId }: Props) => {
  const router = useRouter();
  const [dragged, setDragged] = useState<CardModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A press that moves less than 6px stays a click, so the card still opens. */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setDragged(null);
    const card = (active.data.current as DragData | undefined)?.card;
    const statuses = (over?.data.current as DropData | undefined)?.statuses;
    if (!card || !statuses || statuses.includes(card.status)) return;
    const move = moveFor(card, statuses);
    if (!move) {
      setError(
        `${card.id} cannot move from ${COLUMN_NAMES[card.status]} to ${statuses.map((status) => COLUMN_NAMES[status]).join(' · ')}`,
      );
      return;
    }
    setError(null);
    try {
      await mutate(taskActionUrl(projectId, card.id, move.action));
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={MEASURING}
      onDragStart={({ active }) => setDragged((active.data.current as DragData | undefined)?.card ?? null)}
      onDragCancel={() => setDragged(null)}
      onDragEnd={handleDragEnd}
    >
      {error && (
        <p
          role="alert"
          className="mb-2 rounded-card bg-danger/10 px-3 py-2 text-[13px] text-danger"
          data-testid="board-error"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2 overflow-x-auto pb-3" data-testid="board">
        {PHASES.map((phase) => {
          const slots = slotsOf(phase.columns, cards);
          const populated = slots.filter((slot) => slot.kind === 'column').length;
          /* min-w-fit: a phase never shrinks below its rails and 118 px columns — narrower, the board scrolls
             sideways in its own lane instead of drawing one phase over the next. */
          return (
            <div
              key={phase.name}
              className="flex min-w-fit flex-col gap-1.5"
              style={{ flex: populated ? `${populated} 1 0` : '0 0 auto' }}
            >
              <div className="truncate border-b-2 border-line-soft px-0.5 pb-1 text-[11.5px] font-semibold text-faint">
                {phase.name}
              </div>
              <div className="flex items-start gap-1.5">
                {slots.map((slot) =>
                  slot.kind === 'rail' ? (
                    <EmptyRail
                      key={slot.statuses.join('-')}
                      statuses={slot.statuses}
                      names={slot.statuses.map((status) => COLUMN_NAMES[status])}
                    />
                  ) : (
                    <BoardColumn
                      key={slot.status}
                      status={slot.status}
                      name={COLUMN_NAMES[slot.status]}
                      cards={slot.cards}
                      projectId={projectId}
                      selectedId={selectedId}
                    />
                  ),
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className={cn(cardClass(dragged), 'w-44 rotate-2 cursor-grabbing shadow-xl shadow-black/50')}>
            <TaskCardBody card={dragged} projectId={projectId} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
};
