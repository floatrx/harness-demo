import { STATUSES, type Status } from '@harness/core/task/transitions';
import { cn } from '@/lib/cn';

/* The pipeline up to done; delivered and parked are not stages a task passes through. */
const TRACK = STATUSES.slice(0, 11);

interface Props {
  status: Status;
  isBad?: boolean;
  className?: string;
}

export const StageTrack = ({ status, isBad, className }: Props) => {
  /* Delivered is past the end of the pipeline: the whole track is walked, done is the last lit segment. */
  const at = status === 'delivered' ? TRACK.length - 1 : TRACK.indexOf(status);
  return (
    <div className={cn('flex gap-0.5', className)} aria-label={`stage ${status}`}>
      {TRACK.map((stage, index) => (
        <i
          key={stage}
          className={cn(
            'h-[3px] flex-1 rounded-sm bg-track',
            index < at && 'bg-track-past',
            index === at && (isBad ? 'bg-danger' : 'bg-accent'),
          )}
        />
      ))}
    </div>
  );
};
