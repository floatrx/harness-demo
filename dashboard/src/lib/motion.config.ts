/* The dashboard's motion tokens: every animated component takes its timing from here. Only the unit in flight moves
   continuously; everything else moves once — on first render, or when a unit ends. Reduced motion stops all of it
   (MotionRoot for `motion`, global.css for CSS). */

export const DURATION = {
  /** Hovers, a rim flash. */
  fast: 0.16,
  /** A lane fold, a row sliding in. */
  base: 0.32,
  /** A count-up, bars growing on first render. */
  slow: 0.9,
} as const;

/** One curve for every tween: a quick start, a soft landing. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const SPRING = {
  /** Rows that make room for a new one. */
  snappy: { type: 'spring', stiffness: 520, damping: 38 },
  /** Larger surfaces: a lane, a drawer. */
  soft: { type: 'spring', stiffness: 220, damping: 30 },
} as const;

/** The delay between siblings that enter together (bars, cells), in seconds. */
export const STAGGER = 0.03;
