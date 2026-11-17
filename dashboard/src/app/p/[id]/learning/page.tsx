import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Candidate } from '@harness/core/lessons';
import { ProjectNotFound, findProject } from '@/lib/board';
import { cn } from '@/lib/cn';
import { type LearningTab, loadLearning } from '@/lib/learning-view';
import { CandidateList, type CandidateRow } from '@/components/learning/candidate-list';
import { LessonDecision, LessonUndo } from '@/components/learning/lesson-decision';
import { PageHeader } from '@/components/shell/page-header';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; l?: string }>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* "today", "yesterday", "3 days ago": how fresh the evidence is, from its newest date. */
const ago = (iso: string | null, now = Date.now()) => {
  if (!iso) return null;
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const countOf = (candidate: Candidate) =>
  candidate.kind === 'journal'
    ? 'a note in JOURNAL.md'
    : [
        candidate.tasks.length ? plural(candidate.tasks.length, 'task') : null,
        plural(candidate.evidence.length, candidate.kind === 'denied-tool' ? 'unit' : 'stop'),
      ]
        .filter(Boolean)
        .join(' · ');

const TAB_LABEL: Record<LearningTab, string> = { new: 'New', applied: 'Applied', rejected: 'Rejected' };

export default async function LearningPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab, l } = await searchParams;
  let project;
  try {
    project = findProject(id);
  } catch (error) {
    if (error instanceof ProjectNotFound) notFound();
    throw error;
  }
  const model = loadLearning(id, tab, l);
  const counts: Record<LearningTab, number> = {
    new: model.candidates.length,
    applied: model.applied.length,
    rejected: model.rejected.length,
  };
  const rows: CandidateRow[] = model.candidates.map((candidate) => ({
    key: candidate.key,
    kind: candidate.kind,
    summary: candidate.summary,
    count: countOf(candidate),
    newest: ago(candidate.newest),
  }));
  const selected = model.selected;
  return (
    <main className="px-4 pt-3.5 pb-8" data-testid="learning">
      <PageHeader
        project={project}
        title="Learning"
        lead="Decide what the loop should remember: repeated failures and agents' notes become rules every later unit reads."
      />
      <p className="mb-3 text-[15px]" data-testid="learning-headline">
        <b className="font-semibold">{plural(counts.new, 'candidate')} to decide</b>
        <span className="text-muted"> · {plural(counts.applied, 'rule')} in force</span>
      </p>
      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Lessons">
        {(Object.keys(TAB_LABEL) as LearningTab[]).map((key) => (
          <Link
            key={key}
            href={`/p/${id}/learning${key === 'new' ? '' : `?tab=${key}`}`}
            scroll={false}
            aria-current={model.tab === key ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px]',
              model.tab === key
                ? 'border-accent-line bg-accent-soft font-semibold text-accent'
                : 'border-line-soft text-muted hover:text-foreground',
            )}
            data-testid={`lesson-tab-${key}`}
          >
            {TAB_LABEL[key]}
            <span className="tabular-nums">{counts[key]}</span>
          </Link>
        ))}
      </nav>

      {model.tab === 'new' &&
        (rows.length ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <CandidateList projectId={id} rows={rows} selected={selected?.key ?? null} />
            {selected && (
              <section
                className="min-w-0 rounded-panel border border-line-soft bg-surface px-4 py-3.5"
                data-testid="lesson-detail"
              >
                <h2 className="text-[15px] font-semibold [overflow-wrap:anywhere]">{selected.summary}</h2>
                <p className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">key: {selected.key}</p>
                <h3 className="mt-3 mb-1.5 text-xs font-semibold text-muted">Evidence</h3>
                <ul className="mb-4 space-y-1 text-[12.5px]" data-testid="lesson-evidence">
                  {selected.evidence.map((item, index) => (
                    <li key={index} className="flex flex-wrap items-baseline gap-x-2">
                      {item.task && (
                        <Link
                          href={`/p/${id}?t=${item.task}`}
                          className="inline-flex min-h-11 items-center font-semibold hover:text-accent md:min-h-0"
                        >
                          {item.task}
                        </Link>
                      )}
                      {item.unit !== null && (
                        <Link
                          href={`/p/${id}/live?u=${item.unit}`}
                          className="inline-flex min-h-11 items-center text-muted hover:text-accent md:min-h-0"
                        >
                          unit {item.unit}
                        </Link>
                      )}
                      <span className="min-w-0 text-muted [overflow-wrap:anywhere]">{item.line}</span>
                    </li>
                  ))}
                </ul>
                <LessonDecision key={selected.key} projectId={id} lessonKey={selected.key} draft={selected.draft} />
              </section>
            )}
          </div>
        ) : (
          <p
            className="rounded-panel border border-dashed border-border px-6 py-10 text-center text-sm text-muted"
            data-testid="learning-empty"
          >
            No repeated failures yet. Lessons appear when the same contract stops two tasks, a tool is denied in three
            units, or an agent leaves a note.
          </p>
        ))}

      {model.tab === 'applied' &&
        (model.applied.length ? (
          <ol
            className="divide-y divide-line-soft rounded-panel border border-line-soft bg-surface"
            data-testid="lessons-applied"
          >
            {model.applied.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                <b className="mt-3 flex-none font-semibold tabular-nums">{entry.id}</b>
                <span className="min-w-0 flex-1 py-3 [overflow-wrap:anywhere] whitespace-pre-line">{entry.text}</span>
                <span className="mt-3 flex-none text-xs text-muted">{entry.date}</span>
                <LessonUndo projectId={id} id={entry.id} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">
            No rule in force. An applied lesson lands here and in every unit's Memory.
          </p>
        ))}

      {model.tab === 'rejected' &&
        (model.rejected.length ? (
          <ol className="divide-y divide-line-soft rounded-panel border border-line-soft bg-surface text-[13px]">
            {model.rejected.map((entry) => (
              <li key={entry.id} className="flex gap-3 px-4 py-2.5">
                <b className="flex-none font-semibold tabular-nums">{entry.id}</b>
                <span className="min-w-0 flex-1 text-muted [overflow-wrap:anywhere]">{entry.key}</span>
                <span className="flex-none text-xs text-muted">{entry.date}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted">Nothing rejected. A rejected candidate is never proposed again.</p>
        ))}

      <p className="mt-4 text-xs text-faint">
        Decisions live in <code>.harness/LESSONS.md</code>; the CLI twin is <code>harness lessons</code>.
      </p>
    </main>
  );
}
