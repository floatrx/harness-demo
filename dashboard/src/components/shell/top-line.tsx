import type { BoardModel } from '@/lib/board';
import { duration, usd } from '@/lib/format';

interface Props {
  board: BoardModel;
}

export const TopLine = ({ board }: Props) => (
  <div className="mb-3.5 flex h-8 items-center gap-3 text-[13px] whitespace-nowrap">
    <span className="min-w-0 truncate">
      <b className="text-sm font-semibold">{board.project.name}</b>{' '}
      <span className="text-muted">
        {board.project.path.replace(/^\/Users\/[^/]+/, '~')} · {board.baseBranch}
      </span>
    </span>
    <span className="ml-auto text-muted" data-testid="today">
      Today {board.today.units} units
      {board.today.durationMs != null && ` · ${duration(board.today.durationMs)}`}
      {board.today.costUsd != null && ` · ${usd(board.today.costUsd)}`}
    </span>
  </div>
);
