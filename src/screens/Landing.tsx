/**
 * The public front door.
 *
 * This page sells the feeling of Rune Realm first: the living world, the
 * companion cards, and the conflict. The longer chronicle lives at /lore and
 * is deliberately not linked while that canon is still being shaped.
 */
import {
  createContext, lazy, Suspense, useContext, useEffect, useRef, useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGame } from '../state/gameContext';
import { Element, ItemId, Monster, Move } from '../lib/types';
import { Button, cx } from '../ui/primitives';
import {
  Arrow,
  ELEMENT_ICON,
  Lock,
  Wallet,
} from '../ui/icons';
import { Mark } from '../ui/Mark';
import { CardPreview } from '../ui/CardPreview';
import { ScrollReveal } from '../ui/ScrollReveal';
import { FactionChoice } from './Factions';

const RealmVista = lazy(() => import('../ui/RealmVista'));
const Monolith = lazy(() => import('../ui/Monolith'));
const LandingAltars = lazy(() => import('../ui/LandingAltars'));
const LandingVault = lazy(() => import('../ui/LandingVault'));

type Showcase = {
  element: Element;
  faction: string;
  name: string;
  level: number;
  stats: [number, number, number, number];
  /**
   * Three, and the first is the species' own `basicMove` from the monster
   * index — that slot is guaranteed by `Battle.rollMoves`, so a showcase card
   * whose first move is not the species signature is showing a companion the
   * game cannot issue.
   */
  moves: [string, string, string];
};

const SHOWCASE: Showcase[] = [
  {
    element: 'air',
    faction: 'Sky Nomads',
    name: 'Airbud',
    level: 12,
    stats: [25, 18, 31, 68],
    moves: ['Wind Slash', 'Tornado', 'Regenerate'],
  },
  {
    element: 'water',
    faction: 'Aqua Guardians',
    name: 'WaterDoge',
    level: 9,
    stats: [22, 27, 20, 76],
    moves: ['Whirlpool', 'Tidal Wave', 'Iron Skin'],
  },
  {
    element: 'fire',
    faction: 'Inferno Blades',
    name: 'FireFox',
    level: 16,
    stats: [34, 19, 28, 71],
    moves: ['Scorching Ash', 'Firenado', 'Recovery'],
  },
  {
    element: 'rock',
    faction: 'Stone Titans',
    name: 'Rockpup',
    level: 14,
    stats: [29, 35, 16, 88],
    moves: ['Boulder Crush', 'Earth Shield', 'Life Surge'],
  },
];

const BERRIES: Record<Element, ItemId> = {
  air: 'air_berry',
  water: 'water_berry',
  fire: 'fire_berry',
  rock: 'rock_berry',
};

function exampleMove(type: Move['type']): Move {
  return {
    type,
    rarity: 2,
    count: 2,
    damage: type === 'heal' || type === 'boost' ? 0 : 4,
    attack: type === 'boost' ? 3 : 1,
    speed: 1,
    defense: type === 'heal' ? 2 : 0,
    health: type === 'heal' ? 6 : 0,
  };
}

function exampleMonster(record: Showcase): Monster {
  const [attack, defense, speed, health] = record.stats;
  const art = { fire: 'Fire', water: 'Water', air: 'Air', rock: 'Earth' }[record.element];
  return {
    // An exhibition creature, not one the process issued: the id says so rather
    // than borrowing a shape that looks like a real companion's.
    id: `example-${record.element}`,
    name: record.name,
    image: '',
    sprite: '',
    holographic: true,
    background: art,
    border: art,
    faction: record.faction,
    elementType: record.element,
    berryItem: BERRIES[record.element],
    attack,
    defense,
    speed,
    health,
    energy: 84,
    happiness: 91,
    level: record.level,
    exp: 62,
    nextLevelExp: 100,
    totalTimesFed: 18,
    totalTimesPlay: 27,
    totalTimesQuest: 11,
    moves: Object.fromEntries(record.moves.map((name, index) => [
      name,
      exampleMove(index < 2 ? record.element : index === 2 ? 'boost' : 'heal'),
    ])),
    status: { type: 'Home', since: 0, until_time: 0 },
    bornAt: 0,
  };
}

