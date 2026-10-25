'use client';

import { Button, Modal } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { cn } from '@/lib/cn';
import { mutate } from '@/lib/mutate';

interface Props {
  projectId: string;
}

const KINDS = [
  { value: '', label: 'Let the writer decide' },
  { value: 'ui', label: 'UI — gets a prototype round' },
  { value: 'logic', label: 'Logic' },
  { value: 'docs', label: 'Docs' },
  { value: 'chore', label: 'Chore' },
];

const fieldClass =
  'w-full rounded-[8px] border border-border bg-surface-secondary px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent';

/* A draft is all the human writes: a title and two lines. The writer turns it into a spec. */
export const CreateTaskModal = ({ projectId }: Props) => {
  const router = useRouter();
  const [isOpen, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { id } = (await mutate(`/api/p/${projectId}/tasks`, {
        title: form.get('title'),
        draft: form.get('draft'),
        kind: form.get('kind'),
      })) as { id: string };
      setOpen(false);
      router.push(`/p/${projectId}?t=${id}`, { scroll: false });
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button variant="primary" size="sm" onPress={() => setOpen(true)} data-testid="create-task">
        New task
      </Button>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={setOpen}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>New task</Modal.Heading>
            </Modal.Header>
            <form onSubmit={handleSubmit} data-testid="create-task-form">
              <Modal.Body className="space-y-3">
                <label className="block space-y-1 text-[13px]">
                  <span className="text-muted">Title</span>
                  <input
                    name="title"
                    required
                    autoFocus
                    placeholder="Export bookmarks as JSON"
                    className={cn(fieldClass, 'h-10')}
                  />
                </label>
                <label className="block space-y-1 text-[13px]">
                  <span className="text-muted">
                    Draft — two lines are enough; the writer asks if something is unclear
                  </span>
                  <textarea
                    name="draft"
                    rows={4}
                    placeholder="What should change, and for whom."
                    className={cn(fieldClass, 'py-2')}
                  />
                </label>
                <label className="block space-y-1 text-[13px]">
                  <span className="text-muted">Kind</span>
                  <select name="kind" defaultValue="" className={cn(fieldClass, 'h-10')}>
                    {KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </select>
                </label>
                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="tertiary" size="sm" slot="close">
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit" isDisabled={isPending}>
                  {isPending ? 'Creating…' : 'Create draft'}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
};
