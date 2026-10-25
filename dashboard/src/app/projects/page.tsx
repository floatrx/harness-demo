import Link from 'next/link';
import { cn } from '@/lib/cn';
import { type ProjectSummary, listProjectSummaries } from '@/lib/projects-view';
import { AddProjectForm } from '@/components/projects/add-project-form';
import { RemoveProjectButton } from '@/components/projects/remove-project-button';
import { RailNav } from '@/components/shell/rail-nav';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';

export const dynamic = 'force-dynamic';

const home = (path: string) => path.replace(/^\/Users\/[^/]+/, '~');

const Facts = ({ summary }: { summary: ProjectSummary }) => {
  if (summary.state !== 'ok')
    return (
      <span className="text-xs text-danger" data-testid="project-problem">
        {summary.state === 'missing' ? 'Folder gone' : 'Cannot open'}: {summary.problem}
      </span>
    );
  return (
    <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
      {summary.tasks} task{summary.tasks === 1 ? '' : 's'}
      {!!summary.waiting && <b className="font-semibold text-accent">{summary.waiting} wait for you</b>}
      {summary.running ? (
        <span className="flex items-center gap-1 text-accent">
          <ClaudeSpinner size="sm" />
          {summary.running}
        </span>
      ) : (
        summary.supervisor === 'paused' && <span>paused</span>
      )}
    </span>
  );
};

export default function ProjectsPage() {
  const summaries = listProjectSummaries();
  return (
    <div className="grid min-h-screen grid-cols-[52px_minmax(0,1fr)]">
      <RailNav projectId={null} />
      <main className="max-w-3xl px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted">
          A project is a local git repository the loop works in. The CLI does the same:{' '}
          <code className="text-foreground">harness projects add &lt;path&gt;</code> ·{' '}
          <code className="text-foreground">harness example &lt;dest&gt;</code>.
        </p>
        <ul className="mt-5 grid gap-2" data-testid="project-list">
          {summaries.map((summary) => (
            <li
              key={summary.project.id}
              className={cn(
                'flex items-center gap-3 rounded-panel border bg-surface px-4 py-3',
                summary.state === 'ok' ? 'border-line-soft hover:border-border' : 'border-danger/30',
              )}
              data-testid="project-row"
            >
              <div className="min-w-0 flex-1">
                {summary.state === 'ok' ? (
                  <Link href={`/p/${summary.project.id}`} className="font-semibold hover:text-accent">
                    {summary.project.name}
                  </Link>
                ) : (
                  <b className="font-semibold">{summary.project.name}</b>
                )}
                <span className="ml-2 text-xs text-muted">{home(summary.project.path)}</span>
                <div className="mt-0.5">
                  <Facts summary={summary} />
                </div>
              </div>
              <RemoveProjectButton projectId={summary.project.id} name={summary.project.name} />
              {summary.state === 'ok' && (
                <Link
                  href={`/p/${summary.project.id}`}
                  className="rounded-[8px] bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:brightness-125"
                  data-testid="open-board"
                >
                  Open board →
                </Link>
              )}
            </li>
          ))}
        </ul>
        {!summaries.length && (
          <p className="mt-2 text-sm text-muted" data-testid="projects-empty">
            No projects yet. Add a repository below, or make a demo copy with{' '}
            <code className="text-foreground">harness example ~/harness-demo-app</code>.
          </p>
        )}
        <div className="mt-6">
          <AddProjectForm />
        </div>
      </main>
    </div>
  );
}
