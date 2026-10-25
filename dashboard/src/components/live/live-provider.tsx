'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, use, useEffect, useRef, useState } from 'react';
import type { LiveSnapshot } from '@/lib/live';

interface LiveState {
  snapshot: LiveSnapshot;
  /** false while the event stream is reconnecting. */
  isConnected: boolean;
}

const LiveContext = createContext<LiveState | null>(null);

export const useLive = () => {
  const state = use(LiveContext);
  if (!state) throw new Error('useLive needs a LiveProvider');
  return state;
};

interface Props {
  projectId: string;
  initial: LiveSnapshot;
  children: ReactNode;
}

/* One EventSource per page. When the board's own version changes (a task file, the unit, a handoff), the server
   components re-render through router.refresh(); the dock re-renders from the snapshot itself. */
export const LiveProvider = ({ projectId, initial, children }: Props) => {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [isConnected, setConnected] = useState(true);
  const boardVersion = useRef(initial.boardVersion);

  useEffect(() => {
    const source = new EventSource(`/api/p/${projectId}/live`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      const next = JSON.parse(event.data as string) as LiveSnapshot;
      setSnapshot(next);
      if (next.boardVersion !== boardVersion.current) {
        boardVersion.current = next.boardVersion;
        router.refresh();
      }
    };
    return () => source.close();
  }, [projectId, router]);

  return <LiveContext value={{ snapshot, isConnected }}>{children}</LiveContext>;
};
