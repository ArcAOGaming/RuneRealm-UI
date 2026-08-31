/**
 * The public front door.
 *
 * This page sells the feeling of Rune Realm first: the living world, the
 * companion cards, and the conflict. The longer chronicle lives at /lore and
 * is deliberately not linked while that canon is still being shaped.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../state/GameProvider';
import { Element, ItemId, Monster, Move } from '../lib/types';
import { Button, cx } from '../ui/primitives';
import {
  Arrow,
  ELEMENT_ICON,
  Lock,
  Map,
  Sparkle,
  Sword,
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
  moves: [string, string, string, string];
};

const SHOWCASE: Showcase[] = [
  {
    element: 'air',
    faction: 'Sky Nomads',
    name: 'Airbud',
    level: 12,
    stats: [25, 18, 31, 68],
    moves: ['Tornado', 'Breeze', 'Battle Cry', 'Regenerate'],
  },
  {
    element: 'water',
    faction: 'Aqua Guardians',
    name: 'WaterDoge',
    level: 9,
    stats: [22, 27, 20, 76],
    moves: ['Tidal Wave', 'Ocean Mist', 'Iron Skin', 'Heal'],
  },
  {
    element: 'fire',
    faction: 'Inferno Blades',
    name: 'FireFox',
    level: 16,
    stats: [34, 19, 28, 71],
    moves: ['Firenado', 'Flame Shield', 'Power Up', 'Recovery'],
  },
  {
    element: 'rock',
    faction: 'Stone Titans',
    name: 'Rockpup',
    level: 14,
    stats: [29, 35, 16, 88],
    moves: ['Boulder Crush', 'Stone Wall', 'Swift Wind', 'Life Surge'],
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
      <KeyLore />
      <Resistance />
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
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-rune/75">
              The Realm is still alive
            </p>
          </div>
          <h1 className="hero-title">
            The world was never meant to be <span>managed.</span>
          </h1>
          <p className="mt-7 max-w-xl text-[15px] leading-7 text-muted sm:text-lg sm:leading-8">
            Swear to an elemental faction. Defeat wild creatures and call them
            back with runes. Raise a companion strong enough to tear the
            Corporation's order out by the root.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <EntryButton />
            <a href="#companions" className="landing-secondary-link">
              See the companions <Arrow className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            <span>4 factions</span>
            <span>Living companions</span>
            <span>Collectible cards</span>
            {player?.monster && <span className="text-element">Your mark is active</span>}
          </div>
        </div>
      </div>

      <a href="#companions" aria-label="Continue to the companion cards" className="hero-scroll">
        <span>Descend</span>
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
            <p className="landing-kicker">Recovered companions / live card system</p>
            <h2 className="landing-title mt-5">Meet the creatures that chose to return.</h2>
          </div>
          <p className="max-w-lg text-[14px] leading-7 text-muted lg:justify-self-end lg:text-right">
            Every companion carries its element, level, stats and battle moves
            on a card drawn from its living record. These are examples of the
            four first bloodlines waiting beyond the gate.
          </p>
        </ScrollReveal>

        <div className="monster-card-stage mt-14">
          {SHOWCASE.map((record, index) => (
            <ShowcaseCard key={record.element} record={record} index={index} />
          ))}
        </div>

        <ScrollReveal className="mt-12 flex flex-wrap items-center justify-between gap-5 border-t border-rune/10 pt-6" delay={2}>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
            Every victory changes the record
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[9px] uppercase tracking-[0.16em] text-rune/60">
            <span>Raise stats</span>
            <span>Discover moves</span>
            <span>Mint the card</span>
            <span>Carry it into battle</span>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

function AltarShowcase() {
  return (
    <section className="landing-section landing-altars-section">
      <ScrollReveal className="relative z-10 mx-auto grid max-w-6xl items-end gap-7 px-5 sm:px-8 lg:grid-cols-[1fr_0.7fr]">
        <div className="max-w-3xl">
          <p className="landing-kicker">The altar hall / four living currents</p>
          <h2 className="landing-title mt-5">An oath begins where the elements answer.</h2>
        </div>
        <p className="max-w-md text-[14px] leading-7 text-muted lg:justify-self-end lg:text-right">
          Fire strains against its vessel. Water remembers the room around it.
          Air refuses to hold one shape. Stone keeps moving long after it appears still.
        </p>
      </ScrollReveal>

      <DeferredScene className="mt-8 min-h-[38rem]" fallback={<SceneFallback label="The altars are gathering" />}>
        <Suspense fallback={<SceneFallback label="The altars are gathering" />}>
          <LandingAltars />
        </Suspense>
      </DeferredScene>

      <p className="relative z-10 mx-auto -mt-10 max-w-6xl px-5 text-center font-mono text-[9px] uppercase tracking-[0.18em] text-faint sm:px-8">
        Exhibition only / no oath is signed here
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
            <p className="landing-kicker">The vault / reward ceremony</p>
            <h2 className="landing-title mt-5">Some victories should break open.</h2>
          </div>
          <p className="max-w-xl text-[14px] leading-7 text-muted lg:justify-self-end lg:text-right">
            Every chest waits under a rune seal. Watch it strain, split and
            throw its rewards into the room. Change the rarity to wake a
            different color of magic.
          </p>
        </ScrollReveal>

        <DeferredScene className="mt-10 min-h-[34rem]" fallback={<SceneFallback label="The vault is sealing" />}>
          <Suspense fallback={<SceneFallback label="The vault is sealing" />}>
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
      <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.18em] text-rune/50">{label}</p>
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
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-element">{record.faction}</p>
          <p className="mt-1 text-sm font-medium">{record.name}</p>
        </div>
        <div className="flex items-center gap-2 text-element">
          <Icon className="h-4 w-4" />
          <span className="font-mono text-[10px]">LV {record.level}</span>
        </div>
      </div>
    </ScrollReveal>
  );
}

function KeyLore() {
  return (
    <section id="signal" className="landing-section key-lore-section">
      <div className="key-lore-mark" aria-hidden><Mark size={520} /></div>
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <ScrollReveal className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <p className="landing-kicker">Three truths the ledgers cannot erase</p>
            <h2 className="landing-title mt-5">The Realm is still alive.</h2>
            <p className="mt-6 max-w-md text-[15px] leading-7 text-muted">
              Under every measured road and numbered settlement, the old
              currents keep moving. The Corporation can standardize a map. It
              has not learned how to own a living world.
            </p>
          </div>

          <div className="key-lore-list">
            <LoreSignal
              number="01"
              title="The enemy calls control peace."
              body="The Corporation's Alignment turns every road, home and creature into a permission it can revoke. Its machines do not rage. They correct."
            />
            <LoreSignal
              number="02"
              title="A companion is Returned, not taken."
              body="Defeat ends a wild creature's life. A scroll remembers its path; runes open the way back. Loyalty begins after the rite."
            />
            <LoreSignal
              number="03"
              title="Four currents answer. Two remain hidden."
              body="Fire, Water, Air and Stone shape the visible Realm. Light and Dark are neither good nor evil, and their oldest names have been redacted."
            />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

function LoreSignal({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="key-lore-item">
      <span className="font-mono text-[9px] tracking-[0.18em] text-rune/50">{number}</span>
      <div>
        <h3 className="text-xl font-semibold sm:text-2xl">{title}</h3>
        <p className="mt-3 text-[13px] leading-6 text-muted">{body}</p>
      </div>
    </div>
  );
}

function Resistance() {
  return (
    <section id="resistance" className="landing-section border-y border-rune/10 bg-surface/20">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <ScrollReveal className="grid items-end gap-8 md:grid-cols-[1fr_auto]">
          <div className="max-w-2xl">
            <p className="landing-kicker">Beyond the sanctuary</p>
            <h2 className="landing-title mt-5">The arena is training. The Realm is the fight.</h2>
          </div>
          <p className="max-w-md text-[14px] leading-6 text-muted md:text-right">
            Recover routes, creatures and erased names from a machine empire
            that mistakes control for peace.
          </p>
        </ScrollReveal>

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          <WorldCard
            icon={<Map className="h-5 w-5" />}
            label="Open world"
            title="Cross the living lands"
            body="Travel through flooded archives, broken lift roads, wild nests and Corporation territory."
            className="lg:translate-y-8"
          />
          <WorldCard
            icon={<Sparkle className="h-5 w-5" />}
            label="Companions"
            title="Raise what chose to return"
            body="Feed, play, quest and grow together. The rite opens the path; loyalty is everything you do after."
          />
          <WorldCard
            icon={<Sword className="h-5 w-5" />}
            label="Resistance"
            title="Break the Alignment"
            body="Train against other keepers, then carry what you learned against the machines remaking the world."
            className="lg:translate-y-8"
          />
        </div>
      </div>
    </section>
  );
}

function WorldCard({
  icon,
  label,
  title,
  body,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <ScrollReveal className={cx('world-card', className)}>
      <div className="text-element">{icon}</div>
      <p className="mt-8 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">{label}</p>
      <h3 className="mt-3 text-2xl font-semibold">{title}</h3>
      <p className="mt-4 text-[13px] leading-6 text-muted">{body}</p>
    </ScrollReveal>
  );
}

function FinalCall() {
  const { address, player, publicAccess } = useGame();
  return (
    <section id="entry" className="landing-final">
      <div className="landing-final-mark" aria-hidden><Mark size={420} /></div>
      <ScrollReveal className="relative z-10 mx-auto max-w-3xl px-5 text-center sm:px-8">
        <p className="landing-kicker">The gate remembers every mark</p>
        <h2 className="landing-title mx-auto mt-5 max-w-2xl">The Realm is still alive. Enter it.</h2>
        <p className="mx-auto mt-5 max-w-xl text-[14px] leading-7 text-muted">
          {publicAccess
            ? 'The gates are open. Bring an existing wallet or let this browser make your mark, then choose a faction and begin.'
            : address && player && !player.unlocked
            ? 'This wallet has no Eternal Pass. If you held one before the migration, send your wallet address to the team so the record can be restored.'
            : 'Your faction is an oath. Your companion is a responsibility. Every battle leaves a record the Corporation cannot rewrite.'}
        </p>
        <div className="mt-9 flex justify-center"><EntryButton /></div>
      </ScrollReveal>
    </section>
  );
}

function EntryButton() {
  const {
    address,
    connect,
    connecting,
    player,
    loadingPlayer,
  } = useGame();
  const navigate = useNavigate();

  if (!address) {
    return (
      <Button
        size="lg"
        variant="primary"
        busy={connecting}
        onClick={connect}
        icon={<Wallet className="h-4 w-4" />}
      >
        Connect wallet
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

  const destination = player.monster ? '/companion' : '/factions';
  const label = player.monster ? 'Return to your companion' : 'Choose your faction';
  return (
    <Button
      size="lg"
      variant="primary"
      onClick={() => navigate(destination)}
      icon={<Arrow className="h-4 w-4" />}
    >
      {label}
    </Button>
  );
}
