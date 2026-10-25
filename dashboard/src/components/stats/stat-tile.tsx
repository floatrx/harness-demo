import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}

/* A headline number: no chart, the value is the point. */
export const StatTile = ({ label, value, sub }: Props) => (
  <div className="rounded-panel border border-line-soft bg-surface px-4 py-3" data-testid="stat-tile">
    <p className="text-xs text-muted">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
  </div>
);
