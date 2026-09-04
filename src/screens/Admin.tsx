/**
 * Realm command console.
 *
 * The process is still the security boundary: every mutation below is owner
 * signed and refused by Lua for every other wallet. This screen turns that
 * authority into an operating surface — roster, live incidents, economy,
 * factions, history and exact player edits — instead of a pile of blind forms.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useGame } from '../state/gameContext';
import * as api from '../lib/game';
import { GAME_OWNER } from '../lib/hyperbeam';
import {
  ActivityType, AdminAuditEntry, AdminBattleSummary, AdminFactionStats,
  AdminMetricDay, AdminMetrics, AdminPlayerPatch, AdminPlayerSummary,
  AdminSnapshot, EconomyPolicyChange, EconomyView, Element, GoldMarketItemId,
  GoldOrderSide, ItemId, Player,
} from '../lib/types';
import {
  Badge, Button, Empty, ErrorNote, Panel, SectionTitle, Skeleton, cx,
} from '../ui/primitives';
import {
  Check, Clock, Cog, ELEMENT_ICON, Lock, Refresh, Rune, Satchel,
  Shield, Sword, Trophy, Users,
} from '../ui/icons';
import { MonsterCard } from '../ui/MonsterCard';
import { extractAddresses, ITEM_NAME, shortAddress } from '../lib/format';
import { useToast } from '../ui/toastContext';
import SwarmMonitor from './admin/SwarmMonitor';
import { SWARM_ADDRESSES, SWARM_WALLETS } from '../data/swarm-wallets';
import { economyPreview } from '../lib/economy-preview';

type Tab = 'overview' | 'economy' | 'swarm' | 'players' | 'operations' | 'tracking' | 'monster-index' | 'visualize' | 'create';

const Studio = lazy(() => import('./admin/Studio'));
const MonsterIndexAdmin = lazy(() => import('./admin/MonsterIndex'));

const ITEMS: ItemId[] = [
  'rune', 'fire_berry', 'water_berry', 'air_berry', 'rock_berry',
  'scroll',
  'legendary_scroll',
];

const FACTIONS = [
  'Inferno Blades', 'Aqua Guardians', 'Sky Nomads', 'Stone Titans',
] as const;

const inputClass = cx(
  'w-full rounded-[3px] border border-edge bg-raised px-2.5 py-2',
  'text-sm text-ink focus:border-element/60 focus:outline-none',
);

const todayKey = () => String(Math.floor(Date.now() / 86400000));
const fmt = (n: number | undefined) => Number(n ?? 0).toLocaleString();
const asNumber = (value: string, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const dayToDate = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);
const when = (timestamp?: number) => timestamp
  ? new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  : 'Never';

function makeSwarmPreviewSnapshot(): AdminSnapshot {
  const generatedAt = Date.now();
  const elementByFaction: Record<string, Element> = {
    'Inferno Blades': 'fire', 'Aqua Guardians': 'water',
    'Sky Nomads': 'air', 'Stone Titans': 'rock',
  };
  const states: ActivityType[] = ['Home', 'Home', 'Quest', 'Play', 'Battle'];
  const players: AdminPlayerSummary[] = SWARM_WALLETS.map((profile, index) => {
    const status = states[index % states.length];
    return {
      address: profile.address,
      unlocked: index !== 49,
      faction: index === 48 ? 'Stone Titans' : profile.faction,
      name: profile.callSign,
      element: elementByFaction[profile.faction],
      level: 1 + (index % 9), exp: (index * 37) % 500,
      energy: 42 + (index % 58), happiness: 51 + (index % 49), status,
      inventory: { rune: 4 + (index % 13), fire_berry: index % 4 },
      gold: 25 + index * 3,
      lootboxes: [index % 3, index % 2, 0, 0, 0],
      wins: index % 8, losses: index % 4, questsCompleted: index % 11,
      battlesRemaining: status === 'Battle' ? 2 : 0,
      activeBattleId: status === 'Battle' ? `TEST-preview-${index}` : undefined,
      dailyStreak: index % 7, bestStreak: index % 12, offerings: index % 5,
      lastDaily: generatedAt - 3_600_000, joinedAt: generatedAt - 86_400_000,
      lastActiveAt: generatedAt - index * 21_000,
      lastAction: status === 'Home' ? 'Daily.Claim' : `Monster.${status}`,
      assets: 0,
      passOrigin: 'test', accountId: profile.address,
      recoveryCooldownUntil: 0, runeBond: 0,
    };
  });
  const runes = players.reduce((sum, player) => sum + Number(player.inventory.rune ?? 0), 0);
  const lootboxes = players.reduce((sum, player) => sum + player.lootboxes.reduce((a, b) => a + b, 0), 0);
  const wins = players.reduce((sum, player) => sum + player.wins, 0);
  const losses = players.reduce((sum, player) => sum + player.losses, 0);
  const quests = players.reduce((sum, player) => sum + player.questsCompleted, 0);
  return {
    generatedAt, players, battles: [], factions: [], audit: [],
    stats: {
      players: players.length, unlocked: players.filter((player) => player.unlocked).length,
      monsters: players.length, activeBattles: players.filter((player) => player.activeBattleId).length,
      completedBattles: wins + losses, wins, losses, quests, runes, lootboxes,
      offerings: 0, activeToday: players.length, items: { rune: runes }, mintedAssets: 0,
    },
    metrics: { since: generatedAt - 60_000, totals: { 'TEST.Preview': 24 }, daily: {} },
  };
}

export default function Admin() {
  const { address, processId, node } = useGame();
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // The local studio never needs process authority. Starting there in dev
  // means opening /admin to browse art or balance combat asks for no wallet
  // signature at all; choosing a live-process tab performs the owner read.
  const [tab, setTab] = useState<Tab>(() => {
    if (import.meta.env.DEV) {
      const saved = window.sessionStorage.getItem('runerealm-admin-tab');
      if (saved === 'monster-index' || saved === 'visualize' || saved === 'create') return saved;
      return 'visualize';
    }
    return 'overview';
  });
  const [selected, setSelected] = useState<string | null>(null);
  const isSwarmPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('swarm-preview');
  const isEconomyPreview = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has('economy-preview');
  const swarmPreview = useMemo(() => isSwarmPreview ? makeSwarmPreviewSnapshot() : null, [isSwarmPreview]);

  const isOwner = address === GAME_OWNER;
  const isLocalStudio = import.meta.env.DEV && (tab === 'monster-index' || tab === 'visualize' || tab === 'create');

  const load = useCallback(async (force = false) => {
    if (import.meta.env.DEV && (tab === 'monster-index' || tab === 'visualize' || tab === 'create')) {
      setLoading(false);
      return;
    }
    if (!address || address !== GAME_OWNER) {
      setSnapshot(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [next, economy] = await Promise.all([
        api.adminSnapshot({ force }),
        api.readEconomy().catch(() => undefined),
      ]);
      const merged = economy ? { ...next, economy } : next;
      setSnapshot(merged);
      setSelected((current) => (
        current && merged.players.some((p) => p.address === current)
          ? current
          : merged.players[0]?.address ?? null
      ));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [address, tab]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (import.meta.env.DEV && (tab === 'monster-index' || tab === 'visualize' || tab === 'create')) {
      window.sessionStorage.setItem('runerealm-admin-tab', tab);
    }
  }, [tab]);

  if (swarmPreview) {
    return (
      <div className="admin-console animate-rise space-y-4" data-element="arcane">
        <CommandHeader processId={processId} node={node} loading={false}
          isOwner={false} onRefresh={async () => undefined} />
        <nav className="admin-tabs" aria-label="Admin console preview">
          <button className="admin-tab is-active" aria-current="page">
            <span>Test swarm</span><small>50 preview agents</small>
          </button>
        </nav>
        <SwarmMonitor snapshot={swarmPreview} />
      </div>
    );
  }

  if (isEconomyPreview) {
    return <div className="admin-console animate-rise space-y-4" data-element="arcane"><CommandHeader processId={processId} node={node} loading={false} isOwner onRefresh={async () => undefined} /><EconomyAdmin economy={economyPreview()} onChanged={async () => undefined} /></div>;
  }

  if (isLocalStudio) {
    return (
      <div className="admin-console animate-rise space-y-4" data-element="arcane">
        <LocalStudioTabs tab={tab as 'monster-index' | 'visualize' | 'create'} onChange={setTab} canOpenProcess={Boolean(address)} />
        <Suspense fallback={<Panel className="p-6"><Skeleton className="h-72 w-full" /></Panel>}>
          {tab === 'monster-index' ? <MonsterIndexAdmin /> : <Studio mode={tab as 'visualize' | 'create'} />}
        </Suspense>
      </div>
    );
  }

  if (!address) {
    return (
      <Panel className="p-6">
        <Empty icon={<Lock />} title="Connect the owner wallet">
          The console is visible only after the process can verify its operator.
        </Empty>
      </Panel>
    );
  }

  return (
    <div className="admin-console animate-rise space-y-4" data-element="arcane">
      <CommandHeader processId={processId} node={node} loading={loading}
        isOwner={isOwner} onRefresh={() => load(true)} />

      {error !== null && <ErrorNote error={error} onRetry={() => load(true)} />}

      {isOwner && api.usesLegacyAdminApi() && (
        <div className="rounded-[3px] border border-warn/35 bg-warn/[0.07] px-4 py-3 text-sm leading-relaxed text-ink/90">
          This running process predates the compact admin snapshot. The console is using its
          one-signature compatibility export; deploy the included backend update to enable the
          complete live roster and one-signature post-action refreshes.
        </div>
      )}

      {loading && isOwner && !snapshot ? (
        <Panel className="p-6"><Skeleton className="h-52 w-full" /></Panel>
      ) : !isOwner ? (
        <ReadOnly owner={GAME_OWNER} />
      ) : snapshot ? (
        <>
          <CommandTabs tab={tab} onChange={setTab} snapshot={snapshot} />
          {tab === 'overview' && <Overview snapshot={snapshot} />}
          {tab === 'economy' && <EconomyAdmin economy={snapshot.economy} onChanged={() => load(true)} />}
          {tab === 'swarm' && <SwarmMonitor snapshot={snapshot} />}
          {tab === 'players' && (
            <PlayersView snapshot={snapshot} selected={selected}
              onSelect={setSelected} onChanged={load} />
          )}
          {tab === 'operations' && <Operations snapshot={snapshot} onChanged={load} />}
          {tab === 'tracking' && <Tracking snapshot={snapshot} />}
          {tab === 'monster-index' && (
            <Suspense fallback={<Panel className="p-6"><Skeleton className="h-72 w-full" /></Panel>}>
              <MonsterIndexAdmin />
            </Suspense>
          )}
          {(tab === 'visualize' || tab === 'create') && import.meta.env.DEV && (
            <Suspense fallback={<Panel className="p-6"><Skeleton className="h-72 w-full" /></Panel>}>
              <Studio mode={tab} />
            </Suspense>
          )}
        </>
      ) : null}
    </div>
  );
}

function LocalStudioTabs({ tab, onChange, canOpenProcess }: {
  tab: 'monster-index' | 'visualize' | 'create'; onChange: (tab: Tab) => void; canOpenProcess: boolean;
}) {
  const tabs: Array<{ id: Tab; label: string; note: string }> = [
    { id: 'monster-index', label: 'Monster Index', note: 'numbered entries' },
    { id: 'visualize', label: 'Visualize', note: 'assets + balance' },
    { id: 'create', label: 'Create', note: 'generate + approve' },
  ];
  if (canOpenProcess) tabs.unshift({ id: 'overview', label: 'Process', note: 'owner controls' });
  return (
    <nav className="admin-tabs" aria-label="Local admin studio sections">
      {tabs.map((item) => (
        <button key={item.id} className={cx('admin-tab', tab === item.id && 'is-active')}
          aria-current={tab === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
          <span>{item.label}</span><small>{item.note}</small>
        </button>
      ))}
    </nav>
  );
}

function CommandHeader({ processId, node, loading, isOwner, onRefresh }: {
  processId: string; node: string; loading: boolean; isOwner: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <header className="admin-hero">
      <div className="relative z-[1] flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow flex items-center gap-2 text-element">
            <span className="admin-status-light" /> Live process control
          </div>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            <Cog className="h-7 w-7 text-element" /> Realm command
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Watch the realm, inspect every keeper, intervene in stuck state, and
            leave a durable record of every operational change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && <Badge tone="good"><Check className="h-3 w-3" />Owner verified</Badge>}
          <Button size="sm" variant="ghost" busy={loading}
            onClick={() => void onRefresh()} icon={<Refresh className="h-4 w-4" />}>
            Refresh
          </Button>
        </div>
      </div>
      <div className="admin-process-line relative z-[1] mt-6 grid gap-3 text-[11px] sm:grid-cols-2">
        <div><span>process</span><code>{shortAddress(processId, 10)}</code></div>
        <div><span>node</span><code>{node.replace(/^https?:\/\//, '')}</code></div>
      </div>
    </header>
  );
}

function ReadOnly({ owner }: { owner: string }) {
  return (
    <div className="space-y-4">
      <Panel className="p-6">
        <Empty icon={<Lock />} title="Read-only process view">
          Connect <span className="font-mono">{shortAddress(owner, 7)}</span> to
          load the roster and sign operational changes.
        </Empty>
      </Panel>
      <WorshipHistory />
    </div>
  );
}

function CommandTabs({ tab, onChange, snapshot }: {
  tab: Tab; onChange: (tab: Tab) => void; snapshot: AdminSnapshot;
}) {
  const tabs: Array<{ id: Tab; label: string; note: string }> = [
    { id: 'overview', label: 'Overview', note: `${snapshot.stats.activeToday} active` },
    { id: 'economy', label: 'Economy', note: snapshot.economy?.invariants.ok ? 'exact' : 'attention' },
    { id: 'swarm', label: 'Test swarm', note: `${snapshot.players.filter(({ address }) => SWARM_ADDRESSES.has(address)).length}/50 live` },
    { id: 'players', label: 'Players', note: fmt(snapshot.players.length) },
    { id: 'operations', label: 'Operations', note: `${snapshot.battles.length} live` },
    { id: 'tracking', label: 'Tracking', note: `${Object.keys(snapshot.metrics.daily).length} days` },
    { id: 'monster-index', label: 'Monster Index', note: 'entries + Hunt' },
  ];
  if (import.meta.env.DEV) tabs.push(
    { id: 'visualize', label: 'Visualize', note: 'assets + balance' },
    { id: 'create', label: 'Create', note: 'generate + approve' },
  );
  return (
    <nav className="admin-tabs" aria-label="Admin console sections">
      {tabs.map((item) => (
        <button key={item.id} className={cx('admin-tab', tab === item.id && 'is-active')}
          aria-current={tab === item.id ? 'page' : undefined}
          onClick={() => onChange(item.id)}>
          <span>{item.label}</span><small>{item.note}</small>
        </button>
      ))}
    </nav>
  );
}

function Overview({ snapshot }: { snapshot: AdminSnapshot }) {
  const today = snapshot.metrics.daily[todayKey()];
  const actionCount = today?.actions
    ? Object.values(today.actions).reduce((a, b) => a + (b ?? 0), 0) : 0;
  const worshipToday = snapshot.factions.reduce((sum, f) => sum + f.worshipersToday, 0);
  return (
    <div className="space-y-4">
      <section className="admin-kpi-grid">
        <Kpi icon={<Users />} label="Keepers" value={snapshot.stats.players}
          note={`${snapshot.stats.unlocked} access passes live`} />
        <Kpi icon={<Clock />} label="Active today" value={snapshot.stats.activeToday}
          note={`${fmt(actionCount)} actions tracked`} />
        <Kpi icon={<Rune />} label="Rune held" value={snapshot.stats.runes}
          note="In-game circulation" />
        <Kpi icon={<Sword />} label="Live battles" value={snapshot.stats.activeBattles}
          note={`${fmt(snapshot.stats.completedBattles)} completed`} />
        <Kpi icon={<Trophy />} label="Worship today" value={worshipToday}
          note={`${fmt(snapshot.stats.offerings)} lifetime offerings`} />
        <Kpi icon={<Satchel />} label="Loot boxes" value={snapshot.stats.lootboxes}
          note={`${fmt(snapshot.stats.mintedAssets)} companions minted`} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <ActivityTrend metrics={snapshot.metrics} compact />
        <LiveBattleSummary battles={snapshot.battles} />
      </div>
      <FactionPulse factions={snapshot.factions} />
      <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <WorshipHistory />
        <AuditLog audit={snapshot.audit.slice(0, 8)} />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, note }: {
  icon: JSX.Element; label: string; value: number; note: string;
}) {
  return (
    <Panel className="admin-kpi p-4">
      <div className="relative min-w-0">
        <div className="eyebrow pr-10">{label}</div>
        <div className="carve mt-2 whitespace-nowrap font-mono text-2xl tabular-nums">{fmt(value)}</div>
        <div className="admin-kpi-icon absolute right-0 top-0">{icon}</div>
      </div>
      <p className="mt-3 text-xs text-faint">{note}</p>
    </Panel>
  );
}

function FactionPulse({ factions }: { factions: AdminFactionStats[] }) {
  const largest = Math.max(1, ...factions.map((f) => f.members));
  return (
    <Panel className="p-5">
      <SectionTitle right={<span className="text-[11px] text-faint">Live distribution</span>}>Faction pulse</SectionTitle>
      <div className="grid gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 md:grid-cols-2 xl:grid-cols-4">
        {factions.map((f) => {
          const Icon = ELEMENT_ICON[f.element];
          const decisions = f.wins + f.losses;
          const winRate = decisions ? Math.round((f.wins / decisions) * 100) : 0;
          return (
            <article key={f.name} className="admin-faction-card" data-element={f.element}>
              <div className="flex items-center justify-between gap-2">
                <Icon className="h-5 w-5 text-element" />
                <span className="font-mono text-[10px] text-faint">{winRate}% wins</span>
              </div>
              <h3 className="mt-3 text-base font-semibold">{f.name}</h3>
              <div className="mt-3 h-1.5 bg-raised"><div className="h-full bg-element" style={{ width: `${(f.members / largest) * 100}%` }} /></div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <SmallStat label="Members" value={f.members} />
                <SmallStat label="Rune" value={f.runes} />
                <SmallStat label="Offerings" value={f.offerings} />
                <SmallStat label="Worship today" value={f.worshipersToday} />
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function SmallStat({ label, value }: { label: string; value: number | string }) {
  return <div><div className="text-[10px] uppercase tracking-wide text-faint">{label}</div><div className="mt-0.5 font-mono text-ink">{typeof value === 'number' ? fmt(value) : value}</div></div>;
}

function LiveBattleSummary({ battles }: { battles: AdminBattleSummary[] }) {
  return (
    <Panel className="p-5">
      <SectionTitle right={battles.length ? <Badge tone="warn">{battles.length} live</Badge> : undefined}>Battle watch</SectionTitle>
      {!battles.length ? (
        <Empty icon={<Shield />} title="Arena clear">No active or pending battles.</Empty>
      ) : (
        <div className="space-y-2">
          {battles.slice(0, 5).map((battle) => (
            <div key={battle.id} className="admin-compact-row">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><Badge tone={battle.status === 'battling' ? 'warn' : 'plain'}>{battle.status}</Badge><span className="font-mono text-xs">{battle.id}</span></div>
                <p className="mt-1 truncate font-mono text-[10px] text-faint">
                  {shortAddress(battle.challenger ?? '', 5)} vs {battle.accepter === 'bot'
                    ? 'house' : battle.accepter ? shortAddress(battle.accepter, 5) : 'waiting'}
                </p>
              </div>
              <span className="font-mono text-xs text-muted">R{battle.round}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PlayersView({ snapshot, selected, onSelect, onChanged }: {
  snapshot: AdminSnapshot; selected: string | null;
  onSelect: (address: string) => void; onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [faction, setFaction] = useState('all');
  const [state, setState] = useState('all');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.players.filter((player) => {
      if (needle && ![player.address, player.name, player.faction, player.lastAction]
        .some((v) => v?.toLowerCase().includes(needle))) return false;
      if (faction !== 'all' && player.faction !== faction) return false;
      if (state === 'access' && !player.unlocked) return false;
      if (state === 'locked' && player.unlocked) return false;
      if (state === 'battle' && player.status !== 'Battle' && !player.activeBattleId) return false;
      if (state === 'busy' && ['Home', 'No companion'].includes(player.status)) return false;
      return true;
    });
  }, [snapshot.players, query, faction, state]);

  const chosen = snapshot.players.find((p) => p.address === selected) ?? null;
  return (
    <div className="admin-player-layout">
      <Panel className="min-w-0 overflow-hidden">
        <div className="border-b border-edge/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><div className="eyebrow">Player directory</div><div className="mt-1 text-sm text-muted">{rows.length} of {snapshot.players.length} records</div></div>
            <div className="flex flex-wrap gap-2">
              <select value={faction} onChange={(e) => setFaction(e.target.value)} className="admin-filter">
                <option value="all">All factions</option>{FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={state} onChange={(e) => setState(e.target.value)} className="admin-filter">
                <option value="all">All states</option><option value="access">Access live</option>
                <option value="locked">Revoked</option><option value="battle">In battle</option><option value="busy">Busy</option>
              </select>
            </div>
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wallet, companion, faction or last action"
            className={cx(inputClass, 'mt-3 font-mono text-xs')} />
        </div>
        <div className="admin-roster-scroll overflow-auto">
          <table className="admin-roster-table w-full text-left">
            <thead><tr><th>Keeper</th><th>State</th><th>Rune</th><th>Level</th><th>Record</th><th>Last seen</th></tr></thead>
            <tbody>{rows.map((player) => (
              <tr key={player.address} className={cx(selected === player.address && 'is-selected')} onClick={() => onSelect(player.address)}>
                <td><button className="block w-full text-left" onClick={() => onSelect(player.address)}><span className="block text-sm text-ink">{player.name ?? 'Unsworn keeper'}</span><span className="mt-0.5 block font-mono text-[10px] text-faint">{shortAddress(player.address, 6)}</span></button></td>
                <td><StateBadge player={player} /></td><td className="font-mono text-sm">{fmt(player.inventory.rune)}</td>
                <td className="font-mono text-sm">{player.level}</td><td className="font-mono text-xs">{player.wins}–{player.losses}</td>
                <td className="whitespace-nowrap text-[11px] text-faint">{relativeTime(player.lastActiveAt)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!rows.length && <Empty icon={<Users />} title="No matching players" />}
        </div>
      </Panel>
      <div className="min-w-0">
        {chosen ? <PlayerWorkspace summary={chosen} onChanged={onChanged} /> : (
          <Panel><Empty icon={<Users />} title="Select a keeper">Choose a row to inspect and edit its complete record.</Empty></Panel>
        )}
      </div>
    </div>
  );
}

function StateBadge({ player }: { player: AdminPlayerSummary }) {
  if (!player.unlocked) return <Badge tone="bad">Revoked</Badge>;
  if (player.activeBattleId || player.status === 'Battle') return <Badge tone="warn">Battle</Badge>;
  if (player.status === 'Home') return <Badge tone="good">Home</Badge>;
  if (player.status === 'No companion') return <Badge tone="plain">No companion</Badge>;
  return <Badge tone="element">{player.status}</Badge>;
}

function relativeTime(timestamp: number) {
  if (!timestamp) return 'Never';
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return 'Just now';
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  return `${Math.floor(delta / 86400_000)}d ago`;
}

function PlayerWorkspace({ summary, onChanged }: {
  summary: AdminPlayerSummary; onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.readPlayer(summary.address)
      .then((next) => { if (!cancelled) setPlayer(next); })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [summary.address, toast]);

  const run = async (key: string, action: () => Promise<Player>, message: string) => {
    setBusy(key);
    try {
      const next = await action(); setPlayer(next); toast.success(message); await onChanged(); return next;
    } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); return null; }
    finally { setBusy(null); }
  };

  if (loading || !player) return <Panel className="p-5"><Skeleton className="h-[32rem] w-full" /></Panel>;

  return (
    <div className="admin-player-workspace space-y-4" data-element={player.monster?.elementType}>
      <Panel className="overflow-hidden">
        <div className="admin-player-head p-5">
          <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><StateBadge player={summary} />{player.faction && <Badge tone="element">{player.faction}</Badge>}</div>
              <h2 className="mt-3 truncate text-2xl font-semibold">{player.monster?.name ?? 'Unsworn keeper'}</h2>
              <code className="mt-1 block text-[10px] text-faint">{player.address}</code>
            </div>
            <Button size="sm" variant={editing ? 'primary' : 'ghost'} onClick={() => setEditing((v) => !v)}>{editing ? 'Close editor' : 'Edit full record'}</Button>
          </div>
        </div>
        <div className="grid gap-px border-y border-edge/60 bg-edge/60 sm:grid-cols-4">
          <WorkspaceFact label="Rune" value={fmt(player.inventory.rune)} /><WorkspaceFact label="Record" value={`${player.wins}–${player.losses}`} />
          <WorkspaceFact label="Streak" value={`${player.dailyStreak ?? 0}d`} /><WorkspaceFact label="Last action" value={summary.lastAction?.replace(/^[^.]+\./, '') ?? 'None'} />
        </div>
        {player.monster && <div className="border-b border-edge/60 bg-void/20 p-4"><MonsterCard player={player} bare /></div>}
        <div className="p-4">
          <InventoryAdjuster player={player} busy={busy} onAdjust={(item, delta) => run(
            `inventory:${item}`, async () => (await api.adminAdjustInventory(player.address, item, delta)).player,
            `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} ${ITEM_NAME[item]}.`,
          )} />
          <div className="mt-4 flex flex-wrap gap-2 border-t border-edge/50 pt-4">
            {(player.activeBattleId || player.monster?.status.type === 'Battle') && (
              <Button size="sm" variant="danger" busy={busy === 'release'}
                onClick={() => run('release', async () => (await api.adminReleaseBattle(player.address)).player, 'Player released from battle.')}>Release from battle</Button>
            )}
            <Button size="sm" variant={player.unlocked ? 'danger' : 'ghost'} busy={busy === 'access'}
              onClick={() => run('access', () => api.adminUpdatePlayer(player.address, { account: { unlocked: !player.unlocked } }), player.unlocked ? 'Access revoked.' : 'Access restored.')}>
              {player.unlocked ? 'Revoke access' : 'Restore access'}
            </Button>
            <Button size="sm" variant="ghost" busy={busy === 'refill'} disabled={!player.monster}
              onClick={() => run('refill', () => api.adminUpdatePlayer(player.address, { monster: { energy: 100, happiness: 100 } }), 'Energy and happiness restored.')}>
              Refill companion
            </Button>
            {!player.monster && player.faction && <Button size="sm" variant="ghost" busy={busy === 'create'}
              onClick={() => run('create', () => api.adminUpdatePlayer(player.address, { createMonster: true }), 'Companion created.')}>Create companion</Button>}
          </div>
        </div>
      </Panel>

      {editing && <RecordEditor player={player} busy={busy === 'save'}
        onSave={(patch) => run('save', () => api.adminUpdatePlayer(player.address, patch), 'Player record saved.')} />}

      <Panel className="border border-bad/20 p-4">
        {!confirmDelete ? (
          <div className="flex items-center justify-between gap-4"><div><div className="eyebrow text-bad">Danger zone</div><p className="mt-1 text-xs text-faint">Removal clears battle state first, then deletes this process record.</p></div><Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>Remove player</Button></div>
        ) : (
          <div><p className="text-sm text-ink">Delete <span className="font-mono text-bad">{shortAddress(player.address, 7)}</span>? This cannot be undone.</p><div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" busy={busy === 'delete'} onClick={async () => {
              setBusy('delete');
              try { await api.adminRemove(player.address); toast.success('Player removed.'); await onChanged(); }
              catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
              finally { setBusy(null); }
            }}>Delete permanently</Button><Button size="sm" variant="quiet" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div></div>
        )}
      </Panel>
    </div>
  );
}

function WorkspaceFact({ label, value }: { label: string; value: string }) {
  return <div className="bg-surface/95 p-3"><div className="eyebrow">{label}</div><div className="mt-1 truncate font-mono text-sm text-ink">{value}</div></div>;
}

function InventoryAdjuster({ player, busy, onAdjust }: {
  player: Player; busy: string | null; onAdjust: (item: ItemId, delta: number) => Promise<Player | null>;
}) {
  const [item, setItem] = useState<ItemId>('rune');
  const [amount, setAmount] = useState('5');
  const count = player.inventory[item] ?? 0;
  const delta = Math.max(1, asNumber(amount, 1));
  return (
    <div>
      <div className="flex items-center justify-between gap-3"><div><div className="eyebrow">Balances</div><p className="mt-1 text-xs text-faint">Give or take any in-game item. Balances never fall below zero.</p></div><Badge tone="element">{fmt(count)} held</Badge></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_auto_auto]">
        <select value={item} onChange={(e) => setItem(e.target.value as ItemId)} className={inputClass}>{ITEMS.map((id) => <option key={id} value={id}>{ITEM_NAME[id]} · {fmt(player.inventory[id])}</option>)}</select>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={cx(inputClass, 'font-mono text-center')} />
        <Button size="sm" variant="ghost" busy={busy === `inventory:${item}`} onClick={() => void onAdjust(item, delta)}>Give</Button>
        <Button size="sm" variant="danger" busy={busy === `inventory:${item}`} disabled={count <= 0} onClick={() => void onAdjust(item, -delta)}>Take</Button>
      </div>
    </div>
  );
}

type EditDraft = {
  faction: string;
  account: Record<string, string>;
  inventory: Record<ItemId, string>;
  lootboxes: Record<string, string>;
  monster: Record<string, string>;
};

function draftFrom(player: Player): EditDraft {
  const m = player.monster;
  return {
    faction: player.faction ?? '',
    account: {
      wins: String(player.wins ?? 0), losses: String(player.losses ?? 0), questsCompleted: String(player.questsCompleted ?? 0),
      battlesRemaining: String(player.battlesRemaining ?? 0), dailyStreak: String(player.dailyStreak ?? 0),
      bestStreak: String(player.bestStreak ?? 0), offerings: String(player.offerings ?? 0),
      lastDaily: String(player.lastDaily ?? 0), joinedAt: String(player.joinedAt ?? 0),
    },
    inventory: Object.fromEntries(ITEMS.map((item) => [item, String(player.inventory[item] ?? 0)])) as Record<ItemId, string>,
    lootboxes: Object.fromEntries([1, 2, 3, 4, 5].map((rarity) => [String(rarity), String(player.lootboxes.filter((r) => r === rarity).length)])),
    monster: {
      name: m?.name ?? '', level: String(m?.level ?? 0), exp: String(m?.exp ?? 0), attack: String(m?.attack ?? 1),
      defense: String(m?.defense ?? 1), speed: String(m?.speed ?? 1), health: String(m?.health ?? 1),
      energy: String(m?.energy ?? 0), happiness: String(m?.happiness ?? 0), totalTimesFed: String(m?.totalTimesFed ?? 0),
      totalTimesPlay: String(m?.totalTimesPlay ?? 0), totalTimesQuest: String(m?.totalTimesQuest ?? 0),
      statusType: m?.status.type ?? 'Home', statusSince: String(m?.status.since ?? 0), statusUntil: String(m?.status.until_time ?? 0),
    },
  };
}

function RecordEditor({ player, busy, onSave }: {
  player: Player; busy: boolean; onSave: (patch: AdminPlayerPatch) => Promise<Player | null>;
}) {
  const [draft, setDraft] = useState<EditDraft>(() => draftFrom(player));
  const [reroll, setReroll] = useState(false);
  useEffect(() => { setDraft(draftFrom(player)); setReroll(false); }, [player]);
  const accountField = (key: string, value: string) => setDraft((d) => ({ ...d, account: { ...d.account, [key]: value } }));
  const monsterField = (key: string, value: string) => setDraft((d) => ({ ...d, monster: { ...d.monster, [key]: value } }));

  const save = () => {
    const account = {
      faction: draft.faction,
      wins: asNumber(draft.account.wins), losses: asNumber(draft.account.losses),
      questsCompleted: asNumber(draft.account.questsCompleted), battlesRemaining: asNumber(draft.account.battlesRemaining),
      dailyStreak: asNumber(draft.account.dailyStreak), bestStreak: asNumber(draft.account.bestStreak),
      offerings: asNumber(draft.account.offerings), lastDaily: asNumber(draft.account.lastDaily), joinedAt: asNumber(draft.account.joinedAt),
    };
    const inventory = Object.fromEntries(ITEMS.map((item) => [item, Math.max(0, asNumber(draft.inventory[item]))])) as Partial<Record<ItemId, number>>;
    const lootboxes = Object.fromEntries(Object.entries(draft.lootboxes).map(([k, v]) => [k, Math.max(0, asNumber(v))]));
    const monster = player.monster ? {
      name: draft.monster.name, level: asNumber(draft.monster.level), exp: asNumber(draft.monster.exp),
      attack: asNumber(draft.monster.attack, 1), defense: asNumber(draft.monster.defense, 1),
      speed: asNumber(draft.monster.speed, 1), health: asNumber(draft.monster.health, 1),
      energy: asNumber(draft.monster.energy), happiness: asNumber(draft.monster.happiness),
      totalTimesFed: asNumber(draft.monster.totalTimesFed), totalTimesPlay: asNumber(draft.monster.totalTimesPlay),
      totalTimesQuest: asNumber(draft.monster.totalTimesQuest),
      status: { type: draft.monster.statusType as ActivityType, since: asNumber(draft.monster.statusSince), until_time: asNumber(draft.monster.statusUntil) },
      rerollMoves: reroll,
    } : undefined;
    void onSave({ account, inventory, lootboxes, monster,
      clearBattle: !!player.activeBattleId && draft.monster.statusType === 'Home' });
  };

  return (
    <Panel className="p-5">
      <SectionTitle right={<Badge tone="warn">Exact values</Badge>}>Full record editor</SectionTitle>
      <p className="text-xs leading-relaxed text-faint">Saving replaces the values shown below. Use the balance control above for a quick auditable delta.</p>
      <EditorSection title="Account">
        <Field label="Faction"><select value={draft.faction} onChange={(e) => setDraft((d) => ({ ...d, faction: e.target.value }))} className={inputClass}>{!player.monster && <option value="">No faction</option>}{FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}</select></Field>
        {Object.entries({ wins: 'Wins', losses: 'Losses', questsCompleted: 'Quests', battlesRemaining: 'Battles left', dailyStreak: 'Daily streak', bestStreak: 'Best streak', offerings: 'Offerings', lastDaily: 'Last daily · ms', joinedAt: 'Joined · ms' }).map(([key, label]) => (
          <NumberField key={key} label={label} value={draft.account[key]} onChange={(v) => accountField(key, v)} />
        ))}
      </EditorSection>
      <EditorSection title="Inventory balances">{ITEMS.map((item) => <NumberField key={item} label={ITEM_NAME[item]} value={draft.inventory[item]} onChange={(value) => setDraft((d) => ({ ...d, inventory: { ...d.inventory, [item]: value } }))} />)}</EditorSection>
      <EditorSection title="Loot boxes">{[1, 2, 3, 4, 5].map((rarity) => <NumberField key={rarity} label={`Tier ${rarity}`} value={draft.lootboxes[String(rarity)]} onChange={(value) => setDraft((d) => ({ ...d, lootboxes: { ...d.lootboxes, [String(rarity)]: value } }))} />)}</EditorSection>
      {player.monster && <EditorSection title="Companion">
        <Field label="Name"><input value={draft.monster.name} onChange={(e) => monsterField('name', e.target.value)} className={inputClass} /></Field>
        {Object.entries({ level: 'Level', exp: 'Experience', attack: 'Attack', defense: 'Defense', speed: 'Speed', health: 'Health', energy: 'Energy', happiness: 'Happiness', totalTimesFed: 'Times fed', totalTimesPlay: 'Times played', totalTimesQuest: 'Times quested' }).map(([key, label]) => <NumberField key={key} label={label} value={draft.monster[key]} onChange={(v) => monsterField(key, v)} />)}
        <Field label="Activity"><select value={draft.monster.statusType} onChange={(e) => monsterField('statusType', e.target.value)} className={inputClass}>{(['Home', 'Play', 'Quest', 'Hunt', 'Battle', 'Minting'] as ActivityType[]).map((type) => <option key={type}>{type}</option>)}</select></Field>
        <NumberField label="Activity since · ms" value={draft.monster.statusSince} onChange={(v) => monsterField('statusSince', v)} />
        <NumberField label="Activity until · ms" value={draft.monster.statusUntil} onChange={(v) => monsterField('statusUntil', v)} />
        <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted"><input type="checkbox" checked={reroll} onChange={(e) => setReroll(e.target.checked)} /> Reroll moveset</label>
      </EditorSection>}
      <div className="mt-5 flex justify-end"><Button variant="primary" busy={busy} onClick={save}>Save complete record</Button></div>
    </Panel>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset className="mt-5 border-t border-edge/50 pt-4"><legend className="eyebrow pr-3">{title}</legend><div className="mt-1 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div></fieldset>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-faint">{label}</span>{children}</label>;
}
function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <Field label={label}><input type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} className={cx(inputClass, 'font-mono')} /></Field>;
}

function Operations({ snapshot, onChanged }: { snapshot: AdminSnapshot; onChanged: () => Promise<void> }) {
  return <div className="space-y-4"><ActiveBattles battles={snapshot.battles} onChanged={onChanged} /><div className="grid gap-4 xl:grid-cols-2"><UnlockPanel onDone={onChanged} /><EconomyInventory snapshot={snapshot} /></div><AdjustAllPanel players={snapshot.stats.players} /></div>;
}

function ActiveBattles({ battles, onChanged }: { battles: AdminBattleSummary[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const release = async (battle: AdminBattleSummary) => {
    const target = battle.challenger ?? battle.accepter;
    if (!target || target === 'bot') return;
    setBusy(battle.id);
    try { const result = await api.adminReleaseBattle(target); toast.success(`Released ${result.released.length} participant${result.released.length === 1 ? '' : 's'} from ${battle.id}.`); await onChanged(); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(null); }
  };
  return (
    <Panel className="overflow-hidden">
      <div className="p-5"><SectionTitle right={<Badge tone={battles.length ? 'warn' : 'good'}>{battles.length} live</Badge>}>Arena intervention</SectionTitle><p className="text-xs text-faint">A release cancels the battle without awarding a win, clears both players, and returns their companions home.</p></div>
      {!battles.length ? <Empty icon={<Shield />} title="No intervention needed" /> : <div className="overflow-auto border-t border-edge/50"><table className="admin-roster-table w-full text-left"><thead><tr><th>Battle</th><th>State</th><th>Challenger</th><th>Opponent</th><th>Started</th><th /></tr></thead><tbody>{battles.map((battle) => <tr key={battle.id}>
        <td className="font-mono text-xs">{battle.id}</td><td><Badge tone={battle.status === 'battling' ? 'warn' : 'plain'}>{battle.status} · R{battle.round}</Badge></td>
        <td className="font-mono text-[11px]">{shortAddress(battle.challenger ?? '', 6)}</td><td className="font-mono text-[11px]">{battle.accepter === 'bot' ? 'House' : battle.accepter ? shortAddress(battle.accepter, 6) : 'Waiting'}</td>
        <td className="text-[11px] text-faint">{when(battle.startedAt)}</td><td className="text-right"><Button size="sm" variant="danger" busy={busy === battle.id} onClick={() => void release(battle)}>Release</Button></td>
      </tr>)}</tbody></table></div>}
    </Panel>
  );
}

function EconomyInventory({ snapshot }: { snapshot: AdminSnapshot }) {
  return <Panel className="p-5"><SectionTitle right={<span className="font-mono text-[11px] text-faint">all wallets</span>}>Realm inventory</SectionTitle><div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 sm:grid-cols-3">{ITEMS.map((item) => <div key={item} className="bg-void/55 p-3"><div className="truncate text-[10px] uppercase tracking-wide text-faint">{ITEM_NAME[item]}</div><div className="mt-1 font-mono text-lg text-ink">{fmt(snapshot.stats.items[item])}</div></div>)}</div></Panel>;
}

const ECONOMY_DIALS: Array<{
  path: string; label: string; kind?: 'boolean' | 'split'; note: string;
}> = [
  { path: 'gold.perQualifiedPlayer', label: 'Gold per qualified player', note: 'Long-run target input' },
  { path: 'gold.normalWeeklyReleaseBps', label: 'Weekly Gold release / bps', note: 'Hard ceiling remains 1000 bps' },
  { path: 'gold.shopBurnBps', label: 'NPC-sale policy share / bps', note: 'Burned only above the upper corridor; otherwise policy-locked' },
  { path: 'gold.burnBelowTargetBps', label: 'Gold corridor lower / bps', note: 'Below this level fees remain policy-locked' },
  { path: 'gold.burnAboveTargetBps', label: 'Gold corridor upper / bps', note: 'Above this level normal burns operate' },
  { path: 'gold.expansionEnabled', label: 'Gold expansion enabled', kind: 'boolean', note: 'Open qualification policy should be approved first' },
  { path: 'qualification.enabled', label: 'Qualified-player policy enabled', kind: 'boolean', note: 'Uses the visible candidate definition' },
  { path: 'runeRewards.epochBudget', label: 'Global Rune / epoch', note: 'Zero keeps issuance paused' },
  { path: 'runeRewards.enabled', label: 'Global Rune rewards enabled', kind: 'boolean', note: 'Never restores a per-wallet stipend' },
  { path: 'amm.maxSlippageBps', label: 'Rune acquisition slippage / bps', note: 'Execution hard rail' },
  { path: 'amm.maxWeeklyPoolBps', label: 'Weekly AMM reserve spend / bps', note: 'Execution hard rail' },
  { path: 'proceeds.split', label: 'Paid proceeds split', kind: 'split', note: 'Team + Rune acquisition + treasury must total 10000 bps' },
  { path: 'emergency.paused', label: 'Economy emergency state', kind: 'boolean', note: 'Disabling a pause is delayed; enabling it here is also delayed' },
  ...(['air_berry', 'water_berry', 'fire_berry', 'rock_berry', 'scroll', 'rune'] as GoldMarketItemId[])
    .flatMap((item) => [
      { path: `desks.${item}.bidBps`, label: `${ITEM_NAME[item]} bid multiplier`, note: 'Normal movement capped at 5% per seven days' },
      { path: `desks.${item}.askBps`, label: `${ITEM_NAME[item]} ask multiplier`, note: 'Normal movement capped at 5% per seven days' },
      { path: `desks.${item}.stockBps`, label: `${ITEM_NAME[item]} stock target / bps`, note: 'Percentage of tracked total supply' },
      { path: `desks.${item}.stockMax`, label: `${ITEM_NAME[item]} maximum stock`, note: 'Absolute cap; lower of cap and supply percentage wins' },
      { path: `desks.${item}.goldReserve`, label: `${ITEM_NAME[item]} Gold allocation`, note: 'Moves Gold to or from the locked policy reserve' },
      { path: `desks.${item}.limits.perAction`, label: `${ITEM_NAME[item]} per-action limit`, note: 'Applies independently to each player-facing side' },
      { path: `desks.${item}.limits.perAccount`, label: `${ITEM_NAME[item]} 20h account limit`, note: 'Applies independently to each player-facing side' },
      { path: `desks.${item}.limits.global`, label: `${ITEM_NAME[item]} 20h global limit`, note: 'Applies independently to each player-facing side' },
      { path: `desks.${item}.enabled.buy`, label: `${ITEM_NAME[item]} NPC sell side`, kind: 'boolean' as const, note: 'Enabling or resuming applies only after the delay' },
      { path: `desks.${item}.enabled.sell`, label: `${ITEM_NAME[item]} NPC buy side`, kind: 'boolean' as const, note: 'Enabling or resuming applies only after the delay' },
    ]),
];

function EconomyAdmin({ economy, onChanged }: {
  economy?: EconomyView; onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [dial, setDial] = useState(ECONOMY_DIALS[0].path);
  const selectedDial = ECONOMY_DIALS.find((entry) => entry.path === dial) ?? ECONOMY_DIALS[0];
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{
    path: string; oldValue: unknown; newValue: unknown;
    effectiveAt: number; effect?: Record<string, unknown>;
  } | null>(null);
  const [busy, setBusy] = useState('');
  const [runeSupply, setRuneSupply] = useState('');
  const [releaseItem, setReleaseItem] = useState<GoldMarketItemId>('rune');
  const [releaseAmount, setReleaseAmount] = useState('');
  const [split, setSplit] = useState({ teamBps: '5000', runeBps: '3000', treasuryBps: '2000' });
  const [promisedText, setPromisedText] = useState('');
  const [promiseHash, setPromiseHash] = useState('');
  const [promiseSlots, setPromiseSlots] = useState('0');
  const [promiseDeadline, setPromiseDeadline] = useState('');

  if (!economy) return <Panel className="p-6"><Empty icon={<Rune />} title="Economy state is not published">Deploy the integrated economy contract to enable exact ledgers and controls.</Empty></Panel>;

  const parsedValue = selectedDial.kind === 'split'
    ? { teamBps: asNumber(split.teamBps), runeBps: asNumber(split.runeBps), treasuryBps: asNumber(split.treasuryBps) }
    : selectedDial.kind === 'boolean' ? value === 'true' : asNumber(value);
  const valueReady = selectedDial.kind === 'split'
    ? Object.values(parsedValue as Record<string, number>).reduce((sum, part) => sum + part, 0) === 10000
    : value !== '';
  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try { await fn(); toast.success(message); await onChanged(); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  };
  const doPreview = async () => {
    setBusy('preview');
    try { setPreview(await api.adminPreviewEconomyPolicy(dial, parsedValue)); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  };
  const doPropose = () => {
    if (!reason.trim()) { toast.error('A public reason is required.'); return; }
    void act('propose', () => api.adminProposeEconomyPolicy(dial, parsedValue, reason.trim()),
      'Policy change scheduled with its public delay.').then(() => setPreview(null));
  };
  const pauseDesk = (item: GoldMarketItemId, side: GoldOrderSide) => {
    if (!reason.trim()) { toast.error('Use the reason field before pausing a desk.'); return; }
    void act(`pause-${item}-${side}`, () => api.adminPauseEconomyDesk(item, side, reason.trim()),
      `${ITEM_NAME[item]} ${side} side paused.`);
  };
  const pending = Object.values(economy.policy.pending ?? {}) as EconomyPolicyChange[];
  const rune = economy.invariants.rune;
  const promisedAddresses = extractAddresses(promisedText);

  return <div className="space-y-4">
    <section className="admin-kpi-grid">
      <Kpi icon={<Rune />} label="Gold issued" value={economy.gold.issued} note={`${fmt(economy.gold.burned)} burned`} />
      <Kpi icon={<Satchel />} label="Outstanding" value={economy.gold.outstanding} note={`target ${fmt(economy.gold.target)}`} />
      <Kpi icon={<Lock />} label="P2P escrow" value={economy.gold.escrow} note={`${fmt(economy.orders.length)} open orders`} />
      <Kpi icon={<Shield />} label="Shop reserves" value={economy.gold.shop} note={`${fmt(economy.gold.locked)} policy-locked`} />
      <Kpi icon={<Users />} label="Qualified" value={economy.gold.qualifiedActive} note={`${fmt(economy.gold.candidateQualifiedActive)} candidates`} />
      <Kpi icon={<Check />} label="Invariants" value={economy.invariants.ok ? 1 : 0} note={economy.invariants.ok ? 'All equations exact' : 'Affected desks paused'} />
    </section>

    <GoldFloat gold={economy.gold} />

    {!economy.invariants.ok && <div className="rounded-[3px] border border-bad/45 bg-bad/[0.06] px-4 py-3 text-sm text-ink"><b>Accounting mismatch.</b> Inspect the differences below before resuming any desk.</div>}
    <Panel className="p-5">
      <SectionTitle right={<Badge tone={economy.policy.passes.genesisSealed ? 'good' : 'warn'}>{economy.policy.passes.genesisSealed ? 'genesis sealed' : 'pre-launch only'}</Badge>}>Eternal Pass policy</SectionTitle>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 sm:grid-cols-4 lg:grid-cols-6"><MiniMetric label="Genesis" value={economy.passQuote.genesisPassCount} /><MiniMetric label="Lifetime" value={economy.passQuote.lifetimePassCount} /><MiniMetric label="Legacy" value={economy.policy.passes.legacyCount} /><MiniMetric label="Promised" value={economy.policy.passes.promisedCount} /><MiniMetric label="Next reference ¢" value={economy.passQuote.next} /><MiniMetric label="Foregone Rune-buy ¢" value={economy.policy.passes.foregoneRuneAcquisitionReference} /></div>
      <p className="mt-3 text-xs leading-relaxed text-faint">The pass is non-transferable. Recovery moves the complete account and preserves maturity, balances, orders, limits, and history. Purchase remains disabled until an on-chain payment asset is selected.</p>
      {!economy.policy.passes.genesisSealed && <div className="mt-4 grid gap-3 border-t border-edge/50 pt-4 lg:grid-cols-2"><label><span className="eyebrow mb-1.5 block">Promised wallet manifest</span><textarea className={cx(inputClass, 'min-h-28 resize-y font-mono text-xs')} value={promisedText} onChange={(event) => setPromisedText(event.target.value)} placeholder="Wallet addresses" /></label><div className="space-y-3"><Field label="Published commitment hash"><input className={cx(inputClass, 'font-mono')} value={promiseHash} onChange={(event) => setPromiseHash(event.target.value)} /></Field><div className="grid grid-cols-2 gap-3"><NumberField label="Unassigned slots" value={promiseSlots} onChange={setPromiseSlots} /><Field label="Claim deadline"><input className={inputClass} type="datetime-local" value={promiseDeadline} onChange={(event) => setPromiseDeadline(event.target.value)} /></Field></div><Button variant="danger" busy={busy === 'seal-genesis'} disabled={!promiseHash || (!promisedAddresses.length && asNumber(promiseSlots) === 0)} onClick={() => void act('seal-genesis', () => api.adminConfigureGenesisPasses({ addresses: promisedAddresses, commitmentHash: promiseHash, unassignedSlots: asNumber(promiseSlots), claimDeadline: promiseDeadline ? new Date(promiseDeadline).getTime() : 0 }), 'Genesis pass manifest permanently sealed.')}>Seal {promisedAddresses.length} promised pass{promisedAddresses.length === 1 ? '' : 'es'}</Button></div></div>}
    </Panel>
    <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <Panel className="overflow-hidden">
        <div className="p-5"><SectionTitle right={<Badge tone={economy.invariants.ok ? 'good' : 'bad'}>{economy.invariants.ok ? 'exact' : 'paused'}</Badge>}>Asset supply equations</SectionTitle></div>
        <div className="overflow-auto border-t border-edge/50"><table className="admin-roster-table w-full text-left"><thead><tr><th>Asset</th><th>Issued</th><th>Consumed</th><th>Players</th><th>Escrow</th><th>Shop</th><th>7d issue / use</th><th>Difference</th></tr></thead><tbody>
          {Object.entries(economy.assets).map(([id, row]) => <tr key={id}><td>{ITEM_NAME[id as ItemId] ?? id}</td><td className="font-mono">{fmt(row.issued)}</td><td className="font-mono">{fmt(row.consumed)}</td><td className="font-mono">{fmt(row.player)}</td><td className="font-mono">{fmt(row.escrow)}</td><td className="font-mono">{fmt(row.shop)}</td><td className="font-mono text-xs">{fmt(row.rolling7d.issued)} / {fmt(row.rolling7d.consumed)}</td><td><Badge tone={economy.invariants.assets[id as GoldMarketItemId]?.difference === 0 ? 'good' : 'bad'}>{fmt(economy.invariants.assets[id as GoldMarketItemId]?.difference)}</Badge></td></tr>)}
        </tbody></table></div>
      </Panel>
      <Panel className="p-5">
        <SectionTitle right={<Badge tone={rune.difference === undefined ? 'warn' : rune.difference === 0 ? 'good' : 'bad'}>{rune.difference === undefined ? 'awaiting token' : `diff ${fmt(rune.difference)}`}</Badge>}>Rune reconciliation</SectionTitle>
        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60">
          <MiniMetric label="Inside game" value={rune.inGame} /><MiniMetric label="Outside token" value={rune.outsideTokenSupply ?? 0} />
          <MiniMetric label="Pending out" value={rune.pendingWithdrawals} /><MiniMetric label="Pending in" value={rune.pendingDeposits} />
          <MiniMetric label="Economic" value={rune.economic} /><MiniMetric label="Accounted" value={rune.accounted} />
        </div>
        <div className="mt-4 space-y-2"><input className={cx(inputClass, 'font-mono')} inputMode="numeric" value={runeSupply} onChange={(event) => setRuneSupply(event.target.value)} placeholder="Published token total supply" /><Button className="w-full" busy={busy === 'rune-observe'} onClick={() => void act('rune-observe', () => api.adminObserveRuneSupply(asNumber(runeSupply), reason || 'token reconciliation'), 'Rune supply observation recorded.')}>Record token observation</Button></div>
      </Panel>
    </div>

    <Panel className="overflow-hidden">
      <div className="p-5"><SectionTitle right={<Badge tone="warn">NPC counterparties</Badge>}>Finite shop desks</SectionTitle><p className="text-xs text-faint">Pausing is immediate. Repricing or resuming must go through delayed policy.</p></div>
      <div className="overflow-auto border-t border-edge/50"><table className="admin-roster-table w-full text-left"><thead><tr><th>Desk</th><th>Stock / cap</th><th>Gold reserve</th><th>Bid / ask</th><th>Band</th><th>Limits A / acct / global</th><th>Pauses</th><th /></tr></thead><tbody>{Object.entries(economy.desks).map(([id, desk]) => desk && <tr key={id}><td>{ITEM_NAME[id as ItemId]}</td><td className="font-mono">{fmt(desk.stock)} / {fmt(desk.stockCap)}</td><td className="font-mono">{fmt(desk.goldReserve)}</td><td className="font-mono">{fmt(desk.bid)} / {fmt(desk.ask)}</td><td className="font-mono">{desk.band ?? '--'}</td><td className="font-mono text-xs">{desk.limits.perAction} / {desk.limits.perAccount} / {desk.limits.global}</td><td className="max-w-56 text-[11px] text-faint">{desk.pause.sell && `NPC buy: ${desk.pause.sell}`}{desk.pause.sell && desk.pause.buy && <br />}{desk.pause.buy && `NPC sell: ${desk.pause.buy}`}</td><td><div className="flex gap-1"><Button size="sm" variant="danger" busy={busy === `pause-${id}-sell`} onClick={() => pauseDesk(id as GoldMarketItemId, 'sell')}>Pause buy</Button><Button size="sm" variant="danger" busy={busy === `pause-${id}-buy`} onClick={() => pauseDesk(id as GoldMarketItemId, 'buy')}>Pause sell</Button></div></td></tr>)}</tbody></table></div>
    </Panel>

    <div className="grid gap-4 xl:grid-cols-2">
      <Panel className="p-5">
        <SectionTitle right={<Badge tone="plain">24h delay</Badge>}>Policy proposal</SectionTitle>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label><span className="eyebrow mb-1.5 block">Dial</span><select className={inputClass} value={dial} onChange={(event) => { setDial(event.target.value); setPreview(null); setValue(''); }}>{ECONOMY_DIALS.map((entry) => <option key={entry.path} value={entry.path}>{entry.label}</option>)}</select></label>{selectedDial.kind !== 'split' && <label><span className="eyebrow mb-1.5 block">New value</span>{selectedDial.kind === 'boolean' ? <select className={inputClass} value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose</option><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input className={cx(inputClass, 'font-mono')} inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} />}</label>}</div>
        {selectedDial.kind === 'split' && <div className="mt-3 grid grid-cols-3 gap-3"><NumberField label="Team / bps" value={split.teamBps} onChange={(teamBps) => setSplit((current) => ({ ...current, teamBps }))} /><NumberField label="Rune buy / bps" value={split.runeBps} onChange={(runeBps) => setSplit((current) => ({ ...current, runeBps }))} /><NumberField label="Treasury / bps" value={split.treasuryBps} onChange={(treasuryBps) => setSplit((current) => ({ ...current, treasuryBps }))} /></div>}
        <p className="mt-2 text-xs text-faint">{selectedDial.note}</p>
        <label className="mt-3 block"><span className="eyebrow mb-1.5 block">Public reason</span><textarea className={cx(inputClass, 'min-h-20 resize-y')} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="mt-3 flex flex-wrap gap-2"><Button busy={busy === 'preview'} disabled={!valueReady} onClick={() => void doPreview()}>Preview</Button><Button variant="primary" busy={busy === 'propose'} disabled={!preview || !reason.trim()} onClick={doPropose}>Schedule</Button><Button variant="quiet" busy={busy === 'observe-gold'} disabled={!reason.trim()} onClick={() => void act('observe-gold', () => api.adminObserveGoldPolicy(reason.trim()), 'Weekly Gold target observation recorded.')}>Observe Gold target</Button></div>
        {preview && <div className="mt-4 rounded-[3px] border border-element/25 bg-element/[0.04] p-3 text-xs"><b>{typeof preview.oldValue === 'object' ? JSON.stringify(preview.oldValue) : String(preview.oldValue)} → {typeof preview.newValue === 'object' ? JSON.stringify(preview.newValue) : String(preview.newValue)}</b><p className="mt-1 text-faint">Effective no earlier than {when(preview.effectiveAt)}. Gold target: {fmt(Number(preview.effect?.goldTargetBefore))} → {fmt(Number(preview.effect?.goldTargetAfter))}.</p></div>}
      </Panel>
      <Panel className="p-5">
        <SectionTitle right={<Badge tone={economy.policy.emergency.paused ? 'bad' : 'good'}>{economy.policy.emergency.paused ? 'paused' : 'running'}</Badge>}>Circuit breakers</SectionTitle>
        <p className="mt-2 text-xs text-faint">Emergency pause is immediate. Resume is deliberately unavailable without a delayed policy action.</p>
        <Button className="mt-4" variant="danger" busy={busy === 'emergency'} disabled={!reason.trim() || economy.policy.emergency.paused} onClick={() => void act('emergency', () => api.adminEmergencyPauseEconomy(reason.trim()), 'All economy desks paused.')}>Emergency pause all</Button>
        <div className="mt-5 border-t border-edge/50 pt-4"><div className="eyebrow">Authorized Gold release</div><div className="mt-2 grid grid-cols-[1fr_7rem] gap-2"><select className={inputClass} value={releaseItem} onChange={(event) => setReleaseItem(event.target.value as GoldMarketItemId)}>{Object.keys(economy.desks).map((id) => <option key={id} value={id}>{ITEM_NAME[id as ItemId]}</option>)}</select><input className={cx(inputClass, 'font-mono')} inputMode="numeric" value={releaseAmount} onChange={(event) => setReleaseAmount(event.target.value)} placeholder="Gold" /></div><Button className="mt-2 w-full" busy={busy === 'release-gold'} disabled={!releaseAmount || !reason.trim()} onClick={() => void act('release-gold', () => api.adminReleaseGold(releaseItem, asNumber(releaseAmount), reason.trim()), 'Authorized Gold released to the named desk.')}>Release to desk</Button></div>
        <div className="mt-5 border-t border-edge/50 pt-4"><div className="eyebrow">Pending changes</div>{pending.length ? <div className="mt-2 space-y-2">{pending.map((change) => <div key={change.id} className="rounded-[3px] border border-edge/60 bg-void/40 p-3"><div className="flex items-start justify-between gap-3"><div><b className="text-sm">{change.path}</b><p className="mt-1 text-xs text-faint">{String(change.oldValue)} → {String(change.newValue)} · {when(change.effectiveAt)}</p><p className="mt-1 text-xs text-muted">{change.reason}</p></div><Button size="sm" disabled={Date.now() < change.effectiveAt} busy={busy === `apply-${change.id}`} onClick={() => void act(`apply-${change.id}`, () => api.adminApplyEconomyPolicy(change.id), 'Delayed policy applied.')}>Apply</Button></div></div>)}</div> : <p className="mt-2 text-xs text-faint">No pending policy changes.</p>}</div>
      </Panel>
    </div>
  </div>;
}

/**
 * Where the Gold actually is.
 *
 * `issued` and `outstanding` were both on the board and neither answered the
 * only question anyone asks: how much of it is in play. Gold has exactly one
 * source — the launch allocation — and no verb mints more, so the four buckets
 * below are the whole supply, and the first of them is the entire circulating
 * float. `player + escrow + shop + locked == issued - burned` is the invariant
 * the process refuses to run without; this is that equation, drawn.
 */
