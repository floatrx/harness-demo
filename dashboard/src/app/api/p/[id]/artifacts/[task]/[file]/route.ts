import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tracePaths } from '@harness/core/paths';
import { ProjectNotFound, findProject } from '@/lib/board';

const TYPES: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

interface Context {
  params: Promise<{ id: string; task: string; file: string }>;
}

/* Read-only: one file from <project>/.harness/artifacts/<task>/, by basename only. */
export async function GET(_request: Request, { params }: Context) {
  const { id, task, file } = await params;
  const name = basename(file);
  const type = TYPES[name.split('.').pop() ?? ''];
  if (!/^T-\d{3,}$/.test(task) || name !== file || !type) return new Response('not found', { status: 404 });
  try {
    const project = findProject(id);
    const body = await readFile(join(tracePaths(project.path).artifacts, task, name));
    return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch (error) {
    return new Response(error instanceof ProjectNotFound ? 'no project' : 'not found', { status: 404 });
  }
}
