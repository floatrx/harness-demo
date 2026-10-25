interface Props {
  /** The row's value; null draws an empty track (unknown, not zero). */
  value: number | null;
  max: number;
  /** The exact value, for the hover tooltip. */
  label: string;
}

/* One magnitude per row, in one hue: a 6px bar anchored left with a rounded data end. */
export const ShareBar = ({ value, max, label }: Props) => (
  <span className="block h-1.5 w-full rounded-full bg-track" title={label} role="img" aria-label={label}>
    {value != null && max > 0 && (
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
    )}
  </span>
);
