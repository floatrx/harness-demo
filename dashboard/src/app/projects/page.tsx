import Link from 'next/link';
import { listProjects } from '@harness/core/projects';
import { RailNav } from '@/components/shell/rail-nav';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  const projects = listProjects();
  return (
    <div className="grid min-h-screen grid-cols-[52px_minmax(0,1fr)]">
      <RailNav projectId={null} active="projects" />
      <main className="max-w-3xl px-6 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted">
          A project is a local git repository the loop works in. Add one with{' '}
          <code className="text-foreground">harness projects add &lt;path&gt;</code> or{' '}
          <code className="text-foreground">harness example &lt;dest&gt;</code>.
        </p>
        <ul className="mt-5 grid gap-2" data-testid="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/p/${project.id}`}
                className="flex items-center justify-between rounded-panel border border-line-soft bg-surface px-4 py-3 hover:border-border"
              >
                <span>
                  <b className="font-semibold">{project.name}</b>
                  <span className="ml-2 text-xs text-muted">{project.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                </span>
                <span className="text-xs text-muted">added {project.addedAt.slice(0, 10)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {!projects.length && <p className="mt-6 text-sm text-muted">No projects yet.</p>}
      </main>
    </div>
  );
}
