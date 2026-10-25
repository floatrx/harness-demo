import Link from 'next/link';
import { cn } from '@/lib/cn';
import { clockDuration, usd } from '@/lib/format';
import { EXIT_LABEL, type UnitRecord } from '@/lib/units';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';

interface Props {
  projectId: string;
  units: UnitRecord[];
  runningUnit: number | null;
  selected: number | null;
}

export const UnitList = ({ projectId, units, runningUnit, selected }: Props) => (
  <nav aria-label="Units" className="flex flex-col gap-1" data-testid="unit-list">
    {runningUnit !== null && !units.some((unit) => unit.unit === runningUnit) && (
      <Link
        href={`/p/${projectId}/live?u=${runningUnit}`}
        className={cn(
          'flex items-center gap-1.5 rounded-card px-3 py-2 text-[12.5px] hover:bg-surface',
          selected === runningUnit && 'bg-accent-soft',
        )}
      >
        <ClaudeSpinner size="sm" />
        <span className="font-semibold text-accent">unit {runningUnit} · running</span>
      </Link>
    )}
    {units.map((unit) => (
      <Link
        key={`${unit.unit}-${unit.at}`}
        href={`/p/${projectId}/live?u=${unit.unit}`}
        className={cn(
          'rounded-card px-3 py-2 text-[12.5px] hover:bg-surface',
          selected === unit.unit && 'bg-surface-secondary',
        )}
      >
        <span className="flex items-center gap-1.5">
          <b className="tabular-nums">unit {unit.unit}</b>
          <span className="text-muted">
            {unit.task} · {unit.stage}
          </span>
          <span className={cn('ml-auto text-xs', unit.exit === 0 ? 'text-muted' : 'text-danger')}>
            {EXIT_LABEL[unit.exit ?? 0] ?? unit.exit}
          </span>
        </span>
        <span className="flex gap-1.5 text-xs text-muted">
          {unit.from} → {unit.to}
          <span className="ml-auto tabular-nums">
            {unit.durationMs != null ? clockDuration(unit.durationMs) : '—'}
            {unit.usage?.costUsd != null && ` · ${usd(unit.usage.costUsd)}`}
          </span>
        </span>
      </Link>
    ))}
    {!units.length && runningUnit === null && (
      <p className="px-3 text-sm text-muted">No units yet — start the supervisor from the board.</p>
    )}
  </nav>
);
