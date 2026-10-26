'use client';

import Link from 'next/link';
import { clock, usd } from '@/lib/format';
import { AgentRow } from '@/components/live/agent-row';
import { useLive } from '@/components/live/live-provider';
import { SupervisorControls } from '@/components/live/supervisor-controls';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { ClaudeWorking } from '@/components/ui/claude-working';

interface Props {
  projectId: string;
}

const STATE_LABEL = { running: 'Running', paused: 'Paused', stopping: 'Stopping', stopped: 'Not running' } as const;

export const LiveDock = ({ projectId }: Props) => {
  const { snapshot, isConnected } = useLive();
  const { supervisor, running, upNext, recent } = snapshot;
  return (
    <aside
      className="flex h-screen flex-col gap-5 overflow-y-auto border-l border-line-soft bg-rail px-3.5 py-3.5"
      data-testid="live-dock"
    >
      <section>
        <h4 className="mb-1 flex items-center text-xs font-semibold text-muted">
          Supervisor
          {!isConnected && <span className="ml-auto font-normal text-danger">reconnecting…</span>}
        </h4>
        <p className="flex items-center text-lg font-semibold" data-testid="supervisor-state">
          {supervisor.state === 'running' && <ClaudeSpinner size="lg" />}
          {STATE_LABEL[supervisor.state]}
        </p>
        <p className="text-xs text-muted">
          {supervisor.pid
            ? `pid ${supervisor.pid}${supervisor.since ? ` · since ${clock(supervisor.since)}` : ''}`
            : 'Start it here or with harness run'}
        </p>
        <SupervisorControls projectId={projectId} state={supervisor.state} agent={snapshot.agent} />
      </section>

      <section>
        <h4 className="mb-1.5 text-xs font-semibold text-muted">Unit in flight</h4>
        {running ? (
          <div className="space-y-2.5" data-testid="unit-in-flight">
            <div className="text-[12.5px]">
              <ClaudeWorking label={`unit ${running.unit} · ${running.task}`} since={running.startedAt} />
              <p className="text-xs text-muted">{running.stage} stage</p>
            </div>
            {running.trace && running.trace.agents.length ? (
              <ol className="space-y-2">
                {running.trace.agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted">
                {running.trace?.coordinator.tool
                  ? `${running.role} · ${running.trace.coordinator.tool}${running.trace.coordinator.file ? ` · ${running.trace.coordinator.file}` : ''}`
                  : 'No specialist dispatched yet.'}
              </p>
            )}
            {!!running.trace?.denials && (
              <p className="text-xs text-danger">{running.trace.denials} tool call(s) denied</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">Nothing is running.</p>
        )}
      </section>

      <section>
        <h4 className="mb-1 text-xs font-semibold text-muted">Up next</h4>
        <p className="text-[12.5px]">{upNext ?? 'Nothing to take — the board waits for you.'}</p>
      </section>

      <section>
        <h4 className="mb-1.5 text-xs font-semibold text-muted">Recent units</h4>
        {recent.length ? (
          <table className="w-full text-xs">
            <tbody>
              {recent.map((unit) => (
                <tr key={`${unit.unit}-${unit.at}`} className="border-b border-line-soft">
                  <td className="w-6 py-1.5 text-muted tabular-nums">{unit.unit ?? '↗'}</td>
                  <td className="py-1.5">
                    {unit.unit != null ? (
                      <Link href={`/p/${projectId}/live?u=${unit.unit}`} className="hover:text-accent">
                        <span className="text-muted tabular-nums">{unit.task}</span> {unit.from} → {unit.to}
                      </Link>
                    ) : (
                      /* A runner step (delivery): no trace to open; the pull request is the link. */
                      <a href={unit.pr ?? '#'} target="_blank" rel="noreferrer" className="hover:text-accent">
                        <span className="text-muted tabular-nums">{unit.task}</span> {unit.from} → {unit.to}
                      </a>
                    )}
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
};
