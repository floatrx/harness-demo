import type { Handoff } from '@/lib/board';
import { clock, usd } from '@/lib/format';

interface Props {
  units: Handoff[];
}

export const UnitsPanel = ({ units }: Props) =>
  units.length ? (
    <table className="w-full text-xs">
      <tbody>
        {[...units].reverse().map((unit) => (
          <tr key={`${unit.unit}-${unit.at}`} className="border-b border-line-soft">
            <td className="py-1.5 text-muted tabular-nums">{clock(unit.at)}</td>
            <td className="py-1.5 tabular-nums">unit {unit.unit}</td>
            <td className="py-1.5">{unit.stage}</td>
            <td className="py-1.5">
              {unit.from} → {unit.to}
              {unit.verdict && <span className="ml-1 text-muted">· {unit.verdict}</span>}
            </td>
            <td className="py-1.5 text-right text-muted tabular-nums">
              {unit.usage?.costUsd != null ? usd(unit.usage.costUsd) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p className="text-[13.5px] text-muted">No units have run on this task yet.</p>
  );
