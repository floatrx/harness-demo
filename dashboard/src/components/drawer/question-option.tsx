import { cn } from '@/lib/cn';

interface Props {
  name: string;
  letter: string;
  text: string;
  isChosen: boolean;
  onChoose: () => void;
}

/* "Faster to find — recommended: the list grows" → the option and, under it, why it is recommended. */
const split = (text: string) => {
  const match = /^(.*?)\s+[—-]\s+(recommended\b.*)$/i.exec(text);
  return match ? { main: match[1] ?? text, why: match[2] ?? '' } : { main: text, why: '' };
};

export const QuestionOption = ({ name, letter, text, isChosen, onChoose }: Props) => {
  const { main, why } = split(text);
  return (
    <label
      className={cn(
        'mb-1.5 flex cursor-pointer items-start gap-2.5 rounded-[9px] border border-transparent bg-surface-secondary px-3 py-2.5 text-[13.5px] transition-colors hover:border-border',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:disabled]:cursor-default',
        isChosen && 'border-accent-line bg-accent-soft hover:border-accent-line',
      )}
    >
      <input type="radio" name={name} value={letter} checked={isChosen} onChange={onChoose} className="sr-only" />
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
    </label>
  );
};
