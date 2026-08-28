/**
 * The satchel — what you carry, laid over whatever page you are on.
 *
 * It used to be two panels bolted to the companion screen, permanently open:
 * a grid of items and a list of loot boxes, both competing with the companion
 * itself for the only column that mattered. What you are carrying is not
 * something you read continuously; it is something you check, then act on. So
 * it is a drawer now — shut by default, over the right edge when opened, and
 * self-contained enough to drop onto any page that wants it:
 *
 *     <SatchelDrawer />
 *
 * Nothing is passed in. It reads the player from the provider the same way
 * every other panel does, so a second copy on the arena or the leaderboard
 * costs one line and no plumbing.
 *
 * It is a portal for the reason `Dialog` is: `.panel` sets `backdrop-filter`,
 * which makes any panel a containing block for `position: fixed` children, so
 * a drawer written inline would be pinned to whatever panel happened to hold
 * the button rather than to the viewport.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import { ItemId, LootResult } from '../lib/types';
import { Badge, Button, SectionTitle, cx } from './primitives';
import { Gift, Rune, Satchel, X } from './icons';
import { ITEM_ELEMENT, ITEM_NAME, LOOTBOX_TIER } from '../lib/format';
import { ITEM_ART } from './art';

/** three.js, so it arrives on the click that opens a box — see `LootVault`. */
const LootVault = lazy(() => import('./LootVault').then((m) => ({ default: m.LootVault })));

/**
 * The trigger and the drawer, together.
 *
 * They are one component on purpose: a caller that had to hold the open state
 * would be a caller that could render the button without the drawer, and the
 * whole point is that dropping this anywhere is complete.
 */
export function SatchelDrawer({ className }: { className?: string }) {
  const { player, run } = useGame();
  const [open, setOpen] = useState(false);
  // The ceremony starts on the click, not on the reply — see `LootVault`.
  const [opening, setOpening] = useState<{ rarity: number; result: LootResult | null } | null>(null);

  const items = Object.entries(player?.inventory ?? {})
    .filter(([, n]) => (n ?? 0) > 0) as Array<[ItemId, number]>;
  const boxes = player?.lootboxes ?? [];
  const carried = items.length + boxes.length;

  // Opening one shuts the drawer. The vault takes the whole screen and leaves
  // a receipt in the bottom-right corner afterwards — which is exactly where
  // the drawer is, so the two would sit on top of each other. The state lives
  // out here rather than in the drawer for the same reason: the ceremony has
  // to outlive the thing that started it.
  const openBox = async (rarity: number) => {
    setOpen(false);
    setOpening({ rarity, result: null });
    const reply = await run(`box:${rarity}`, () => api.openLootbox(rarity));
    if (reply?.lootResult) setOpening({ rarity, result: reply.lootResult });
    // A refused write leaves nothing to reveal; the toast already said why.
    else setOpening(null);
  };

  return (
    <>
      <Button
        className={className}
        icon={<Satchel className="h-4 w-4" />}
        onClick={() => setOpen(true)}
        title="What you are carrying"
        aria-expanded={open}
      >
        Satchel
        {carried > 0 && (
          <span className="font-mono text-[11px] tabular-nums text-faint">{carried}</span>
        )}
      </Button>
      {open && <Drawer onClose={() => setOpen(false)} onOpenBox={openBox} />}
      {opening && (
        <Suspense fallback={null}>
          <LootVault
            rarity={opening.rarity}
            result={opening.result}
            onClose={() => setOpening(null)}
          />
        </Suspense>
      )}
    </>
  );
}

function Drawer({ onClose, onOpenBox }: {
  onClose: () => void;
  onOpenBox: (rarity: number) => void;
}) {
  const { player, isPending, busy } = useGame();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = Object.entries(player?.inventory ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[ItemId, number]>;

  const boxes = player?.lootboxes ?? [];
  const byTier = boxes.reduce<Record<number, number>>((acc, r) => {
    acc[r] = (acc[r] ?? 0) + 1;
    return acc;
  }, {});

  return createPortal(
    <>
      {/* No blur and no dark wash: the drawer is a thing you hold up next to
          the page, not a modal that takes it away. Clicking off closes. */}
      <div
        className="drawer-backdrop fixed inset-0 z-40"
        onMouseDown={onClose}
        aria-hidden
      />
      <aside
        aria-label="Satchel"
        className={cx(
          'satchel-drawer panel fixed right-0 top-0 z-40 flex h-dvh w-full max-w-[19rem] flex-col',
          'animate-rise border-l border-edge p-4 shadow-glow',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h2 className="eyebrow flex items-center gap-2">
            <Satchel className="h-4 w-4 text-element" />
            Satchel
          </h2>
          <Button size="sm" variant="quiet" onClick={onClose} aria-label="Close satchel">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="-mr-2 mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-2">
          <section>
            <SectionTitle right={items.length ? <Badge>{items.length}</Badge> : null}>
              Items
            </SectionTitle>
            {items.length === 0 ? (
              <p className="py-3 text-[13px] text-faint">Empty. Open a loot box.</p>
            ) : (
              <div className="space-y-1.5">
                {items.map(([id, count]) => {
                  const element = ITEM_ELEMENT[id];
                  return (
                    <div
                      key={id}
                      data-element={element}
                      className="flex items-center gap-2 rounded-[3px] border border-edge/60 bg-void/25 px-2.5 py-2"
                    >
                      {/* Runes have no drawing in the art repo — the card
                          says so too, and a map glyph for a rune was the old
                          catch-all standing in for a thing that has its own. */}
                      {ITEM_ART[id]
                        ? <img src={ITEM_ART[id]} alt="" className="h-6 w-6 shrink-0 object-contain" />
                        : <Rune className="h-5 w-5 shrink-0 text-rune" />}
                      <span className={cx('min-w-0 flex-1 truncate text-[13px]', element ? 'text-element' : 'text-muted')}>
                        {ITEM_NAME[id]}
                      </span>
                      <span className="shrink-0 font-mono text-sm tabular-nums">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <SectionTitle right={boxes.length ? <Badge>{boxes.length}</Badge> : null}>
              Loot boxes
            </SectionTitle>
            {boxes.length === 0 ? (
              <p className="py-3 text-[13px] text-faint">
                None. Quests and arena wins award them.
              </p>
            ) : (
              <div className="space-y-2">
                {Object.entries(byTier)
                  .sort(([a], [b]) => Number(b) - Number(a))
                  .map(([tier, count]) => (
                    <div
                      key={tier}
                      className="flex items-center justify-between gap-2 rounded-[3px] border border-edge/60 bg-void/25 px-2.5 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-[13px]">
                        <Gift className="h-4 w-4 shrink-0 text-element" />
                        <span className="truncate">{LOOTBOX_TIER[Number(tier)] ?? `Tier ${tier}`}</span>
                        <span className="font-mono text-xs text-faint">&times;{count}</span>
                      </span>
                      <Button
                        size="sm" variant="ghost"
                        busy={isPending(`box:${tier}`)} disabled={busy}
                        onClick={() => onOpenBox(Number(tier))}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </>,
    document.body,
  );
}
