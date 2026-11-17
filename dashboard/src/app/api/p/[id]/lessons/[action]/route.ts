import { handleLessonAction } from '@/lib/actions';

interface Context {
  params: Promise<{ id: string; action: string }>;
}

export async function POST(request: Request, { params }: Context) {
  const { id, action } = await params;
  return handleLessonAction(request, id, action);
}
