import type { Status } from '@harness/core/task/transitions';

export const COLUMN_NAMES: Record<Status, string> = {
  draft: 'Draft',
  spec: 'Spec',
  'needs-input': 'Needs input',
  plan: 'Plan',
  planned: 'Planned',
  prototype: 'Prototype',
  ready: 'Ready',
  implementing: 'Implementing',
  qa: 'QA',
  judge: 'Judge',
  done: 'Done',
  delivered: 'Delivered',
  parked: 'Parked',
};

export const PHASES: { name: string; columns: Status[] }[] = [
  { name: 'Define', columns: ['draft', 'spec', 'needs-input'] },
  { name: 'Plan', columns: ['plan', 'planned', 'prototype'] },
  { name: 'Build', columns: ['ready', 'implementing'] },
  { name: 'Review', columns: ['qa', 'judge'] },
  { name: 'Finish', columns: ['done', 'delivered', 'parked'] },
];
