/**
 * MintPanel — pulling a companion out of the game, and putting one back.
 *
 * Two directions, and they are not symmetrical, so the screen does not pretend
 * they are:
 *
 *   OUT is free to the player and slow. `Monster.Mint` charges runes, freezes
 *   the companion and queues it; a funded worker signs the Arweave transaction.
 *   The player signs one message and waits — minutes, because the asset is a
 *   base-layer transaction and those wait for a block.
 *
 *   IN costs the player a network fee and needs their signature, because only
 *   the holder can give an asset away. There is no burn in this standard, so
 *   coming home is a transfer to the vault the process publishes, followed by
 *   `Monster.Deposit` to point the worker at it.
 *
 * Both waits are stated in the interface rather than hidden behind a spinner.
 * "Permanent, public, and a few minutes away" is the honest description of what
 * the button does, and a card that quietly appeared later would teach players
 * that the app lies about time.
 *
 * `MintButton` lives beside Level up, in the companion panel, because that is
 * where the things you DO to a companion are. It carries no copy and no card
 * preview: the card is already on screen, at full size, right above it.
 */
import { useEffect, useState } from 'react';
import { useGame } from '../state/GameProvider';
import * as api from '../lib/game';
import { assetHolder, assetImage, bazarUrl, transferAsset } from '../lib/mint';
import { GameError, MintedAsset, Player } from '../lib/types';
import { Badge, Button, Empty, Panel, SectionTitle } from './primitives';
import { Clock, Gift, Sparkle } from './icons';
import { shortAddress } from '../lib/format';

/** Runes the process says a mint costs. Read once; it is a constant. */
function useMintCost(): number | null {
  const [cost, setCost] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api.readMintCost().then((n) => { if (live) setCost(n); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return cost;
}

/**
 * Mint, as one button.
 *
 * Every reason it can be unavailable is carried in the tooltip rather than in
 * the label, so the button does not change width as a companion goes on a
 * quest or runs out of runes — a control that resizes under you is a control
 * you misclick.
 */
export function MintButton({ player, className }: { player: Player; className?: string }) {
  const { run, isPending } = useGame();
  const cost = useMintCost();
  const monster = player.monster;
  if (!monster) return null;

  const runes = player.inventory?.rune ?? 0;
  const inFlight = Boolean(player.mint);
  const away = monster.status.type !== 'Home';
  const short = cost !== null && runes < cost;

  const why = inFlight
    ? 'Already minting — waiting for the chain'
    : away
      ? `Your companion is busy: ${monster.status.type}`
      : short
        ? `Minting costs ${cost} runes; you have ${runes}`
        : `Mint this card as a tradable Arweave asset (${cost ?? '—'} runes). `
          + 'The companion leaves the game until you bring it back.';

  return (
    <Button
      className={className}
      icon={<Sparkle className="h-4 w-4" />}
      busy={isPending('mint')}
      disabled={inFlight || away || cost === null || short}
      title={why}
      onClick={() => run('mint', api.mint, 'Queued for minting')}
    >
      {inFlight ? 'Minting' : 'Mint'}
    </Button>
  );
}

/** The vault: what this wallet has pulled out of the game. */
export function MintPanel({ player }: { player: Player }) {
  const assets = Object.values(player.assets ?? {});

  return (
    <Panel className="p-5">
      <SectionTitle right={assets.length ? <Badge>{assets.length}</Badge> : null}>
        Minted
      </SectionTitle>
      {assets.length === 0 ? (
        <Empty icon={<Gift />} title="Nothing minted yet">
          Companions you pull out appear here, with a link to trade them and a
          way to bring them home.
        </Empty>
      ) : (
        <div className="space-y-3">
          {assets
            .sort((a, b) => b.mintedAt - a.mintedAt)
            .map((asset) => (
              <AssetRow key={asset.assetId} asset={asset} player={player} />
            ))}
        </div>
      )}
    </Panel>
  );
}

/**
 * One minted companion.
 *
 * The image is fetched from the gateway by asset id, because in this standard
 * the asset IS the image — there is no metadata document to resolve first.
 */
function AssetRow({ asset, player }: { asset: MintedAsset; player: Player }) {
  const { run, refresh } = useGame();
  const [state, setState] = useState<'idle' | 'transferring' | 'sent' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [holder, setHolder] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    assetHolder(asset.assetId)
      .then((who) => { if (live) setHolder(who); })
      .catch(() => { if (live) setHolder(null); });
    return () => { live = false; };
  }, [asset.assetId]);

  const mine = holder === player.address;

  async function bringHome() {
    setError(null);
    setState('transferring');
    try {
      const vault = await api.readMintVault();
      if (!vault || vault === 'null') throw new GameError('No vault published yet');
      await transferAsset(asset.assetId, vault);
      // Register the intent immediately. The transfer still has to be mined,
      // and the worker settles it by reading the asset's balances — but if the
      // page is closed before this message is sent, nothing is watching for it.
      await run('deposit', () => api.depositAsset(asset.assetId));
      setState('sent');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('failed');
    }
  }

  return (
    <div className="flex gap-3 rounded-[3px] border border-edge/60 bg-void/25 p-3">
      <img
        src={assetImage(asset.assetId)}
        alt={`${asset.monster.name} card`}
        className="h-24 w-[58px] shrink-0 rounded border border-edge/60 object-cover"
        style={{ imageRendering: 'pixelated' }}
        loading="lazy"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{asset.monster.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">
            lvl {asset.monster.level}
          </span>
        </div>
        <div className="font-mono text-[11px] text-faint">
          {shortAddress(asset.assetId)}
          {holder === undefined
            ? ' · checking'
            : mine
              ? ' · yours'
              : holder
                ? ` · held by ${shortAddress(holder)}`
                : ' · settling'}
        </div>
        <div className="flex flex-wrap gap-2 pt-0.5">
          <a href={bazarUrl(asset.assetId)} target="_blank" rel="noreferrer">
            <Button size="sm" variant="quiet">Trade</Button>
          </a>
          {state === 'sent' ? (
            <Badge tone="warn"><Clock className="h-3 w-3" />Coming home</Badge>
          ) : (
            <Button
              size="sm"
              busy={state === 'transferring'}
              disabled={!mine || Boolean(player.monster)}
              onClick={bringHome}
              title={player.monster
                ? 'Mint or release your current companion first'
                : !mine ? 'Only the holder can send it back' : undefined}
            >
              Bring home
            </Button>
          )}
        </div>
        {error && <p className="text-[11px] text-bad">{error}</p>}
      </div>
    </div>
  );
}
