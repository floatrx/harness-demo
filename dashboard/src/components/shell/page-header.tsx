import type { ReactNode } from 'react';
import type { Project } from '@harness/core/projects';

interface Props {
  project: Project;
  title: string;
  /** One sentence: what this page answers. */
  lead: ReactNode;
  aside?: ReactNode;
}

export const PageHeader = ({ project, title, lead, aside }: Props) => (
  <header className="mb-5">
    <p className="mb-3.5 flex h-8 items-center text-[13px] whitespace-nowrap">
      <b className="text-sm font-semibold">{project.name}</b>
      <span className="ml-1.5 truncate text-muted">{project.path.replace(/^\/Users\/[^/]+/, '~')}</span>
    </p>
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted">{lead}</p>
      </div>
      {aside}
    </div>
  </header>
);
