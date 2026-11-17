'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import type { FlowLane, LastRun, RoleNode } from '@/lib/flow-view';
import { clockDuration } from '@/lib/format';
import { DURATION, EASE, SPRING } from '@/lib/motion.config';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { ClaudeWorking } from '@/components/ui/claude-working';
import { RoleAvatar } from '@/components/ui/role-avatar';
import { ROLE_IDENTITY } from '@/components/ui/roles.config';

interface Props {
  projectId: string;
  lane: FlowLane | null;
  lastRuns: LastRun[];
  /** The agent whose drawer is open, to mark its node. */
  selectedAgent: string | null;
}

/* The statuses the task should pass (hollow), filled where handoffs.jsonl or the task file says it passed. The edge
   into the current status carries moving dashes while its unit runs. */
const ExpectedPath = ({ lane }: { lane: FlowLane }) => (
  <ol className="flex flex-wrap items-center gap-y-2" aria-label="expected path" data-testid="flow-expected">
    {lane.expected.map((node, index) => (
      <li key={node.status} className="flex items-center">
        {index > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'mx-1 h-px w-4 sm:w-6',
              node.isCurrent ? 'flow-dash' : node.passed ? 'bg-track-past' : 'bg-track',
            )}
          />
        )}
        <span
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] whitespace-nowrap',
            node.isCurrent
              ? 'border-accent bg-accent-soft font-semibold text-accent'
              : node.passed
                ? 'border-track-past bg-surface-secondary text-foreground'
                : 'border-dashed border-border text-faint',
          )}
          data-state={node.isCurrent ? 'current' : node.passed ? 'passed' : 'expected'}
        >
          {node.isCurrent && <ClaudeSpinner size="sm" />}
          {node.status}
        </span>
      </li>
    ))}
  </ol>
);

/* The time each role has run in this unit, side by side; the coordinator's share is what its specialists did not run. */
const RoleStrip = ({ roles }: { roles: RoleNode[] }) => {
  const total = roles.reduce((sum, role) => sum + role.ms, 0);
  if (!total) return null;
  return (
    <div className="mt-3" data-testid="flow-strip">
      <div className="flex h-2 overflow-hidden rounded-full bg-track" role="img" aria-label="time by role">
        {roles
          .filter((role) => role.ms > 0)
          .map((role) => (
            <span
              key={role.id}
              title={`${role.role} · ${clockDuration(role.ms)}`}
              className="h-full border-r border-background bg-[hsl(var(--h)_45%_55%)] last:border-r-0"
              style={{ width: `${(role.ms / total) * 100}%`, '--h': ROLE_IDENTITY[role.role]?.hue ?? 0 } as CSSProperties}
            />
          ))}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
        {roles
          .filter((role) => role.ms > 0)
          .map((role) => (
            <span key={role.id}>
              {role.role} {clockDuration(role.ms)}
            </span>
          ))}
      </p>
    </div>
  );
};

const RoleChain = ({ lane, projectId, selectedAgent }: { lane: FlowLane; projectId: string; selectedAgent: string | null }) => (
  <ol className="flex flex-wrap items-center gap-y-2" aria-label="roles of the unit in flight" data-testid="flow-roles">
    {lane.roles.map((role, index) => (
      <li key={role.id} className="flex items-center">
        {index > 0 && (
          <span
            aria-hidden="true"
            className={cn('mx-1 h-px w-4', role.state === 'running' ? 'flow-dash' : 'bg-track-past')}
          />
        )}
        <Link
          href={`/p/${projectId}/flow?a=${encodeURIComponent(role.role)}`}
          scroll={false}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-card border px-2.5 text-[12.5px] transition-colors hover:border-accent-line',
            role.state === 'running' ? 'border-accent-line bg-card-run' : 'border-line-soft bg-card',
            role.state === 'failed' && 'border-danger/40',
            selectedAgent === role.role && 'ring-1 ring-accent',
          )}
          data-testid="flow-role"
          data-role={role.role}
          data-coordinator={role.isCoordinator}
          data-state={role.state}
        >
          <RoleAvatar role={role.role} state={role.state === 'running' ? 'live' : 'done'} />
          <b className="font-semibold">{role.role}</b>
          {role.isCoordinator && <span className="text-[11px] text-faint">coordinator</span>}
          {role.state === 'running' && <ClaudeSpinner size="sm" />}
          {role.state === 'done' && <span className="text-muted">✓</span>}
          {role.state === 'failed' && <span className="text-danger">✕</span>}
          <span className="text-[11px] text-muted tabular-nums">
            {role.calls} call{role.calls === 1 ? '' : 's'}
          </span>
        </Link>
      </li>
    ))}
  </ol>
);

