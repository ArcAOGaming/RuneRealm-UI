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
import { Link, Navigate } from 'react-router-dom';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import { ItemId, Monster, Player } from '../lib/types';
import {
  Bar, Button, Panel, SectionTitle, Skeleton, Spinner, cx,
} from '../ui/primitives';
import {
  Arrow, Berry, Bolt, Clock, Gift, GLYPH_PATH, Heart, Map, Rune, Shield, Sparkle, Sword,
} from '../ui/icons';
import {
  BERRY_FOR, countdown, ELEMENT_LABEL, ITEM_NAME,
} from '../lib/format';
import { StatusBadge } from '../ui/MonsterCard';
import { Dialog } from '../ui/Dialog';
import { Sigil } from '../ui/Sigil';
import { Room } from '../ui/Room';
import { ArenaPeek } from '../ui/ArenaPeek';
import { SatchelDrawer } from '../ui/Satchel';
import { MintButton, MintPanel } from '../ui/MintPanel';
// three.js, so it arrives when somebody actually picks the card up.
const CardViewer = lazy(() => import('../ui/CardViewer'));
import { ITEM_ART, portrait } from '../ui/art';
import { CardPreview } from '../ui/CardPreview';
import type { ActivityRunes, RuneState } from '../gfx/activityRunes';

