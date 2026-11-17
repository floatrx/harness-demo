'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE, DURATION } from '@/lib/motion.config';

interface Props {
  children: ReactNode;
}

/* `prefers-reduced-motion` reaches CSS through global.css; this makes every `motion` component honour it too. */
export const MotionRoot = ({ children }: Props) => (
  <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE }}>
    {children}
  </MotionConfig>
);
