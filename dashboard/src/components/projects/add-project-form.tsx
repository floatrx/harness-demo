'use client';

import { Button } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { cn } from '@/lib/cn';
import { mutate } from '@/lib/mutate';

const fieldClass =
  'h-10 rounded-[8px] border border-border bg-surface-secondary px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent';

/* Registers a local git repository, as `harness projects add <path>`: the loop gets a `.harness/` folder in it. */
export const AddProjectForm = () => {
  const router = useRouter();
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    try {
      await mutate('/api/projects', { path: data.get('path'), name: data.get('name') });
      form.reset();
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-panel border border-line-soft bg-surface p-4"
      data-testid="add-project-form"
    >
      <h2 className="text-[13px] font-semibold">Add a project</h2>
      <p className="mt-0.5 text-xs text-muted">
        Any local git repository. The loop creates <code className="text-foreground">.harness/</code> in it and touches
        nothing else until you submit a task.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          name="path"
          required
          placeholder="~/Projects/my-app"
          aria-label="Path"
          className={cn(fieldClass, 'min-w-0 flex-1')}
          data-testid="project-path"
        />
        <input name="name" placeholder="Name (optional)" aria-label="Name" className={cn(fieldClass, 'w-44')} />
        <Button variant="primary" type="submit" isDisabled={isPending} data-testid="add-project">
          {isPending ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger" data-testid="add-project-error">
          {error}
        </p>
      )}
    </form>
  );
};
