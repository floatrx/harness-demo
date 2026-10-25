interface Props {
  names: string[];
}

export const EmptyRail = ({ names }: Props) => (
  <section
    data-testid="empty-rail"
    title={`${names.join(', ')} — empty`}
    className="flex min-h-44 w-6 flex-none flex-col items-center gap-2 rounded-panel bg-lane py-2.5 text-[11.5px] text-faint"
  >
    <span className="rotate-180 whitespace-nowrap [writing-mode:vertical-rl]">{names.join(' · ')}</span>
    <span className="tabular-nums">0</span>
  </section>
);
