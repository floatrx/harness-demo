'use client';

import { useEffect, useState } from 'react';

interface Props {
  since: string;
}

const format = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

/** A ticking m:ss since an ISO time — how long the unit has run. */
export const Elapsed = ({ since }: Props) => {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={since} className="tabular-nums" suppressHydrationWarning>
      {format(now - start)}
    </time>
  );
};
