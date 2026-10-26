import { notFound } from 'next/navigation';
import { STAGE_ROLE, type UnitStage } from '@harness/core/config';
import { ProjectNotFound, findProject } from '@/lib/board';
import { cn } from '@/lib/cn';
import { clockDuration, tokens, usd } from '@/lib/format';
import { loadTracePage } from '@/lib/unit-detail';
import { EXIT_LABEL } from '@harness/core/stats';
import { PageHeader } from '@/components/shell/page-header';
import { AgentLane } from '@/components/trace/agent-lane';
import { UnitList } from '@/components/trace/unit-list';
import { AutoRefresh } from '@/components/ui/auto-refresh';
import { ClaudeWorking } from '@/components/ui/claude-working';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ u?: string }>;
}

const Chip = ({ children, isBad }: { children: React.ReactNode; isBad?: boolean }) => (
  <span className={cn('rounded-full bg-surface-secondary px-2 py-0.5 text-xs', isBad ? 'text-danger' : 'text-muted')}>
    {children}
  </span>
);

export default async function TracePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { u } = await searchParams;
  let project;
  try {
    project = findProject(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const page = loadTracePage(id, u && /^\d+$/.test(u) ? Number(u) : null);
  const detail = page.selected;
  const record = detail?.record ?? null;
  const stage = (detail?.running?.stage ?? record?.stage ?? 'spec') as UnitStage;
  const coordinatorRole = detail?.running?.role ?? STAGE_ROLE[stage] ?? 'coordinator';
  const trace = detail?.trace ?? null;
  const usage = record?.usage;
  return (
    <main className="px-4 pt-3.5 pb-8">
      {/* Follow the loop: the unit in flight fast; with no unit picked, also whatever starts next (slower while idle).
          A picked past unit never changes, so it does not poll. */}
      {(detail?.running || !u) && <AutoRefresh everyMs={detail?.running || page.supervisorRunning ? 2000 : 5000} />}
      <PageHeader
        project={project}
        title="Live trace"
        lead="Every unit the loop ran: who it dispatched, which tools they used on which files, and what came out. Tool arguments and messages are never shown."
      />
      <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-5">
        <UnitList projectId={id} units={page.units} runningUnit={page.runningUnit} selected={detail?.unit ?? null} />
        {detail ? (
          <div className="min-w-0 space-y-4" data-testid="unit-detail">
            <div>
              <h2 className="text-lg font-semibold">
                Unit {detail.unit} · {detail.running?.task ?? record?.task} · {stage}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {detail.running ? (
                  <ClaudeWorking label={`${coordinatorRole} working`} since={detail.running.startedAt} />
                ) : (
                  record && (
                    <>
                      <Chip isBad={record.exit !== 0}>{EXIT_LABEL[record.exit ?? 0]}</Chip>
                      <Chip>
                        {record.from} → {record.to}
                      </Chip>
                      {record.verdict && <Chip>verdict {record.verdict}</Chip>}
                      {record.commit && <Chip>commit {record.commit.slice(0, 7)}</Chip>}
                      {record.durationMs != null && <Chip>{clockDuration(record.durationMs)}</Chip>}
                      {usage?.costUsd != null && <Chip>{usd(usage.costUsd)}</Chip>}
                      {usage?.inputTokens != null && (
                        <Chip>{tokens((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))} tokens</Chip>
                      )}
                    </>
                  )
                )}
                {!!trace?.denials && <Chip isBad>{trace.denials} denied</Chip>}
              </div>
              {record?.reason && <p className="mt-2 text-[13px] text-danger">{record.reason}</p>}
              {!!detail.offered.length && (
                <p className="mt-2 text-xs text-muted">Offered specialists: {detail.offered.join(', ')}</p>
              )}
            </div>
            {trace ? (
              <div className="grid gap-3 xl:grid-cols-2">
                <AgentLane
                  role={coordinatorRole}
                  state="coordinator"
                  steps={trace.steps.filter((step) => step.actor === 'coordinator')}
                  origin={trace.startedAt}
                  durationMs={null}
                  className="xl:col-span-2"
                />
                {trace.agents.map((agent) => (
                  <AgentLane
                    key={agent.id}
                    role={agent.role}
                    state={agent.state}
                    steps={trace.steps.filter((step) => step.actor === agent.id)}
                    origin={trace.startedAt}
                    durationMs={
                      agent.startedAt && agent.endedAt
                        ? new Date(agent.endedAt).getTime() - new Date(agent.startedAt).getTime()
                        : null
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No trace file for this unit.</p>
            )}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold text-muted">
                Supervisor log <span className="font-normal text-faint">· newest first</span>
              </h3>
              <pre
                className="max-h-72 overflow-auto rounded-panel border border-line-soft bg-rail p-3 text-[11.5px] leading-relaxed text-muted"
                data-testid="supervisor-log"
              >
                {page.supervisorLog
                  .toReversed()
                  .map((line) => line.replace(/^\S+T(\d\d:\d\d:\d\d)\.\d+Z /, '$1 '))
                  .join('\n') || 'Empty.'}
              </pre>
            </section>
          </div>
        ) : (
          <p className="text-sm text-muted" data-testid="unit-missing">
            {u
              ? `No unit ${u} in this project.`
              : 'No units yet. Start the loop from the board; every unit shows up here.'}
          </p>
        )}
      </div>
    </main>
  );
}
