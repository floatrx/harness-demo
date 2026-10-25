'use client';

import { Button } from '@heroui/react';
import Link from 'next/link';

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/* Anything unexpected while reading a project. The server log has the stack; the page keeps the rail and a way out. */
export default function ProjectError({ error, reset }: Props) {
  return (
    <main className="max-w-2xl px-6 py-8" data-testid="project-error">
      <h1 className="text-2xl font-semibold tracking-tight">Something broke while reading this project</h1>
      <p className="mt-2 text-sm text-muted">
        The dashboard only reads files here, so nothing was changed. The server log has the details
        {error.digest ? (
          <>
            {' '}
            under <code className="text-foreground">{error.digest}</code>
          </>
        ) : null}
        .
      </p>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" size="sm" onPress={reset}>
          Try again
        </Button>
        <Link href="/projects" className="text-sm font-semibold text-accent hover:underline">
          ← All projects
        </Link>
      </div>
    </main>
  );
}
