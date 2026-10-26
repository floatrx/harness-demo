import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectNotFound, findProject } from '@/lib/board';
import { clockDuration, tokens, usd } from '@/lib/format';
import { projectStats } from '@harness/core/stats';
import { PageHeader } from '@/components/shell/page-header';
import { StatTile } from '@/components/stats/stat-tile';
import { StatsTable } from '@/components/stats/stats-table';
import { RoleAvatar } from '@/components/ui/role-avatar';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function StatsPage({ params }: Props) {
  const { id } = await params;
  let project;
  try {
    project = findProject(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const stats = projectStats(project.path);
  const { total } = stats;
  const unreported = total.units - total.reported;
  return (
    <main className="px-4 pt-3.5 pb-8">
      <PageHeader
        project={project}
        title="Stats"
        lead="Where the time and the usage went, per stage and per task — from what each unit reported. Cost is the API-equivalent price claude -p reports; a subscription is not billed per token."
      />
      {total.units === 0 ? (
        <p className="text-sm text-muted" data-testid="stats-empty">
          No units yet. Start the loop from the board; every unit it runs lands here.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-3">
            <StatTile
              label="Units"
              value={total.units}
              sub={`${total.ok} passed · ${total.stops} parked by a contract`}
            />
            <StatTile
              label="API-equivalent cost"
              value={total.costUsd == null ? '—' : usd(total.costUsd)}
              sub={
                total.reported
                  ? `${usd((total.costUsd ?? 0) / total.reported)} per reporting unit`
                  : 'no unit reported usage'
              }
            />
            <StatTile
              label="Tokens"
              value={total.reported ? tokens(total.tokens) : '—'}
              sub={
                total.cacheReadTokens
                  ? `input + output · + ${tokens(total.cacheReadTokens)} cache reads`
                  : 'input + output'
              }
            />
            <StatTile
              label="Agent time"
              value={clockDuration(total.durationMs)}
              sub={`${clockDuration(total.durationMs / total.units)} per unit`}
            />
            <StatTile
              label="Denied tool calls"
              value={stats.denials.reduce((sum, denial) => sum + denial.count, 0)}
              sub={
                stats.denials.length
                  ? stats.denials.map((denial) => `${denial.tool} ×${denial.count}`).join(' · ')
                  : 'none'
              }
            />
          </div>
          {unreported > 0 && (
            <p
              className="rounded-card border border-line-soft bg-surface px-4 py-2.5 text-[13px] text-muted"
              data-testid="stats-unreported"
            >
              {unreported} of {total.units} units reported no usage: their agent printed plain text, not a stream-json
              result (the fake agent does this). Their cost is unknown, not zero.
            </p>
          )}
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-4">
              <StatsTable
                caption="By stage"
                head="Stage · coordinator"
                rows={stats.byStage}
                testId="stats-by-stage"
                lead={(row) => (
                  <span className="flex items-center gap-2">
                    <RoleAvatar role={row.role} />
                    <b className="font-semibold">{row.key}</b>
                    <span className="truncate text-muted">{row.role}</span>
                  </span>
                )}
              />
              <StatsTable
                caption="By task"
                head="Task"
                rows={stats.byTask}
                testId="stats-by-task"
                lead={(row) => (
                  <Link href={`/p/${id}?t=${row.key}`} className="flex items-center gap-2 hover:text-accent">
                    <b className="flex-none font-semibold">{row.key}</b>
                    <span className="truncate">{row.title ?? 'deleted task'}</span>
                    {row.status && <span className="ml-auto flex-none text-xs text-muted">{row.status}</span>}
                  </Link>
                )}
              />
            </div>
            <aside className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-1">
              <section
                className="rounded-panel border border-line-soft bg-surface px-4 py-3"
                data-testid="stats-verdicts"
              >
                <h2 className="mb-2 text-[13px] font-semibold">Verdicts</h2>
                {stats.verdicts.length ? (
                  <ul className="space-y-1 text-[12.5px]">
                    {stats.verdicts.map((row) => (
                      <li key={`${row.stage}-${row.verdict}`} className="flex gap-2">
                        <span className="text-muted">{row.stage}:</span>
                        <b className={/FAIL|REJECTED/.test(row.verdict) ? 'text-danger' : ''}>{row.verdict}</b>
                        <span className="ml-auto tabular-nums text-muted">×{row.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">No qa or judge unit yet.</p>
                )}
              </section>
              <section
                className="rounded-panel border border-line-soft bg-surface px-4 py-3"
                data-testid="stats-denials"
              >
                <h2 className="mb-1 text-[13px] font-semibold">Permission denials</h2>
                <p className="mb-2 text-xs text-muted">
                  Tool calls the permission mode refused. Frequent ones hint at a missing entry in
                  <code className="mx-1 rounded bg-surface-secondary px-1">agent.allowedTools</code>. The refused
                  commands stay in the files under{' '}
                  <code className="mx-1 rounded bg-surface-secondary px-1">.harness/trace/</code>, never on this page.
                </p>
                {stats.denials.length ? (
                  <ul className="space-y-1 text-[12.5px]">
                    {stats.denials.map((denial) => (
                      <li key={denial.tool} className="flex flex-wrap gap-x-2">
                        <b>{denial.tool}</b>
                        <span className="tabular-nums text-muted">×{denial.count}</span>
                        <span className="ml-auto text-xs">
                          {denial.units.map((unit) => (
                            <Link
                              key={unit}
                              href={`/p/${id}/live?u=${unit}`}
                              className="ml-1.5 text-muted hover:text-accent"
                            >
                              unit {unit}
                            </Link>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted">None.</p>
                )}
              </section>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
