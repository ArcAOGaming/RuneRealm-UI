/**
 * The hidden public chronicle.
 *
 * /lore is intentionally routable but unlinked. It is a place to shape the
 * public telling before it becomes part of the site's navigation.
 */
import { ELEMENT_ICON, Rune } from '../ui/icons';
import { Mark } from '../ui/Mark';
import { portrait } from '../ui/art';
import { Element } from '../lib/types';
import { ScrollReveal } from '../ui/ScrollReveal';

const FACTIONS: Array<{
  element: Element;
  name: string;
  companion: string;
  description: string;
}> = [
  {
    element: 'air',
    name: 'Sky Nomads',
    companion: 'Airbud',
    description: 'They keep no capital the Corporation can seize. Their roads are high bridges, abandoned lift rails and routes that exist for one season.',
  },
  {
    element: 'water',
    name: 'Aqua Guardians',
    companion: 'WaterDoge',
    description: 'They protect springs, flooded archives and the names official records have removed. A door today may be a reservoir tomorrow.',
  },
  {
    element: 'fire',
    name: 'Inferno Blades',
    companion: 'FireFox',
    description: 'They know the difference between destruction and release. One precise flame can free a district without burning what it came to save.',
  },
  {
    element: 'rock',
    name: 'Stone Titans',
    companion: 'Rockpup',
    description: 'They keep vault roads, seed chambers and the foundations of towns removed from maps. Even their retreats leave shelter behind.',
  },
];

