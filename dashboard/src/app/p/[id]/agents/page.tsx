import Link from 'next/link';
import { notFound } from 'next/navigation';
import { UNIT_STAGES } from '@harness/core/config';
import { ProjectNotFound, findProject } from '@/lib/board';
import { cn } from '@/lib/cn';
import { loadAgentsPage } from '@/lib/agents-view';
import { MarkdownPanel } from '@/components/drawer/markdown-panel';
import { PageHeader } from '@/components/shell/page-header';
import { RoleAvatar } from '@/components/ui/role-avatar';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ a?: string }>;
}

const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className="flex gap-2 text-[12.5px]">
    <span className={cn('flex-none font-bold', ok ? 'text-accent' : 'text-danger')}>{ok ? '✓' : '✕'}</span>
    <span className={ok ? 'text-muted' : ''}>{children}</span>
  </li>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-surface-secondary px-1 text-[11.5px]">{children}</code>
);

export default async function AgentsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { a } = await searchParams;
  let project;
  try {
    project = findProject(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const page = loadAgentsPage(id);
  const selected = page.agents.find((agent) => agent.name === a) ?? null;
  const judgeOk = !page.problems.some((problem) => problem.startsWith('judge and'));
  const failing = page.problems.length + page.drift.length;
  return (
    <main className="px-4 pt-3.5 pb-8">
      <PageHeader
        project={project}
        title="Agents"
        lead="Who works each stage: the coordinator a unit runs as, the specialists it may dispatch, and the checks that refuse a run."
        aside={
          <span
            className={cn('mt-1 rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap', failing ? 'bg-danger/15 text-danger' : 'bg-accent-soft text-accent')}
            data-testid="agents-status"
          >
            {failing ? `${failing} problem${failing === 1 ? '' : 's'} · runs refuse` : 'All checks pass'}
          </span>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <section>
            <h2 className="mb-2 text-[13px] font-semibold">
              Stage coordinators <span className="font-normal text-muted">
                · one <Code>claude -p</Code> per unit, on this model
              </span>
            </h2>
            <ol className="grid grid-cols-3 gap-2 xl:grid-cols-6" data-testid="coordinators">
              {page.coordinators.map((row, index) => (
                <li key={row.stage} className="rounded-card border border-line-soft bg-surface px-3 py-2.5">
                  <p className="text-[11px] text-faint tabular-nums">{index + 1} · {row.stage}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold">
                    <RoleAvatar role={row.role} />
                    {row.role}
                  </p>
                  <p className={cn('mt-1 text-xs', row.role === 'judge' ? 'text-accent' : 'text-muted')}>{row.model ?? 'default model'}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-panel border border-line-soft bg-surface" data-testid="agents-table">
            <h2 className="border-b border-line-soft px-4 py-2.5 text-[13px] font-semibold">
              Specialists <span className="font-normal text-muted">
                · passed to each unit with <Code>--agents</Code>; a dot = the stage offers it
              </span>
            </h2>
            <table className="w-full table-fixed text-[12.5px]">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="w-32 px-2 py-2 font-medium">Model</th>
                  {UNIT_STAGES.map((stage) => (
                    <th key={stage} className="w-14 px-1 py-2 text-center font-medium">
                      {stage === 'prototype' ? 'proto' : stage === 'implement' ? 'impl' : stage}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.agents.map((agent) => (
                  <tr key={agent.name} className={cn('border-t border-line-soft', selected?.name === agent.name && 'bg-surface-secondary')}>
                    <td className="px-4 py-2">
                      <Link href={`/p/${id}/agents?a=${agent.name}`} className="group flex items-center gap-2" scroll={false}>
                        <RoleAvatar role={agent.name} />
                        <b className="font-semibold group-hover:text-accent">{agent.name}</b>
                        {agent.source === 'project' && <span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] text-accent">project</span>}
                      </Link>
                      <p className="mt-0.5 truncate pl-7 text-xs text-muted" title={agent.description}>
                        {agent.description}
                      </p>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {agent.model ?? <span className="text-muted">coordinator&apos;s</span>}
                      {agent.modelFrom === 'config' && <span className="ml-1 text-[10.5px] text-faint">config</span>}
                    </td>
                    {UNIT_STAGES.map((stage) => (
                      <td key={stage} className="px-1 py-2 text-center">
                        {agent.offeredIn.includes(stage) ? (
                          <span className="inline-block size-2 rounded-full bg-accent" title={`${stage} offers ${agent.name}`} />
                        ) : (
                          <span className="inline-block size-1 rounded-full bg-track" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {selected ? (
            <section className="rounded-panel border border-line-soft bg-surface px-4 py-3" data-testid="agent-prompt">
              <header className="mb-2 flex items-center gap-2">
                <RoleAvatar role={selected.name} />
                <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                <span className="text-xs text-muted">{selected.file}</span>
                <Link href={`/p/${id}/agents`} className="ml-auto text-xs text-muted hover:text-accent" scroll={false}>
                  Close
                </Link>
              </header>
              <dl className="mb-3 grid grid-cols-[90px_minmax(0,1fr)] gap-y-1 text-[12.5px]">
                <dt className="text-muted">When</dt>
                <dd>{selected.when || '—'}</dd>
                <dt className="text-muted">Tools</dt>
                <dd>{selected.tools.length ? selected.tools.join(', ') : 'all the unit allows'}</dd>
              </dl>
              <MarkdownPanel markdown={selected.prompt} empty="No prompt body." />
              <p className="mt-3 text-xs text-muted">
                + the standing-rules block from <Code>{page.rulesFile}</Code>, the same for every agent.
              </p>
            </section>
          ) : (
            <p className="text-xs text-muted">Pick an agent to read its prompt.</p>
          )}
        </div>
        <aside className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section className="rounded-panel border border-line-soft bg-surface px-4 py-3" data-testid="agents-checks">
            <h2 className="mb-2 text-[13px] font-semibold">Checks · every unit</h2>
            <ul className="space-y-1.5">
              <Check ok={judgeOk}>The judge runs on a different model from the implementer and the tester.</Check>
              <Check ok={!page.drift.length}>
                Every agent carries the current standing rules from <Code>{page.rulesFile}</Code>.
              </Check>
              {page.problems
                .filter((problem) => !problem.startsWith('judge and'))
                .map((problem) => (
                  <Check key={problem} ok={false}>
                    {problem}
                  </Check>
                ))}
              {page.problems
                .filter((problem) => problem.startsWith('judge and'))
                .map((problem) => (
                  <li key={problem} className="pl-5 text-xs text-danger">
                    {problem}
                  </li>
                ))}
            </ul>
            {!!page.drift.length && (
              <div className="mt-2 pl-5 text-xs">
                <p className="text-danger">Drifted: {page.drift.join(', ')}</p>
                <p className="mt-1 text-muted">
                  Fix: <Code>harness agents --sync</Code>
                </p>
              </div>
            )}
          </section>
          <section className="rounded-panel border border-line-soft bg-surface px-4 py-3" data-testid="agents-invocation">
            <h2 className="mb-2 text-[13px] font-semibold">Invocation</h2>
            {page.invocation.override && (
              <p className="mb-2 rounded-card bg-accent-soft px-2.5 py-1.5 text-xs text-accent">
                A stand-in replaces <Code>claude</Code>:
                <span className="block break-all">{page.invocation.override}</span>
              </p>
            )}
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[12.5px]">
              <dt className="text-muted">Delivery</dt>
              <dd data-testid="outbound-delivery">
                {page.outbound.pr ? (
                  <>
                    pull request to <Code>{page.outbound.remote}</Code> via <Code>gh</Code> · never merged
                  </>
                ) : (
                  <span className="text-muted">off — done is the end (deliver.pr)</span>
                )}
              </dd>
              <dt className="text-muted">Telegram</dt>
              <dd data-testid="outbound-telegram">
                {page.outbound.telegram ? (
                  <>
                    on · keys from <Code>{page.outbound.telegram}</Code>
                  </>
                ) : (
                  <span className="text-muted">
                    off — set <Code>TELEGRAM_BOT_TOKEN</Code> and <Code>TELEGRAM_CHAT_ID</Code> in <Code>~/.harness/.env</Code>
                  </span>
                )}
              </dd>
              <dt className="text-muted">Permission mode</dt>
              <dd>
                <Code>{page.invocation.permissionMode}</Code>
              </dd>
              <dt className="text-muted">Setting sources</dt>
              <dd>
                <Code>{page.invocation.settingSources}</Code>
              </dd>
              <dt className="text-muted">Allowed tools</dt>
              <dd className="flex flex-wrap gap-1">
                {page.invocation.allowedTools.map((tool) => (
                  <Code key={tool}>{tool}</Code>
                ))}
              </dd>
            </dl>
            {!page.invocation.override && (
<pre className="mt-2.5 rounded-card bg-rail p-2 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted">
              {page.invocation.display}
            </pre>
)}
            <p className="mt-2 text-xs text-muted">
              Commits and pushes are absent on purpose: the loop commits only after the contracts pass.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
