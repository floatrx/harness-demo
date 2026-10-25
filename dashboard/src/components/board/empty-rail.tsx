'use client';

import type { Status } from '@harness/core/task/transitions';
import { cn } from '@/lib/cn';
import { dropClass, useDropState } from './board-column';

interface Props {
  statuses: Status[];
  names: string[];
}

export const EmptyRail = ({ statuses, names }: Props) => {
  const { setNodeRef, isOver, state } = useDropState(`rail-${statuses.join('-')}`, statuses);
  return (
    <section
      ref={setNodeRef}
      data-testid="empty-rail"
      data-statuses={statuses.join(' ')}
      title={`${names.join(', ')} — empty`}
      className={cn(
        'flex min-h-44 w-6 flex-none flex-col items-center gap-2 rounded-panel bg-lane py-2.5 text-[11.5px] text-faint transition',
        dropClass(state, isOver),
        state === 'allowed' && 'w-24 text-accent',
      )}
    >
      <span className="rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{names.join(' · ')}</span>
      <span className="tabular-nums">0</span>
    </section>
  );
};
