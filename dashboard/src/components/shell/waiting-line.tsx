import type { CardModel } from '@/lib/board';

interface Props {
  waiting: CardModel[];
  drafts: CardModel[];
}

const PHRASE: Record<string, (card: CardModel) => string> = {
  Answer: (card) => `${card.id} has ${card.meta}`,
  Approve: (card) => `${card.id}'s plan needs approval`,
  Review: (card) => `${card.id}'s prototype is ready to review`,
  Reopen: (card) => `${card.id} is parked`,
};

const draftsLine = (drafts: CardModel[]) =>
  drafts.length === 1
    ? `${drafts[0]?.id} is a draft — Submit starts the loop on it.`
    : `${drafts.length} drafts are yours — Submit starts the loop on each.`;

/* The page's goal in one sentence: what waits for the human, and where. Drafts are named apart: they do not block
   the loop, but a first screen of Submit buttons under "nothing waits for you" read as a contradiction. */
export const WaitingLine = ({ waiting, drafts }: Props) => (
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
        .{drafts.length > 0 && ` ${draftsLine(drafts)}`}
      </>
    ) : drafts.length ? (
      <>
        <b className="font-semibold text-foreground">{draftsLine(drafts)}</b>
      </>
    ) : (
      'Nothing waits for you — the loop has what it needs.'
    )}
  </p>
);
