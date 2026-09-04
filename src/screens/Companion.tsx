/**
 * The companion screen: everything you do between fights.
 *
 * The old build spread this across a management page, a status window, an
 * activities panel, a stat-allocation modal and a separate inventory overlay,
 * all polling independently. It is one screen now, because it is one subject,
 * and every action is a single signature rather than a token transfer waiting
 * on a Credit-Notice.
 */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { projectFeed, projectPlay } from '../state/optimistic';
import * as api from '../lib/game';
import {
  ActivityReceipt, BerryItemId, ItemId, levelUpCost, Monster, Player,
} from '../lib/types';
import {
  Bar, Button, Panel, SectionTitle, Skeleton, Spinner, cx,
} from '../ui/primitives';
import {
  Arrow, Berry, Bolt, Clock, Gift, GLYPH_PATH, Heart, Map, Rune, Shield, Sparkle, Sword, Users,
} from '../ui/icons';
import {
  BERRY_FOR, countdown, ELEMENT_LABEL, ITEM_NAME,
} from '../lib/format';
import { StatusBadge } from '../ui/MonsterCard';
import { Dialog } from '../ui/Dialog';
import { CharacterDialog } from '../ui/character/CharacterDialog';
import { Sigil } from '../ui/Sigil';
import { Room } from '../ui/Room';
import { ArenaPeek } from '../ui/ArenaPeek';
import { SatchelDrawer } from '../ui/Satchel';
import { useTour, useTourSteps, type TourStep } from '../ui/tourContext';
// three.js, so it arrives when somebody actually picks the card up.
const CardViewer = lazy(() => import('../ui/CardViewer'));
const HuntOffering = lazy(() => import('../ui/HuntOffering'));
import { ITEM_ART, portrait } from '../ui/art';
import { CardPreview } from '../ui/CardPreview';
import type { ActivityRunes, RuneState } from '../gfx/activityRunes';
import { HUNT_PROCESS } from '../lib/hyperbeam';

/**
 * The walkthrough for this screen — and, because this is where a new player is
 * put down the moment their oath lands, for the game.
 *
 * It names the room, what you can ask of the companion, the card, the daily
 * claim, and then what is behind each tab. One line each, and each one says
 * what the thing IS and what it costs or gives; nobody needs to be told that a
 * button can be pressed.
 *
 * **This list is part of the flows it describes.** Change what an activity
 * costs, what the arena charges or what a tab is called, and the sentence here
 * is part of that change — a walkthrough describing rules the game no longer
 * has is worse than none, because the player has no way to tell.
 *
 * Steps whose target is not on screen are dropped by the tour, which is why the
 * tab steps can name routes a given player may not have (no companion, no
 * Arena tab) and why the daily-worship step simply is not there on a phone.
 */
const COMPANION_TOUR: TourStep[] = [
  {
    target: '[data-tour="room"]',
    title: 'Your companion',
    body: 'This is its home. Energy, happiness and level all move with what you do next.',
  },
  {
    target: '[data-tour="activities"]',
    title: 'What you can ask of it',
    body: 'Feed it its berry, play with it, send it on a quest, or take it hunting for a wild companion to bring back.',
  },
  {
    target: '[data-tour="card"]',
    title: 'Its card',
    body: 'Stats, moves and meters, drawn on the card itself. Pick it up to look at it, and level it up once it has the experience.',
  },
  {
    target: '[data-tour="worship"]',
    title: 'Daily worship',
    body: 'One claim a day, free — Runes and a loot box. It is the realm’s only faucet, so it is worth coming back for.',
  },
  {
    target: '[data-tour-to="/arena"]',
    title: 'Arena',
    body: 'A Rune buys a session of four battles. Fight a trainer, or challenge another player.',
  },
  {
    target: '[data-tour-to="/market"]',
    title: 'Market',
    body: 'Berries, Rune and companions — at the realm’s fixed price, or against other players on the trading floor.',
  },
  {
    target: '[data-tour-to="/monster-index"]',
    title: 'Monster Index',
    body: 'Every companion form there is, and which of them you have held.',
  },
  {
    target: '[data-tour-to="/factions"]',
    title: 'Factions',
    body: 'The four altars, the standings, and everybody else sworn alongside you.',
  },
  {
    target: '[data-tour="guide"]',
    title: 'And whenever you are lost',
    body: 'This shows you around whatever page you are on. It is on every screen, and it never goes away.',
  },
];

