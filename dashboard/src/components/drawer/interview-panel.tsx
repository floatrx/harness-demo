import type { Question } from '@harness/core/task/parse';
import { QuestionOption } from './question-option';

interface Props {
  questions: Question[];
}

/* Phase 1 renders the picker read-only: the recommended option (the first) shows as chosen. Sending is phase 2. */
export const InterviewPanel = ({ questions }: Props) => {
  const open = questions.filter((question) => question.state === 'open');
  if (!questions.length) return <p className="text-[13.5px] text-muted">No questions on this task.</p>;
  return (
    <div data-testid="interview">
      {questions.map((question) => (
        <fieldset key={question.id} className="mb-4">
          <legend className="mb-2 text-[15px] font-semibold">
            <span className="mr-2 text-accent">{question.id}</span>
            {question.text}
            {question.state === 'answered' && (
              <span className="ml-2 text-xs font-normal text-muted">answered {question.answer}</span>
            )}
          </legend>
          {question.options.map((option, index) => (
            <QuestionOption
              key={option.letter}
              letter={option.letter}
              text={option.text}
              isChosen={question.state === 'open' ? index === 0 : !!question.answer?.startsWith(`(${option.letter})`)}
            />
          ))}
        </fieldset>
      ))}
      {!!open.length && (
        <button
          type="button"
          disabled
          className="h-[34px] rounded-[7px] bg-accent px-4 text-[12.5px] font-semibold text-accent-foreground opacity-60"
          title="Answering arrives in phase 2"
        >
          Send {open.length} answer{open.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
};
