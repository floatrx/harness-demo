import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EXIT_LABEL } from '@harness/core/stats';
import { ProjectNotFound } from '@/lib/board';
import { cn } from '@/lib/cn';
import { healthOf, loadHome } from '@/lib/home-view';
import { liveSnapshot } from '@/lib/live';
import { HomeWidget, WidgetEmpty } from '@/components/home/home-widget';
import { SparkBars } from '@/components/home/spark-bars';
import { LiveProvider } from '@/components/live/live-provider';
import { TopLine } from '@/components/shell/top-line';
import { ClaudeWorking } from '@/components/ui/claude-working';
import { CountUp } from '@/components/ui/count-up';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

const SUPERVISOR_LINE = {
  running: 'The loop runs and waits for work.',
  paused: 'The loop is paused.',
  stopped: 'The loop is stopped. Start it from the board.',
} as const;

const HEALTH_CLASS = { ok: 'bg-accent', bounce: 'bg-warn', stop: 'bg-danger' } as const;

export default async function HomePage({ params }: Props) {
  const { id } = await params;
  let home;
  try {
    home = loadHome(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const { board, waiting, done, running, health, spend, verdicts } = home;
  return (
    <LiveProvider projectId={id} initial={liveSnapshot(id)}>
      <main className="px-4 pt-3.5 pb-8" data-testid="home">
        <TopLine board={board} />
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="home-headline">
            {waiting.count ? (
              <>
                <CountUp value={waiting.count} /> task{waiting.count === 1 ? ' waits' : 's wait'} for you
              </>
            ) : (
              'Nothing waits for you'
            )}
          </h1>
          <p className="mt-1 text-sm text-muted" data-testid="home-reasons">
            {waiting.count
              ? waiting.reasons.map((reason) => `${reason.count} ${reason.label}`).join(' · ')
              : board.cards.length
                ? 'The loop has what it needs. The board shows where each task is.'
                : 'No tasks yet. Create the first one on the board.'}
          </p>
        </header>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          <HomeWidget
            title="Waiting for you"
            href={`/p/${id}?owner=human`}
            linkLabel="the board, only the tasks that wait for you"
            testId="home-waiting"
          >
            {waiting.count ? (
              <>
                <p className="text-2xl font-semibold tracking-tight">
                  <CountUp value={waiting.count} />
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {waiting.reasons.map((reason) => (
                    <li key={reason.label}>
                      {reason.count} {reason.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <WidgetEmpty>Nothing waits for you.</WidgetEmpty>
            )}
          </HomeWidget>

          <HomeWidget
            title="Done"
            href={`/p/${id}?status=done,delivered`}
            linkLabel="the board, only the done and delivered tasks"
            testId="home-done"
          >
            {done.finished || done.lastWeek ? (
              <>
                <p className="text-2xl font-semibold tracking-tight">
                  <CountUp value={done.finished} />
                  <span className="text-base font-normal text-muted"> of {done.total}</span>
                </p>
                <div className="mt-auto pt-2">
                  <SparkBars days={done.perDay} />
                  <p className="mt-1 text-xs text-muted">+{done.lastWeek} in 7 days</p>
                </div>
              </>
            ) : (
              <WidgetEmpty>The first done task appears here.</WidgetEmpty>
            )}
          </HomeWidget>

          <HomeWidget
            title="Running now"
            href={running ? `/p/${id}/flow` : `/p/${id}/live`}
            linkLabel={running ? 'the flow of the task in flight' : 'the live trace'}
            testId="home-running"
          >
            {running ? (
              <>
                <p className="truncate text-[15px] font-semibold">
                  {running.task} <span className="font-normal text-muted">{running.title}</span>
                </p>
                <p className="mt-1 text-xs text-muted">stage {running.stage} · unit {running.unit}</p>
                <ClaudeWorking
                  className="mt-auto pt-2 text-[13px]"
                  label={`${running.role} working`}
                  since={running.startedAt}
                />
              </>
            ) : (
              <WidgetEmpty>
                No unit is running. {SUPERVISOR_LINE[home.supervisor]}
              </WidgetEmpty>
            )}
          </HomeWidget>
        </div>

        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
          <HomeWidget
            title={health.length ? `Run health · last ${health.length} unit${health.length === 1 ? '' : 's'}` : 'Run health'}
            href={`/p/${id}/live`}
            linkLabel="the live trace, every unit"
            testId="home-health"
          >
            {health.length ? (
              <>
                <ol className="mt-1 flex flex-wrap gap-1" aria-label="units, oldest first">
                  {health.map((cell) => (
                    <li
                      key={cell.unit}
                      className={cn('size-3.5 rounded-[3px]', HEALTH_CLASS[healthOf(cell)])}
                      title={`unit ${cell.unit} · ${cell.task ?? '?'} · ${cell.stage ?? '?'} · ${EXIT_LABEL[cell.exit ?? -1] ?? `exit ${cell.exit}`}${cell.verdict ? ` · ${cell.verdict}` : ''}`}
                    />
                  ))}
                </ol>
                <p className="mt-auto pt-2 text-xs text-muted">
                  {health.filter((cell) => healthOf(cell) === 'ok').length} passed ·{' '}
                  {health.filter((cell) => healthOf(cell) === 'bounce').length} bounced ·{' '}
                  {health.filter((cell) => healthOf(cell) === 'stop').length} stopped
                </p>
              </>
            ) : (
              <WidgetEmpty>Cells appear after the first unit.</WidgetEmpty>
            )}
          </HomeWidget>

          <HomeWidget
            title="Spend per done task"
            href={`/p/${id}/stats`}
            linkLabel="the stats, per task"
            testId="home-spend"
          >
            {spend && spend.reported ? (
              <>
                <p className="text-2xl font-semibold tracking-tight">
                  {spend.costUsd == null ? '—' : <CountUp value={spend.costUsd} format="usd" />}
                </p>
                <p className="mt-auto pt-2 text-xs text-muted">
                  {spend.tokens != null && (
                    <>
                      <CountUp value={spend.tokens} format="tokens" /> tokens ·{' '}
                    </>
                  )}
                  over {spend.tasks} task{spend.tasks === 1 ? '' : 's'} · API-equivalent
                </p>
              </>
            ) : (
              <WidgetEmpty>
                Cost appears after the first real unit
                {spend ? ': the units of the done tasks reported no usage (a stand-in agent reports none).' : '.'}
              </WidgetEmpty>
            )}
          </HomeWidget>

          <HomeWidget title="Verdicts" href={`/p/${id}/stats`} linkLabel="the stats, verdicts" testId="home-verdicts">
            {verdicts.length ? (
              <ul className="mt-1 space-y-0.5 text-[12.5px]">
                {verdicts.map((row) => (
                  <li key={`${row.stage}-${row.verdict}`} className="flex gap-2">
                    <span className="text-muted">{row.stage}</span>
                    <b className={/FAIL|REJECTED/.test(row.verdict) ? 'text-danger' : ''}>{row.verdict}</b>
                    <span className="ml-auto text-muted tabular-nums">×{row.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <WidgetEmpty>No verdicts yet.</WidgetEmpty>
            )}
          </HomeWidget>
        </div>
        <p className="mt-4 text-xs text-faint">
          Numbers come from the task files and <code>.harness/trace/handoffs.jsonl</code>, the same as{' '}
          <code>harness stats</code>.{' '}
          <Link href={`/p/${id}`} className="inline-flex min-h-11 items-center text-muted hover:text-accent">
            Open the board
          </Link>
        </p>
      </main>
    </LiveProvider>
  );
}
