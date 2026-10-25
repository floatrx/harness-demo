import Link from 'next/link';
import { cn } from '@/lib/cn';
import { HarnessMark, RailIcon, type RailIconName } from './rail-icons';

export type RailSection = 'board' | 'live' | 'stats' | 'agents' | 'projects';

interface Props {
  projectId: string | null;
  active: RailSection;
}

const ITEMS: { section: RailSection; label: string; href: (id: string) => string; icon: RailIconName }[] = [
  { section: 'board', label: 'Board', href: (id) => `/p/${id}`, icon: 'board' },
  { section: 'live', label: 'Live trace', href: (id) => `/p/${id}/live`, icon: 'live' },
  { section: 'stats', label: 'Stats', href: (id) => `/p/${id}/stats`, icon: 'stats' },
  { section: 'agents', label: 'Agents', href: (id) => `/p/${id}/agents`, icon: 'agents' },
];

const itemClass = (isActive: boolean) =>
  cn(
    'grid size-9 place-items-center rounded-[9px] text-muted transition-colors hover:bg-surface-secondary hover:text-foreground',
    isActive && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
  );

export const RailNav = ({ projectId, active }: Props) => (
  <nav
    className="sticky top-0 flex h-screen flex-col items-center gap-1.5 border-r border-line-soft bg-rail py-3.5"
    aria-label="Main"
  >
    <Link href="/projects" className="mb-3 text-accent">
      <HarnessMark />
    </Link>
    {projectId &&
      ITEMS.map((item) => (
        <Link
          key={item.section}
          href={item.href(projectId)}
          title={item.label}
          aria-label={item.label}
          className={itemClass(active === item.section)}
        >
          <RailIcon name={item.icon} />
        </Link>
      ))}
    <Link
      href="/projects"
      title="Projects"
      aria-label="Projects"
      className={cn('mt-auto', itemClass(active === 'projects'))}
    >
      <RailIcon name="projects" />
    </Link>
  </nav>
);