export default function Companion() {
  const { player, loadingPlayer, address } = useGame();
  const [activityReceipt, setActivityReceipt] = useState<ActivityReceipt>();
  const { offer } = useTour();
  useTourSteps('companion', COMPANION_TOUR);

  /*
    The walkthrough, once, for somebody who has just got here.

    This is the screen a new player is dropped on the moment the oath lands —
    a room, four activities, a card and a strip of tabs, none of which says
    which one is the game. `offer` is a no-op for anybody who has already been
    through it or dismissed it; replaying is in the wallet dialog.

    The delay is not padding. Every step points at a real element and the ones
    with no target are dropped, so opening on the first frame — before the card
    has painted or the tab strip has grown its Arena entry — is a tour of
    whichever half of the screen happened to exist.
  */
  useEffect(() => {
    if (!player?.faction || !player.monster) return undefined;
    const timer = window.setTimeout(offer, 1200);
    return () => window.clearTimeout(timer);
  }, [player?.faction, player?.monster?.id, offer]);

  // A claim receipt is a hand-off to the ceremony, not durable player state.
  // Let the animation finish, then forget it so remounting the room after an
  // unrelated arena visit cannot celebrate the old reward again.
  useEffect(() => {
    if (!activityReceipt) return undefined;
    const id = activityReceipt.id;
    const timer = window.setTimeout(() => {
      setActivityReceipt((current) => current?.id === id ? undefined : current);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [activityReceipt]);

  if (loadingPlayer && !player) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="h-80 p-6"><Skeleton className="h-full w-full" /></Panel>
        <Panel className="h-80 p-6"><Skeleton className="h-full w-full" /></Panel>
      </div>
    );
  }
  if (!player?.unlocked) return <Navigate to="/" replace />;
  if (!player.faction) return <Navigate to="/factions" replace />;
  if (player.hunt && player.monster?.status.type === 'Hunt') return <Navigate to="/hunt" replace />;

  // An empty active slot is no longer the same thing as a new player, and it
  // has stopped being one twice over: a minted companion leaves the game, and
  // a sold or stored one leaves the roster. `adopted` is the only thing that
  // says whether this account is at the start of the flow — what it happens to
  // be holding right now does not, because a player can return to holding
  // nothing on purpose.
  if (!player.monster) {
    return (
      <div className="animate-rise space-y-4">
        {player.adopted ? <NoActiveCompanion player={player} /> : <Adopt />}
      </div>
    );
  }

  // The vault is only worth a panel once there is something in it. An empty
  // "Nothing minted yet" box sat under the companion on every screen of every
  // player who had never minted, which is most of them.
  return (
    /*
      A page that fits.

      Everything on this screen is one subject, and a subject you have to
      scroll past its own card to finish reading is a subject in two halves.
      The shell hands this route the viewport as a fixed box (see `fitted` in
      Shell.tsx); the height then flows DOWN through here — the card is
      whatever tall is left after the buttons and the record, and its width
      follows from that, rather than the card being drawn at column width and
      the page growing to hold it.
    */
    <div className="companion-screen animate-rise flex min-h-0 flex-1 flex-col gap-3">
      {/* Faction, adoption, character — and this is the third. It only appears
          for an account that has never published a sprite, and it takes a row
          rather than a modal because it is an offer, not a step being demanded
          before the screen can be used. */}
      <div className="companion-layout grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* The room is aspect-locked to its own plate and draws at a whole-number
            zoom, so its height follows its width and it is not a thing that can
            be stretched — see `RoomStage`. The activities take everything under
            it instead, which is why they are cards rather than lines: given a
            column of height to fill, three rectangles fill it and three rows
            leave a hole. */}
        <div className="companion-room-column flex min-h-0 flex-col gap-3">
          {/* The badge sits ON the room, which is the thing it describes. It
              used to be in the activities heading, where it was a second label
              for a fact the room behind it was already showing. */}
          <div data-tour="room" className="relative shrink-0">
            {/* Away at the arena, and there is a fight to look at: show the
                fight. An empty house with a dimmed sprite in it is a picture of
                an absence, and the interesting thing is one click away. */}
            {player.monster.status.type === 'Battle' && player.battle ? (
              <ArenaPeek battle={player.battle} address={address} />
            ) : (
              <Room
                monster={player.monster}
                playerOutfit={player.outfit}
                playerSpriteTxId={player.spriteTxId}
                activityReceipt={activityReceipt}
              />
            )}
            <div className="pointer-events-none absolute right-3 top-3">
              <StatusBadge monster={player.monster} />
            </div>
          </div>
          <Activities onActivityClaim={setActivityReceipt} />
        </div>
        <div className="companion-card-column flex min-h-0 flex-col gap-3">
          <CompanionCard monster={player.monster} player={player} />
          {/* Capped and scrolled inside itself. The vault is a list that grows
              with every mint, and left free it would take the height off the
              card — which is the thing the page is for. */}
        </div>
      </div>
    </div>
  );
}

// Adoption ------------------------------------------------------------------

function Adopt() {
  const { player, factions, run, isPending } = useGame();
  const faction = factions?.find((f) => f.name === player?.faction);

  return (
    <div className="mx-auto max-w-lg animate-rise" data-element={faction?.element}>
      <Panel className="p-8 text-center" glow>
        {faction && (
          <img
            src={portrait(faction.element, 0, faction.monsterEntryNo)} alt=""
            className="mx-auto h-32 w-32 animate-drift object-contain"
          />
        )}
        <h1 className="mt-5 text-xl font-semibold">
          Your {faction?.monsterName ?? 'companion'} is waiting
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
          It arrives at level zero with four moves rolled from the{' '}
          {faction ? ELEMENT_LABEL[faction.element].toLowerCase() : ''} pool and a
          random spread of ten stat points. Adopting also hands you three loot
          boxes.
        </p>
        <p className="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-faint">
          This is the one companion the realm gives you. Every other one is
          bought, traded for, or won — so if you part with this one, you replace
          it at the market rather than being handed another.
        </p>
        <Button
          className="mt-6" size="lg" variant="primary"
          busy={isPending('adopt')}
          onClick={() => run('adopt', api.adopt, 'Your companion has arrived.')}
        >
          Adopt your companion
        </Button>
      </Panel>
    </div>
  );
}

/**
 * Adopted, but nothing active right now.
 *
 * Stored, sold, given away or minted out — from this screen's point of view
 * they are the same situation and the wrong answer to all of them is the Adopt
 * panel, which would offer a button the process is going to refuse. What the
 * player needs is the way back to a companion they already own, or the market.
 */
