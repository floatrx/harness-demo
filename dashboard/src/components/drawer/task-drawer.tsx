'use client';

import { Tabs } from '@heroui/react';
import Link from 'next/link';
import type { TaskDetail } from '@/lib/task-detail';
import { usd } from '@/lib/format';
import { RoleAvatar } from '@/components/ui/role-avatar';
import { StageTrack } from '@/components/board/stage-track';
import { ClaudeSpinner } from '@/components/ui/claude-spinner';
import { InterviewPanel } from './interview-panel';
import { GateReview } from './gate-review';
import { MarkdownPanel } from './markdown-panel';
import { UnitsPanel } from './units-panel';

interface Props {
  task: TaskDetail;
  projectId: string;
}

export const TaskDrawer = ({ task, projectId }: Props) => {
  const openCount = task.questions.filter((question) => question.state === 'open').length;
  const tabs = [
    ...(task.questions.length
      ? [
          {
            id: 'interview',
            label: 'Interview',
            count: openCount,
            body: <InterviewPanel questions={task.questions} projectId={projectId} taskId={task.id} />,
          },
        ]
      : []),
    {
      id: 'spec',
      label: 'Spec',
      body: (
        <MarkdownPanel
          markdown={[
            task.sections.Spec,
            task.sections['Acceptance criteria'] && `### Acceptance criteria\n${task.sections['Acceptance criteria']}`,
          ]
            .filter(Boolean)
            .join('\n\n')}
          empty="The writer has not written the spec yet."
        />
      ),
    },
    {
      id: 'plan',
      label: 'Plan',
      body: (
        <div className="space-y-3">
          {task.status === 'planned' && <GateReview gate="plan" projectId={projectId} taskId={task.id} />}
          <MarkdownPanel markdown={task.sections.Plan} empty="The planner has not written the plan yet." />
        </div>
      ),
    },
    ...(task.kind === 'ui' || task.sections.Prototype
      ? [
          {
            id: 'prototype',
            label: 'Prototype',
            body: (
              <div className="space-y-3">
                {task.status === 'prototype' && task.prototype.state === 'review' && (
                  <GateReview
                    gate="prototype"
                    projectId={projectId}
                    taskId={task.id}
                    roundsLeft={task.prototype.roundsLeft}
                  />
                )}
                {task.status === 'prototype' && task.prototype.state === 'drafting' && (
                  <p className="flex items-center text-[13px] text-muted">
                    <ClaudeSpinner />
                    The designer drafts the next round.
                  </p>
                )}
                {task.prototypeImage && (
                  <img
                    src={`/api/p/${projectId}/artifacts/${task.id}/${task.prototypeImage}`}
                    alt={`Prototype of ${task.id}`}
                    className="w-full rounded-card border border-line-soft"
                  />
                )}
                <MarkdownPanel markdown={task.sections.Prototype} empty="No prototype round yet." />
              </div>
            ),
          },
        ]
      : []),
    {
      id: 'log',
      label: 'Log',
      body: (
        <div className="space-y-4">
          <UnitsPanel units={task.units} />
          <ul className="space-y-1 text-xs text-muted">
            {task.log.map((line) => (
              <li key={line}>{line.replace(/^- /, '')}</li>
            ))}
          </ul>
        </div>
      ),
    },
  ];
  /* Open on the tab where the human acts. */
  const initial = openCount
    ? 'interview'
    : task.status === 'prototype'
      ? 'prototype'
      : task.status === 'planned'
        ? 'plan'
        : 'spec';
  return (
    <aside
      className="flex h-screen flex-col overflow-y-auto border-l border-line-soft bg-rail"
      data-testid="task-drawer"
    >
      <header className="border-b border-line-soft px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted tabular-nums">{task.id}</span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent">
            {task.status}
          </span>
          <Link
            href={`/p/${projectId}`}
            scroll={false}
            className="ml-auto text-muted hover:text-foreground"
            aria-label="Close the task"
          >
            ✕
          </Link>
        </div>
        <h2 className="mt-2 text-lg leading-snug font-semibold">{task.title}</h2>
        {task.pr && (
          <a
            href={task.pr}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[13px] font-semibold text-accent hover:underline"
            data-testid="drawer-pr"
          >
            Pull request #{task.pr.split('/').at(-1)} ↗{' '}
            <span className="font-normal text-muted">— merging is yours</span>
          </a>
        )}
        {task.askedBy && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            asked by <RoleAvatar role={task.askedBy.role} /> {task.askedBy.role} · {task.askedBy.stage}
            {task.askedBy.unit != null && ` · unit ${task.askedBy.unit}`}
            {task.askedBy.costUsd != null && ` · ${usd(task.askedBy.costUsd)}`}
          </p>
        )}
        <StageTrack status={task.trackStatus} isBad={task.status === 'parked'} className="mt-3" />
      </header>
      <Tabs variant="secondary" defaultSelectedKey={initial} className="px-4 pt-2">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Task sections">
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.id} id={tab.id} className="px-2 text-[13px] whitespace-nowrap">
                {tab.label}
                {'count' in tab && !!tab.count && <span className="ml-1 text-accent tabular-nums">{tab.count}</span>}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((tab) => (
          <Tabs.Panel key={tab.id} id={tab.id} className="py-3">
            {tab.body}
          </Tabs.Panel>
        ))}
      </Tabs>
      {task.sections.Draft && (
        <section className="mt-auto border-t border-line-soft px-4 py-3">
          <h4 className="mb-1 text-xs font-semibold text-muted">Your draft</h4>
          <p className="text-[13px] leading-relaxed">{task.sections.Draft}</p>
        </section>
      )}
    </aside>
  );
};
