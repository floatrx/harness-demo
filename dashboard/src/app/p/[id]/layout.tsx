import type { ReactNode } from 'react';
import { RailNav } from '@/components/shell/rail-nav';

interface Props {
  children: ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProjectLayout({ children, params }: Props) {
  const { id } = await params;
  return (
    <div className="grid min-h-screen grid-cols-[52px_minmax(0,1fr)]">
      <RailNav projectId={id} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
