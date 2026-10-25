import { notFound } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ProjectNotFound, loadBoard } from '@/lib/board';
import { liveSnapshot } from '@/lib/live';
import { loadTaskDetail } from '@/lib/task-detail';
import { LiveProvider } from '@/components/live/live-provider';
import { BoardView } from '@/components/board/board-view';
import { CreateTaskModal } from '@/components/board/create-task-modal';
import { LiveDock } from '@/components/dock/live-dock';
import { TaskDrawer } from '@/components/drawer/task-drawer';
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
    <LiveProvider projectId={id} initial={liveSnapshot(id)}>
      <div
        className={cn(
          'grid min-h-screen',
          task ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-[minmax(0,1fr)_300px]',
        )}
      >
        <main className="min-w-0 px-4 pt-3.5 pb-6">
          <TopLine board={board} />
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
              {/* An empty board has one thing to do, and its panel below says it. */}
              {!!board.cards.length && <WaitingLine waiting={board.waiting} />}
            </div>
            {!!board.cards.length && <CreateTaskModal projectId={id} />}
          </div>
          {!!board.unreadable.length && (
            <div
              role="alert"
              className="mb-3 rounded-card border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]"
              data-testid="unreadable-tasks"
            >
              <b className="text-danger">
                {board.unreadable.length} task file{board.unreadable.length === 1 ? '' : 's'} could not be read
              </b>{' '}
              <span className="text-muted">— the loop skips them until they parse.</span>
              <ul className="mt-1 text-xs text-muted">
                {board.unreadable.map((item) => (
                  <li key={item.file}>
                    <code className="text-foreground">.harness/tasks/{item.file}</code>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {board.cards.length ? (
            <BoardView cards={board.cards} projectId={id} selectedId={task?.id ?? null} />
          ) : (
            <section
              className="grid place-items-center rounded-panel border border-dashed border-border px-6 py-16 text-center"
              data-testid="board-empty"
            >
              <h2 className="text-lg font-semibold">No tasks yet</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                A task starts as a draft: a title and two lines. Submit it and the writer turns it into a spec, asking
                you when something is unclear.
              </p>
              <div className="mt-4">
                <CreateTaskModal projectId={id} />
              </div>
            </section>
          )}
        </main>
        {task ? <TaskDrawer task={task} projectId={id} /> : <LiveDock projectId={id} />}
      </div>
    </LiveProvider>
  );
}
