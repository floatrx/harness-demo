import Link from 'next/link';
import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { RoleAvatar } from '@/components/ui/role-avatar';
import { StageTrack } from './stage-track';

interface Props {
  card: CardModel;
  projectId: string;
  isSelected: boolean;
}

export const TaskCard = ({ card, projectId, isSelected }: Props) => (
  <Link
    href={`/p/${projectId}?t=${card.id}`}
    scroll={false}
    data-testid="task-card"
    className={cn(
      '@container flex min-w-0 flex-col gap-1.5 rounded-card border border-border/70 bg-card p-2 transition-colors hover:border-border',
      card.action && 'border-accent-line',
      card.working && 'border-accent-line bg-card-run',
      isSelected && 'ring-2 ring-accent',
    )}
  >
    <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <span className="whitespace-nowrap tabular-nums">{card.id}</span>
      {card.kind && <span className="hidden rounded-[5px] bg-surface-secondary px-1.5 @min-[8.5rem]:inline">{card.kind}</span>}
      {!!card.bounces && (
        <span className="flex gap-0.5" title={`bounce ${card.bounces} of ${card.bounceCap}`}>
          {Array.from({ length: card.bounceCap }, (_, index) => (
            <i
              key={index}
              className={cn(
                'size-[7px] rounded-full border-[1.5px] border-danger',
                index < card.bounces && 'bg-danger',
              )}
            />
          ))}
        </span>
      )}
      {!card.working && card.owner && <RoleAvatar role={card.owner} className="ml-auto" />}
    </div>
    <h3 className="text-[13px] leading-snug font-semibold">{card.title}</h3>
    {card.hasPrototype && (
      <img
        src={`/api/p/${projectId}/artifacts/${card.id}/prototype.svg`}
        alt={`Prototype of ${card.id}`}
        className="w-full rounded-md bg-background"
      />
    )}
    <StageTrack status={card.trackStatus} isBad={card.isBad} />
    <div className="flex min-h-5 items-start gap-1.5 text-xs text-muted">
      {card.working ? (
        <>
          <RoleAvatar role={card.working.role} state="live" />
          <span className="flex items-center font-semibold text-foreground">
            <ClaudeSpinner />
            {card.working.role} · unit {card.working.unit}
          </span>
        </>
      ) : (
        <span className={cn('line-clamp-2 leading-snug', card.isBad && 'text-danger')}>{card.meta}</span>
      )}
    </div>
    {card.action && !card.working && (
      <span
        className={cn(
          'flex h-7 items-center rounded-[7px] px-2.5 text-[12.5px] font-semibold',
          card.isBad ? 'bg-surface-secondary text-foreground' : 'bg-accent-soft text-accent',
        )}
      >
        {card.action}
      </span>
    )}
  </Link>
);
