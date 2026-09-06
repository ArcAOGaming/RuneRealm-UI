/**
 * The market's four counters, and the one control that picks between them.
 *
 * They live here rather than in `screens/Marketplace.tsx` because the chooser
 * is in the header, next to Arena, and the screen is not: a player switching
 * counters is doing the same thing as a player switching pages, so it is the
 * same strip of chrome. The screen keeps its own copy of the control for
 * phones, where there is no header nav to hang it off.
 *
 * The choice is in the URL (`/market?venue=internal`) and nowhere else. That
 * makes it linkable, survives a reload, and — the reason it is not a context —
 * lets the header set it without the market screen having to be mounted first.
 */
import { useEffect, useRef, useState } from 'react';

import { cx } from './primitives';
import { Arrow, Check, Exchange, Rune, Satchel, Sparkle } from './icons';

export type MarketVenue = 'shop' | 'internal' | 'external' | 'monster';

export const VENUES: Array<{
  id: MarketVenue;
  /** What the header shows once you are standing there. */
  short: string;
  title: string;
  note: string;
  accent: 'rune' | 'arcane' | 'element';
  Icon: (props: { className?: string }) => JSX.Element;
}> = [
  {
    id: 'shop', short: 'Shop', title: 'Realm shop',
    note: 'Fixed price · you trade with the realm', accent: 'rune', Icon: Satchel,
  },
  {
    id: 'internal', short: 'Internal', title: 'Internal book',
    note: 'Goods for Gold · player to player', accent: 'arcane', Icon: Exchange,
  },
  {
    id: 'external', short: 'External', title: 'External book',
    note: 'Rune for a wallet token · player to player', accent: 'arcane', Icon: Rune,
  },
  {
    id: 'monster', short: 'Monsters', title: 'Monster market',
    note: 'Companions for Rune', accent: 'element', Icon: Sparkle,
  },
];

/** Anything else in the query string means the shop, which is the way in. */
export function venueFromSearch(search: string): MarketVenue {
  const value = new URLSearchParams(search).get('venue');
  return VENUES.some((row) => row.id === value) ? value as MarketVenue : 'shop';
}

/**
 * The list itself, without a trigger.
 *
 * Shared so the header's menu and the phone's picker are the same rows in the
 * same order with the same sentences — the sentences being the whole reason
 * this is a list and not a row of four short words.
 */
export function VenueOptions({ venue, onPick, listRef }: {
  venue: MarketVenue; onPick: (venue: MarketVenue) => void;
  listRef?: React.RefObject<HTMLDivElement>;
}) {
  const roam = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowDown' ? 1 : VENUES.length - 1)) % VENUES.length;
    listRef?.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };
  return (
    <div ref={listRef} role="listbox" aria-label="Market counters" className="market-venue-list">
      {VENUES.map((row, index) => (
        <button key={row.id} type="button" role="option" aria-selected={row.id === venue}
                data-selected={row.id === venue} data-accent={row.accent}
                className="market-venue-option"
                onKeyDown={(event) => roam(event, index)}
                onClick={() => onPick(row.id)}>
          <row.Icon className="market-venue-icon h-4 w-4" />
          <span className="market-venue-lines">
            <b>{row.title}</b>
            <small>{row.note}</small>
          </span>
          {row.id === venue && <Check className="h-4 w-4 shrink-0 text-element" />}
        </button>
      ))}
    </div>
  );
}

/**
 * Close on a click outside, on Escape, and move focus into the list on open.
 * Both the header menu and the screen's picker need exactly this, and a second
 * copy of it is a second place for the popover to stay open on a route change.
 */
export function usePopover(open: boolean, close: () => void) {
  const host = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const active = list.current?.querySelector<HTMLElement>('[data-selected="true"]')
      ?? list.current?.querySelector<HTMLElement>('[role="option"]');
    active?.focus();
  }, [open]);

  return { host, list };
}

/**
 * The screen's own chooser: phones only.
 *
 * On a phone the header has no nav to hang the counters off — the routes are a
 * thumb bar at the bottom, and a fifth control in it would be four controls in
 * a trench coat. So the market page carries the picker itself below `lg`, and
 * hides it above, where the header has it.
 */
export function MarketVenuePicker({ venue, onVenue, className }: {
  venue: MarketVenue; onVenue: (venue: MarketVenue) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { host, list } = usePopover(open, () => setOpen(false));
  const current = VENUES.find((row) => row.id === venue) ?? VENUES[0];

  return (
    <div ref={host} className={cx('market-venue', className)}>
      <button type="button" className="market-venue-trigger" aria-haspopup="listbox" aria-expanded={open}
              data-accent={current.accent}
              onClick={() => setOpen((value) => !value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); }
              }}>
        <current.Icon className="market-venue-icon h-5 w-5" />
        <span className="market-venue-lines">
          <b>{current.title}</b>
          <small>{current.note}</small>
        </span>
        <Arrow className={cx('market-venue-caret h-4 w-4', open && 'is-open')} />
      </button>
      {open && (
        <VenueOptions venue={venue} listRef={list}
                      onPick={(next) => { onVenue(next); setOpen(false); }} />
      )}
    </div>
  );
}
