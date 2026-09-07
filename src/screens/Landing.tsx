/**
 * The public front door.
 *
 * This page sells the feeling of Rune Realm first: the living world, the
 * companion cards, and the conflict. The longer chronicle lives at /lore and
 * is deliberately not linked while that canon is still being shaped.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function Landing() {
  return (
    <div className="landing-shell">
      <Hero />
      <CompanionShowcase />
      <AltarShowcase />
      <VaultShowcase />
      <FinalCall />
    </div>
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

  const ready = !!player?.unlocked;
  /** Connected, allowed in, and has never sworn. The onboarding case. */
  const needsFaction = ready && !player!.faction;
  const destination = !ready ? null : player!.faction ? '/companion' : '/factions';

  /*
    Arriving at the hall for the first time is an introduction.

    A player with no faction has never seen these four, so the hall fills itself
    in — one altar at a time, left to right, then the companions — before it
    hands over the choice. It rides on the navigation and only from here: coming
    to the same screen from the nav, or with a faction already sworn, walks into
    a room that is already standing. See `Factions`.
  */
  const go = (to: string) => navigate(to, needsFaction ? { state: { intro: true } } : undefined);

  return { destination, needsFaction, go };
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
  const { needsFaction, go } = useEntry();

  if (needsFaction) {
    return (
      <button type="button" className="landing-secondary-link" onClick={() => go('/factions')}>
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
  const { destination, go } = useEntry();
  const [entering, setEntering] = useState(false);

  // The hand-off waits for the record, not for the wallet: an address arrives
  // milliseconds after the signature and the account read takes seconds, and
  // navigating on the address alone would guess the destination wrong.
  useEffect(() => {
    if (!entering || !destination) return;
    setEntering(false);
    go(destination);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entering, destination]);

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
      onClick={() => go(player.faction ? '/companion' : '/factions')}
      icon={<Arrow className="h-4 w-4" />}
    >
      {label}
    </Button>
  );
}
