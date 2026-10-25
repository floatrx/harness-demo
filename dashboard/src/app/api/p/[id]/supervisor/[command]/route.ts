import { handleSupervisor } from '@/lib/supervisor-control';

interface Context {
  params: Promise<{ id: string; command: string }>;
}

export async function POST(request: Request, { params }: Context) {
  const { id, command } = await params;
  return handleSupervisor(request, id, command);
}
