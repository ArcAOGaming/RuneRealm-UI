/** One chosen companion, with every other owned card kept in the collection. */
import { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import * as api from '../lib/game';
import type { Monster } from '../lib/types';
import { CardPreview } from '../ui/CardPreview';
import { CollectionCardEntrance } from '../ui/CollectionCardEntrance';
import {
  CollectionCardSwap, renderCollectionSwapFace, type CollectionSwapRequest,
} from '../ui/CollectionCardSwap';
import { Dialog } from '../ui/Dialog';
import { CharacterDialog } from '../ui/character/CharacterDialog';
import {
  Button, Empty, Panel, Skeleton, cx,
} from '../ui/primitives';
import { Sparkle, Users } from '../ui/icons';

export default function Collection() {
  const {
    player, loadingPlayer, run, isPending, busy,
  } = useGame();
  const [introDone, setIntroDone] = useState(false);
  const [introVisible, setIntroVisible] = useState(false);
  const [selected, setSelected] = useState<Monster | null>(null);
  const [swap, setSwap] = useState<CollectionSwapRequest | null>(null);
  const [preparingSwap, setPreparingSwap] = useState(false);
  const [preferredSlot, setPreferredSlot] = useState<{ id: string; index: number } | null>(null);
  const [editingCharacter, setEditingCharacter] = useState(false);
  const revealIntro = useCallback(() => setIntroVisible(true), []);
  const finishIntro = useCallback(() => {
    setIntroVisible(true);
    setIntroDone(true);
  }, []);
  const finishSwap = useCallback(() => setSwap(null), []);

  const active = player?.monster ?? Object.values(player?.monsters ?? {})[0];
  const storedUnordered = Object.values(player?.collection ?? {});
  const stored = [...storedUnordered];
  if (preferredSlot) {
    const currentIndex = stored.findIndex((monster) => monster.id === preferredSlot.id);
    if (currentIndex >= 0) {
      const [preferred] = stored.splice(currentIndex, 1);
      stored.splice(Math.min(preferredSlot.index, stored.length), 0, preferred);
    }
  }
  const all = active ? [active, ...stored] : stored;
  const arenaLocked = Boolean(player?.activeBattleId) || (player?.battlesRemaining ?? 0) > 0;
  const activityLocked = Boolean(player?.hunt) || Boolean(active && active.status.type !== 'Home');
  const switchLocked = busy || arenaLocked || activityLocked || swap !== null;
  const switchKey = selected ? `collection-switch:${selected.id}` : 'collection-switch';
  const switching = preparingSwap || isPending(switchKey);

  if (loadingPlayer && !player) {
    return <Panel className="h-[34rem] p-6"><Skeleton className="h-full w-full" /></Panel>;
  }
  if (!player?.unlocked) return <Navigate to="/" replace />;
  if (!player.faction) return <Navigate to="/factions" replace />;

  const confirmSwitch = async () => {
    if (!selected || switchLocked) return;
    if (!active) {
      const next = await run(switchKey, () => api.retrieveMonster(selected.id));
      if (next) {
        setPreferredSlot(null);
        setSelected(null);
      }
      return;
    }

    const root = document.querySelector('.collection-page');
    const fromNode = root?.querySelector<HTMLElement>(
      `[data-collection-card-target="${active.id}"]`,
    );
    const toNode = root?.querySelector<HTMLElement>(
      `[data-collection-card-target="${selected.id}"]`,
    );
    if (!fromNode || !toNode) return;
    const fromBox = fromNode.getBoundingClientRect();
    const toBox = toNode.getBoundingClientRect();
    const fromStart = {
      left: fromBox.left, top: fromBox.top, width: fromBox.width, height: fromBox.height,
    };
    const toStart = {
      left: toBox.left, top: toBox.top, width: toBox.width, height: toBox.height,
    };
    const selectedSlot = stored.findIndex((monster) => monster.id === selected.id);

    setPreparingSwap(true);
    let fromFace: HTMLCanvasElement;
    let toFace: HTMLCanvasElement;
    try {
      [fromFace, toFace] = await Promise.all([
        renderCollectionSwapFace(active),
        renderCollectionSwapFace(selected),
      ]);
    } catch {
      setPreparingSwap(false);
      return;
    }

    const next = await run(
      switchKey,
      () => api.setActiveMonster(selected.id),
      `${selected.name} is now your companion.`,
    );
    if (!next) {
      setPreparingSwap(false);
      return;
    }
    setPreferredSlot({ id: active.id, index: Math.max(0, selectedSlot) });
    setSwap({ from: active, to: selected, fromStart, toStart, fromFace, toFace });
    setPreparingSwap(false);
    setSelected(null);
  };

  const swapping = (id: string) => Boolean(
    swap && (swap.from.id === id || swap.to.id === id),
  );

  return (
    <div className={cx(
      'collection-page relative -mx-1 flex min-h-0 flex-1 overflow-hidden px-1',
      !introDone && 'is-intro',
    )}>
      {!introDone && (
        <CollectionCardEntrance
          monsters={all}
          onReveal={revealIntro}
          onComplete={finishIntro}
        />
      )}
      {swap && <CollectionCardSwap request={swap} onComplete={finishSwap} />}

      <div className={cx(
        'collection-workspace relative z-[1] grid min-h-0 flex-1 gap-3',
        /*
          Stacked, the companion row takes what it NEEDS and the collection
          takes the rest.

          It used to be `minmax(11rem,.62fr)`, which on a phone resolves to
          about 190px — less than the card (184px) plus its gap and the Edit
          character button under it. The panel is `overflow-hidden`, so what
          the row could not fit it cut: the card lost its nameplate off the top
          and the button was sliced in half at the bottom.
        */
        'grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[minmax(18rem,.72fr)_minmax(0,2.28fr)] lg:grid-rows-1',
        introVisible && 'is-ready',
      )}>
        {/* No headings over either column.

            They used to carry "Companion / Active" and "Collection / 7" — four
            labels for two things the cards already say, on a page whose whole
            height is the cards. The one control that was up there is now IN the
            companion panel, where the companion is. */}
        <section className="flex min-h-0 flex-col">
          {active ? (
            <ActiveCompanion
              monster={active}
              swapping={swapping(active.id)}
              onEditCharacter={() => setEditingCharacter(true)}
            />
          ) : (
            <Panel className="min-h-0 flex-1">
              <Empty icon={<Sparkle />} title="Choose your companion">
                Select any card below to bring that companion into the room.
              </Empty>
            </Panel>
          )}
        </section>

        <section className="flex min-h-0 flex-col">
          <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            {stored.length ? (
              <div className="collection-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                <div className="collection-grid grid gap-3 grid-cols-2 md:grid-cols-3 2xl:grid-cols-4">
                  {stored.map((monster) => (
                    <StoredCompanion
                      key={monster.id}
                      monster={monster}
                      disabled={switchLocked}
                      swapping={swapping(monster.id)}
                      onSelect={() => setSelected(monster)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <Empty icon={<Users />} title="No other companions yet">
                Captured, traded, and purchased companions appear here.
              </Empty>
            )}
          </Panel>
        </section>
      </div>

      {editingCharacter && (
        <CharacterDialog
          element={active?.elementType}
          onClose={() => setEditingCharacter(false)}
        />
      )}

      {selected && (
        <Dialog
          title={`Switch to ${selected.name}?`}
          element={selected.elementType}
          busy={switching}
          onClose={() => setSelected(null)}
        >
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            {active ? <CardPreview monster={active} eager className="w-full" /> : <span />}
            <span className="font-mono text-lg text-element">→</span>
            <CardPreview monster={selected} eager className="w-full" />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" disabled={switching} onClick={() => setSelected(null)}>Cancel</Button>
            <Button variant="primary" busy={switching} onClick={() => void confirmSwitch()}>Confirm switch</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ActiveCompanion({ monster, swapping, onEditCharacter }: {
  monster: Monster;
  swapping: boolean;
  onEditCharacter: () => void;
}) {
  return (
    <Panel
      data-element={monster.elementType}
      className="collection-active-card relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-3 sm:p-4 lg:p-6"
      glow
    >
      <div
        className={cx(
          'collection-card-target w-[9rem] shrink-0 sm:w-[11rem] lg:w-full lg:max-w-[21rem]',
          swapping && 'is-swapping',
        )}
        data-collection-card-target={monster.id}
      >
        <CardPreview monster={monster} eager className="w-full" />
      </div>
      {/* The trainer, under their companion. This was a 11px link in a heading
          nobody looked at; it is the only action on this half of the page, so
          it gets to look like one. */}
      <Button
        variant="ghost"
        onClick={onEditCharacter}
        icon={<Sparkle className="h-4 w-4" />}
        className="shrink-0"
      >
        Edit character
      </Button>
    </Panel>
  );
}

function StoredCompanion({ monster, disabled, swapping, onSelect }: {
  monster: Monster;
  disabled: boolean;
  swapping: boolean;
  onSelect: () => void;
}) {
  return (
    <Panel
      data-element={monster.elementType}
      className="collection-stored-card relative min-w-0 overflow-hidden p-2.5"
    >
      <button
        type="button"
        className="collection-card-button absolute inset-0 z-[2] rounded-[3px] disabled:cursor-not-allowed"
        aria-label={`Switch to ${monster.name}`}
        disabled={disabled}
        onClick={onSelect}
      />
      <div className="collection-card-content pointer-events-none relative z-[1]">
        <div
          className={cx(
            'collection-card-target mx-auto w-full max-w-[15rem]',
            swapping && 'is-swapping',
          )}
          data-collection-card-target={monster.id}
        >
          <CardPreview monster={monster} eager className="w-full" />
        </div>
      </div>
    </Panel>
  );
}