/**
 * How the faction hall is opened from here.
 *
 * The two controls that can open it — the button and the quiet link beside it
 * — are several levels down, and a context is the cheapest way to hand them
 * the switch without threading a prop through four layouts that do not care.
 */
const OpenChoice = createContext<() => void>(() => {});

/**
 * The hall is a SEARCH PARAM on the front page, not a component's `useState`.
 *
 * It stayed a page — `/` is still the only address involved, so the shell
 * still treats it as public and none of the game's chrome appears — but the
 * step is now something the URL knows about, and that buys the two things
 * local state could not:
 *
 *   - the wordmark works. It is a link to `/`, and from a hall held in
 *     component state that is a navigation to the page you are already on:
 *     nothing changes, the state survives, and the one control in the header
 *     does nothing when clicked. Clearing the search is a real navigation.
 *   - back works, for the same reason.
 *
 * Not a route, though. A route would need its own entry in `main.tsx` and its
 * own line in the gate, and it would be an address a half-onboarded wallet
 * could be sent to, typed at, or bounced out of — see the note on `Landing`.
 */
const CHOOSE = 'choose';

/**
 * The front page — and, once you ask for it, the faction hall.
 *
 * Everyone sees the same page first: the visitor with no wallet, the wallet
 * the process has never heard of, the member who has not sworn, and the player
 * coming back to the front door. It is the one thing on the site that explains
 * what the site is, and skipping past it for somebody mid-onboarding meant a
 * player who connected a wallet never saw the game they were joining.
 *
 * Choosing a faction then happens IN this page rather than at a route of its
 * own, and that is not a layout preference:
 *
 *   - the shell treats `/` as public, so the nav, the rune count, the offering
 *     and the walkthrough are absent by construction rather than by four more
 *     conditions. A player who has not joined the game is not shown the game's
 *     furniture — a rune count reading zero is not information, it is a
 *     question the player cannot answer yet;
 *   - every OTHER route in the app requires an oath (see `main.tsx`), so there
 *     is no second address the half-onboarded state can be reached at, typed
 *     at, or bounced out of.
 *
 * The hall closes itself by leaving: swearing ends on `/companion`. The flag
 * is dropped if the wallet stops qualifying underneath it — a disconnect
 * mid-choice puts the front page back rather than leaving a hall nobody is
 * standing in.
 */
export default function Landing() {
  const { member } = useGame();
  const { search } = useLocation();
  const navigate = useNavigate();
  const choosing = new URLSearchParams(search).get(CHOOSE) === '1';

  /*
    Open until the hall itself leaves — and deliberately NOT `&& !sworn`.

    Swearing happens inside the hall, and the reveal that follows it is the
    payoff for the one irreversible decision in the game: the oath lands, the
    companion is named, and the player watches it arrive before being handed
    to `/companion`. Tying the hall's life to "has not sworn" tore it down at
    exactly that moment — the reply set the faction, this line went false, the
    hall unmounted mid-write, and the player was dropped back on the marketing
    page with no idea what had just happened to them.

    So the hall owns the page from the moment it opens, and closes itself by
    navigating: to `/companion` when the reveal finishes, or to `/` when the
    wordmark is clicked. The only other way to this URL is typing it, and a
    sworn player who does gets a hall that will not swear them again
    (`canJoin` in `Factions`) — a curiosity, not a state to defend against.
  */
  if (choosing && member) return <FactionChoice />;

  return (
    /*
      The oath is an ARRIVAL at the hall, and the hall introduces itself to
      somebody arriving — one altar at a time, left to right, then the
      companions. That beat rides on the navigation, exactly as it does when a
      sworn player is sent to `/factions` from elsewhere, and it is consumed on
      arrival so a reload is not a second first time. See `Hall` in
      `screens/Factions.tsx`.
    */
    <OpenChoice.Provider value={() => navigate(`/?${CHOOSE}=1`, { state: { intro: true } })}>
      <div className="landing-shell">
        <Hero />
        <CompanionShowcase />
        <AltarShowcase />
        <VaultShowcase />
        <FinalCall />
      </div>
    </OpenChoice.Provider>
  );
}

