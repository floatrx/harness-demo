import type { Status } from '@harness/core/task/transitions';
import type { CardModel } from '@/lib/board';
import { TaskCard } from './task-card';

interface Props {
  status: Status;
  name: string;
  cards: CardModel[];
  projectId: string;
  selectedId: string | null;
}

export const BoardColumn = ({ status, name, cards, projectId, selectedId }: Props) => (
  <section
    data-testid={`column-${status}`}
    className="flex min-w-[118px] flex-1 basis-0 flex-col gap-1.5 rounded-panel bg-lane p-1.5"
  >
    <header className="flex min-w-0 items-center gap-1.5 px-1 pt-1">
      <span className="truncate text-[13px] font-semibold">{name}</span>
      <span className="text-muted tabular-nums">{cards.length}</span>
    </header>
    {cards.map((card) => (
      <TaskCard key={card.id} card={card} projectId={projectId} isSelected={card.id === selectedId} />
    ))}
  </section>
);
