import type { Status } from '@harness/core/task/transitions';
import type { CardModel } from '@/lib/board';
import { BoardColumn } from './board-column';
import { EmptyRail } from './empty-rail';
import { COLUMN_NAMES, PHASES } from './board.config';

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

/* Columns are fluid: each populated column takes an equal share (min ~120px), rails stay 24px. The board fits a
   1440px screen with the dock open and grows on wider ones; below its minimum it scrolls sideways. */
export const BoardView = ({ cards, projectId, selectedId }: Props) => (
  <div className="flex gap-2 overflow-x-auto pb-3" data-testid="board">
    {PHASES.map((phase) => {
      const slots = slotsOf(phase.columns, cards);
      const populated = slots.filter((slot) => slot.kind === 'column').length;
      return (
        <div
          key={phase.name}
          className="flex min-w-0 flex-col gap-1.5"
          style={{ flex: populated ? `${populated} 1 0` : '0 0 auto' }}
        >
          <div className="truncate border-b-2 border-line-soft px-0.5 pb-1 text-[11.5px] font-semibold text-faint">
            {phase.name}
          </div>
          <div className="flex items-start gap-1.5">
            {slots.map((slot) =>
              slot.kind === 'rail' ? (
                <EmptyRail key={slot.statuses.join('-')} names={slot.statuses.map((status) => COLUMN_NAMES[status])} />
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
);
