/**
 * The small set of pieces every screen is built from.
 *
 * Everything elemental reads `--element` off an ancestor's `data-element`
 * rather than taking a colour prop, so a fire card's buttons, bars and glow all
 * agree without any of them being told which faction they are in.
 */
import { ButtonHTMLAttributes, HTMLAttributes, ReactNode, forwardRef } from 'react';
import { pct } from '../lib/format';

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

// Panel ---------------------------------------------------------------------

/**
 * Forwards its ref: the Factions screen scrolls a card into view when you pick
 * its altar, and a panel that swallows the ref cannot be found to scroll to.
 */
export const Panel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { glow?: boolean }>(
  function Panel({ className, children, glow, ...rest }, ref) {
    return (
      <div
        ref={ref}
        {...rest}
        className={cx('panel', glow && 'shadow-glow', className)}
      >
        {children}
      </div>
    );
  },
);

export function SectionTitle({
  children, right,
}: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="eyebrow">{children}</h2>
      {right}
    </div>
  );
}

// Button --------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', busy, icon, className, children, disabled, ...rest },
  ref,
) {
  const sizes = {
    sm: 'h-11 px-3 text-[13px] gap-1.5 sm:h-8',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-[15px] gap-2.5',
  }[size];

  // The primary action is a struck tablet: chamfered on the mark's own two
  // corners, and its glow is a `drop-shadow` rather than a `box-shadow`,
  // because a clip-path cuts a box-shadow off at the silhouette and leaves the
  // button sitting in a hard-edged rectangle of its own light. The bordered
  // variants stay square — see `.chamfer` in index.css for why.
  const variants = {
    primary:
      'chamfer bg-element text-void font-semibold hover:brightness-110 active:brightness-95 ' +
      'drop-shadow-[0_8px_18px_rgb(var(--element)/0.35)]',
    ghost:
      'rounded-[3px] bg-raised/80 text-ink border border-edge hover:border-element/60 hover:bg-raised',
    quiet:
      'rounded-[3px] bg-transparent text-muted hover:text-ink hover:bg-raised/60',
    danger:
      'rounded-[3px] bg-transparent text-bad border border-bad/40 hover:bg-bad/10',
  }[variant];

  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'button-control inline-flex select-none items-center justify-center',
        'transition-[filter,background-color,border-color,transform] duration-150',
        'active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
        sizes, variants, className,
      )}
    >
      {busy ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

/**
 * Busy.
 *
 * An octagonal seal turning, not a circle: there is no arc anywhere else in
 * this interface, and a rounded spinner in the middle of a carved button was
 * the one piece of stock UI left in it.
 */
export function Spinner({ className }: { className?: string }) {
  const RING = 'M9.4 2.6h5.2l4.8 4.8v5.2l-4.8 4.8H9.4l-4.8-4.8V7.4Z';
  return (
    <svg
      className={cx('animate-spin', className ?? 'h-5 w-5')}
      viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="butt" strokeLinejoin="miter"
    >
      <path d={RING} strokeOpacity="0.2" transform="translate(0 1.4)" />
      {/* One face of the seal lit, so the turn is legible. */}
      <path d="M14.6 4h-5.2" strokeOpacity="0.95" />
      <path d="M18.6 8.8 14.6 4" strokeOpacity="0.55" />
    </svg>
  );
}

// Numbers -------------------------------------------------------------------

/**
 * A meter. `tone` overrides the elemental colour for things that carry a fixed
 * meaning — health is always health-coloured, whatever faction you are in.
 *
 * `name` is what a screen reader announces. It is required rather than optional
 * because these carry health, shield, energy, happiness and experience, and a
 * bar with no accessible value is a bar only some people can read.
 */
export function Bar({
  value, max, name, tone = 'element', label, right, size = 'md',
}: {
  value: number; max: number; name: string;
  tone?: 'element' | 'health' | 'energy' | 'happy' | 'exp' | 'shield';
  label?: ReactNode; right?: ReactNode; size?: 'sm' | 'md';
}) {
  const fill = {
    element: 'bg-element',
    health: 'bg-good',
    energy: 'bg-warn',
    happy: 'bg-[rgb(236,110,180)]',
    exp: 'bg-arcane',
    shield: 'bg-tide',
  }[tone];
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';
  return (
    <div className="min-w-0">
      {(label || right) && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
          <span className="truncate text-muted">{label}</span>
          <span className="shrink-0 font-mono tabular-nums text-faint">{right}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={name}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-valuetext={`${Math.round(value)} of ${Math.round(max)}`}
        className={cx('w-full overflow-hidden rounded-[2px] bg-raised', height)}
      >
        <div
          className={cx('h-full rounded-[1px] transition-[width] duration-500 ease-out', fill)}
          style={{ width: `${pct(value, max)}%` }}
        />
      </div>
    </div>
  );
}

export function Badge({
  children, tone = 'plain', className,
}: { children: ReactNode; tone?: 'plain' | 'element' | 'good' | 'warn' | 'bad'; className?: string }) {
  const tones = {
    plain: 'border-edge text-muted',
    element: 'border-element/50 text-element bg-element/10',
    good: 'border-good/40 text-good bg-good/10',
    warn: 'border-warn/40 text-warn bg-warn/10',
    bad: 'border-bad/40 text-bad bg-bad/10',
  }[tone];
  return (
    <span className={cx(
      'inline-flex items-center gap-1 rounded-[3px] border px-2 py-0.5',
      'text-[11px] font-medium uppercase tracking-wide',
      tones, className,
    )}>
      {children}
    </span>
  );
}

// States --------------------------------------------------------------------

export function Empty({
  icon, title, children, action,
}: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-faint [&>svg]:h-8 [&>svg]:w-8">{icon}</div>}
      <h3 className="text-base font-medium text-ink">{title}</h3>
      {children && <p className="max-w-sm text-sm leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-[3px]', className ?? 'h-4 w-full')} />;
}

/**
 * Errors are shown, never swallowed. The old client discarded handler errors in
 * several places, so a refused action looked exactly like a slow network and
 * players had no way to tell the difference.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex items-start gap-3 rounded-[3px] border border-bad/35 bg-bad/[0.07] p-3.5">
      <div className="mt-0.5 shrink-0 text-bad">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" strokeLinecap="round" />
          <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink/90">{message}</p>
      {onRetry && <Button size="sm" variant="quiet" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
