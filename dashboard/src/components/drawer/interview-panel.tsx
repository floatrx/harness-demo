'use client';

import type { Question } from '@harness/core/task/parse';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mutate, taskActionUrl } from '@/lib/mutate';
import { QuestionOption } from './question-option';

interface Props {
  questions: Question[];
  projectId: string;
  taskId: string;
}

/* The interview picker: lettered options, the recommended one (the first) pre-selected, a note per question, and one
   send that writes every answer at once. The runner moves the task back to the stage that asked. */
export const InterviewPanel = ({ questions, projectId, taskId }: Props) => {
  const router = useRouter();
  const open = questions.filter((question) => question.state === 'open');
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((question) => [question.id, question.options[0]?.letter ?? ''])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!questions.length) return <p className="text-[13.5px] text-muted">No questions on this task.</p>;

  const handleSend = async () => {
    setPending(true);
    setError(null);
    try {
      await mutate(taskActionUrl(projectId, taskId, 'answer'), {
        answers: open.map((question) => ({
          id: question.id,
          letter: choices[question.id],
          note: notes[question.id] ?? '',
        })),
      });
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div data-testid="interview">
      {questions.map((question) => (
        <fieldset key={question.id} className="mb-4" disabled={question.state !== 'open' || isPending}>
          <legend className="mb-2 text-[15px] font-semibold">
            <span className="mr-2 text-accent">{question.id}</span>
            {question.text}
            {question.state === 'answered' && (
              <span className="ml-2 text-xs font-normal text-muted">answered {question.answer}</span>
            )}
          </legend>
          {question.options.map((option) => (
            <QuestionOption
              key={option.letter}
              name={question.id}
              letter={option.letter}
              text={option.text}
              isChosen={
                question.state === 'open'
                  ? choices[question.id] === option.letter
                  : !!question.answer?.startsWith(`(${option.letter})`)
              }
              onChoose={() => setChoices((current) => ({ ...current, [question.id]: option.letter }))}
            />
          ))}
          {question.state === 'open' && (
            <input
              value={notes[question.id] ?? ''}
              onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
              placeholder="Note for the agent (optional)"
              aria-label={`Note for ${question.id}`}
              className="mt-0.5 h-9 w-full rounded-[8px] border border-border bg-surface-secondary px-3 text-[13px] outline-none placeholder:text-faint focus:border-accent"
            />
          )}
        </fieldset>
      ))}
      {!!open.length && (
        <button
          type="button"
          onClick={handleSend}
          disabled={isPending}
          data-testid="send-answers"
          className="h-[34px] rounded-[7px] bg-accent px-4 text-[12.5px] font-semibold text-accent-foreground transition hover:brightness-110 disabled:opacity-60"
        >
          {isPending ? 'Sending…' : `Send ${open.length} answer${open.length === 1 ? '' : 's'}`}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};
