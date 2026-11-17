'use client';

import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { tokens, usd } from '@/lib/format';
import { DURATION, EASE } from '@/lib/motion.config';

const FORMAT = {
  int: (value: number) => String(Math.round(value)),
  usd,
  tokens: (value: number) => tokens(Math.round(value)),
} as const;

interface Props {
  value: number;
  format?: keyof typeof FORMAT;
}

/**
 * A number that counts up once, on first mount. The server renders the final value; a refresh re-renders the same
 * mounted component, so it never replays.
 * @example <CountUp value={3} /> · <CountUp value={0.42} format="usd" />
 */
export const CountUp = ({ value, format = 'int' }: Props) => {
  /* The in-between value while counting; null shows the real one. */
  const [shown, setShown] = useState<number | null>(null);
  const hasRun = useRef(false);
  const isReduced = useReducedMotion();
  useEffect(() => {
    if (hasRun.current || isReduced || value === 0) return;
    hasRun.current = true;
    const controls = animate(0, value, {
      duration: DURATION.slow,
      ease: EASE,
      onUpdate: setShown,
      onComplete: () => setShown(null),
    });
    // Strict mode mounts twice: the second mount runs the count from the start.
    return () => {
      controls.stop();
      hasRun.current = false;
      setShown(null);
    };
    // Mount only: a later value is rendered as it is, not animated.
  }, []);
  return <span className="tabular-nums">{FORMAT[format](shown ?? value)}</span>;
};
