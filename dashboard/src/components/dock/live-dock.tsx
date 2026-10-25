import type { DockModel } from '@/lib/board';
import { clock, usd } from '@/lib/format';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { ClaudeWorking } from '@/components/ui/claude-working';
import { RoleAvatar } from '@/components/ui/role-avatar';

interface Props {
  dock: DockModel;
}

const STATE_LABEL = { running: 'Running', paused: 'Paused', stopped: 'Not running' } as const;

/* Phase 1: a snapshot rendered on the server. Phase 3 makes it live over SSE and wires the controls. */
export const LiveDock = ({ dock }: Props) => (
  <aside
    className="flex h-screen flex-col gap-5 overflow-y-auto border-l border-line-soft bg-rail px-3.5 py-3.5"
    data-testid="live-dock"
  >
    <section>
      <h4 className="mb-1 text-xs font-semibold text-muted">Supervisor</h4>
      <p className="flex items-center text-lg font-semibold">
        {dock.supervisor.state === 'running' && <ClaudeSpinner />}
        {STATE_LABEL[dock.supervisor.state]}
      </p>
      <p className="text-xs text-muted">
        {dock.supervisor.pid ? `pid ${dock.supervisor.pid}` : 'Start it from here or with harness run'}
      </p>
      <div className="mt-2 flex gap-1.5">
        {(dock.supervisor.state === 'stopped' ? ['Start'] : ['Pause', 'Stop']).map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className="h-[30px] rounded-[7px] border border-border px-3 text-[12.5px] opacity-60"
            title="Controls arrive in phase 3"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
    <section>
      <h4 className="mb-1.5 text-xs font-semibold text-muted">Unit in flight</h4>
      {dock.running ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <RoleAvatar role={dock.running.role} state="live" />
          <div>
            <ClaudeWorking label={`unit ${dock.running.unit} · ${dock.running.task}`} since={dock.running.startedAt} />
            <p className="text-xs text-muted">
              {dock.running.stage} · {dock.running.role} · since {clock(dock.running.startedAt)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">Nothing is running.</p>
      )}
    </section>
    <section>
      <h4 className="mb-1 text-xs font-semibold text-muted">Up next</h4>
      <p className="text-[12.5px]">{dock.upNext ?? 'Nothing to take — the board waits for you.'}</p>
    </section>
    <section>
      <h4 className="mb-1.5 text-xs font-semibold text-muted">Recent units</h4>
      {dock.recent.length ? (
        <table className="w-full text-xs">
          <tbody>
            {dock.recent.map((unit) => (
              <tr key={`${unit.unit}-${unit.at}`} className="border-b border-line-soft">
                <td className="w-6 py-1.5 text-muted tabular-nums">{unit.unit}</td>
                <td className="py-1.5">
                  <span className="text-muted tabular-nums">{unit.task}</span> {unit.from} → {unit.to}
                </td>
                <td className="py-1.5 text-right text-muted tabular-nums">
                  {unit.usage?.costUsd != null ? usd(unit.usage.costUsd) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted">No units yet.</p>
      )}
    </section>
  </aside>
);