function Hero() {
  const { player } = useGame();
  return (
    <section className="landing-hero">
      <div className="hero-vignette" aria-hidden />
      <Suspense fallback={<HeroFallback />}>
        <RealmVista />
      </Suspense>
      <div className="hero-monolith">
        <Suspense fallback={<HeroMarkFallback />}>
          <Monolith element="arcane" size={620} />
        </Suspense>
      </div>

      <div className="landing-hero-content relative z-10 mx-auto flex min-h-[calc(100svh-65px)] max-w-[92rem] items-end px-5 pb-14 pt-24 sm:px-8 sm:pb-20 lg:items-center lg:px-10 lg:py-24">
        <div className="max-w-2xl animate-rise">
          <div className="mb-6 flex items-center gap-3">
            <span className="signal-pulse" />
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-rune/85">
              Four factions. One companion.
            </p>
          </div>
          <h1 className="hero-title">
            Choose your <span>element.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Raise a companion. Battle for the Realm.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <EntryButton />
            <HeroSecondary />
          </div>
          {player?.monster && (
            <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-element">
              Your mark is active
            </p>
          )}
        </div>
      </div>

      <a href="#companions" aria-label="Continue to the companion cards" className="hero-scroll">
        <span>Explore</span>
        <span className="hero-scroll-line" />
      </a>
    </section>
  );
}

function HeroFallback() {
  return (
    <div className="hero-field-fallback" aria-hidden />
  );
}

function HeroMarkFallback() {
  return (
    <div className="hero-mark-fallback" role="img" aria-label="Rune Realm">
      <span className="hero-mark-orbit hero-mark-orbit-outer" aria-hidden />
      <span className="hero-mark-orbit hero-mark-orbit-inner" aria-hidden />
      <Mark size={230} glow className="hero-mark-awakening" />
    </div>
  );
}

function CompanionShowcase() {
  return (
    <section id="companions" className="landing-section landing-showcase">
      <div className="showcase-beam" aria-hidden />
      <div className="relative mx-auto max-w-[84rem] px-5 sm:px-8">
        <ScrollReveal className="grid items-end gap-8 lg:grid-cols-[1fr_0.8fr]">
          <div className="max-w-3xl">
            <p className="landing-kicker">Your companion</p>
            <h2 className="landing-title mt-5">Choose one. Raise it. Make it yours.</h2>
          </div>
          <p className="max-w-lg text-base leading-7 text-muted lg:justify-self-end lg:text-right">
            Raise it, battle, relearn its moves as it levels, and mint its card.
          </p>
        </ScrollReveal>

        <div className="monster-card-stage mt-14">
          {SHOWCASE.map((record, index) => (
            <ShowcaseCard key={record.element} record={record} index={index} />
          ))}
        </div>

      </div>
    </section>
  );
}

function AltarShowcase() {
  return (
    <section className="landing-section landing-altars-section">
      <ScrollReveal className="relative z-10 mx-auto grid max-w-6xl items-end gap-7 px-5 sm:px-8 lg:grid-cols-[1fr_0.7fr]">
        <div className="max-w-3xl">
          <p className="landing-kicker">Choose a faction</p>
          <h2 className="landing-title mt-5">Swear to an element.</h2>
        </div>
        <p className="max-w-md text-base leading-7 text-muted lg:justify-self-end lg:text-right">
          Your faction determines your first companion and community.
        </p>
      </ScrollReveal>

      <DeferredScene className="mt-8 min-h-[38rem]" fallback={<SceneFallback label="Loading altars" />}>
        <Suspense fallback={<SceneFallback label="Loading altars" />}>
          <LandingAltars />
        </Suspense>
      </DeferredScene>

      <p className="relative z-10 mx-auto -mt-10 max-w-6xl px-5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-faint sm:px-8">
        Preview only — no choice is saved
      </p>
    </section>
  );
}

