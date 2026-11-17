/* Server-only: what /learning shows. The candidates and the decisions come from the core (`lessonsView`); this module
   only picks the tab and the selected candidate. */

import { type Candidate, type LessonEntry, lessonsView } from '@harness/core/lessons';
import { findProject } from './board.ts';

export const TABS = ['new', 'applied', 'rejected'] as const;
export type LearningTab = (typeof TABS)[number];

export interface LearningModel {
  tab: LearningTab;
  candidates: Candidate[];
  applied: LessonEntry[];
  rejected: LessonEntry[];
  selected: Candidate | null;
}

export function loadLearning(projectId: string, tab?: string, key?: string): LearningModel {
  const project = findProject(projectId);
  const view = lessonsView(project.path);
  const candidates = view.candidates;
  return {
    tab: (TABS as readonly string[]).includes(tab ?? '') ? (tab as LearningTab) : 'new',
    candidates,
    applied: view.entries.filter((entry) => entry.status === 'applied'),
    rejected: view.entries.filter((entry) => entry.status === 'rejected'),
    // The newest candidate is open by default: the page's goal is a decision, so the first screen holds one.
    selected: candidates.find((candidate) => candidate.key === key) ?? candidates[0] ?? null,
  };
}
