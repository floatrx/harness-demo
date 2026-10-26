import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { clockDuration, tokens, usd } from '@/lib/format';
import type { StatRow } from '@harness/core/stats';
import { ShareBar } from './share-bar';

interface Props<T extends StatRow> {
  caption: string;
  head: string;
  rows: T[];
  lead: (row: T) => ReactNode;
  testId: string;
}

const cost = (row: StatRow) => (row.costUsd == null ? '—' : usd(row.costUsd));

/* Units, outcome, time, tokens and cost per row. The bar shows cost when any row reported one, else time. */
export const StatsTable = <T extends StatRow>({ caption, head, rows, lead, testId }: Props<T>) => {
  const byCost = rows.some((row) => row.costUsd != null);
  const metric = (row: StatRow) => (byCost ? row.costUsd : row.units ? row.durationMs : null);
  const max = Math.max(0, ...rows.map((row) => metric(row) ?? 0));
  return (
    <section className="rounded-panel border border-line-soft bg-surface" data-testid={testId}>
      <h2 className="border-b border-line-soft px-4 py-2.5 text-[13px] font-semibold">
        {caption} <span className="font-normal text-muted">· bar = {byCost ? 'cost' : 'time'}</span>
      </h2>
      <table className="w-full table-fixed text-[12.5px] tabular-nums">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">{head}</th>
            <th className="w-16 px-2 py-2 text-right font-medium">Units</th>
            <th className="w-16 px-2 py-2 text-right font-medium">Parked</th>
            <th className="w-16 px-2 py-2 text-right font-medium">Time</th>
            <th className="w-20 px-2 py-2 text-right font-medium">Tokens</th>
            <th className="w-20 px-2 py-2 text-right font-medium" title="API-equivalent price reported by claude -p">
              Cost*
            </th>
            <th className="w-[24%] px-4 py-2 font-medium" aria-label="share" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cn('border-t border-line-soft', !row.units && 'text-faint')}>
              <td className="px-4 py-2">{lead(row)}</td>
              <td className="px-2 py-2 text-right">{row.units || '—'}</td>
              <td className={cn('px-2 py-2 text-right', row.stops ? 'text-danger' : 'text-muted')}>
                {row.stops || '—'}
              </td>
              <td className="px-2 py-2 text-right">{row.units ? clockDuration(row.durationMs) : '—'}</td>
              <td className="px-2 py-2 text-right">{row.reported ? tokens(row.tokens) : '—'}</td>
              <td className="px-2 py-2 text-right font-semibold">{cost(row)}</td>
              <td className="px-4 py-2">
                {!!row.units && (
                  <ShareBar
                    value={metric(row)}
                    max={max}
                    label={byCost ? `${row.key}: ${cost(row)}` : `${row.key}: ${clockDuration(row.durationMs)}`}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
