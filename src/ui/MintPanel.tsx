/**
 * Legacy asset recovery.
 *
 * New companions never leave the game as NFTs. This panel exists only so a
 * player who minted under the old model can return that asset to the in-game
 * collection rather than being stranded by the migration.
 */
import { useEffect, useState } from 'react';
import { useGame } from '../state/gameContext';
import * as api from '../lib/game';
import { assetHolder, assetImage, transferAsset } from '../lib/mint';
import { GameError, MintedAsset, Player } from '../lib/types';
import { Badge, Button, Empty, Panel, SectionTitle } from './primitives';
import { Clock, Gift } from './icons';
import { shortAddress } from '../lib/format';

/** Existing assets can come home, but cannot be newly minted or traded here. */
export function MintPanel({ player }: { player: Player }) {
  const assets = Object.values(player.assets ?? {});

  return (
    <Panel className="p-5">
      <SectionTitle right={assets.length ? <Badge>{assets.length}</Badge> : null}>
        Legacy cards
      </SectionTitle>
      {assets.length === 0 ? (
        <Empty icon={<Gift />} title="No legacy cards">
          No old-format cards are waiting to return.
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
