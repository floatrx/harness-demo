import { handleAddProject } from '@/lib/actions';

export async function POST(request: Request) {
  return handleAddProject(request);
}
