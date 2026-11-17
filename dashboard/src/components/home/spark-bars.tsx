'use client';

import { motion } from 'motion/react';
import { DURATION, EASE, STAGGER } from '@/lib/motion.config';

interface Props {
  days: { day: string; count: number }[];
}

/* One bar per day, today last. The bars grow once, on first render; a refresh keeps them where they are. */
export const SparkBars = ({ days }: Props) => {
  const max = Math.max(1, ...days.map((day) => day.count));
  return (
    <div
      className="flex h-8 items-end gap-[3px]"
      role="img"
      aria-label={`moves into done per day, last ${days.length} days: ${days.map((day) => day.count).join(', ')}`}
    >
      {days.map((day, index) => (
        <motion.i
          key={day.day}
          title={`${day.day}: ${day.count}`}
          className={day.count ? 'block flex-1 origin-bottom rounded-[2px] bg-accent' : 'block h-[2px] flex-1 bg-track'}
          style={day.count ? { height: `${Math.max(12, (day.count / max) * 100)}%` } : undefined}
          initial={day.count ? { scaleY: 0 } : false}
          animate={{ scaleY: 1 }}
          transition={{ duration: DURATION.slow, ease: EASE, delay: index * STAGGER }}
        />
      ))}
    </div>
  );
};