const Lane = ({ lane, projectId, selectedAgent }: { lane: FlowLane; projectId: string; selectedAgent: string | null }) => (
  <motion.section
    layout
    className="overflow-hidden rounded-panel border border-accent-line bg-surface"
    initial={false}
    /* A finish is an event: the rim flashes once, then the lane folds away. */
    exit={{
      boxShadow: ['0 0 0 0 rgb(217 119 87 / 0)', '0 0 0 3px rgb(217 119 87 / 0.9)', '0 0 0 0 rgb(217 119 87 / 0)'],
      height: 0,
      opacity: 0,
      transition: {
        boxShadow: { duration: DURATION.fast * 3, ease: EASE },
        height: { delay: DURATION.fast * 2, duration: DURATION.base, ease: EASE },
        opacity: { delay: DURATION.fast * 2, duration: DURATION.base, ease: EASE },
      },
    }}
    data-testid="flow-lane"
  >
    <div className="px-4 py-3.5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="min-w-0 truncate text-[15px] font-semibold">
          {lane.task} <span className="font-normal text-muted">{lane.title ?? 'task file missing'}</span>
        </h2>
        {lane.kind && <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-muted">{lane.kind}</span>}
        <ClaudeWorking className="ml-auto text-[13px]" label={`${lane.coordinator} working`} since={lane.startedAt} />
      </header>
      <p className="mt-0.5 text-xs text-muted">
        unit {lane.unit} · stage {lane.stage} · coordinator {lane.coordinator}
      </p>

      <h3 className="mt-4 mb-1.5 text-[11.5px] font-semibold text-faint">Expected path · {lane.kind ?? 'any'} task</h3>
      <ExpectedPath lane={lane} />

      <h3 className="mt-4 mb-1.5 text-[11.5px] font-semibold text-faint">
        Trail · what really ran, from handoffs.jsonl
      </h3>
      <ol className="flex flex-wrap items-center gap-1.5" data-testid="flow-trail">
        {lane.trail.map((node) => (
          <li
            key={node.key}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-card border px-2 text-[12px]',
              node.isBad ? 'border-danger/40 text-danger' : 'border-line-soft bg-card',
            )}
            title={`${node.from ?? '?'} → ${node.to ?? '?'}${node.verdict ? ` · ${node.verdict}` : ''}`}
            data-testid="flow-trail-node"
          >
            {node.role ? <RoleAvatar role={node.role} state="done" /> : <span className="text-faint">runner</span>}
            <span>{node.isAdvance ? `${node.from} → ${node.to}` : node.stage}</span>
            {(node.verdict || node.isBad) && <b className="text-[11px]">{node.outcome}</b>}
          </li>
        ))}
        <li
          className="inline-flex h-7 items-center gap-1.5 rounded-card border border-accent bg-accent-soft px-2 text-[12px] font-semibold text-accent"
          data-testid="flow-trail-live"
        >
          <ClaudeSpinner size="sm" />
          {lane.stage} · now
        </li>
      </ol>

      <h3 className="mt-4 mb-1.5 text-[11.5px] font-semibold text-faint">
        Unit {lane.unit} · the coordinator and every specialist it dispatched
      </h3>
      <RoleChain lane={lane} projectId={projectId} selectedAgent={selectedAgent} />
      <RoleStrip roles={lane.roles} />
      {lane.progress && (
        <p className="mt-3 truncate font-mono text-[11.5px] text-muted" data-testid="flow-progress" title={lane.progress}>
          {lane.progress}
        </p>
      )}
    </div>
  </motion.section>
);

/* The task in flight and the latest finished units. When the unit ends, its lane flashes and folds, and the run slides
   into "Last runs" — events only; the first render and every refresh draw them still. */
export const FlowLanes = ({ projectId, lane, lastRuns, selectedAgent }: Props) => (
  <div className="space-y-5">
    <AnimatePresence initial={false} mode="popLayout">
      {lane && <Lane key={lane.key} lane={lane} projectId={projectId} selectedAgent={selectedAgent} />}
    </AnimatePresence>
    {!lane && (
      <section
        className="rounded-panel border border-dashed border-border px-5 py-8 text-center"
        data-testid="flow-empty"
      >
        <h2 className="text-[15px] font-semibold">No task in flight</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          {lastRuns[0]
            ? `The last unit was ${lastRuns[0].task ?? '?'} · ${lastRuns[0].stage ?? '?'} (unit ${lastRuns[0].unit}, ${lastRuns[0].outcome}).`
            : 'No unit has run yet.'}{' '}
          A lane appears here when the loop starts the next unit.
        </p>
        <Link
          href={`/p/${projectId}/live`}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent hover:underline"
        >
          Open the live trace →
        </Link>
      </section>
    )}
    <section data-testid="flow-last-runs">
      <h2 className="mb-2 text-[13px] font-semibold">
        Last runs <span className="font-normal text-muted">· newest first</span>
      </h2>
      {lastRuns.length ? (
        <motion.ol layout className="divide-y divide-line-soft rounded-panel border border-line-soft bg-surface">
          <AnimatePresence initial={false}>
            {lastRuns.map((run) => (
              <motion.li
                key={run.unit}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={SPRING.snappy}
              >
                <Link
                  href={`/p/${projectId}/live?u=${run.unit}`}
                  className="flex min-h-11 items-center gap-2 px-3 text-[12.5px] hover:bg-surface-secondary"
                  data-testid="flow-run"
                >
                  <span className="w-14 flex-none text-faint tabular-nums">unit {run.unit}</span>
                  <b className="flex-none font-semibold">{run.task}</b>
                  <span className="truncate text-muted">{run.stage}</span>
                  <span className={cn('ml-auto flex-none', run.isBad ? 'text-danger' : 'text-muted')}>
                    {run.outcome}
                  </span>
                  {run.durationMs != null && (
                    <span className="w-12 flex-none text-right text-faint tabular-nums">{clockDuration(run.durationMs)}</span>
                  )}
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ol>
      ) : (
        <p className="text-xs text-muted">Finished units appear here.</p>
      )}
    </section>
  </div>
);
