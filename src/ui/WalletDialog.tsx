import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  downloadLocalWallet, walletAvailability, type WalletAvailability,
  type WalletConnection, type WalletProviderId,
} from '../lib/wallet';
import { shortAddress } from '../lib/format';
import { Arrow, Check, Compass, Lock } from './icons';
import { Button, cx, Spinner } from './primitives';
import { Dialog } from './Dialog';
import { type InstallResult } from './PwaInstall';
import { usePwaInstall } from './pwaInstallContext';
import { PERMAWEB_OS_LOGO } from './brandAssets';
import { useTour } from './tourContext';

export function WalletDialog({
  onClose, onChoose, busyProvider, createdWallet, onContinue, connected, onDisconnect,
}: {
  onClose: () => void;
  onChoose: (provider: WalletProviderId) => void;
  busyProvider: WalletProviderId | null;
  createdWallet: WalletConnection | null;
  onContinue: () => void;
  connected: { address: string; providerName: string | null } | null;
  onDisconnect: () => void;
}) {
  const [availability, setAvailability] = useState<WalletAvailability | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [installHelp, setInstallHelp] = useState<'ios' | 'browser' | null>(null);
  const { start: startTour, pageKey } = useTour();

  useEffect(() => {
    let live = true;
    walletAvailability().then((value) => { if (live) setAvailability(value); });
    return () => { live = false; };
  }, []);

  if (connected && !createdWallet) {
    const localProvider = /browser|local/i.test(connected.providerName ?? '');
    const permawebProvider = /permawebos/i.test(connected.providerName ?? '');
    return (
      <Dialog title="Wallet" onClose={onClose} busy={busyProvider !== null} size="sm">
        <div className="pt-4">
          <div className="flex items-center gap-3 rounded-[3px] border border-good/35 bg-good/[0.07] p-3">
            <BrandFrame compact>
              {localProvider
                ? <LocalWalletLogo />
                : permawebProvider ? <PermawebOsLogo /> : <WanderLogo />}
            </BrandFrame>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                {connected.providerName ?? 'Connected'}
              </div>
              <code className="mt-0.5 block truncate font-mono text-[10px] text-muted" title={connected.address}>
                {shortAddress(connected.address)}
              </code>
            </div>
            <Check className="h-4 w-4 text-good" />
          </div>

          <div className="mt-3 space-y-2">
            <InstallOption onHelp={setInstallHelp} />
            {installHelp && <InstallHelp platform={installHelp} />}
            {/* The one place a returning player can ask to be shown around
                again. It lives beside Install rather than on the companion
                screen because this dialog is the only thing in the chrome that
                is reachable from every page and is not itself a destination —
                and because somebody who is lost is already clicking on their
                own address looking for a way out. */}
            <TourOption page={pageKey} onStart={() => { onClose(); startTour(); }} />
          </div>

          <Button className="mt-3 w-full" size="sm" variant="danger" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </Dialog>
    );
  }

  if (createdWallet) {
    return (
      <Dialog title="Local wallet ready" onClose={onContinue} size="sm">
        <div className="pt-4">
          <div className="flex items-center gap-3 rounded-[3px] border border-good/35 bg-good/[0.07] p-3">
            <BrandFrame compact><LocalWalletLogo /></BrandFrame>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-good" />
                Permaweb key
              </div>
              <code className="mt-0.5 block truncate font-mono text-[10px] text-muted" title={createdWallet.address}>
                {shortAddress(createdWallet.address)}
              </code>
            </div>
            <Check className="h-4 w-4 text-good" />
          </div>

          <div className="mt-3 flex items-start gap-2.5 rounded-[3px] border border-warn/30 bg-warn/[0.06] p-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <p className="text-xs leading-5 text-muted">
              Save the recovery JSON. Clearing site data erases this key; anyone with the file controls it.
            </p>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button
              size="sm"
              variant={backedUp ? 'ghost' : 'primary'}
              onClick={() => { void downloadLocalWallet().then(() => setBackedUp(true)); }}
              icon={backedUp ? <Check className="h-4 w-4" /> : <DownloadIcon />}
            >
              {backedUp ? 'Saved' : 'Save recovery'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onContinue} icon={<Arrow className="h-4 w-4" />}>
              Play
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  const extension = availability?.injected;
  const permaweb = availability?.permaweb;
  const local = availability?.local;
  const busy = busyProvider !== null;

  return (
    <Dialog title="Enter Rune Realm" onClose={onClose} busy={busy} size="sm">
      <div className="pt-4">
        <div className="grid grid-cols-3 gap-2">
          <ProviderTile
            label="Wander"
            mark="EXTENSION"
            status={!availability ? 'CHECKING' : extension?.available ? 'READY' : 'GET'}
            statusTone={extension?.available ? 'good' : 'plain'}
            disabled={!availability || busy}
            busy={busyProvider === 'injected'}
            onClick={extension?.available ? () => onChoose('injected') : undefined}
            href={availability && !extension?.available ? 'https://www.wander.app/download' : undefined}
            title={extension?.available ? `Connect with ${extension.name}` : 'Install Wander wallet'}
            icon={<WanderLogo />}
          />

          <ProviderTile
            label="PermawebOS"
            mark="WALLET"
            status={!availability ? 'CHECKING' : permaweb?.available ? 'READY' : 'OFF'}
            statusTone={permaweb?.available ? 'good' : 'plain'}
            disabled={!availability || !permaweb?.available || busy}
            busy={busyProvider === 'permaweb'}
            onClick={() => onChoose('permaweb')}
            title={permaweb?.available ? `Connect with ${permaweb.name}` : 'PermawebOS extension not detected'}
            icon={<PermawebOsLogo />}
          />

          <ProviderTile
            label="Local key"
            mark="PERMAWEB"
            status={local?.available ? 'SAVED' : 'NEW'}
            statusTone={local?.available ? 'good' : 'plain'}
            disabled={busy}
            busy={busyProvider === 'local'}
            onClick={() => onChoose('local')}
            title={local?.available ? `Use ${shortAddress(local.address ?? '')}` : 'Create a wallet in this browser'}
            icon={<LocalWalletLogo />}
          />
        </div>

        {local?.available && (
          <button
            type="button"
            onClick={() => { void downloadLocalWallet(); }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 py-1 text-[10px] uppercase tracking-[0.12em] text-faint hover:text-ink"
            title="Download this local wallet's recovery JSON"
          >
            <DownloadIcon /> Recovery
          </button>
        )}

        <div className="mt-3 border-t border-edge/70 pt-3">
          <InstallOption onHelp={setInstallHelp} />
          {installHelp && <InstallHelp platform={installHelp} />}
        </div>
      </div>
    </Dialog>
  );
}

function InstallOption({ onHelp }: { onHelp: (platform: 'ios' | 'browser' | null) => void }) {
  const { installed, installing, promptReady, ios, install } = usePwaInstall();

  const startInstall = () => {
    onHelp(null);
    void install().then((result: InstallResult) => {
      if (result === 'ios-help') onHelp('ios');
      if (result === 'browser-help') onHelp('browser');
    });
  };

  return (
    <button
      type="button"
      disabled={installed || installing}
      onClick={startInstall}
      title={installed ? 'Rune Realm is installed' : 'Install Rune Realm on this device'}
      className={cx(
        'flex w-full items-center gap-3 rounded-[3px] border border-edge bg-raised/45 p-2.5 text-left',
        'transition-colors hover:border-element/60 hover:bg-raised/80',
        'disabled:cursor-default disabled:opacity-60 disabled:hover:border-edge disabled:hover:bg-raised/45',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-rune/20 bg-void/50 text-rune">
        {installing ? <Spinner className="h-4 w-4" /> : <InstallIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{installed ? 'Game installed' : 'Install game'}</span>
        <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          {installed ? 'ON DEVICE' : promptReady ? 'READY' : ios ? 'HOME SCREEN' : 'LOCAL APP'}
        </span>
      </span>
      {installed ? <Check className="h-4 w-4 text-good" /> : <Arrow className="h-4 w-4 text-faint" />}
    </button>
  );
}

/**
 * Same row as Install, so the two "things you can do here" read as a pair.
 *
 * This is the backstop, not the front door — the guide in the header is on the
 * page you are actually confused about. It is here as well because somebody
 * lost is already clicking on their own address looking for a way out, and
 * because this dialog is the one piece of chrome reachable from every page that
 * is not itself a destination.
 *
 * It names the page it would tour. "Review tutorial" on the market page, when
 * pressing it walks you round the market, is a promise about the wrong thing.
 */
function TourOption({ page, onStart }: { page: string | null; onStart: () => void }) {
  const here = page && page !== 'companion';
  return (
    <button
      type="button"
      onClick={onStart}
      title={here ? 'Walk through this page' : 'Walk through the game again'}
      className={cx(
        'flex w-full items-center gap-3 rounded-[3px] border border-edge bg-raised/45 p-2.5 text-left',
        'transition-colors hover:border-element/60 hover:bg-raised/80',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-rune/20 bg-void/50 text-rune">
        <Compass className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">
          {here ? 'Tour this page' : 'Review tutorial'}
        </span>
        {/* Not a step count: the walkthrough drops the steps whose subject is
            not on this screen, so the same list is nine steps on a laptop and
            eight on a phone, where the daily countdown chip is not shown. */}
        <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          WALKTHROUGH
        </span>
      </span>
      <Arrow className="h-4 w-4 text-faint" />
    </button>
  );
}

function InstallHelp({ platform }: { platform: 'ios' | 'browser' }) {
  return (
    <div className="mt-2 rounded-[3px] border border-element/30 bg-element/[0.06] p-3 text-xs leading-5 text-muted">
      {platform === 'ios' ? (
        <p><strong className="text-ink">Share</strong> → <strong className="text-ink">Add to Home Screen</strong> → <strong className="text-ink">Add</strong></p>
      ) : (
        <p><strong className="text-ink">Browser menu</strong> → <strong className="text-ink">Install app</strong></p>
      )}
    </div>
  );
}

function ProviderTile({
  label, mark, status, statusTone, disabled, busy, onClick, href, title, icon, wideIcon,
}: {
  label: string;
  mark: string;
  status: string;
  statusTone: 'good' | 'plain';
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  href?: string;
  title: string;
  icon: ReactNode;
  wideIcon?: boolean;
}) {
  const classes = cx(
    'group relative flex min-h-32 flex-col items-center justify-center rounded-[3px] border border-edge bg-raised/45 p-3 text-center',
    'transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-element/60 hover:bg-raised/80',
    'disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-edge disabled:hover:bg-raised/45',
  );
  const content = (
    <>
      <span className={cx(
        'absolute right-2 top-2 flex items-center gap-1 font-mono text-[8px] tracking-[0.12em]',
        statusTone === 'good' ? 'text-good' : 'text-faint',
      )}>
        {statusTone === 'good' && <span className="h-1.5 w-1.5 rounded-full bg-good" />}
        {status}
      </span>
      <BrandFrame wide={wideIcon}>{busy ? <Spinner className="h-6 w-6" /> : icon}</BrandFrame>
      <span className="mt-2 block text-sm font-semibold text-ink">{label}</span>
      <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.18em] text-faint">{mark}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes} title={title}>
        {content}
      </a>
    );
  }

  return (
    <button type="button" disabled={disabled} onClick={onClick} className={classes} title={title}>
      {content}
    </button>
  );
}

function BrandFrame({
  children, compact = false, wide = false,
}: { children: ReactNode; compact?: boolean; wide?: boolean }) {
  return (
    <span className={cx(
      'grid shrink-0 place-items-center overflow-hidden rounded-[3px] border border-rune/20 bg-void/55',
      compact ? 'h-9 w-9 p-1.5' : wide ? 'h-14 w-24 p-2' : 'h-14 w-14 p-2',
    )}>
      {children}
    </span>
  );
}

/**
 * Wander's mark, drawn here rather than fetched.
 *
 * These three paths and their gradients are lifted verbatim from Wander's own
 * published logo (the crown, without the wordmark beside it), so it is still
 * their artwork and not an approximation of it.
 *
 * It used to be two `<img>` tags pointing at a Twitter avatar CDN and a Webflow
 * bucket, which is three things wrong at once. This app is DEPLOYED TO THE
 * PERMAWEB: a page that is meant to keep working forever cannot have the icon
 * on its connect button hosted by somebody else's marketing site, and the whole
 * point of an Arweave build is that it does not rot when a URL moves. It also
 * meant a network round trip — and a visibly empty box until it landed — for a
 * 56px icon, and it told the CDN's owner about every player who opened the
 * wallet dialog.
 *
 * Drawn as vectors it is sharp at any size, transparent on the panel's own
 * ground instead of carrying a white plate, and costs nothing.
 *
 * The gradient ids are per-instance. Two of these can be on screen at once and
 * duplicate ids in one document resolve to whichever came first — which is how
 * a mark ends up filled from a gradient that has been unmounted.
 */
function WanderLogo() {
  const id = useId();
  const g = (n: number) => `wander-${id}-${n}`;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 58 28"
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M39.7903 14.0136L29.499 0.964308C29.0655 0.401696 28.6403 0.309813 28.1746 0.914092L17.8675 13.9924L27.8436 23.009L28.8124 2.35127L29.7812 23.009L39.7903 14.0136Z"
        fill={`url(#${g(0)})`}
      />
      <path
        d="M47.0982 27.5L57.5574 5.18035C57.7818 4.69144 57.246 4.20289 56.7798 4.47132L41.1404 13.4603L30.9749 24.9122L47.0982 27.5Z"
        fill={`url(#${g(1)})`}
      />
      <path
        d="M10.5119 27.5L0.0526943 5.18035C-0.171667 4.69144 0.364134 4.20289 0.830313 4.47132L16.4697 13.4603L26.6353 24.9122L10.5119 27.5Z"
        fill={`url(#${g(2)})`}
      />
      <defs>
        <linearGradient id={g(0)} x1="28.7517" y1="23.009" x2="28.7517" y2="0.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B57F9" /><stop offset="1" stopColor="#9787FF" />
        </linearGradient>
        <linearGradient id={g(1)} x1="35.135" y1="18.4187" x2="49.1781" y2="26.3958" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B57F9" /><stop offset="1" stopColor="#9787FF" />
        </linearGradient>
        <linearGradient id={g(2)} x1="22.4751" y1="18.4187" x2="8.43201" y2="26.3958" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6B57F9" /><stop offset="1" stopColor="#9787FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** Exact icon bundled with the PermawebOS extension supplied by the user. */
function PermawebOsLogo() {
  return <img aria-hidden="true" alt="" src={PERMAWEB_OS_LOGO} className="h-full w-full object-contain" />;
}

/** Arweave's published Unicode glyph, used for a device-local Permaweb key. */
function LocalWalletLogo() {
  return <span aria-hidden="true" className="font-mono text-[38px] leading-none text-ink">ⓐ</span>;
}

function InstallIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 4.5h14v15H5Z" /><path d="M12 7v7m-3-3 3 3 3-3M8 17h8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v12m-4-4 4 4 4-4M4 19h16" />
    </svg>
  );
}
