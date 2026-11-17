import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProjectNotFound } from '@/lib/board';
import { cn } from '@/lib/cn';
import { loadFlow } from '@/lib/flow-view';
import { MarkdownPanel } from '@/components/drawer/markdown-panel';
import { FlowLanes } from '@/components/flow/flow-lanes';
import { PageHeader } from '@/components/shell/page-header';
import { AutoRefresh } from '@/components/ui/auto-refresh';
import { RoleAvatar } from '@/components/ui/role-avatar';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string }>;
}

export default async function FlowPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { a } = await searchParams;
  let flow;
  try {
    flow = loadFlow(id, a ?? null);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const { board, lane, lastRuns, agent, missingAgent } = flow;
  const hasDrawer = !!(agent || missingAgent);
  return (
    <div className={cn('grid min-h-screen', hasDrawer && 'lg:grid-cols-[minmax(0,1fr)_380px]')}>
      {/* The unit in flight changes every second or two; idle with the loop on, the next unit may start any moment. */}
      {(lane || board.dock.supervisor.state === 'running') && <AutoRefresh everyMs={lane ? 2000 : 5000} />}
      <main className="min-w-0 px-4 pt-3.5 pb-8" data-testid="flow">
        <PageHeader
          project={board.project}
          title="Flow"
          lead="Which stage and which agent work on a task now: the path its kind should take, what really ran, and who is on it."
        />
        <FlowLanes projectId={id} lane={lane} lastRuns={lastRuns} selectedAgent={agent?.name ?? missingAgent} />
      </main>
      {hasDrawer && (
        <aside
          className="border-t border-line-soft bg-rail px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-t-0 lg:border-l"
          data-testid="flow-agent"
        >
          <header className="mb-3 flex items-center gap-2">
            <RoleAvatar role={agent?.name ?? missingAgent ?? ''} />
            <h2 className="text-[15px] font-semibold">{agent?.name ?? missingAgent}</h2>
            <Link
              href={`/p/${id}/flow`}
              scroll={false}
              className="ml-auto inline-flex min-h-11 items-center px-1 text-xs text-muted hover:text-accent"
            >
              Close
            </Link>
          </header>
          {agent ? (
            <>
              <p className="text-[13px] text-muted">{agent.description}</p>
              <dl className="my-3 grid grid-cols-[70px_minmax(0,1fr)] gap-y-1 text-[12.5px]">
                <dt className="text-muted">Model</dt>
                <dd>
                  {agent.model ?? "the coordinator's"}
                  {agent.modelFrom === 'config' && <span className="ml-1 text-[10.5px] text-faint">config</span>}
                </dd>
                <dt className="text-muted">File</dt>
                <dd className="truncate">{agent.file}</dd>
                <dt className="text-muted">Tools</dt>
                <dd>{agent.tools.length ? agent.tools.join(', ') : 'all the unit allows'}</dd>
              </dl>
              <MarkdownPanel markdown={agent.prompt} empty="No prompt body." />
              <Link
                href={`/p/${id}/agents?a=${encodeURIComponent(agent.name)}`}
                className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:underline"
              >
                Open on the Agents page →
              </Link>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              No agent file for “{missingAgent}”. A coordinator runs on its stage prompt in{' '}
              <code>harness/prompts/</code>; specialists come from <code>agents/</code> and the project&apos;s{' '}
              <code>.claude/agents/</code>.
            </p>
          )}
        </aside>
      )}
    </div>
  );
}
