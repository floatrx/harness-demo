/* Client side of the mutation contract: every write is a POST with the x-harness header (lib/actions.ts). */

export class MutationError extends Error {
  override name = 'MutationError';
}

export async function mutate(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'x-harness': '1', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new MutationError(data.error ?? `request failed (${response.status})`);
  return data;
}

export const taskActionUrl = (projectId: string, taskId: string, action: string) =>
  `/api/p/${projectId}/tasks/${taskId}/${action}`;
