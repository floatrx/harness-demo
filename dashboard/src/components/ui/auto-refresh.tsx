'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface Props {
  everyMs: number;
}

/** Re-renders the server page on an interval — for a view of something still running. */
export const AutoRefresh = ({ everyMs }: Props) => {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [everyMs, router]);
  return null;
};
