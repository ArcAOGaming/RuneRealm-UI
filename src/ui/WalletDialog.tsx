import { useEffect, useState, type ReactNode } from 'react';
import {
  downloadLocalWallet, walletAvailability, type WalletAvailability,
  type WalletConnection, type WalletProviderId,
} from '../lib/wallet';
import { shortAddress } from '../lib/format';
import { Arrow, Check, Lock } from './icons';
import { Button, cx, Spinner } from './primitives';
import { Dialog } from './Dialog';
import { type InstallResult, usePwaInstall } from './PwaInstall';
import { PERMAWEB_OS_LOGO } from './brandAssets';

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

  useEffect(() => {
    let live = true;
    walletAvailability().then((value) => { if (live) setAvailability(value); });
    return () => { live = false; };
  }, []);

  if (connected && !createdWallet) {
    const localProvider = /browser|local/i.test(connected.providerName ?? '');
    const permawebProvider = /permawebos/i.test(connected.providerName ?? '');
    return (
      <Dialog title="Wallet" onClose={onClose} busy={busyProvider !== null} className="max-w-sm">
        <div className="pt-4">
          <div className="flex items-center gap-3 rounded-[3px] border border-good/35 bg-good/[0.07] p-3">
            <BrandFrame compact>
              {localProvider
                ? <LocalWalletLogo />
                : permawebProvider ? <PermawebOsLogo /> : <WanderLogo markOnly />}
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

          <div className="mt-3">
            <InstallOption onHelp={setInstallHelp} />
            {installHelp && <InstallHelp platform={installHelp} />}
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
      <Dialog title="Local wallet ready" onClose={onContinue} className="max-w-sm">
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
    <Dialog title="Enter Rune Realm" onClose={onClose} busy={busy} className="max-w-sm">
      <div className="pt-4">
        <div className="grid grid-cols-3 gap-2">
          <ProviderTile
            label="Wander"
            mark="ARCONNECT"
            status={!availability ? 'CHECKING' : extension?.available ? 'READY' : 'GET'}
            statusTone={extension?.available ? 'good' : 'plain'}
            disabled={!availability || busy}
            busy={busyProvider === 'injected'}
            onClick={extension?.available ? () => onChoose('injected') : undefined}
            href={availability && !extension?.available ? 'https://www.wander.app/download' : undefined}
            title={extension?.available ? `Connect with ${extension.name}` : 'Install Wander wallet'}
            icon={<WanderLogo markOnly />}
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

/** Wander's exact published SVG; ArConnect was renamed Wander. */
function WanderLogo({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <img
      aria-hidden="true"
      alt=""
      src={markOnly
        ? 'https://pbs.twimg.com/profile_images/1887976393213984768/GRlEX0dS.png'
        : 'https://cdn.prod.website-files.com/678ff8951ddaa7a4b0b3ea22/678ffafb1e6148b3ad1b5d67_main%20logo.svg'}
      className="h-full w-full object-contain"
      decoding="async"
    />
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
