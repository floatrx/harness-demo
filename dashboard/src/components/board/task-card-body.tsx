import type { CardModel } from '@/lib/board';
import { cn } from '@/lib/cn';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { ClaudeWorking } from '@/components/ui/claude-working';
import { RoleAvatar } from '@/components/ui/role-avatar';
import { StageTrack } from './stage-track';

interface Props {
  card: CardModel;
  projectId: string;
}

/* What a card shows; TaskCard adds the link, the drag handle and the action around it. */
export const TaskCardBody = ({ card, projectId }: Props) => (
  <>
    <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <span className="whitespace-nowrap tabular-nums">{card.id}</span>
      {card.kind && (
        <span className="hidden rounded-[5px] bg-surface-secondary px-1.5 @min-[8.5rem]:inline">{card.kind}</span>
      )}
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
      {card.working ? (
        <ClaudeSpinner className="ml-auto" />
      ) : (
        card.owner && <RoleAvatar role={card.owner} className="ml-auto" />
      )}
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
        <ClaudeWorking label={card.working.role} since={card.working.since} />
      ) : (
        <>
          {card.agentNext && <ClaudeSpinner state="idle" size="sm" title="waits for an agent" />}
          <span className={cn('line-clamp-2 leading-snug', card.isBad && 'text-danger')}>{card.meta}</span>
        </>
      )}
    </div>
  </>
);
