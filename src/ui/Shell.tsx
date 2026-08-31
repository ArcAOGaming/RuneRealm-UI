/**
 * App chrome: a slim header on desktop, a bottom bar on phones.
 *
 * The nav only ever shows what the player can actually reach. Nothing is
 * rendered disabled-and-mysterious: with no faction there is no Companion tab,
 * with no companion there is no Arena tab, and the one thing you can do next is
 * the only thing on screen.
 */
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useGame } from '../state/GameProvider';
import { shortAddress } from '../lib/format';
import { useAether } from './Aether';
import { Sigil } from './Sigil';
import { Button, cx } from './primitives';
import { Berry, Exchange, Map, Rune, Sword, Users, Wallet } from './icons';
import { Worship } from './Worship';
import { Wordmark } from './Mark';

type Tab = { to: string; label: string; Icon: (p: any) => JSX.Element };

export function Shell({ children }: { children: React.ReactNode }) {
  const {
    address, player, connect, connecting, walletProviderName,
  } = useGame();
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  const onPublicStory = onHome || pathname === '/lore';
  const onMarket = pathname === '/market';
  const onCollection = pathname === '/collection';

  const tabs: Tab[] = [];
  tabs.push({ to: '/factions', label: 'Factions', Icon: Users });
  if (player?.faction) tabs.push({ to: '/companion', label: 'Companion', Icon: Berry });
  if (player?.monster) tabs.push({ to: '/arena', label: 'Arena', Icon: Sword });
  if (player?.hunt) tabs.push({ to: '/hunt', label: 'Hunt', Icon: Map });
  tabs.push({ to: '/market', label: 'Market', Icon: Exchange });

  const element = player?.monster?.elementType;

  // The companion screen is the one page built to FIT: a room, the things you
  // can ask of the companion, and its card, all on screen at once with nothing
  // below the fold. It gets the viewport as a fixed box to lay itself out in
  // and a wider, tighter frame to do it in — see `Companion.tsx`. Below `lg`
  // the columns stack and the page scrolls like every other one, because a
  // phone cannot hold a card and a room side by side at a readable size.
  //
  // The box is a height to lay out IN, not a clip: no `overflow-hidden`. On a
  // window too short to hold the panels at their smallest, the content runs
  // past the box and the document scrolls, which is the honest failure — the
  // clipped version loses the record row off the bottom with nothing on screen
  // to say it is there.
  // Routes that own the viewport instead of scrolling inside it. A fight has
  // to be legible in one look — the stage, both fighters, and the moves you can
  // pick — and hunting for the move list below the fold is how you lose a round
  // you had already decided.
  const onArena = pathname === '/arena';
  const onHunt = pathname === '/hunt';
  const fitted = pathname === '/companion' || onArena || onHunt || onMarket || onCollection;

  /**
   * The arena hides its own chrome.
   *
   * The header is 64px of a viewport the fight has to share three ways, and
   * during a battle none of it is reachable anyway — you cannot wander off to
   * the market mid-round. So it collapses on entry and a single control in the
   * corner brings it back, which is worth about a tenth of the screen to the
   * thing you are actually looking at.
   *
   * Only on /arena, and only at lg: below that the header is the navigation.
   */
  const canCollapse = pathname === '/arena' || pathname === '/hunt';
  const [headerOpen, setHeaderOpen] = useState(false);
  useEffect(() => { setHeaderOpen(!canCollapse); }, [canCollapse]);
  const headerHidden = canCollapse && !headerOpen;

  // The whole page takes its chroma from the companion, and so does the field
  // behind it — joining a faction visibly changes the colour of the world.
  const { setElement } = useAether();
  useEffect(() => {
    setElement(onPublicStory ? 'arcane' : element ?? 'arcane');
  }, [element, onPublicStory, setElement]);

  // Portalled UI (toasts and receipts) lives outside this component, so it
  // cannot see whether the mobile navigation is present through ancestry.
  // One document flag lets the responsive layer reserve that space without
  // hard-coding route checks into every overlay added later.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-game-shell', !onPublicStory);
    return () => document.documentElement.removeAttribute('data-game-shell');
  }, [onPublicStory]);

  return (
    <div
      data-element={onPublicStory ? undefined : element}
      className={cx(
        'app-shell flex min-h-full flex-col',
        !onPublicStory && 'app-shell--game',
        onCollection && 'h-dvh min-h-0 overflow-hidden',
        fitted && 'lg:h-dvh lg:min-h-0 lg:overflow-hidden',
        headerHidden && 'app-shell--bare',
      )}
    >
      <header
        className={cx(
          'app-header sticky top-0 z-30 border-b border-rune/15 bg-void/78 backdrop-blur-xl',
          headerHidden && 'lg:hidden',
        )}
      >
        <div className="app-header-inner flex h-16 w-full items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-7">
          {/* The seal is geometry, not an image — so it is sharp at 26px and
              its bind bar carries the player's element like everything else. */}
          <NavLink to="/" aria-label="Rune Realm" className="shrink-0">
            <Wordmark size={26} className="select-none" />
          </NavLink>

          {!onPublicStory && (
            <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 lg:flex">
              {tabs.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} className={({ isActive }) => cx(
                  'flex h-9 items-center gap-2 rounded-[3px] px-3 text-sm transition-colors',
                  isActive
                    ? 'bg-raised text-ink'
                    : 'text-muted hover:bg-raised/60 hover:text-ink',
                )}>
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!onPublicStory && player && <SessionChips />}
            {!onPublicStory && <Worship />}
            {/* No link to /admin. It is reachable by typing the path, which is
                the point: the controls behind it change every player in the
                game, and a cog in the header is something you can happen upon.
                The process refuses every Admin action from a non-owner anyway,
                so this is tidiness rather than security. */}
            {address ? (
              <Button
                size="sm" variant="ghost" onClick={connect}
                title={`Manage ${walletProviderName ?? 'wallet'} and app installation`}
                icon={<Sigil address={address} size={20} weight={1.7} className="text-rune" />}
              >
                <span className="font-mono text-xs">{shortAddress(address)}</span>
              </Button>
            ) : (
              <Button size="sm" variant="primary" busy={connecting} onClick={connect}
                      icon={<Wallet className="hidden h-4 w-4 sm:block" />}>
                Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Brought back with one click. Deliberately small and in the corner the
          scene has least going on in — and it is a real button, so it is
          reachable by keyboard even while the chrome it restores is gone. */}
      {headerHidden && (
        <button
          type="button"
          onClick={() => setHeaderOpen(true)}
          aria-label="Show navigation"
          className={cx(
            'fixed right-2 top-2 z-40 hidden h-7 w-7 items-center justify-center lg:flex',
            'rounded-[3px] border border-rune/20 bg-void/80 text-muted backdrop-blur-sm',
            'transition-colors hover:border-element/50 hover:text-ink',
          )}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
            <path d="M3 5h10M3 8h10M3 11h10" />
          </svg>
        </button>
      )}

      <main className={cx(
        'app-main w-full flex-1',
        onPublicStory && 'pb-0',
        !onPublicStory && !fitted && 'game-main mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12',
        // Wider and tighter, and a flex column so the page below can claim the
        // height rather than measure it.
        fitted && cx(
          'game-main game-main--fitted mx-auto px-3 pb-28 pt-4 sm:px-4 lg:flex lg:min-h-0 lg:flex-col lg:pb-4 lg:pt-3',
          // The arena is the one page that IS a picture. Every rem of gutter is
          // a rem the picture does not get, so it keeps none of the page's
          // usual margin and none of its width cap.
          (onArena || onHunt) && 'lg:px-2 lg:pb-2 lg:pt-2',
          onCollection && 'flex min-h-0 max-w-none flex-col overflow-hidden px-2 pb-24 pt-2 sm:px-3 lg:px-4 lg:pb-3 lg:pt-3',
          onMarket || onArena || onHunt || onCollection ? 'max-w-none' : 'max-w-[92rem]',
        ),
      )}>
        {children}
      </main>

      {/* Bottom bar, phones only. Same tabs, thumb-reachable. */}
      {!onPublicStory && tabs.length > 1 && (
        <nav aria-label="Primary" className="app-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-edge/70 bg-void/90 backdrop-blur-xl lg:hidden">
          <div className="app-tabbar-inner mx-auto flex max-w-md items-stretch">
            {tabs.map(({ to, label, Icon }) => {
              const active = pathname.startsWith(to);
              return (
                <NavLink key={to} to={to} className={cx(
                  'app-tab flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
                  active ? 'text-element' : 'text-faint',
                )}>
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

/** The two numbers worth glancing at from anywhere: Runes and battles left. */
function SessionChips() {
  const { player } = useGame();
  if (!player) return null;
  // Defensive on purpose: the header renders before anything else, so a
  // reply that is missing a field must not be able to take the page down.
  const runes = player.inventory?.rune ?? 0;
  const inArena = player.monster?.status.type === 'Battle';
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="flex h-8 items-center gap-1.5 rounded-[3px] border border-edge bg-raised/60 px-2.5 text-xs">
        <Rune className="h-3.5 w-3.5 text-element" />
        <span className="font-mono tabular-nums">{runes}</span>
        <span className="text-faint">runes</span>
      </span>
      {inArena && (
        <span className="flex h-8 items-center gap-1.5 rounded-[3px] border border-element/40 bg-element/10 px-2.5 text-xs text-element">
          <Sword className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{player.battlesRemaining}</span>
          <span className="opacity-70">left</span>
        </span>
      )}
    </div>
  );
}
