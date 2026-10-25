import { handleTaskAction } from '@/lib/actions';

interface Context {
  params: Promise<{ id: string; task: string; action: string }>;
}

export async function POST(request: Request, { params }: Context) {
  const { id, task, action } = await params;
  return handleTaskAction(request, id, task, action);
}
