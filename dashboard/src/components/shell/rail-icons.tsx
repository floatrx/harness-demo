/* Outline icons for the rail, 1.5px stroke on a 20px grid. */
const PATHS = {
  board: 'M3 4h4v12H3zM8.5 4h4v8h-4zM14 4h3v5h-3z',
  live: 'M2 10h3l2-5 3 10 2-6 1.5 3H18',
  stats: 'M4 16V9M8 16V5M12 16v-4M16 16V7',
  agents:
    'M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM13.5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2.5 16c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12 12.4c2.3-.2 4 1.2 4.6 3.6',
  projects: 'M2.5 6.5h5l1.5 1.5h8.5v8h-15z',
} as const;

export type RailIconName = keyof typeof PATHS;

interface Props {
  name: RailIconName;
}

export const RailIcon = ({ name }: Props) => (
  <svg
    viewBox="0 0 20 20"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={PATHS[name]} />
  </svg>
);

/* The product's own mark: a loop with its unit in flight. Never Claude's logo. */
export const HarnessMark = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" aria-label="harness">
    <path d="M5 11a6 6 0 1 1 6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="11" cy="11" r="2.4" fill="currentColor" />
    <circle cx="5" cy="17" r="1.6" fill="currentColor" />
  </svg>
);