function GoldFloat({ gold }: { gold: EconomyView['gold'] }) {
  const buckets = [
    { key: 'player', label: 'In players’ hands', value: gold.player, tone: 'bg-good' },
    { key: 'escrow', label: 'Locked in open orders', value: gold.escrow, tone: 'bg-arcane' },
    { key: 'shop', label: 'Shop desk reserves', value: gold.shop, tone: 'bg-rune' },
    { key: 'locked', label: 'Policy-locked', value: gold.locked, tone: 'bg-edge' },
  ];
  const total = Math.max(1, buckets.reduce((sum, row) => sum + row.value, 0));
  const share = (value: number) => `${(value / total * 100).toFixed(value / total < 0.01 ? 2 : 1)}%`;
  return (
    <Panel className="p-5">
      <SectionTitle right={<Badge tone="plain">{fmt(gold.issued - gold.burned)} outstanding</Badge>}>
        Where the Gold is
      </SectionTitle>
      <div className="flex h-2.5 overflow-hidden rounded-[2px] border border-edge/60" role="presentation">
        {buckets.map((row) => (
          <div key={row.key} className={row.tone} style={{ width: `${row.value / total * 100}%` }}
               title={`${row.label}: ${fmt(row.value)}`} />
        ))}
      </div>
      <div className="mt-3 grid gap-px overflow-hidden rounded-[3px] border border-edge/60 bg-edge/60 sm:grid-cols-2 lg:grid-cols-4">
        {buckets.map((row) => (
          <MiniMetric key={row.key} label={`${row.label} / ${share(row.value)}`} value={row.value} />
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        No verb mints Gold; the launch allocation is all there will be until expansion is
        enabled. It reaches a player only when a shop desk buys an item from them or another
        player&rsquo;s order fills, so the first bucket is the entire circulating float.
      </p>
    </Panel>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return <div className="bg-void/55 p-3"><div className="text-[9px] uppercase tracking-wide text-faint">{label}</div><div className="mt-1 font-mono text-lg">{fmt(value)}</div></div>;
}

function UnlockPanel({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const addresses = extractAddresses(text);
  const submit = async () => {
    if (!addresses.length) return;
    setBusy(true); let added = 0;
    try { for (let i = 0; i < addresses.length; i += 50) { setProgress(`${Math.min(i + 50, addresses.length)} / ${addresses.length}`); added += (await api.adminUnlock(addresses.slice(i, i + 50))).added; } toast.success(`${added} newly unlocked.`); setText(''); await onDone(); }
    catch (err) { toast.error(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); setProgress(null); }
  };
  return <Panel className="p-5"><SectionTitle right={<span className="font-mono text-xs text-faint">{addresses.length} found</span>}>Grant access</SectionTitle><p className="mb-3 text-xs leading-relaxed text-faint">Paste a list, CSV, JSON or message. Only valid 43-character addresses are extracted.</p><textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} spellCheck={false} placeholder="Paste wallet addresses" className={cx(inputClass, 'resize-y font-mono text-xs leading-relaxed')} /><div className="mt-3 flex items-center gap-3"><Button variant="primary" busy={busy} disabled={!addresses.length} onClick={() => void submit()} icon={<Users className="h-4 w-4" />}>Unlock {addresses.length || ''}</Button>{progress && <span className="font-mono text-xs text-muted">{progress}</span>}</div></Panel>;
}

function AdjustAllPanel({ players }: { players: number }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({ energy: '', happiness: '', attack: '', defense: '', speed: '', health: '' });
  const [reroll, setReroll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const num = (value: string) => value.trim() === '' ? undefined : asNumber(value);
  const opts = { energy: num(values.energy), happiness: num(values.happiness), attack: num(values.attack), defense: num(values.defense), speed: num(values.speed), health: num(values.health), rerollMoves: reroll || undefined };
  const nothing = Object.values(opts).every((v) => v === undefined || v === 0);
  const apply = async () => { setBusy(true); try { const result = await api.adminAdjustAll(opts); toast.success(`Adjusted ${result.adjusted} companions; ${result.skipped} skipped.`); setConfirming(false); } catch (err) { toast.error(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } };
  return <Panel className="p-5"><SectionTitle right={<span className="font-mono text-[11px] text-faint">{players} players</span>}>Global rebalance</SectionTitle><p className="text-xs leading-relaxed text-faint">Energy and happiness are set. Combat stats add a delta. Blank values are left untouched.</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.keys(values).map((key) => <NumberField key={key} label={key} value={values[key]} onChange={(value) => setValues((current) => ({ ...current, [key]: value }))} />)}</div><label className="mt-4 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={reroll} onChange={(e) => setReroll(e.target.checked)} />Reroll every moveset</label>{!confirming ? <Button className="mt-4" variant="ghost" disabled={nothing} onClick={() => setConfirming(true)}>Review global change</Button> : <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-warn/40 bg-warn/[.04] p-4"><p className="text-sm text-ink">Apply these values to every companion? This cannot be undone.</p><div className="flex gap-2"><Button size="sm" variant="danger" busy={busy} onClick={() => void apply()}>Apply to all</Button><Button size="sm" variant="quiet" onClick={() => setConfirming(false)}>Cancel</Button></div></div>}</Panel>;
}

function Tracking({ snapshot }: { snapshot: AdminSnapshot }) {
  return <div className="space-y-4"><ActivityTrend metrics={snapshot.metrics} /><EconomyTrend metrics={snapshot.metrics} /><div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><WorshipHistory /><AuditLog audit={snapshot.audit} /></div></div>;
}

type DayRow = AdminMetricDay & { day: number };
function metricDays(metrics: AdminMetrics, limit = 30): DayRow[] {
  return Object.entries(metrics.daily).map(([day, row]) => ({ ...row, day: Number(day) }))
    .filter((row) => Number.isFinite(row.day)).sort((a, b) => a.day - b.day).slice(-limit);
}

function ActivityTrend({ metrics, compact = false }: { metrics: AdminMetrics; compact?: boolean }) {
  const days = metricDays(metrics, compact ? 21 : 45);
  const series = [
    { key: 'activePlayers', label: 'Active keepers', color: '#B9A6FF' },
    { key: 'worshipClaims', label: 'Worship', color: '#4AB0FF' },
    { key: 'battlesStarted', label: 'Battles', color: '#FF7A43' },
    { key: 'questsCompleted', label: 'Quests', color: '#4AD295' },
  ];
  return <Panel className="p-5"><SectionTitle right={metrics.since ? <span className="font-mono text-[10px] text-faint">tracked since {new Date(metrics.since).toLocaleDateString()}</span> : undefined}>Realm activity</SectionTitle><TrendChart days={days} series={series} empty="Activity tracking begins with the first successful game action after this upgrade." /></Panel>;
}

function EconomyTrend({ metrics }: { metrics: AdminMetrics }) {
  return <Panel className="p-5"><SectionTitle>Rune economy</SectionTitle><TrendChart days={metricDays(metrics, 45)} series={[
    { key: 'runeAdded', label: 'Added', color: '#4AD295' }, { key: 'runeRemoved', label: 'Removed', color: '#FF5E69' },
    { key: 'runes', label: 'Held', color: '#D6C8A2' },
  ]} empty="Rune sources, sinks, and circulation will appear here as actions land." /></Panel>;
}

function TrendChart({ days, series, empty }: {
  days: DayRow[]; series: Array<{ key: string; label: string; color: string }>; empty: string;
}) {
  if (!days.length) return <Empty icon={<Clock />} title="No tracked days yet">{empty}</Empty>;
  const W = 760, H = 210, PX = 18, PY = 18;
  const max = Math.max(1, ...days.flatMap((d) => series.map((s) => Number(d[s.key] ?? 0))));
  const x = (index: number) => PX + (days.length === 1 ? (W - PX * 2) / 2 : (index / (days.length - 1)) * (W - PX * 2));
  const y = (value: number) => H - PY - (value / max) * (H - PY * 2);
  return <div><div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">{series.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-muted"><i className="h-1.5 w-3" style={{ background: s.color }} />{s.label}<b className="font-mono font-normal text-faint">{fmt(Number(days[days.length - 1]?.[s.key] ?? 0))}</b></span>)}</div><svg viewBox={`0 0 ${W} ${H}`} className="admin-trend-chart w-full" role="img" aria-label={`Trend from ${dayToDate(days[0].day)} to ${dayToDate(days[days.length - 1].day)}`}>
    {[0, .25, .5, .75, 1].map((step) => <line key={step} x1={PX} x2={W - PX} y1={y(max * step)} y2={y(max * step)} stroke="rgb(var(--edge))" strokeOpacity=".42" />)}
    {series.map((s) => { const points = days.map((day, i) => `${x(i)},${y(Number(day[s.key] ?? 0))}`).join(' '); return <g key={s.key}><polyline points={points} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />{days.length === 1 && <circle cx={x(0)} cy={y(Number(days[0][s.key] ?? 0))} r="3" fill={s.color} />}</g>; })}
  </svg><div className="mt-1 flex justify-between font-mono text-[9px] text-faint"><span>{dayToDate(days[0].day)}</span><span>{dayToDate(days[days.length - 1].day)}</span></div></div>;
}

function AuditLog({ audit }: { audit: AdminAuditEntry[] }) {
  return <Panel className="p-5"><SectionTitle right={<span className="font-mono text-[10px] text-faint">last {audit.length}</span>}>Intervention log</SectionTitle>{!audit.length ? <Empty icon={<Cog />} title="No interventions yet">Signed admin changes will appear here.</Empty> : <div className="admin-audit-list space-y-1 overflow-auto">{audit.map((entry) => <div key={entry.seq} className="admin-audit-row"><span className="admin-audit-mark" /><div className="min-w-0"><div className="truncate text-xs text-ink">{entry.summary}</div><div className="mt-0.5 truncate font-mono text-[9px] text-faint">{entry.target ? shortAddress(entry.target, 5) : 'realm'} · {when(entry.timestamp)}</div></div></div>)}</div>}</Panel>;
}

const TIERS = [
  { key: 'high', label: '10+ day streak', color: '#B9A6FF' },
  { key: 'medium', label: '3–9 days', color: '#8A6FE8' },
  { key: 'low', label: 'new streak', color: '#5941B8' },
] as const;
type Checkins = Record<string, { high: number; medium: number; low: number }>;

function WorshipHistory() {
  const [data, setData] = useState<Checkins | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showTable, setShowTable] = useState(false);
  useEffect(() => { api.readCheckins().then((d) => setData(d ?? {})).catch(setError); }, []);
  const days = useMemo(() => !data ? [] : Object.entries(data).map(([day, value]) => ({ day: Number(day), high: Number(value?.high ?? 0), medium: Number(value?.medium ?? 0), low: Number(value?.low ?? 0) })).filter((d) => Number.isFinite(d.day)).sort((a, b) => a.day - b.day), [data]);
  if (error) return <Panel className="p-5"><SectionTitle>Worship history</SectionTitle><ErrorNote error={error} /></Panel>;
  if (!data) return <Panel className="p-5"><SectionTitle>Worship history</SectionTitle><Skeleton className="mt-4 h-48 w-full" /></Panel>;
  if (!days.length) return <Panel className="p-5"><SectionTitle>Worship history</SectionTitle><Empty icon={<Trophy />} title="No worship history yet" /></Panel>;
  const totals = days.reduce((a, d) => ({ high: a.high + d.high, medium: a.medium + d.medium, low: a.low + d.low }), { high: 0, medium: 0, low: 0 });
  const peak = Math.max(1, ...days.map((d) => d.high + d.medium + d.low));
  const W = 720, H = 165, GAP = 1, colW = W / days.length;
  return <Panel className="p-5"><SectionTitle right={<button className="text-[11px] text-faint hover:text-ink" onClick={() => setShowTable((v) => !v)}>{showTable ? 'show chart' : 'show table'}</button>}>Worship history</SectionTitle><p className="text-xs text-faint">{fmt(totals.high + totals.medium + totals.low)} claims across {days.length} recorded days.</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{TIERS.map((tier) => <span key={tier.key} className="flex items-center gap-1.5 text-[11px] text-muted"><i className="h-2 w-2" style={{ background: tier.color }} />{tier.label}<b className="font-mono font-normal text-faint">{fmt(totals[tier.key])}</b></span>)}</div>{showTable ? <div className="mt-4 max-h-60 overflow-auto border border-edge/60"><table className="admin-roster-table w-full text-left"><thead><tr><th>Day</th><th>Long</th><th>Mid</th><th>New</th><th>Total</th></tr></thead><tbody>{[...days].reverse().map((d) => <tr key={d.day}><td className="font-mono text-xs">{dayToDate(d.day)}</td><td>{d.high}</td><td>{d.medium}</td><td>{d.low}</td><td>{d.high + d.medium + d.low}</td></tr>)}</tbody></table></div> : <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-[165px] w-full" role="img" aria-label="Daily worship by streak tier">{days.map((d, i) => { let y = H; return <g key={d.day}><title>{dayToDate(d.day)} · {d.high + d.medium + d.low} claims</title>{TIERS.map((tier) => { const h = (d[tier.key] / peak) * (H - 8); y -= h; const rect = <rect key={tier.key} x={i * colW} y={y} width={Math.max(1, colW - (days.length > 200 ? 0 : 1))} height={Math.max(.5, h - GAP)} fill={tier.color} />; y -= GAP; return rect; })}</g>; })}</svg>}</Panel>;
}