function NoActiveCompanion({ player }: { player: Player }) {
  const stored = Object.values(player.collection ?? {});
  const { run, isPending } = useGame();

  return (
    <div className="mx-auto max-w-lg animate-rise">
      <Panel className="p-8 text-center" glow>
        <h1 className="text-xl font-semibold">
          {stored.length ? 'Your companions are in storage' : 'You have no companion'}
        </h1>
        {stored.length ? (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              {stored.length === 1
                ? 'One companion is put away.'
                : `${stored.length} companions are put away.`}{' '}
              Choose which one should become your active companion.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link to="/collection"><Button variant="ghost" icon={<Users className="h-4 w-4" />}>Open collection</Button></Link>
              {stored.slice(0, 3).map((monster) => (
                <Button
                  key={monster.id} variant="primary"
                  busy={isPending(`retrieve:${monster.id}`)}
                  onClick={() => run(
                    `retrieve:${monster.id}`,
                    () => api.retrieveMonster(monster.id),
                    `${monster.name} is home.`,
                  )}
                >
                  Choose {monster.name}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
              You have already used the one adoption this account gets. Every
              companion after that changes hands rather than being created, so
              the market is where the next one comes from.
            </p>
            <Link to="/market" className="mt-6 inline-block">
              <Button size="lg" variant="primary">Go to the market</Button>
            </Link>
          </>
        )}
      </Panel>
    </div>
  );
}

/**
 * The last step of setting up an account, and the only optional one.
 *
 * Faction, then adoption, then this — but a character is cosmetic and costs an
 * upload, so it is offered rather than demanded and it stays offered. Dismissal
 * is remembered per wallet in this browser only: it is a nudge, not a fact
 * about the account, and there is no reason to spend a signed write recording
 * that somebody said "later".
 */
// The card ------------------------------------------------------------------

/**
 * True while the viewport is at least `query` wide, and it keeps listening.
 *
 * Read once on mount would be wrong here: the card this drives is a different
 * DRAWING at each size, and a phone that is turned sideways has to get the
 * other one.
 */
function useWide(query: string) {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return wide;
}

function CompanionCard({ monster, player }: { monster: Monster; player: Player }) {
  const { catalog } = useGame();
  // Priced from the process, never from arithmetic inlined here — see the note
  // on `levelUpCost`. A deployment that predates the charge returns 0, and the
  // button then behaves exactly as it used to.
  const levelPrice = levelUpCost(catalog, monster.level + 1);
  const canAfford = (player.inventory.rune ?? 0) >= levelPrice;
  const canLevel = monster.exp >= monster.nextLevelExp;
  const ownedCount = Object.keys(player.collection ?? {}).length + 1;
  const [allocating, setAllocating] = useState(false);
  const [holding, setHolding] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState(false);
  /*
    The extended card is 1044 pixels wide. In the two-column desktop layout it
    gets about half a screen and reads perfectly; stacked on a phone it gets
    ~356, which is a THIRD scale on pixel art whose panel type is drawn at ten
    pixels — three on screen. The moves, the meters and the satchel were all
    there and none of them could be read.

    So below the desktop layout the plain card is drawn instead, at nearly
    double the scale, and the three meters the panel was carrying come back as
    real DOM bars underneath — which are crisp at any size and were always the
    better drawing of a meter anyway.
  */
  const extended = useWide('(min-width: 1024px)');

  return (
    <Panel data-tour="card" className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4" glow>
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full opacity-20 blur-3xl"
        style={{ background: 'rgb(var(--element))' }}
      />
      {/* The EXTENDED card, sized by the height it is given.
          This is the mode the original renderer had and the reason it exists:
          the same card, widened, with the side panel carrying the moves in
          full, the three meters and the satchel. It is not what gets minted —
          the mint stays the plain portrait card — it is how the companion is
          read.

          Everything under it used to be drawn twice: the name over the
          nameplate, the element beside the element plate, four stat columns
          beside the four numbers on the card face, three meters under the
          three meters in the panel. The card won — it is the better drawing of
          all of it, and the second copy was the reason this screen scrolled. */}
      {/*
        The card is the affordance.

        "Hold the card" also sits in the button row below, but a quiet ghost
        button between Level up and Mint is not where anyone looks for it —
        the obvious thing to click on a card is the card.
      */}
      <button
        type="button"
        onClick={() => setHolding(true)}
        title="Hold the card"
        className={cx(
          'group relative flex min-h-0 flex-1 items-center justify-center rounded-[3px]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-element',
        )}
      >
        {/* Height in, width out. The wrapper is only as wide as the card ends
            up being, so the hover chip lands on the card's own corner rather
            than on the corner of whatever space the column had spare. */}
        <span className="relative block h-full">
          <CardPreview
            monster={monster}
            inventory={player.inventory}
            className="h-full w-auto max-w-full"
            extended={extended}
            eager
          />
          <span
            className={cx(
              'pointer-events-none absolute bottom-2 right-2 flex items-center gap-1.5',
              'rounded-[3px] border border-rune/25 bg-void/80 px-2 py-1 backdrop-blur',
              'text-[11px] text-muted opacity-0 transition-opacity',
              'group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
          >
            <Rune className="h-3 w-3 text-element" />
            Hold the card
          </span>
        </span>
      </button>

      {/* The three meters, whenever the card is not carrying them.
          Crisp text at any size, and the same values the panel draws. */}
      {!extended && (
        <div className="relative mt-3 shrink-0 space-y-2">
          <Bar tone="energy" size="sm" name={`${monster.name} energy`}
               value={monster.energy} max={100} label="Energy"
               right={`${monster.energy}/100`} />
          <Bar tone="happy" size="sm" name={`${monster.name} happiness`}
               value={monster.happiness} max={100} label="Happiness"
               right={`${monster.happiness}/100`} />
          <Bar tone="exp" size="sm" name={`${monster.name} experience`}
               value={monster.exp} max={monster.nextLevelExp} label="Experience"
               right={`${monster.exp}/${monster.nextLevelExp}`} />
        </div>
      )}

      {/* The things you DO to a companion, together. Minting used to sit in
          its own panel with a second copy of the card above it — which is the
          card that is already on this screen at full size. */}
      <div className="relative mt-3 flex shrink-0 flex-wrap items-center gap-2">
        <Link to="/collection" className="inline-flex">
          <Button variant="ghost" size="sm" icon={<Users className="h-4 w-4" />}>
            Collection
            <span className="ml-1.5 font-mono text-[10px] opacity-70">
              {ownedCount}
            </span>
          </Button>
        </Link>
        {canLevel && (
          <Button variant="primary" size="sm" onClick={() => setAllocating(true)}
                  disabled={!canAfford}
                  title={canAfford ? undefined
                    : `Levelling to ${monster.level + 1} costs ${levelPrice} Rune; `
                      + `you hold ${player.inventory.rune ?? 0}`}
                  icon={<Sparkle className="h-4 w-4" />}>
            Level up to {monster.level + 1}
            {/* The price sits on the button because it is deducted the moment
                it is pressed. A cost discovered only in the refusal is how a
                player loses a fight they thought they had already won. */}
            {levelPrice > 0 && (
              <span className="ml-1.5 font-mono text-[0.85em] opacity-70">
                {levelPrice}◈
              </span>
            )}
          </Button>
        )}
        {/* The plain card, as an object. The extended card above is the
            dashboard; this is the thing that gets signed and traded, and it
            is worth being able to pick it up and look at the back of it. */}
        <Button variant="ghost" size="sm" onClick={() => setHolding(true)}
                icon={<Rune className="h-4 w-4" />}>
          Hold the card
        </Button>
        <SatchelDrawer className="h-8 px-3 text-[13px]" />
        {/* The sprite the room is drawing, and the only other thing a companion
            owner has any reason to open from here. It used to sit on a line of
            its own above the whole layout, which cost the card thirty pixels
            of height for one link — and then it was a link to a page of its
            own, which threw the room away to change a hat. */}
        <button
          type="button"
          onClick={() => setEditingCharacter(true)}
          className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-[3px] px-2 text-[11px] text-faint transition-colors hover:text-muted lg:h-8"
        >
          <Sparkle className="h-3 w-3" />
          Edit character
        </button>
      </div>

      <div className="relative mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-rune/12 pt-3 text-[13px] text-faint">
        {/* The trainer's mark, drawn from their address. It sits with the
            tallies because that is what it is: the signature on the record —
            and on a plate, at size, because it is the one thing on this screen
            that is theirs and nobody else's. */}
        <Sigil
          address={player.address} size={24} weight={1.8} plate
          title="Your mark" className="text-rune/80"
        />
        <span>Runes <b className="font-mono text-muted">{player.inventory.rune ?? 0}</b></span>
        <span>Fed <b className="font-mono text-muted">{monster.totalTimesFed}</b></span>
        <span>Played <b className="font-mono text-muted">{monster.totalTimesPlay}</b></span>
        <span>Quests <b className="font-mono text-muted">{monster.totalTimesQuest}</b></span>
        <span>Wins <b className="font-mono text-good">{player.wins}</b></span>
        <span>Losses <b className="font-mono text-muted">{player.losses}</b></span>
      </div>

      {allocating && (
        <LevelUpDialog monster={monster} onClose={() => setAllocating(false)} />
      )}

      {holding && (
        <Suspense fallback={null}>
          <CardViewer monster={monster} onClose={() => setHolding(false)} />
        </Suspense>
      )}

      {editingCharacter && (
        <CharacterDialog
          element={monster.elementType}
          onClose={() => setEditingCharacter(false)}
        />
      )}

    </Panel>
  );
}

// Activities ----------------------------------------------------------------


/**
 * The four tokens, mounted over the rows.
 *
 * three.js is a third of the bundle and the rest of this screen does not need
 * it, so the module arrives on the import rather than with the page — the same
 * bargain the loot vault and the card viewer make. Until it lands, and forever
 * on a machine with no WebGL, the rows keep their flat icons: `live` is what
 * decides which of the two is showing, and it only ever goes true once there
 * is a scene actually rendering.
 */
function useActivityRunes(element: string, states: RuneState[]) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const slots = useRef<Array<HTMLElement | null>>([]);
  const runes = useRef<ActivityRunes | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const node = canvas.current;
    if (!node) return undefined;

    import('../gfx/activityRunes').then(({ createActivityRunes }) => {
      if (cancelled || !canvas.current) return;
      const handle = createActivityRunes(canvas.current, {
        glyphs: [
          GLYPH_PATH.berry,
          GLYPH_PATH.sparkle,
          GLYPH_PATH.map,
          [
            'M12 2.2 15 7.4v5.4H9V7.4Z',
            'M6.2 12.8h11.6V15H6.2Z',
            'M10.6 15h2.8v4.4h-2.8Z',
            'M9.2 19.4h5.6v2.2H9.2Z',
          ],
        ],
      });
      if (!handle) return;
      runes.current = handle;
      setLive(true);
    }).catch(() => {});

    return () => {
      cancelled = true;
      runes.current?.dispose();
      runes.current = null;
      setLive(false);
    };
  }, []);

  // The DOM decides where the tokens stand. Measuring the icon slots rather
  // than computing them from the row height is what keeps the stone under the
  // label when the panel wraps, the font loads, or a reason line appears.
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node || !live) return undefined;

    const place = () => {
      const box = node.getBoundingClientRect();
      // The scene is measured in the canvas's own layout pixels, which is what
      // `clientWidth` reports and what the renderer was sized to. A rect is in
      // VISUAL pixels, and the two part company under a CSS `zoom` — so the
      // offsets are divided back rather than handed over as measured, and a
      // zoomed page keeps its tokens under their labels.
      const scale = box.width / Math.max(1, node.clientWidth);
      runes.current?.layout(slots.current.map((slot) => {
        if (!slot) return { x: 0, y: 0, size: 0 };
        const r = slot.getBoundingClientRect();
        return {
          x: (r.left - box.left + r.width / 2) / scale,
          y: (r.top - box.top + r.height / 2) / scale,
          size: Math.min(r.width, r.height) / scale,
        };
      }));
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    for (const slot of slots.current) if (slot) observer.observe(slot);
    return () => observer.disconnect();
  }, [live]);

  useEffect(() => {
    if (!live) return;
    runes.current?.setElement(element as never);
    states.forEach((state, i) => runes.current?.setState(i, state));
  });

  return { canvas, slots, live };
}

