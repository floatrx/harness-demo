import { ProjectNotFound, findProject } from '@/lib/board';
import { liveSnapshot } from '@/lib/live';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

const TICK_MS = 1000;
const HEARTBEAT_MS = 15_000;

/* Server-sent events: the Live snapshot once a second, sent only when it changed, plus a heartbeat comment. */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  try {
    findProject(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) return new Response('no project', { status: 404 });
    throw error;
  }
  const encoder = new TextEncoder();
  let tick: ReturnType<typeof setInterval> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(tick);
    clearInterval(beat);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let last = '';
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const push = () => {
        try {
          const snapshot = liveSnapshot(id);
          if (snapshot.version === last) return;
          last = snapshot.version;
          send(`data: ${JSON.stringify(snapshot)}\n\n`);
        } catch (error) {
          send(`event: problem\ndata: ${JSON.stringify({ error: (error as Error).message })}\n\n`);
        }
      };
      push();
      tick = setInterval(push, TICK_MS);
      beat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      request.signal.addEventListener('abort', () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel: stop,
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}
