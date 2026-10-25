import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ProjectNotFound, loadBoard } from '@/lib/board';
import { loadTaskDetail } from '@/lib/task-detail';
import { BoardView } from '@/components/board/board-view';
import { LiveDock } from '@/components/dock/live-dock';
import { TaskDrawer } from '@/components/drawer/task-drawer';
import { RailNav } from '@/components/shell/rail-nav';
import { TopLine } from '@/components/shell/top-line';
import { WaitingLine } from '@/components/shell/waiting-line';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function BoardPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { t } = await searchParams;
  let board;
  try {
    board = loadBoard(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const task = t ? loadTaskDetail(id, t) : null;
  return (
    <div
      className={cn(
        'grid min-h-screen',
        task ? 'grid-cols-[52px_minmax(0,1fr)_360px]' : 'grid-cols-[52px_minmax(0,1fr)_300px]',
      )}
    >
      <RailNav projectId={id} active="board" />
      <main className="min-w-0 px-4 pt-3.5 pb-6">
        <TopLine board={board} />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
            <WaitingLine waiting={board.waiting} />
          </div>
          <button
            type="button"
            disabled
            className="h-[34px] rounded-[7px] bg-accent px-4 text-[12.5px] font-semibold whitespace-nowrap text-accent-foreground opacity-60"
            title="Creating tasks arrives in phase 2"
          >
            New task
          </button>
        </div>
        <BoardView cards={board.cards} projectId={id} selectedId={task?.id ?? null} />
      </main>
      {task ? <TaskDrawer task={task} projectId={id} /> : <LiveDock dock={board.dock} />}
    </div>
  );
}