function VaultShowcase() {
  return (
    <section className="landing-section landing-vault-section">
      <div className="vault-section-glow" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <ScrollReveal className="grid items-end gap-7 lg:grid-cols-[0.78fr_1.22fr]">
          <div>
            <p className="landing-kicker">Battle rewards</p>
            <h2 className="landing-title mt-5">Open what you earn.</h2>
          </div>
          <p className="max-w-xl text-base leading-7 text-muted lg:justify-self-end lg:text-right">
            Preview the loot ceremony at each rarity.
          </p>
        </ScrollReveal>

        <DeferredScene className="mt-10 min-h-[34rem]" fallback={<SceneFallback label="Loading vault" />}>
          <Suspense fallback={<SceneFallback label="Loading vault" />}>
            <LandingVault />
          </Suspense>
        </DeferredScene>
      </div>
    </section>
  );
}

function DeferredScene({
  children,
  fallback,
  className,
}: {
  children: React.ReactNode;
  fallback: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || ready) return;
    if (!('IntersectionObserver' in window)) {
      setReady(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setReady(true);
      observer.disconnect();
    }, { rootMargin: '420px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);

  return <div ref={ref} className={className}>{ready ? children : fallback}</div>;
}

function SceneFallback({ label }: { label: string }) {
  return (
    <div className="scene-fallback">
      <Mark size={96} glow />
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-rune/70">{label}</p>
    </div>
  );
}

function ShowcaseCard({ record, index }: { record: Showcase; index: number }) {
  const Icon = ELEMENT_ICON[record.element];
  const monster = exampleMonster(record);
  return (
    <ScrollReveal
      data-element={record.element}
      delay={index}
      className={cx('showcase-card', `showcase-card-${index + 1}`)}
    >
      <div className="showcase-card-object">
        <div className="showcase-card-glow" aria-hidden />
        <CardPreview monster={monster} eager className="relative z-10 w-full" />
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-element/20 pt-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-element">{record.faction}</p>
          <p className="mt-1 text-sm font-medium">{record.name}</p>
        </div>
        <div className="flex items-center gap-2 text-element">
          <Icon className="h-4 w-4" />
          <span className="font-mono text-[11px]">LV {record.level}</span>
        </div>
      </div>
    </ScrollReveal>
  );
}

function FinalCall() {
  const { address, player, publicAccess } = useGame();
  return (
    <section id="entry" className="landing-final">
      <div className="landing-final-mark" aria-hidden><Mark size={420} /></div>
      <ScrollReveal className="relative z-10 mx-auto max-w-3xl px-5 text-center sm:px-8">
        <p className="landing-kicker">Ready?</p>
        <h2 className="landing-title mx-auto mt-5 max-w-2xl">Enter Rune Realm.</h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted">
          {publicAccess
            ? 'Connect a wallet or create one here. You’ll choose a faction next.'
            : address && player && !player.unlocked
            ? 'This wallet has no Eternal Pass. If yours was lost in migration, send the wallet address to the team.'
            : 'Connect the wallet linked to your Eternal Pass.'}
        </p>
        <div className="mt-9 flex justify-center"><EntryButton /></div>
      </ScrollReveal>
    </section>
  );
}

/**
 * Where this player goes next, and whether the hall should introduce itself.
 *
 * Shared by the button and the link beside it, because the two standing next to
 * each other saying different things is the exact confusion the first mile is
 * supposed to remove. Null while the record is unknown: the answer is not "the
 * faction hall" until the account has actually been read.
 */
function useEntry() {
  const { player } = useGame();
  const navigate = useNavigate();
  const openChoice = useContext(OpenChoice);

  /** The account has been read and it is allowed in. */
  const ready = !!player?.unlocked;
  /** Connected, allowed in, and has never sworn. The onboarding case. */
  const needsFaction = ready && !player!.faction;

  /*
    Do the next thing — and note that the next thing is not always a page.

    With no faction sworn it is the hall, which opens HERE, over the front page.
    It used to be a route, and putting it back on one would bring the game's
    chrome with it; see the note on `Landing`. With a faction it is the
    companion, which is a page like any other.
  */
  const enter = () => {
    if (needsFaction) openChoice();
    else if (ready && player!.faction) navigate('/companion');
  };

  return { ready, needsFaction, enter };
}

/**
 * The quiet link beside the button.
 *
 * It is the second thing on the page and it should not be advertising the
 * companion cards to somebody the game is currently waiting on. With no faction
 * sworn there is exactly one thing to do, and both controls say so — this one
 * as the calm way in, since not everybody clicks the loud button.
 */
function HeroSecondary() {
  const { needsFaction, enter } = useEntry();

  if (needsFaction) {
    return (
      <button type="button" className="landing-secondary-link" onClick={enter}>
        Pick a faction <Arrow className="h-4 w-4" />
      </button>
    );
  }

  return (
    <a href="#companions" className="landing-secondary-link">
      See the companions <Arrow className="h-4 w-4" />
    </a>
  );
}

/**
 * The one button on the front page, and the whole of the first mile.
 *
 * It is a state readout, not a link: whatever it says is the next thing the
 * player actually has to do, and pressing it does that thing. A wallet with no
 * faction is offered the faction hall, not a companion screen that would only
 * bounce it back there; a wallet with no companion is offered the room where
 * one is claimed; only a player with a companion is offered a return to it.
 *
 * Connecting is armed here rather than in the provider on purpose. Pressing
 * THIS button says "I want to be playing", so the wallet handshake hands off
 * straight into onboarding. Connecting from the header says nothing of the
 * kind, and yanking somebody off the page they were reading would be a bug.
 */
function EntryButton() {
  const {
    address,
    connect,
    connecting,
    player,
    loadingPlayer,
    loginError,
    refresh,
  } = useGame();
  const { ready, enter } = useEntry();
  const [entering, setEntering] = useState(false);

  // The hand-off waits for the RECORD, not for the wallet: an address arrives
  // milliseconds after the signature and the account read takes seconds, and
  // acting on the address alone would guess the next step wrong — the hall and
  // the companion are two different answers to the same click.
  useEffect(() => {
    if (!entering || !ready) return;
    setEntering(false);
    enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering, ready]);

  if (!address) {
    return (
      <Button
        size="lg"
        variant="primary"
        busy={connecting}
        onClick={() => { setEntering(true); void connect(); }}
        icon={<Wallet className="h-4 w-4" />}
      >
        Connect and play now
      </Button>
    );
  }

  // A read that failed is not a read that is still running. Without this the
  // button spins on a network error for as long as the page is open, with no
  // way back other than a reload.
  if (!player && loginError) {
    return (
      <Button size="lg" variant="primary" onClick={() => void refresh()}>
        The realm did not answer — try again
      </Button>
    );
  }

  if (loadingPlayer || !player) {
    return <Button size="lg" variant="primary" busy>Reading your mark</Button>;
  }

  if (!player.unlocked) {
    return (
      <Button
        size="lg"
        variant="ghost"
        onClick={() => document.getElementById('entry')?.scrollIntoView({ behavior: 'smooth' })}
        icon={<Lock className="h-4 w-4" />}
      >
        Eternal Pass required
      </Button>
    );
  }

  /*
    Three connected states, and the label names the one thing left to do in
    each. A reload in the middle of onboarding lands back on the same rung.

    The faction is asked about FIRST, and that is not a style choice: a record
    can carry a companion with no oath behind it — a legacy recovery does
    exactly that — and keying the label on the monster sent that player to the
    faction hall under a button that said "go to your companion".
  */
  const label = !player.faction
    ? 'Choose a faction'
    : player.monster
    ? 'Go to your companion'
    : 'Claim your companion';
  return (
    <Button
      size="lg"
      variant="primary"
      onClick={enter}
      icon={<Arrow className="h-4 w-4" />}
    >
      {label}
    </Button>
  );
}
