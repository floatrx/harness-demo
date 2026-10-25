import type { Status } from '@harness/core/task/transitions';
import type { CardModel } from '@/lib/board';

export interface DropData {
  statuses: Status[];
}

export interface DragData {
  card: CardModel;
}

/** The human move a drop of `card` onto a column (or a merged rail) fires, if any. */
export const moveFor = (card: CardModel, statuses: readonly Status[]) =>
  card.moves.find((move) => statuses.includes(move.target));
