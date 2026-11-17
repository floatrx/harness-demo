'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { DURATION, EASE, SPRING } from '@/lib/motion.config';

export interface CandidateRow {
  key: string;
  kind: string;
  summary: string;
  count: string;
  newest: string | null;
}

interface Props {
  projectId: string;
  rows: CandidateRow[];
  selected: string | null;
}

const KIND_LABEL: Record<string, string> = {
  'repeat-park': 'park',
  'denied-tool': 'denied',
  bounce: 'bounce',
  journal: 'note',
};

/* One row per open candidate, newest first. A decided row slides out (an event, never continuous motion). */
export const CandidateList = ({ projectId, rows, selected }: Props) => (
  <motion.ol
    layout
    className="divide-y divide-line-soft rounded-panel border border-line-soft bg-surface"
    data-testid="lesson-list"
  >
    <AnimatePresence initial={false}>
      {rows.map((row) => (
        <motion.li
          key={row.key}
          layout
          exit={{ opacity: 0, x: 24, transition: { duration: DURATION.base, ease: EASE } }}
          transition={SPRING.snappy}
        >
          <Link
            href={`/p/${projectId}/learning?l=${encodeURIComponent(row.key)}`}
            scroll={false}
            className={cn(
              'flex min-h-11 items-start gap-2 px-3 py-2.5 text-[13px] hover:bg-surface-secondary',
              row.key === selected && 'bg-surface-secondary',
            )}
            aria-current={row.key === selected ? 'true' : undefined}
            data-testid="lesson-row"
          >
            <span className="mt-0.5 flex-none rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold text-accent">
              {KIND_LABEL[row.kind] ?? row.kind}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold [overflow-wrap:anywhere]">{row.summary}</span>
              <span className="block text-xs text-muted">
                {row.count}
                {row.newest && ` · last ${row.newest}`}
              </span>
            </span>
          </Link>
        </motion.li>
      ))}
    </AnimatePresence>
  </motion.ol>
);
