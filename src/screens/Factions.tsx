/**
 * The four factions — the join screen.
 *
 * You arrive in the hall. Four altars, each with its companion standing under
 * its own pillar, nothing selected and nothing dimmed: at rest all four are lit
 * the same, whoever you already belong to. Being sworn is a status, and it is
 * carried in words under your own plinth and by the YOURS badge, not by three
 * other factions being greyed out for a choice you might still want to read.
 *
 * Pointing at an altar charges it. Choosing one opens its detail — description,
 * companion, the tallies, the roster — and swearing happens in there, so the one
 * irreversible action in the game is never one click away from a pretty object.
 *
 * What is NOT on this screen: perks. Every faction used to advertise two —
 * "Increased speed stats", "Boost to air-type attack power" — and nothing in the
 * engine ever read them. They are gone from the process as well as from here
 * (see `C.FACTIONS` in backend/native/constants.lua). A faction picks the
 * companion you start with and the group you belong to. That is the whole of it.
 */import { lazy, Suspense, useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import { Faction, Element, Monster } from '../lib/types';
import { Badge, Button, Panel, Skeleton, Spinner, cx } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { ELEMENT_ICON, Check, Arrow } from '../ui/icons';
import { article, ELEMENT_LABEL, ITEM_NAME, shortAddress } from '../lib/format';
import { portrait } from '../ui/art';
import { Sigil } from '../ui/Sigil';
import { useNavigate } from 'react-router-dom';
import Ranks from './Ranks';

// The hall is three.js and three.js is most of the bundle. It arrives after the
// cards, which are the thing that actually carries the facts.
const AltarHall = lazy(() => import('../ui/Altars'));
const CompanionAcquisition = lazy(() => import('../ui/CompanionAcquisition'));
import type { AltarInfo } from '../ui/Altars';

export default function Factions() {
  const { factions, player, run, isPending } = useGame();
  const [confirming, setConfirming] = useState<Faction | null>(null);
  const [acquired, setAcquired] = useState<Monster | null>(null);
  const navigate = useNavigate();

  const mine = player?.faction ?? null;
  const canJoin = !!player?.unlocked && !mine;
  const myFaction = factions?.find((f) => f.name === mine) ?? null;

  /**
   * Which altar the hall is lighting, and which card is raised.
   *
   * Nothing, until you point at something. It used to open on the player's own
   * faction, which meant a sworn player arrived at a screen that had already
   * made a selection on their behalf — and a screen whose whole job is a choice
   * should not start with one made. Being sworn shows as status instead: the
   * line under the title, the YOURS badge, and a little warmth on your own
   * altar in the hall.
   */
  const [focused, setFocused] = useState<Element | null>(null);
  /** The faction whose detail is open. Set by choosing an altar or a card. */
  const [detail, setDetail] = useState<Faction | null>(null);
  /** False when the hall could not render, and the cards have to carry it. */
  const [hallLive, setHallLive] = useState(true);

  const open = (faction: Faction) => {
    setFocused(faction.element);
    setDetail(faction);
  };

  const info = useMemo(() => {
    const out: Partial<Record<Element, AltarInfo>> = {};
    for (const f of factions ?? []) {
      out[f.element] = {
        name: f.name,
        companion: f.monsterName,
        members: f.memberCount,
        mine: mine === f.name,
      };
    }
    return out;
  }, [factions, mine]);

  const join = async (faction: Faction) => {
    const reply = await run('join', () => api.joinFaction(faction.name));
    setConfirming(null);
    if (reply?.monster) {
      setDetail(null);
      setAcquired(reply.monster);
    } else if (reply) {
      // Compatibility with a process from before Faction.Join returned the
      // adopted monster. The current process always takes the reveal path.
      navigate('/companion');
    }
  };

  return (
    <div className="animate-rise">
      {/* No title, no standings line. You arrive in the hall — the altars say
          what this screen is faster than a heading does, and being sworn is
          already carried by your own altar and by the YOURS badge below. */}

      {/*
        The hall.

        Everything below it is still here and still complete: the altars are how
        you choose, the cards are how you decide. Swearing from the hall is a
        two-step — the first click stands you at an altar and raises its card,
        the second opens the oath — so nobody signs the one irreversible action
        in the game on a single stray click at a pretty object.
      */}
      {factions && (
        <Suspense fallback={<div className="faction-hall-offset h-[100dvh] min-h-[520px]" />}>
          <AltarHall
            info={info}
            sworn={myFaction?.element ?? null}
            selected={focused}
            onSelect={(element) => {
              const f = factions.find((x) => x.element === element);
              if (f) open(f);
            }}
            onLive={setHallLive}
            hint={canJoin ? 'Choose an altar to read it' : undefined}
            /*
              Out of the page's padding entirely, top and bottom.

              The header is 4rem and sticky — in flow, not fixed — plus its own
              1px bottom rule, and `main` adds 1.5rem above and 7rem (3rem on
              lg) below. 89px cancels the lot: the hall's top edge lands on the
              top of the VIEWPORT, behind the translucent nav, and the page is
              exactly one screen tall. Miss the border and the page is one pixel
              too long, which is a scrollbar on a screen that should not have one.
            */
            className="faction-hall-offset"
          />
        </Suspense>
      )}

      {!factions ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Panel key={i} className="space-y-3 p-5">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-16 w-full" />
            </Panel>
          ))}
        </div>
      ) : hallLive ? null : (
        <div className="grid gap-4 lg:grid-cols-2">
          {factions.map((f) => (
            <FactionCard
              key={f.name}
              faction={f}
              mine={mine === f.name}
              focused={focused === f.element}
              onFocus={() => setFocused(f.element)}
              onOpen={() => open(f)}
            />
          ))}
        </div>
      )}

      {detail && (
        <FactionDetail
          faction={detail}
          mine={mine === detail.name}
          canJoin={canJoin}
          onSwear={() => setConfirming(detail)}
          onClose={() => setDetail(null)}
        />
      )}

      {confirming && (
        <ConfirmJoin
          faction={confirming}
          busy={isPending('join')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => join(confirming)}
        />
      )}

      {acquired && (
        <Suspense
          fallback={(
            <div
              role="status"
              data-element={acquired.elementType}
              className="fixed inset-0 z-[70] grid place-items-center bg-void"
            >
              <Spinner className="h-8 w-8 text-element" />
            </div>
          )}
        >
          <CompanionAcquisition
            monster={acquired}
            onComplete={() => {
              setAcquired(null);
              navigate('/companion');
            }}
          />
        </Suspense>
      )}

      <section id="ranks" className="scroll-mt-24 border-t border-rune/12 pt-12">
        <Ranks embedded />
      </section>
    </div>
  );
}