/**
 * The four things you can do, in one activity ledger.
 *
 * They began as cards in a grid, each with an icon row, a labelled COST
 * row, a labelled GAIN row, a reason paragraph and a full-width button — five
 * stacked blocks to say "one berry, twenty energy", and a panel as tall as the
 * companion beside it, spent almost entirely on chrome around six numbers.
 *
 * They are cards again, but two lines each: the token and the name with
 * the button opposite it, and underneath, what it costs, an arrow, and what it
 * gives. The COST and GAIN labels are gone because an arrow says the same
 * thing in four pixels, and the tallies lost their boxes because three
 * bordered pills inside a bordered card inside a bordered panel is three
 * frames around a number.
 *
 * Kept together because these are choices of the same kind, not a sequence.
 */
const HUNT_BERRY_IDS: BerryItemId[] = [
  'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
];
const FALLBACK_HUNT_BERRIES: Record<BerryItemId, number> = {
  fire_berry: 5, water_berry: 5, air_berry: 5, rock_berry: 5,
};

function Activities({
  onActivityClaim,
}: {
  onActivityClaim: (receipt: ActivityReceipt) => void;
}) {
  const { player, catalog, run, isPending, writePhase, busy } = useGame();
  const navigate = useNavigate();
  const [huntGateOpen, setHuntGateOpen] = useState(false);
  const monster = player!.monster!;
  const roster = Object.values(player!.monsters ?? { [monster.id]: monster });
  const activityMonster = roster.find((candidate) => (
    candidate.status.type === 'Play'
      || candidate.status.type === 'Quest'
      || candidate.status.type === 'Hunt'
      || candidate.status.type === 'Battle'
  ));
  const kind = activityMonster?.status.type ?? monster.status.type;

  // Anything but Home and the process refuses every activity. The arena used to get
  // a whole empty state of its own, on a screen where the room behind the
  // companion has already changed to the beach and the badge already reads
  // "In the arena" — three drawings of one fact. It is a note in the heading
  // now, said once rather than once per row.
  const away = Boolean(activityMonster) || kind !== 'Home';

  // A companion only ever eats its own element's berry, so there is nothing to
  // choose: the row states the cost and feeds. The picker that used to sit
  // here offered three buttons that were worth half as much and read as if the
  // wrong one might be right.
  const ownBerry: BerryItemId = monster.elementType === 'normal'
    ? HUNT_BERRY_IDS.find((item) => (player!.inventory[item] ?? 0) > 0) ?? 'air_berry'
    : BERRY_FOR[monster.elementType];
  const berries = player!.inventory[ownBerry] ?? 0;
  const runes = player!.inventory.rune ?? 0;
  const huntConfigured = HUNT_PROCESS.length === 43;
  const huntBerryCosts = catalog?.hunt?.entry?.berries ?? FALLBACK_HUNT_BERRIES;
  const huntShort = HUNT_BERRY_IDS.filter((item) => (
    (player!.inventory[item] ?? 0) < (huntBerryCosts[item] ?? 5)
  ));
  const canPayHunt = huntShort.length === 0;

  const berryIcon = <ItemIcon id={ownBerry} />;
  const energy = <Bolt className="h-3.5 w-3.5 shrink-0" />;
  const happy = <Heart className="h-3.5 w-3.5 shrink-0" />;
  const clock = <Clock className="h-3.5 w-3.5 shrink-0" />;

  const blocked = [
    away || monster.energy >= 100 || berries < 1,
    away || monster.energy < 10 || berries < 1,
    away || runes < 1 || monster.energy < 25 || monster.happiness < 25,
    away || !huntConfigured || !canPayHunt,
  ];
  /*
    The rune animation runs on the SIGNATURE, not the click.

    These four drive `busy` on the activity runes, and they used to be
    `isPending`, which goes true the instant the button is pressed. That meant
    the stones started casting while the wallet's approval dialog was still
    open — animating behind a modal, for a write that had not been sent and
    might be rejected — and the whole thing snapped back on a reject.

    `settling` is the wallet's answer: signed, scheduled, and now the chain's.
    So the cast begins when the player has actually committed, and ends when
    the computed reply lands and the phase clears. The button's own spinner
    still comes from `isPending`, because that is what stops a second click,
    and a disabled button is not an animation.
  */
  const working = [
    writePhase('feed') === 'settling',
    writePhase('play') === 'settling',
    writePhase('quest') === 'settling',
    writePhase('hunt') === 'settling',
  ];

  const beginHunt = async () => {
    const next = await run('hunt', () => api.beginHunt(monster.id));
    if (next?.hunt) {
      setHuntGateOpen(false);
      navigate('/hunt');
    }
  };

  const [hovered, setHovered] = useState<number | null>(null);
  const { canvas, slots, live } = useActivityRunes(
    monster.elementType,
    blocked.map((no, i) => ({ disabled: no, busy: working[i], hover: hovered === i })),
  );

  /*
    Play and Quest replace this panel with the countdown — and this return has
    to stay BELOW every hook above it.

    It used to sit up beside `kind`, which meant starting an activity rendered
    three hooks and claiming it rendered six: "Rendered more hooks than during
    the previous render", and the whole screen replaced by the error boundary,
    a couple of interactions into a session. React counts hooks by call order,
    so a return that skips some is a crash waiting for the state that comes
    back.

    Nothing above is wasted on the way past. `useActivityRunes` mounts nothing
    while its canvas is unrendered — every effect in it leads with
    `if (!node) return` — and the costs it is handed are plain arithmetic.
  */
  if (activityMonster && (kind === 'Play' || kind === 'Quest')) {
    return <InProgress monster={activityMonster} onClaim={onActivityClaim} />;
  }

  // Content height, not "whatever is left". Given `flex-1` this panel took
  // about half the column for three cards and a heading and centred them in it,
  // so the emptiness read as part of the activities rather than as space.
  return (
    <>
    <Panel data-tour="activities" className="flex shrink-0 flex-col px-4 pb-3 pt-2.5">
      {/* Not `SectionTitle`: that one reserves a row for something on the
          right and a `mb-3` under it, and this heading has nothing on its right
          any more — the status went to the room, which is what it describes.
          The margin it was spending is the difference between three cards you
          can read and three cards that fit. */}
      <h2 className="eyebrow mb-2 shrink-0">Activities</h2>

      {/* The cards lay out as normal; the canvas is laid over them and the
          tokens are placed from the DOM, so nothing here has to agree with the
          renderer about where a card ends up. */}
      {/* Capped, and centred in whatever is left over. Three cards given a
          tall column stretch to it, and a 360px rectangle holding a name and
          six numbers is a poster, not a control. Past the cap the slack
          becomes even space above and below, which reads as room rather than
          as three cards that failed to fill something. */}
      <div className="relative w-full">
        <canvas
          ref={canvas}
          aria-hidden
          className={cx(
            'pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500',
            live ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div className="relative grid gap-2 sm:grid-cols-2">
        <ActivityCard
          icon={<Berry className="h-4 w-4" />}
          slot={(el) => { slots.current[0] = el; }}
          carved={live}
          onHover={(on) => setHovered(on ? 0 : null)}
          title="Feed"
          costs={[
            { icon: berryIcon, value: '−1', title: ITEM_NAME[ownBerry], short: berries < 1 },
          ]}
          gains={[{ icon: energy, value: monster.elementType === 'normal' ? '+10' : '+20', title: 'Energy' }]}
          reason={
            away ? null
              : berries < 1 ? `No ${ITEM_NAME[ownBerry]}`
                : monster.energy >= 100 ? 'Already at full energy' : null
          }
          away={away}
          action="Feed your companion"
          busy={isPending('feed')}
          disabled={busy || away || monster.energy >= 100 || berries < 1}
          /* Rendered before the node answers. Feeding costs one berry and adds
             a fixed, capped amount of energy — arithmetic this client can do
             itself — so the bar moves on the click and the authoritative reply
             replaces it a round trip later. A rejection puts the berry back
             under the toast that says why. */
          onClick={() => run(
            'feed', () => api.feed(ownBerry), undefined, projectFeed(monster, ownBerry),
          )}
        />

        <ActivityCard
          icon={<Sparkle className="h-4 w-4" />}
          slot={(el) => { slots.current[1] = el; }}
          carved={live}
          onHover={(on) => setHovered(on ? 1 : null)}
          title="Play"
          costs={[
            { icon: berryIcon, value: '−1', title: ITEM_NAME[ownBerry], short: berries < 1 },
            { icon: energy, value: '−10', title: 'Energy', short: monster.energy < 10 },
            { icon: clock, value: '15m', title: 'Away for 15 minutes' },
          ]}
          gains={[{ icon: happy, value: '+25', title: 'Happiness' }]}
          reason={
            away ? null
              : berries < 1 ? `No ${ITEM_NAME[ownBerry]}`
                : monster.energy < 10 ? 'Not enough energy' : null
          }
          away={away}
          action="Send out to play"
          busy={isPending('play')}
          disabled={busy || away || monster.energy < 10 || berries < 1}
          /* Same rule as Feed: a fixed cost and a status flip, nothing rolled
             and nothing awarded. The countdown starts on this browser's clock
             and is corrected by the reply. */
          onClick={() => run(
            'play', () => api.startPlay(undefined, ownBerry), 'Off to play.',
            projectPlay(monster, ownBerry),
          )}
        />

        <ActivityCard
          icon={<Map className="h-4 w-4" />}
          slot={(el) => { slots.current[2] = el; }}
          carved={live}
          onHover={(on) => setHovered(on ? 2 : null)}
          title="Quest"
          costs={[
            { icon: <Rune className="h-3.5 w-3.5 shrink-0" />, value: '−1', title: 'Rune', short: runes < 1 },
            { icon: energy, value: '−25', title: 'Energy', short: monster.energy < 25 },
            { icon: happy, value: '−25', title: 'Happiness', short: monster.happiness < 25 },
            { icon: clock, value: '1h', title: 'Away for an hour' },
          ]}
          gains={[
            { icon: <Sparkle className="h-3.5 w-3.5 shrink-0" />, value: '+1', title: 'Experience' },
            { icon: <Gift className="h-3.5 w-3.5 shrink-0" />, value: '×1', title: 'Uncommon loot box' },
          ]}
          reason={
            away ? null
              : runes < 1 ? 'No Runes'
                : monster.energy < 25 ? 'Not enough energy'
                  : monster.happiness < 25 ? 'Not happy enough' : null
          }
          away={away}
          action="Send on a quest"
          busy={isPending('quest')}
          disabled={busy || away || runes < 1 || monster.energy < 25 || monster.happiness < 25}
          onClick={() => run('quest', api.startQuest, 'Your companion sets out.')}
        />

        <ActivityCard
          icon={<Sword className="h-4 w-4" />}
          slot={(el) => { slots.current[3] = el; }}
          carved={live}
          onHover={(on) => setHovered(on ? 3 : null)}
          title="Hunt"
          costs={HUNT_BERRY_IDS.map((item) => ({
            icon: <ItemIcon id={item} />,
            value: `−${huntBerryCosts[item] ?? 5}`,
            title: ITEM_NAME[item],
            short: (player!.inventory[item] ?? 0) < (huntBerryCosts[item] ?? 5),
          }))}
          gains={[
            {
              icon: <Gift className="h-3.5 w-3.5 shrink-0" />,
              value: 'wild',
              title: 'Chance to capture a wild companion',
            },
          ]}
          reason={
            away ? null
              : !huntConfigured ? 'Hunt unavailable'
                : huntShort.length ? `Need ${huntShort.map((item) => ITEM_NAME[item]).join(', ')}` : null
          }
          away={away}
          action={`Review the hunt offering for ${monster.name}`}
          busy={isPending('hunt')}
          disabled={busy || away || !huntConfigured || !canPayHunt}
          onClick={() => setHuntGateOpen(true)}
        />
        </div>
      </div>
    </Panel>
    {huntGateOpen && (
      <HuntEntryDialog
        monster={monster}
        inventory={player!.inventory}
        costs={huntBerryCosts}
        busy={isPending('hunt')}
        onClose={() => setHuntGateOpen(false)}
        onConfirm={() => { void beginHunt(); }}
      />
    )}
    </>
  );
}

function HuntEntryDialog({
  monster, inventory, costs, busy, onClose, onConfirm,
}: {
  monster: Monster;
  inventory: Player['inventory'];
  costs: Record<BerryItemId, number>;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const canPay = HUNT_BERRY_IDS.every((item) => (
    (inventory[item] ?? 0) >= (costs[item] ?? 5)
  ));
  return (
    <Dialog
      title="Open the Wild Verge"
      element={monster.elementType}
      busy={busy}
      onClose={onClose}
      className="!max-w-2xl !p-0 [&>h3]:px-6 [&>h3]:pb-3 [&>h3]:pt-5"
    >
      <div className="relative h-64 overflow-hidden border-b border-rune/15 bg-void/80">
        <Suspense fallback={<div className="h-full animate-pulse bg-raised/40" />}>
          <HuntOffering busy={busy} />
        </Suspense>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/80 to-transparent pb-3 pt-9 text-center">
          <p className="eyebrow text-element">Four elements · one passage</p>
          <p className="mt-1 text-sm text-muted">Twenty berries wake the gate.</p>
        </div>
      </div>
      <div className="p-6">
        <p className="text-sm leading-relaxed text-muted">
          The offering is paid once when the hunt opens. Searching, fighting and returning are
          included; a defeated wild companion may then be bound with a 1–5 Rune bid.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {HUNT_BERRY_IDS.map((item) => {
            const need = costs[item] ?? 5;
            const held = inventory[item] ?? 0;
            const enough = held >= need;
            return (
              <div key={item} className={cx(
                'border bg-raised/55 p-3 text-center',
                enough ? 'border-element/20' : 'border-bad/45',
              )}>
                <div className="mx-auto grid h-10 w-10 place-items-center">
                  {ITEM_ART[item]
                    ? <img src={ITEM_ART[item]} alt="" className="h-9 w-9 object-contain" />
                    : <Berry className="h-6 w-6" />}
                </div>
                <p className="mt-2 text-xs font-medium">{ITEM_NAME[item]}</p>
                <p className={cx('mt-1 font-mono text-[11px]', enough ? 'text-good' : 'text-bad')}>
                  {held} held · {need} offered
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-edge/60 pt-4">
          <p className="max-w-sm text-xs leading-relaxed text-faint">
            The process checks all four balances before spending any. A refused entry keeps the
            complete offering, and retrying the same opening never charges twice.
          </p>
          <div className="flex gap-2">
            <Button variant="quiet" disabled={busy} onClick={onClose}>Keep the berries</Button>
            <Button variant="primary" busy={busy} disabled={!canPay || busy} onClick={onConfirm}>
              Offer 20 · enter
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * One number and the thing it is measured in.
 *
 * `short` marks a cost the player cannot currently pay, so the tally itself
 * says which one is missing — the reason line names it, but the red icon is
 * what the eye finds first.
 */
type Tally = { icon: React.ReactNode; value: string; title: string; short?: boolean };

/** Real item art where the game has it, the item's own icon where it does not. */
function ItemIcon({ id }: { id: ItemId }) {
  const src = ITEM_ART[id];
  return src
    ? <img src={src} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />
    : <Berry className="h-3.5 w-3.5 shrink-0" />;
}

function Chip({ icon, value, title, tone }: Tally & { tone: string }) {
  return (
    <span className={cx('flex items-center gap-1', tone)} title={title}>
      {icon}
      {value}
    </span>
  );
}

function ActivityCard({
  icon, slot, carved, onHover,
  title, costs, gains, reason, away, action, busy, disabled, onClick,
}: {
  icon: React.ReactNode;
  /** The box the turning token stands in — see `useActivityRunes`. */
  slot?: (el: HTMLElement | null) => void;
  /** True once a token is actually rendering there, so the flat icon steps aside. */
  carved?: boolean;
  onHover?: (on: boolean) => void;
  title: string;
  costs: Tally[];
  gains: Tally[];
  /** Why it cannot be done right now, if it cannot. Replaces the gains. */
  reason?: string | null;
  /** Blocked by the companion being elsewhere, which the heading already says. */
  away?: boolean;
  /** The accessible name for the whole card, since the card is the control. */
  action: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={action}
      aria-label={action}
      disabled={disabled || busy}
      onClick={onClick}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
      className={cx(
        // The card IS the button. A rectangle with a name, a price and a
        // button inside it is two targets for one action, and the small one
        // was the only one that worked — so the small one is gone and the
        // whole plate takes the click.
        // Ends, not centre: the three cards carry different numbers of
        // tallies, and centring each one's own content put three names at
        // three heights on one line of the page.
        'group flex min-h-0 flex-col justify-between gap-2.5 text-left',
        'rounded-[3px] border border-edge/60 bg-void/25 px-3 py-3',
        'transition-[border-color,background-color,opacity]',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-element',
        (disabled || away)
          ? 'cursor-not-allowed opacity-60'
          : 'hover:border-element/45 hover:bg-element/[0.06] active:translate-y-px',
      )}
    >
      <div className="flex items-center gap-2.5">
        {/* The token's plinth. It keeps its size whether the stone is there or
            not, so the card does not shift by 6px when three.js finishes
            loading. */}
        <span
          ref={slot}
          className="relative grid h-10 w-10 shrink-0 place-items-center text-element"
        >
          <span className={cx('transition-opacity duration-500', carved && 'opacity-0')}>
            {icon}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {/* The only thing the vanished button still had to say. */}
        {busy
          ? <Spinner className="h-4 w-4 shrink-0 text-element" />
          : (
            <Arrow
              className={cx(
                'h-4 w-4 shrink-0 text-faint/50 transition-[color,transform]',
                !(disabled || away) && 'group-hover:translate-x-0.5 group-hover:text-element',
              )}
            />
          )}
      </div>

      {/* A ledger, not a sentence: what it takes on the left, what it returns
          on the right, the arrow between them. They used to run together as one
          wrapping line, so Quest — four costs and two rewards — broke wherever
          the width happened to fall and put half its rewards on the row under
          its costs. Given two columns to break inside, each side wraps within
          itself and the arrow stays the divide. */}
      <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] tabular-nums">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {costs.map((c) => (
            <Chip key={c.title} {...c} tone={c.short ? 'text-bad' : 'text-faint'} />
          ))}
        </div>

        <Arrow className="h-3 w-3 shrink-0 text-faint/40" />

        {reason ? (
          // The reason takes the rewards' side rather than a line of its own:
          // what you would get out of it is not the question while you cannot
          // pay for it, and a line of prose per card is how this panel got tall.
          <div className="flex min-w-0 flex-1 justify-end text-right">
            <span className="font-sans text-[11px] text-warn">{reason}</span>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {gains.map((g) => (
              <Chip key={g.title} {...g} tone="text-good" />
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

/** A live countdown, with the claim button appearing the moment it is due. */
function InProgress({
  monster,
  onClaim,
}: {
  monster: Monster;
  onClaim: (receipt: ActivityReceipt) => void;
}) {
  const { run, isPending } = useGame();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = monster.status.until_time - now;
  const total = Math.max(1, monster.status.until_time - monster.status.since);
  const done = remaining <= 0;
  const label = monster.status.type === 'Play' ? 'Playing' : 'On a quest';
  const activityKind = monster.status.type as ActivityReceipt['kind'];

  const bringHome = async () => {
    const reply = await run(
      `claim:${monster.id}`,
      () => api.claim(monster.id),
      activityKind === 'Play' ? 'Back home, and happier for it.'
        : 'Back from the quest with loot.',
    );
    if (!reply) return;
    onClaim({
      id: `${activityKind}:${monster.status.since}:${Date.now()}`,
      kind: activityKind,
      rewards: { ...(reply.rewards ?? {}) },
    });
  };

  return (
    <Panel className="shrink-0 p-4">
      <SectionTitle right={<StatusBadge monster={monster} />}>{label}</SectionTitle>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <Bar
            name={`${label} progress`}
            value={total - Math.max(0, remaining)} max={total}
            right={done ? 'Ready' : countdown(remaining)}
            label={done ? 'Finished' : 'Time remaining'}
          />
        </div>
        <Button
          variant={done ? 'primary' : 'ghost'}
          disabled={!done}
          busy={isPending(`claim:${monster.id}`)}
          onClick={() => { void bringHome(); }}
          icon={done ? <Gift className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        >
          {done ? 'Bring them home' : countdown(remaining)}
        </Button>
      </div>
      {!done && (
        <p className="mt-3 text-[13px] text-faint">
          <span className="text-muted">{monster.name}</span>{' '}
          {monster.status.type === 'Play'
            ? 'will keep playing until it is time to come home.'
            : 'holds the realm activity slot until the quest is claimed.'}{' '}
          The clock is the chain's, so closing this page changes nothing.
        </p>
      )}
    </Panel>
  );
}

// Level up ------------------------------------------------------------------

/**
 * The allocation rule, from the process rather than from here.
 *
 * These were hardcoded as 10 and 5, which is the drift `Catalog.levelUp` exists
 * to prevent: the cap moved to three and a hardcoded dialog would have kept
 * offering an allocation the process now refuses. The constants remain as the
 * fallback for a deployment that predates the catalog key.
 */
const FALLBACK_TOTAL_POINTS = 10;
const FALLBACK_MAX_PER_STAT = 5;

/**
 * Every point must be spent, and no more than the cap into any one stat — the
 * process enforces exactly that, so the dialog does too rather than letting
 * someone submit an allocation that will be refused.
 */
function LevelUpDialog({ monster, onClose }: { monster: Monster; onClose: () => void }) {
  const { run, isPending, catalog } = useGame();
  const TOTAL_POINTS = catalog?.levelUp?.points ?? FALLBACK_TOTAL_POINTS;
  const MAX_PER_STAT = catalog?.levelUp?.maxPerStat ?? FALLBACK_MAX_PER_STAT;
  const [points, setPoints] = useState({ attack: 0, defense: 0, speed: 0, health: 0 });
  const spent = points.attack + points.defense + points.speed + points.health;
  const left = TOTAL_POINTS - spent;

  const adjust = (key: keyof typeof points, delta: number) => {
    setPoints((p) => {
      const next = p[key] + delta;
      if (next < 0 || next > MAX_PER_STAT) return p;
      // Recompute what is left from `p`, not from the render closure — reading
      // `left` here meant two fast clicks could both see the same stale value
      // and overspend.
      const spentNow = p.attack + p.defense + p.speed + p.health;
      if (delta > 0 && spentNow >= TOTAL_POINTS) return p;
      return { ...p, [key]: next };
    });
  };

  const rows = [
    { key: 'attack' as const, label: 'Attack', icon: <Sword className="h-4 w-4" />, current: monster.attack },
    { key: 'defense' as const, label: 'Defense', icon: <Shield className="h-4 w-4" />, current: monster.defense },
    { key: 'speed' as const, label: 'Speed', icon: <Bolt className="h-4 w-4" />, current: monster.speed },
    { key: 'health' as const, label: 'Health', icon: <Heart className="h-4 w-4" />, current: monster.health },
  ];

  const submit = async () => {
    const reply = await run('levelup', () => api.levelUp(points),
      `${monster.name} reached level ${monster.level + 1}.`);
    if (reply) onClose();
  };

  return (
    <Dialog
      title={`Level ${monster.level} → ${monster.level + 1}`}
      onClose={onClose}
      busy={isPending('levelup')}
      element={monster.elementType}
    >
      <p className="mt-1.5 text-sm text-muted">
          Spend all ten points. At most five into any one stat.
        </p>

        <div className="mt-5 space-y-2.5">
          {rows.map(({ key, label, icon, current }) => (
            <div key={key} className="flex items-center gap-3 rounded-[3px] border border-edge/60 bg-void/25 p-3">
              <span className="text-element">{icon}</span>
              <span className="flex-1 text-sm">{label}</span>
              <span className="font-mono text-sm tabular-nums text-faint">
                {current}
                {points[key] > 0 && <span className="text-good"> +{points[key]}</span>}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="quiet" onClick={() => adjust(key, -1)}
                        disabled={points[key] === 0} aria-label={`Less ${label}`}>−</Button>
                <span className="w-6 text-center font-mono text-sm tabular-nums">{points[key]}</span>
                <Button size="sm" variant="quiet" onClick={() => adjust(key, 1)}
                        disabled={left === 0 || points[key] === MAX_PER_STAT}
                        aria-label={`More ${label}`}>+</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className={left === 0 ? 'text-good' : 'text-muted'}>
            {left === 0 ? 'All points spent' : `${left} point${left === 1 ? '' : 's'} left`}
          </span>
          <Button size="sm" variant="quiet"
                  onClick={() => setPoints({ attack: 0, defense: 0, speed: 0, health: 0 })}>
            Reset
          </Button>
        </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={left !== 0} busy={isPending('levelup')}
                onClick={submit}>
          Confirm
        </Button>
      </div>
    </Dialog>
  );
}
