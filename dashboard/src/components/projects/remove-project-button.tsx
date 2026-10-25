'use client';

import { Button } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate } from '@/lib/mutate';

interface Props {
  projectId: string;
  name: string;
}

/* Two steps, because the list is where the human finds the project again — but no modal: the files stay. */
export const RemoveProjectButton = ({ projectId, name }: Props) => {
  const router = useRouter();
  const [isConfirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    setError(null);
    try {
      await mutate(`/api/projects/${projectId}/remove`);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
      setConfirming(false);
    }
  };

  if (error)
    return (
      <p role="alert" className="max-w-56 text-right text-xs text-danger">
        {error}
      </p>
    );
  return isConfirming ? (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      Forget {name}? Files stay.
      <Button size="sm" variant="danger" onPress={handleRemove} data-testid="confirm-remove">
        Remove
      </Button>
      <Button size="sm" variant="tertiary" onPress={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  ) : (
    <Button size="sm" variant="ghost" onPress={() => setConfirming(true)} data-testid="remove-project">
      Remove
    </Button>
  );
};
