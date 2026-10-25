import { cn } from '@/lib/cn';

interface Props {
  letter: string;
  text: string;
  isChosen: boolean;
}

/* "Faster to find — recommended: the list grows" → the option and, under it, why it is recommended. */
const split = (text: string) => {
  const match = /^(.*?)\s+[—-]\s+(recommended\b.*)$/i.exec(text);
  return match ? { main: match[1] ?? text, why: match[2] ?? '' } : { main: text, why: '' };
};

export const QuestionOption = ({ letter, text, isChosen }: Props) => {
  const { main, why } = split(text);
  return (
    <div
      className={cn(
        'mb-1.5 flex items-start gap-2.5 rounded-[9px] border border-transparent bg-surface-secondary px-3 py-2.5 text-[13.5px]',
        isChosen && 'border-accent-line bg-accent-soft',
      )}
    >
      <span
        className={cn(
          'grid size-5 flex-none place-items-center rounded-md bg-card text-[11.5px] font-bold text-muted',
          isChosen && 'bg-accent text-accent-foreground',
        )}
      >
        {letter}
      </span>
      <span>
        {main}
        {why && <small className="mt-0.5 block text-xs text-muted first-letter:uppercase">{why}</small>}
      </span>
    </div>
  );
};