export default function Lore() {
  return (
    <article className="lore-page">
      <header className="lore-page-hero">
        <div className="lore-page-seal" aria-hidden><Mark size={560} /></div>
        <div className="relative z-10 mx-auto max-w-5xl px-5 py-28 sm:px-8 sm:py-36">
          <p className="landing-kicker">Recovered chronicle / provenance disputed</p>
          <h1 className="lore-page-title mt-6">The Realm was alive before anyone measured it.</h1>
          <p className="mt-8 max-w-2xl text-base leading-8 text-muted sm:text-lg">
            This is the oldest version that survives: a world of living currents,
            a machine order called the Alignment, and the keepers who refused to
            let either monsters or people become entries in its ledger.
          </p>
        </div>
      </header>

      <LoreChapter eyebrow="I / The first truth" title="The currents learned hunger, fear, loyalty and play.">
        <p>
          Fire moved through root and blood. Water remembered every shape it
          had held. Air carried names farther than roads could carry bodies.
          Stone kept the weight of the dead and did not surrender it.
        </p>
        <p>
          Where those currents crossed, creatures appeared. They were not
          animals with magic laid over them, but pieces of the Realm that had
          learned to live. The old peoples fought them when they had to and
          buried them when they could. They did not number every creature or
          insist that a life became real only after it entered a ledger.
        </p>
      </LoreChapter>

      <LoreChapter eyebrow="II / The Alignment" title="The roads acquired gates. The medicine acquired terms." tone="machine">
        <p>
          No surviving record agrees on the Corporation's first name. It arrived
          as roads, winter light, measured harvests and machines that promised
          safety. Then registered homes could be inspected, relocated or emptied.
        </p>
        <blockquote>
          The Corporation does not call its campaign conquest. It calls it the
          Alignment: the slow conversion of a living world into one legible system.
        </blockquote>
        <p>
          Its machines are Units in official orders and Hollows everywhere else.
          Some were built. Some were once creatures, emptied of their current and
          returned with only useful reflexes. They do not rage. They correct.
        </p>
      </LoreChapter>

      <section className="lore-chapter lore-currents">
        <ScrollReveal className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="landing-kicker">III / The six currents</p>
          <h2 className="landing-title mt-5 max-w-4xl">Four shape the visible world. Two touch it from beyond.</h2>
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FACTIONS.map(({ element, name }) => {
              const Icon = ELEMENT_ICON[element];
              return (
                <div key={element} data-element={element} className="current-tablet">
                  <Icon className="h-5 w-5 text-element" />
                  <p className="mt-10 font-mono text-[9px] uppercase tracking-[0.2em] text-element">{element}</p>
                  <h3 className="mt-2 text-xl font-semibold">{name}</h3>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="hidden-current light-current">
              <p className="landing-kicker">Light / Revelation</p>
              <p className="mt-4 text-sm leading-7 text-muted">
                It exposes, multiplies and burns away distinction. It can uncover
                a lie or erase the shelter that made honesty possible.
              </p>
            </div>
            <div className="hidden-current dark-current">
              <p className="landing-kicker">Dark / Keeping</p>
              <p className="mt-4 text-sm leading-7 text-muted">
                It conceals, preserves and gives shape to absence. It can protect
                a fugitive or keep a wound from ever reaching the air.
              </p>
            </div>
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center font-mono text-[9px] uppercase tracking-[0.18em] text-faint">
            Neither is good. Neither is evil. Both are older than the argument.
          </p>
        </ScrollReveal>
      </section>

      <LoreChapter eyebrow="IV / The Returning" title="A scroll holds the road. A rune pays for the door.">
        <p>
          A wild creature cannot be reasoned out of defending its ground. The
          keeper must defeat it completely. Its heart stops and its elemental
          current leaves the body. This is death, not sleep.
        </p>
        <div className="returning-sequence">
          <LoreStep number="01" title="Remember" body="The scroll records the creature's last true signs: its current, its wound, the place it fell and the name it answered to." />
          <LoreStep number="02" title="Open" body="Runes break into force. The keeper gives that force direction and opens a path through the scattered current." />
          <LoreStep number="03" title="Return" body="What comes home remembers the battle and carries a thread of the keeper beside its own. Command is possible. Loyalty must be earned." />
        </div>
        <p>
          The Corporation performs a version without scrolls. It copies useful
          reflexes, strips away choice and calls the result stable. Whether a
          Hollow can be Returned a second time remains an open and dangerous question.
        </p>
      </LoreChapter>

      <section className="lore-chapter border-y border-rune/10 bg-surface/20">
        <ScrollReveal className="mx-auto max-w-6xl px-5 sm:px-8">
          <p className="landing-kicker">V / The four oaths</p>
          <h2 className="landing-title mt-5 max-w-3xl">A faction is a method of refusal, not a claim to rule.</h2>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {FACTIONS.map(({ element, name, companion, description }) => {
              const Icon = ELEMENT_ICON[element];
              return (
                <div key={element} data-element={element} className="lore-faction">
                  <img src={portrait(element)} alt={companion} className="lore-faction-creature" data-pixel />
                  <div className="relative z-10">
                    <Icon className="h-5 w-5 text-element" />
                    <p className="mt-8 font-mono text-[9px] uppercase tracking-[0.2em] text-element">{companion}</p>
                    <h3 className="mt-2 text-2xl font-semibold">{name}</h3>
                    <p className="mt-4 max-w-sm text-[13px] leading-6 text-muted">{description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollReveal>
      </section>

      <LoreChapter eyebrow="VI / The open Realm" title="The world is larger than the war.">
        <p>
          Ordinary life continues beneath ruined turbines and along half-flooded
          roads. Berry gardens grow beside dead machines. Children cut harmless
          runes into slate. Wild creatures nest inside devices built to erase them.
        </p>
        <p>
          Corporation territory is clean, vertical and overlit. Every useful
          surface carries an instruction. Wild territory is not automatically
          safe; it is simply allowed to be itself.
        </p>
        <blockquote>
          Arena battles are training, ritual and rivalry. The real fight is over
          who gets to define order, and whether the Realm is allowed to remain alive.
        </blockquote>
      </LoreChapter>

      <footer className="lore-page-end">
        <Mark size={84} glow />
        <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.22em] text-rune/60">
          End of recovered record
        </p>
      </footer>
    </article>
  );
}

function LoreChapter({
  eyebrow,
  title,
  tone,
  children,
}: {
  eyebrow: string;
  title: string;
  tone?: 'machine';
  children: React.ReactNode;
}) {
  return (
    <section className={`lore-chapter${tone ? ` lore-chapter-${tone}` : ''}`}>
      <ScrollReveal className="mx-auto grid max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <div>
          <p className="landing-kicker">{eyebrow}</p>
          <h2 className="landing-title mt-5">{title}</h2>
          <div className="mt-8 flex items-center gap-3 text-rune/60">
            <span className="h-px w-10 bg-rune/20" />
            <Rune className="h-4 w-4" />
          </div>
        </div>
        <div className="lore-prose">{children}</div>
      </ScrollReveal>
    </section>
  );
}

function LoreStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="returning-lore-step">
      <span className="font-mono text-[9px] text-rune/55">{number}</span>
      <h3 className="mt-5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-[13px] leading-6 text-muted">{body}</p>
    </div>
  );
}
