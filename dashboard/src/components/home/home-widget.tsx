import Link from 'next/link';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Where the widget's count lives in full (the board filtered to it, or the page that owns it). */
  href: string;
  /** What the link opens, read by screen readers and shown on hover. */
  linkLabel: string;
  testId: string;
  children: ReactNode;
}

/* A whole-card link: the widget is its own tap target, the arrow says where it goes. */
export const HomeWidget = ({ title, href, linkLabel, testId, children }: Props) => (
  <Link
    href={href}
    title={linkLabel}
    aria-label={`${title} — ${linkLabel}`}
    className="group flex min-h-24 min-w-0 flex-col rounded-panel border border-line-soft bg-surface px-4 py-3 transition-colors hover:border-border hover:bg-surface-secondary"
    data-testid={testId}
  >
    <span className="flex items-center text-xs text-muted">
      {title}
      <span className="ml-auto text-faint transition-colors group-hover:text-accent" aria-hidden="true">
        →
      </span>
    </span>
    <div className="mt-1 flex min-w-0 flex-1 flex-col">{children}</div>
  </Link>
);

/* What a widget says while it has nothing to count: when its data appears, never a zero. */
export const WidgetEmpty = ({ children }: { children: ReactNode }) => (
  <p className="mt-1 text-[13px] text-muted" data-testid="widget-empty">
    {children}
  </p>
);