/**
 * The compact card — the fallback, and only that.
 *
 * When the hall renders, every faction's plaque stands under its own pillar and
 * this is not on the page at all. Without WebGL there is no hall, and the same
 * summary has to exist somewhere: name, element, whether it is yours, its
 * companion, and how many people are in it, with the detail one click away.
 */
function FactionCard({
  faction, mine, focused, onFocus, onOpen,
}: {
  faction: Faction;
  mine: boolean;
  /** The altar the player is currently standing at. */
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const Icon = ELEMENT_ICON[faction.element];

  return (
    <button
      type="button"
      data-element={faction.element}
      onPointerEnter={onFocus}
      onFocus={onFocus}
      onClick={onOpen}
      className={cx(
        'panel relative w-full overflow-hidden p-4 text-left transition-shadow',
        // The ring is selection, the glow is status. One treatment for both made
        // the faction you belong to indistinguishable from the one you are on.
        focused && 'shadow-glow ring-1 ring-element/40',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-element',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.16] blur-3xl"
        style={{ background: 'rgb(var(--element))' }}
      />

      <div className="relative flex items-center gap-3">
        <img
          src={portrait(faction.element)}
          alt=""
          loading="lazy"
          className="h-14 w-14 shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight">{faction.name}</h3>
            <Badge tone="element"><Icon className="h-3 w-3" />{ELEMENT_LABEL[faction.element]}</Badge>
            {mine && <Badge tone="good"><Check className="h-3 w-3" />Yours</Badge>}
          </div>
          <p className="mt-1 text-[13px] text-faint">
            <span className="text-muted">{faction.monsterName}</span>
            {' · '}
            {faction.memberCount} member{faction.memberCount === 1 ? '' : 's'}
          </p>
        </div>
        <Arrow className="h-4 w-4 shrink-0 text-faint" />
      </div>
    </button>
  );
}

/**
 * Everything about one faction, on demand.
 *
 * This is where the detail that used to be spread across four cards lives:
 * what it is, what you would raise, what it eats, how many are in it and who,
 * and — if you can still join — the way in. Reading a faction and choosing one
 * are different acts, and the swear button here opens the oath rather than
 * taking it.
 */
function FactionDetail({
  faction, mine, canJoin, onSwear, onClose,
}: {
  faction: Faction;
  mine: boolean;
  canJoin: boolean;
  onSwear: () => void;
  onClose: () => void;
}) {
  const Icon = ELEMENT_ICON[faction.element];

  return (
    <Dialog
      title={faction.name}
      onClose={onClose}
      element={faction.element}
      className="max-w-lg"
    >
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone="element"><Icon className="h-3 w-3" />{ELEMENT_LABEL[faction.element]}</Badge>
        {mine && <Badge tone="good"><Check className="h-3 w-3" />Yours</Badge>}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{faction.description}</p>

      <div className="mt-4 flex items-center gap-4 rounded-[3px] border border-edge/60 bg-void/30 p-3">
        <img
          src={portrait(faction.element)}
          alt={faction.monsterName}
          className="h-20 w-20 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <div className="eyebrow">Companion</div>
          <div className="mt-0.5 text-[15px] font-medium text-element">{faction.monsterName}</div>
          <p className="mt-1 text-[13px] text-faint">
            Feeds on <span className="text-muted">{ITEM_NAME[faction.berry]}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 rounded-[3px] border border-edge/60 bg-void/30 p-3">
        <Figure label="Members" value={faction.memberCount} />
        <Figure label="Companions" value={faction.monsterCount} />
        <Figure label="Avg level" value={faction.averageLevel.toFixed(1)} />
      </div>

      {faction.members.length > 0 && (
        <>
          <div className="eyebrow mb-2 mt-4">Roster</div>
          <div className="max-h-44 overflow-auto rounded-[3px] border border-edge/60">
            <table className="faction-roster-table w-full text-[13px]">
              <thead className="sticky top-0 bg-surface/95 backdrop-blur">
                <tr className="text-faint">
                  <th className="px-3 py-2 text-left font-medium" colSpan={2}>Member</th>
                  <th className="px-3 py-2 text-right font-medium">Lvl</th>
                  <th className="px-3 py-2 text-right font-medium">Wins</th>
                  <th className="px-3 py-2 text-right font-medium">Quests</th>
                </tr>
              </thead>
              <tbody>
                {faction.members.map((m) => (
                  <tr key={m.id} className="border-t border-edge/50">
                    {/* Their mark first, then their address. A faction is a list
                        of people; a column of truncated base64 is not. */}
                    <td className="w-9 py-1.5 pl-3">
                      <Sigil address={m.id} size={18} weight={1.4} className="text-rune/70" />
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs text-muted">{shortAddress(m.id, 5)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{m.level}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{m.wins}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted">{m.timesQuest}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>Close</Button>
        {canJoin && (
          <Button variant="primary" onClick={onSwear} icon={<Arrow className="h-4 w-4" />}>
            Swear to {faction.name.split(' ')[0]}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

function ConfirmJoin({
  faction, busy, onCancel, onConfirm,
}: { faction: Faction; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      title={`Swear to the ${faction.name}?`}
      onClose={onCancel}
      busy={busy}
      element={faction.element}
    >
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This cannot be undone. You will raise {article(faction.monsterName)}{' '}
        <span className="text-element">{faction.monsterName}</span>,{' '}
        {article(faction.element)} {ELEMENT_LABEL[faction.element].toLowerCase()}{' '}
        companion, and it will feed on {ITEM_NAME[faction.berry]}.
      </p>
        <p className="mt-3 text-[13px] text-faint">
          Your companion arrives immediately. Rune is never created per wallet;
          it comes from the fixed global reward policy or trade. Promised passes
          grant access only and do not include economic starter items.
        </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={onCancel} disabled={busy}>Not yet</Button>
        <Button variant="primary" busy={busy} onClick={onConfirm}
                icon={<Arrow className="h-4 w-4" />}>
          Swear the oath
        </Button>
      </div>
    </Dialog>
  );
}
