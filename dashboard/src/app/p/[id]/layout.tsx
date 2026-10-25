import { existsSync } from 'node:fs';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfigError, loadConfig } from '@harness/core/config';
import { ProjectNotFound, findProject } from '@/lib/board';
import { RailNav } from '@/components/shell/rail-nav';

interface Props {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

/* Every project page needs the folder and a readable config. When either is missing, say so once, here, with the fix
   — instead of letting each page fail on its own. */
function projectProblem(id: string): { name: string; path: string; problem: string; fix: ReactNode } | null {
  const project = findProject(id);
  if (!existsSync(project.path))
    return {
      ...project,
      problem: 'The folder no longer exists.',
      fix: 'Move it back, or remove the project from the list and add it again from its new place.',
    };
  try {
    loadConfig(project.path);
    return null;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return {
      ...project,
      problem: error.message,
      fix: (
        <>
          Fix <code className="text-foreground">.harness/config.json</code> (it must be valid JSON), or run{' '}
          <code className="text-foreground">harness projects add {project.path}</code> to recreate a missing one.
        </>
      ),
    };
  }
}

export default async function ProjectLayout({ children, params }: Props) {
  const { id } = await params;
  let problem;
  try {
    problem = projectProblem(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  return (
    <div className="grid min-h-screen grid-cols-[52px_minmax(0,1fr)]">
      <RailNav projectId={id} />
      <div className="min-w-0">
        {problem ? (
          <main className="max-w-2xl px-6 py-8" data-testid="project-problem">
            <p className="text-[13px] text-muted">
              <b className="text-foreground">{problem.name}</b> {problem.path.replace(/^\/Users\/[^/]+/, '~')}
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">This project cannot be opened</h1>
            <p className="mt-2 rounded-card border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {problem.problem}
            </p>
            <p className="mt-3 text-sm text-muted">{problem.fix}</p>
            <Link href="/projects" className="mt-5 inline-block text-sm font-semibold text-accent hover:underline">
              ← All projects
            </Link>
          </main>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
