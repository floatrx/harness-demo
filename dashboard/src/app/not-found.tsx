import Link from 'next/link';
import { RailNav } from '@/components/shell/rail-nav';

/* A project id that is not in the registry, or a page that does not exist. */
export default function NotFound() {
  return (
    <div className="grid min-h-screen grid-cols-[52px_minmax(0,1fr)]">
      <RailNav projectId={null} />
      <main className="max-w-2xl px-6 py-8" data-testid="not-found">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-2 text-sm text-muted">
          No project with this id is registered, or the page does not exist. Projects live in{' '}
          <code className="text-foreground">$HARNESS_HOME/projects.json</code> (default{' '}
          <code className="text-foreground">~/.harness</code>) — a dashboard started with another{' '}
          <code className="text-foreground">HARNESS_HOME</code> sees another list.
        </p>
        <Link href="/projects" className="mt-5 inline-block text-sm font-semibold text-accent hover:underline">
          ← All projects
        </Link>
      </main>
    </div>
  );
}