export default function Companion() {
  const { player, loadingPlayer, address } = useGame();

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

  // A minted companion leaves the game, so an empty slot is no longer the same
  // thing as a new player. Adoption still comes first, but the vault has to
  // stay reachable — otherwise pulling a companion out would hide the asset
  // that proves you own it.
  if (!player.monster) {
    const holding = Boolean(player.mint) || Object.keys(player.assets ?? {}).length > 0;
    return (
      <div className="animate-rise space-y-4">
        <Adopt />
        {holding && <div className="mx-auto max-w-md"><MintPanel player={player} /></div>}
      </div>
    );
  }

  // The vault is only worth a panel once there is something in it. An empty
  // "Nothing minted yet" box sat under the companion on every screen of every
  // player who had never minted, which is most of them.
  const minted = Object.keys(player.assets ?? {}).length > 0;

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
    <div className="companion-screen animate-rise flex min-h-0 flex-1 flex-col">
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
          <div className="relative shrink-0">
            {/* Away at the arena, and there is a fight to look at: show the
                fight. An empty house with a dimmed sprite in it is a picture of
                an absence, and the interesting thing is one click away. */}
            {player.monster.status.type === 'Battle' && player.battle ? (
              <ArenaPeek battle={player.battle} address={address} />
            ) : (
              <Room monster={player.monster} />
            )}
            <div className="pointer-events-none absolute right-3 top-3">
              <StatusBadge monster={player.monster} />
            </div>
          </div>
          <Activities />
        </div>
        <div className="companion-card-column flex min-h-0 flex-col gap-3">
          <CompanionCard monster={player.monster} player={player} />
          {/* Capped and scrolled inside itself. The vault is a list that grows
              with every mint, and left free it would take the height off the
              card — which is the thing the page is for. */}
          {minted && (
            <div className="max-h-[34%] shrink-0 overflow-y-auto">
              <MintPanel player={player} />
            </div>
          )}
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
            src={portrait(faction.element)} alt=""
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

// The card ------------------------------------------------------------------

function CompanionCard({ monster, player }: { monster: Monster; player: Player }) {
  const canLevel = monster.exp >= monster.nextLevelExp;
  const [allocating, setAllocating] = useState(false);
  const [holding, setHolding] = useState(false);

  return (
    <Panel className="relative flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4" glow>
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
            extended
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

      {/* The things you DO to a companion, together. Minting used to sit in
          its own panel with a second copy of the card above it — which is the
          card that is already on this screen at full size. */}
      <div className="relative mt-3 flex shrink-0 flex-wrap items-center gap-2">
        {canLevel && (
          <Button variant="primary" size="sm" onClick={() => setAllocating(true)}
                  icon={<Sparkle className="h-4 w-4" />}>
            Level up to {monster.level + 1}
          </Button>
        )}
        <MintButton player={player} className="h-8 px-3 text-[13px]" />
        {/* The plain card, as an object. The extended card above is the
            dashboard; this is the thing that gets signed and traded, and it
            is worth being able to pick it up and look at the back of it. */}
        <Button variant="ghost" size="sm" onClick={() => setHolding(true)}
                icon={<Rune className="h-4 w-4" />}>
          Hold the card
        </Button>
        <SatchelDrawer className="h-8 px-3 text-[13px]" />
        {/* The sprite the room is drawing, and the only other page a companion
            owner has any reason to open from here. It used to sit on a line of
            its own above the whole layout, which cost the card thirty pixels
            of height for one link. */}
        <Link
          to="/character"
          className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-[3px] px-2 text-[11px] text-faint transition-colors hover:text-muted lg:h-8"
        >
          <Sparkle className="h-3 w-3" />
          Edit character
        </Link>
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
    </Panel>
  );
}

// Activities ----------------------------------------------------------------


/**
 * The three tokens, mounted over the rows.
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
        glyphs: [GLYPH_PATH.berry, GLYPH_PATH.sparkle, GLYPH_PATH.map],
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
 * The three things you can do, side by side.
 *
 * They began as three cards in a grid, each with an icon row, a labelled COST
 * row, a labelled GAIN row, a reason paragraph and a full-width button — five
 * stacked blocks to say "one berry, twenty energy", and a panel as tall as the
 * companion beside it, spent almost entirely on chrome around six numbers.
 *
 * They are three cards again, but two lines each: the token and the name with
 * the button opposite it, and underneath, what it costs, an arrow, and what it
 * gives. The COST and GAIN labels are gone because an arrow says the same
 * thing in four pixels, and the tallies lost their boxes because three
 * bordered pills inside a bordered card inside a bordered panel is three
 * frames around a number.
 *
 * Across rather than down because the room above them is wide and they are
 * three choices of the same kind: a column makes a list you read in order, and
 * these are not in an order.
 */
function Activities() {
  const { player, run, isPending, busy } = useGame();
  const monster = player!.monster!;
  const kind = monster.status.type;

  if (kind === 'Play' || kind === 'Quest') return <InProgress monster={monster} />;

  // Anything but Home and the process refuses all three. The arena used to get
  // a whole empty state of its own, on a screen where the room behind the
  // companion has already changed to the beach and the badge already reads
  // "In the arena" — three drawings of one fact. It is a note in the heading
  // now, said once rather than once per row.
  const away = kind !== 'Home';

  // A companion only ever eats its own element's berry, so there is nothing to
  // choose: the row states the cost and feeds. The picker that used to sit
  // here offered three buttons that were worth half as much and read as if the
  // wrong one might be right.
  const ownBerry = BERRY_FOR[monster.elementType];
  const berries = player!.inventory[ownBerry] ?? 0;
  const runes = player!.inventory.rune ?? 0;

  const berryIcon = <ItemIcon id={ownBerry} />;
  const energy = <Bolt className="h-3.5 w-3.5 shrink-0" />;
  const happy = <Heart className="h-3.5 w-3.5 shrink-0" />;
  const clock = <Clock className="h-3.5 w-3.5 shrink-0" />;

  const blocked = [
    away || monster.energy >= 100 || berries < 1,
    away || monster.energy < 10 || berries < 1,
    away || runes < 1 || monster.energy < 25 || monster.happiness < 25,
  ];
  const working = [isPending('feed'), isPending('play'), isPending('quest')];

  const [hovered, setHovered] = useState<number | null>(null);
  const { canvas, slots, live } = useActivityRunes(
    monster.elementType,
    blocked.map((no, i) => ({ disabled: no, busy: working[i], hover: hovered === i })),
  );

  // Content height, not "whatever is left". Given `flex-1` this panel took
  // about half the column for three cards and a heading and centred them in it,
  // so the emptiness read as part of the activities rather than as space.
  return (
    <Panel className="flex shrink-0 flex-col px-4 pb-3 pt-2.5">
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
        <div className="relative grid gap-2 sm:grid-cols-3">
        <ActivityCard
          icon={<Berry className="h-4 w-4" />}
          slot={(el) => { slots.current[0] = el; }}
          carved={live}
          onHover={(on) => setHovered(on ? 0 : null)}
          title="Feed"
          costs={[
            { icon: berryIcon, value: '−1', title: ITEM_NAME[ownBerry], short: berries < 1 },
          ]}
          gains={[{ icon: energy, value: '+20', title: 'Energy' }]}
          reason={
            away ? null
              : berries < 1 ? `No ${ITEM_NAME[ownBerry]}`
                : monster.energy >= 100 ? 'Already at full energy' : null
          }
          away={away}
          action="Feed your companion"
          busy={isPending('feed')}
          disabled={busy || away || monster.energy >= 100 || berries < 1}
          onClick={() => run('feed', () => api.feed(ownBerry))}
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
          onClick={() => run('play', api.startPlay, 'Off to play.')}
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
        </div>
      </div>
    </Panel>
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
function InProgress({ monster }: { monster: Monster }) {
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
          busy={isPending('claim')}
          onClick={() => run('claim', api.claim,
            monster.status.type === 'Play' ? 'Back home, and happier for it.'
              : 'Back from the quest with loot.')}
          icon={done ? <Gift className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
        >
          {done ? 'Bring them home' : countdown(remaining)}
        </Button>
      </div>
      {!done && (
        <p className="mt-3 text-[13px] text-faint">
          Nothing to watch — come back when the timer is up. The clock is the
          chain's, not your browser's, so closing this page changes nothing.
        </p>
      )}
    </Panel>
  );
}

// Level up ------------------------------------------------------------------

const TOTAL_POINTS = 10;
const MAX_PER_STAT = 5;

/**
 * Ten points, at most five into any one stat, and all ten must be spent — the
 * process enforces exactly that, so the dialog does too rather than letting
 * someone submit an allocation that will be refused.
 */
function LevelUpDialog({ monster, onClose }: { monster: Monster; onClose: () => void }) {
  const { run, isPending } = useGame();
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
