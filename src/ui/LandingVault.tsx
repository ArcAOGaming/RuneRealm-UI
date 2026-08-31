import { useEffect, useRef, useState } from 'react';
import { createVault, Spoil, Vault } from '../gfx/vault';
import { ITEM_ART } from './art';
import { Mark } from './Mark';
import { cx } from './primitives';

const TIERS = [
  { rarity: 2, label: 'Uncommon' },
  { rarity: 3, label: 'Rare' },
  { rarity: 5, label: 'Legendary' },
];

const SPOILS: Spoil[] = [
  { url: ITEM_ART.fire_berry!, amount: 5 },
  { url: ITEM_ART.scroll!, amount: 1 },
  { url: ITEM_ART.air_berry!, amount: 5 },
];

/** A self-contained demo of the real loot ceremony. No loot is spent or won. */
export default function LandingVault() {
  const host = useRef<HTMLDivElement>(null);
  const vault = useRef<Vault | null>(null);
  const [rarity, setRarity] = useState(5);
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'sealed' | 'opening' | 'open' | 'flat'>('loading');

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let timer = 0;
    setPhase('loading');

    try {
      const next = createVault(host.current, {
        rarity,
        onReveal: () => { if (!cancelled) setPhase('open'); },
      });
      vault.current = next;
      setPhase('sealed');
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setPhase('opening');
        next.open(SPOILS);
      }, 900);
    } catch {
      host.current?.replaceChildren();
      setPhase('flat');
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      vault.current?.dispose();
      vault.current = null;
    };
  }, [cycle, rarity]);

  const replay = (nextRarity = rarity) => {
    setRarity(nextRarity);
    setCycle((value) => value + 1);
  };

  return (
    <div className="landing-vault-shell">
      <div ref={host} className="landing-vault-stage" aria-label="Animated loot chest showcase">
        {phase === 'flat' && (
          <div className="absolute inset-0 grid place-items-center opacity-35" aria-hidden>
            <Mark size={230} glow />
          </div>
        )}
      </div>

      <div className="landing-vault-controls">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-rune/55">Choose the seal</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <button
                key={tier.rarity}
                type="button"
                onClick={() => replay(tier.rarity)}
                className={cx(
                  'rounded-[3px] border px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors',
                  rarity === tier.rarity
                    ? 'border-rune/45 bg-rune/10 text-ink'
                    : 'border-edge/70 text-faint hover:border-rune/30 hover:text-muted',
                )}
              >
                {tier.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => replay()}
          className="landing-vault-replay"
        >
          {phase === 'open' ? 'Open it again' : phase === 'flat' ? 'Try the ceremony' : 'Restart ceremony'}
        </button>
      </div>
    </div>
  );
}
