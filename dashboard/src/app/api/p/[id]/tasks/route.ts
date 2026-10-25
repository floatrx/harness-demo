import { handleCreateTask } from '@/lib/actions';

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleCreateTask(request, id);
}
