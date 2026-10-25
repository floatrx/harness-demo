import type { CardModel } from '@/lib/board';

interface Props {
  waiting: CardModel[];
}

const PHRASE: Record<string, (card: CardModel) => string> = {
  Answer: (card) => `${card.id} has ${card.meta}`,
  Approve: (card) => `${card.id}'s plan needs approval`,
  Review: (card) => `${card.id}'s prototype is ready to review`,
  Reopen: (card) => `${card.id} is parked`,
};

/* The page's goal in one sentence: what waits for the human, and where. */
export const WaitingLine = ({ waiting }: Props) => (
  <p className="mt-1 text-sm leading-snug text-muted" data-testid="waiting-line">
    {waiting.length ? (
      <>
        <b className="font-semibold text-foreground">
          {waiting.length} task{waiting.length === 1 ? ' waits' : 's wait'} for you.
        </b>{' '}
        {waiting.map((card, index) => (
          <span key={card.id}>
            {index > 0 && ', '}
            <span className="whitespace-nowrap">{card.id}</span>
            {card.action ? PHRASE[card.action]?.(card).slice(card.id.length) : ''}
          </span>
        ))}
        .
      </>
    ) : (
      'Nothing waits for you — the loop has what it needs.'
    )}
  </p>
);
