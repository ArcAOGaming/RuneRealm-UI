import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../lib/game';
import {
  AdminMetrics, AdminPlayerSummary, AdminSnapshot, LeaderboardRow, Player,
} from '../../lib/types';
import { ITEM_NAME, shortAddress } from '../../lib/format';
import { SWARM_WALLETS, SwarmRole, SwarmWalletProfile } from '../../data/swarm-wallets';
import { Badge, Bar, Button, Empty, ErrorNote, Panel, SectionTitle, cx } from '../../ui/primitives';
import { Clock, Refresh, Rune, Shield, Sword, Trophy, Users } from '../../ui/icons';

const POLL_MS = 15_000;
const ROLES: SwarmRole[] = [
  'quester', 'caretaker', 'arena', 'duelist', 'collector', 'progression', 'chaos',
];

type SwarmRow = {
  profile: SwarmWalletProfile;
  summary?: AdminPlayerSummary;
  board?: LeaderboardRow;
  status: string;
  hasCompanion: boolean;
  attention: string[];
};

const fmt = (value: number | undefined) => Number(value ?? 0).toLocaleString();
const totalActions = (metrics?: AdminMetrics | null) => Object.values(metrics?.totals ?? {})
  .reduce((sum, value) => sum + Number(value ?? 0), 0);
const lootboxTotal = (summary?: AdminPlayerSummary) => (
  summary?.lootboxes.reduce((sum, count) => sum + Number(count ?? 0), 0) ?? 0
);
const relativeTime = (timestamp?: number) => {
  if (!timestamp) return 'Never';
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
};
const actionName = (action?: string) => action?.replace(/^[^.]+\./, '').replaceAll('.', ' ') ?? 'None yet';

function rowState(
  profile: SwarmWalletProfile,
  summary?: AdminPlayerSummary,
  board?: LeaderboardRow,
): SwarmRow {
  const hasCompanion = Boolean(board?.monster || summary?.name);
  const status = board?.monster?.status.type
    ?? summary?.status
    ?? (summary ? 'No companion' : 'Not joined');
  const attention: string[] = [];
  if (!summary) attention.push('Not joined');
  else if (!summary.unlocked) attention.push('Access revoked');
  if (summary && !hasCompanion) attention.push('No companion');
  if (summary?.faction && summary.faction !== profile.faction) attention.push('Faction differs from plan');
  return { profile, summary, board, status, hasCompanion, attention };
}

export default function SwarmMonitor({ snapshot }: { snapshot: AdminSnapshot }) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [metrics, setMetrics] = useState<AdminMetrics>(snapshot.metrics);
  const [selected, setSelected] = useState(SWARM_WALLETS[0].address);
  const [player, setPlayer] = useState<Player | null>(null);
  const [watching, setWatching] = useState(true);
  const [sampledAt, setSampledAt] = useState(0);
  const [summaryError, setSummaryError] = useState<unknown>(null);
  const [playerError, setPlayerError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const baselineActions = useRef(totalActions(snapshot.metrics));
  const watchStartedAt = useRef(Date.now());
  const summaryInFlight = useRef(false);

  const refreshSummary = useCallback(async () => {
    if (summaryInFlight.current) return;
    summaryInFlight.current = true;
    setRefreshing(true);
    const [boardResult, metricsResult] = await Promise.allSettled([
      api.readLeaderboard(), api.readMetrics(),
    ]);
    if (boardResult.status === 'fulfilled' && boardResult.value) setLeaderboard(boardResult.value);
    if (metricsResult.status === 'fulfilled' && metricsResult.value) setMetrics(metricsResult.value);
    const failed = [boardResult, metricsResult].find((result) => result.status === 'rejected');
    const bothMissing = boardResult.status === 'fulfilled' && !boardResult.value
      && metricsResult.status === 'fulfilled' && !metricsResult.value;
    setSummaryError(failed?.status === 'rejected'
      ? failed.reason
      : bothMissing ? new Error('Live leaderboard and metrics are not published yet.') : null);
    if ((boardResult.status === 'fulfilled' && boardResult.value)
      || (metricsResult.status === 'fulfilled' && metricsResult.value)) {
      setSampledAt(Date.now());
    }
    setRefreshing(false);
    summaryInFlight.current = false;
  }, []);

  const refreshPlayer = useCallback(async () => {
    setPlayerLoading(true);
    try {
      const next = await api.readPlayer(selected);
      setPlayer(next);
      setPlayerError(null);
    } catch (error) {
      setPlayerError(error);
    } finally {
      setPlayerLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    void refreshSummary();
    if (!watching) return undefined;
    const timer = window.setInterval(() => { void refreshSummary(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshSummary, watching]);

  useEffect(() => {
    setPlayer(null);
    void refreshPlayer();
    if (!watching) return undefined;
    const timer = window.setInterval(() => { void refreshPlayer(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshPlayer, watching]);

  const rows = useMemo(() => {
    const summaries = new Map(snapshot.players.map((entry) => [entry.address, entry]));
    const board = new Map(leaderboard.map((entry) => [entry.address, entry]));
    return SWARM_WALLETS.map((profile) => rowState(
      profile, summaries.get(profile.address), board.get(profile.address),
    ));
  }, [leaderboard, snapshot.players]);

  const joined = rows.filter(({ summary }) => summary).length;
  const companions = rows.filter(({ hasCompanion }) => hasCompanion).length;
  const busy = rows.filter(({ status }) => ![
    'Home', 'No companion', 'Not joined',
  ].includes(status)).length;
  const battling = rows.filter(({ status, summary }) => status === 'Battle' || summary?.activeBattleId).length;
  const levelTotal = rows.reduce((sum, row) => sum + (row.board?.level ?? row.summary?.level ?? 0), 0);
  const wins = rows.reduce((sum, row) => sum + (row.board?.wins ?? row.summary?.wins ?? 0), 0);
  const losses = rows.reduce((sum, row) => sum + (row.board?.losses ?? row.summary?.losses ?? 0), 0);
  const quests = rows.reduce((sum, row) => sum + (row.board?.quests ?? row.summary?.questsCompleted ?? 0), 0);
  const runes = rows.reduce((sum, row) => sum + Number(row.summary?.inventory.rune ?? 0), 0);
  const chests = rows.reduce((sum, row) => sum + lootboxTotal(row.summary), 0);
  const care = rows.reduce((sum, row) => sum
    + Number(row.board?.monster?.totalTimesFed ?? 0)
    + Number(row.board?.monster?.totalTimesPlay ?? 0), 0);
  const attention = rows.filter((row) => row.attention.length).length;
  const actionDelta = Math.max(0, totalActions(metrics) - baselineActions.current);
  const elapsedMinutes = Math.max(1 / 60, (Math.max(sampledAt, Date.now()) - watchStartedAt.current) / 60_000);
  const actionsPerMinute = actionDelta / elapsedMinutes;

  const refreshNow = () => {
    void Promise.all([refreshSummary(), refreshPlayer()]);
  };

  return (
    <div className="space-y-4">
      <Panel className="admin-swarm-banner p-5">
        <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow text-element">50-account simulation</div>
            <h2 className="mt-2 text-2xl font-semibold">Swarm observatory</h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              One live view of the questers, caretakers, arena fighters, duel pairs,
              collectors, generalists, and randomized explorers exercising the realm.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={watching ? 'good' : 'plain'}>
              <span className={cx('admin-status-light', watching && 'is-pulsing')} />
              {watching ? 'Watching live' : 'Watch paused'}
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => setWatching((value) => !value)}>
              {watching ? 'Pause watch' : 'Resume watch'}
            </Button>
            <Button size="sm" variant="ghost" busy={refreshing} onClick={refreshNow}
              icon={<Refresh className="h-4 w-4" />}>Sample now</Button>
          </div>
        </div>
        <div className="relative z-[1] mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-faint">
          <span>public pulse every {POLL_MS / 1000}s</span>
          <span>last sample {sampledAt ? relativeTime(sampledAt) : 'pending'}</span>
          <span>owner snapshot {relativeTime(snapshot.generatedAt)}</span>
          <span>{actionDelta} realm actions observed ({actionsPerMinute.toFixed(1)}/min)</span>
        </div>
      </Panel>

      {summaryError !== null && <ErrorNote error={summaryError} onRetry={refreshNow} />}

      <section className="admin-kpi-grid">
        <SwarmKpi icon={<Users />} label="Joined" value={`${joined}/${SWARM_WALLETS.length}`}
          note={`${SWARM_WALLETS.length - joined} still initializing`} />
        <SwarmKpi icon={<Shield />} label="Companions" value={companions}
          note={`${busy} busy right now`} />
        <SwarmKpi icon={<Sword />} label="Battle state" value={battling}
          note={`${wins}–${losses} combined record`} />
        <SwarmKpi icon={<Trophy />} label="Total level" value={levelTotal}
          note={`${quests} quests completed`} />
        <SwarmKpi icon={<Rune />} label="Rune held" value={runes}
          note={`${chests} unopened chests`} />
        <SwarmKpi icon={<Clock />} label="Attention" value={attention}
          note={attention ? 'Setup or plan mismatches' : 'All planned accounts healthy'} />
      </section>

      <Panel className="p-5">
        <SectionTitle right={<span className="font-mono text-[10px] text-faint">{care} care actions · {actionDelta} new realm actions</span>}>
          Role coverage
        </SectionTitle>
        <div className="admin-swarm-role-grid">
          {ROLES.map((role) => {
            const roleRows = rows.filter(({ profile }) => profile.role === role);
            const roleBusy = roleRows.filter(({ status }) => !['Home', 'No companion', 'Not joined'].includes(status)).length;
            return (
              <div key={role} className="admin-compact-row">
                <div className="min-w-0">
                  <div className="text-xs leading-snug text-ink">{roleRows[0]?.profile.roleLabel}</div>
                  <div className="mt-1 font-mono text-[10px] text-faint">{roleBusy} active now</div>
                </div>
                <span className="shrink-0 font-mono text-lg tabular-nums text-element">{roleRows.length}</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <SwarmDirectory rows={rows} selected={selected} onSelect={setSelected}
        player={player?.address === selected ? player : null} playerError={playerError}
        playerLoading={playerLoading} onRefresh={refreshPlayer} />
    </div>
  );
}

function SwarmKpi({ icon, label, value, note }: {
  icon: JSX.Element; label: string; value: number | string; note: string;
}) {
  return (
    <Panel className="admin-kpi p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="eyebrow">{label}</div><div className="carve mt-1 font-mono text-3xl tabular-nums">{typeof value === 'number' ? fmt(value) : value}</div></div>
        <div className="admin-kpi-icon">{icon}</div>
      </div>
      <p className="mt-3 text-xs text-faint">{note}</p>
    </Panel>
  );
}

function SwarmDirectory({ rows, selected, onSelect, player, playerError, playerLoading, onRefresh }: {
  rows: SwarmRow[];
  selected: string;
  onSelect: (address: string) => void;
  player: Player | null;
  playerError: unknown;
  playerLoading: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<SwarmRole | 'all'>('all');
  const [state, setState] = useState('all');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (role !== 'all' && row.profile.role !== role) return false;
      if (state === 'busy' && ['Home', 'No companion', 'Not joined'].includes(row.status)) return false;
      if (state === 'battle' && row.status !== 'Battle' && !row.summary?.activeBattleId) return false;
      if (state === 'attention' && !row.attention.length) return false;
      if (state === 'ready' && row.status !== 'Home') return false;
      if (needle && ![
        row.profile.wallet, row.profile.callSign, row.profile.roleLabel,
        row.profile.faction, row.profile.address, row.profile.description,
        row.summary?.name, row.summary?.lastAction,
      ].some((value) => value?.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [query, role, rows, state]);
  const chosen = rows.find(({ profile }) => profile.address === selected) ?? rows[0];

  return (
    <div className="admin-player-layout">
      <Panel className="min-w-0 overflow-hidden">
        <div className="border-b border-edge/60 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">Agent directory</div>
              <div className="mt-1 text-sm text-muted">{filtered.length} of {rows.length} planned wallets</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={role} onChange={(event) => setRole(event.target.value as SwarmRole | 'all')} className="admin-filter">
                <option value="all">All roles</option>
                {ROLES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
              <select value={state} onChange={(event) => setState(event.target.value)} className="admin-filter">
                <option value="all">All states</option><option value="ready">Home</option>
                <option value="busy">Busy</option><option value="battle">Battle</option>
                <option value="attention">Needs attention</option>
              </select>
            </div>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search wallet, call sign, role, faction, companion or test intent"
            className="admin-swarm-search mt-3 w-full rounded-[3px] border border-edge bg-raised px-2.5 py-2 font-mono text-xs text-ink focus:border-element/60 focus:outline-none" />
        </div>
        <div className="admin-roster-scroll overflow-auto">
          <table className="admin-roster-table admin-swarm-table w-full text-left">
            <thead><tr><th>Agent</th><th>Role</th><th>State</th><th>Level</th><th>Record</th><th>Coverage</th></tr></thead>
            <tbody>{filtered.map((row) => {
              const monster = row.board?.monster;
              return (
                <tr key={row.profile.address} className={cx(selected === row.profile.address && 'is-selected')}
                  onClick={() => onSelect(row.profile.address)}>
                  <td><button className="block w-full text-left" onClick={() => onSelect(row.profile.address)}>
                    <span className="block text-sm text-ink">{row.profile.callSign}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-faint">{row.profile.wallet} · {shortAddress(row.profile.address, 5)}</span>
                  </button></td>
                  <td><span className="block whitespace-nowrap text-[11px] text-muted">{row.profile.roleLabel}</span><span className="mt-0.5 block text-[10px] text-faint">{row.profile.faction}</span></td>
                  <td><SwarmStateBadge row={row} /></td>
                  <td className="font-mono text-sm">{row.board?.level ?? row.summary?.level ?? 0}</td>
                  <td className="whitespace-nowrap font-mono text-xs">{row.board?.wins ?? row.summary?.wins ?? 0}–{row.board?.losses ?? row.summary?.losses ?? 0}</td>
                  <td className="whitespace-nowrap font-mono text-[10px] text-faint">Q{row.board?.quests ?? row.summary?.questsCompleted ?? 0} · F{monster?.totalTimesFed ?? 0} · P{monster?.totalTimesPlay ?? 0}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {!filtered.length && <Empty icon={<Users />} title="No matching agents" />}
        </div>
      </Panel>
      {chosen ? <SwarmAgentDetail row={chosen} player={player} playerError={playerError}
        playerLoading={playerLoading} onRefresh={onRefresh} rows={rows} /> : null}
    </div>
  );
}

function SwarmStateBadge({ row }: { row: SwarmRow }) {
  if (!row.summary) return <Badge tone="plain">Not joined</Badge>;
  if (!row.summary.unlocked) return <Badge tone="bad">Revoked</Badge>;
  if (row.status === 'Battle' || row.summary.activeBattleId) return <Badge tone="warn">Battle</Badge>;
  if (row.status === 'Home') return <Badge tone="good">Home</Badge>;
  if (row.status === 'No companion') return <Badge tone="plain">No companion</Badge>;
  return <Badge tone="element">{row.status}</Badge>;
}

function SwarmAgentDetail({ row, player, playerError, playerLoading, onRefresh, rows }: {
  row: SwarmRow;
  player: Player | null;
  playerError: unknown;
  playerLoading: boolean;
  onRefresh: () => Promise<void>;
  rows: SwarmRow[];
}) {
  const monster = player?.monster ?? row.board?.monster;
  const inventory = player?.inventory ?? row.summary?.inventory ?? {};
  const partner = row.profile.pvpPair
    ? rows.find((candidate) => candidate.profile.pvpPair === row.profile.pvpPair
      && candidate.profile.address !== row.profile.address)
    : undefined;
  const status = monster?.status.type ?? row.status;
  const statusUntil = monster?.status.until_time;
  const berryCount = Number(inventory.fire_berry ?? 0) + Number(inventory.water_berry ?? 0)
    + Number(inventory.air_berry ?? 0) + Number(inventory.rock_berry ?? 0);
  const element = monster?.elementType ?? row.summary?.element;
  const hasCompanion = Boolean(monster || row.summary?.name);
  const energy = monster?.energy ?? row.summary?.energy ?? 0;
  const happiness = monster?.happiness ?? row.summary?.happiness ?? 0;
  const level = monster?.level ?? row.summary?.level ?? 0;
  const exp = monster?.exp ?? row.summary?.exp ?? 0;
  const nextLevelExp = monster?.nextLevelExp ?? Math.max(100, exp);

  return (
    <div className="admin-player-workspace space-y-4" data-element={element}>
      <Panel className="overflow-hidden">
        <div className="admin-player-head p-5">
          <div className="relative z-[1] flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><SwarmStateBadge row={row} /><Badge tone="element">{row.profile.roleLabel}</Badge></div>
              <h3 className="mt-3 text-2xl font-semibold">{row.profile.callSign}</h3>
              <p className="mt-1 text-sm text-muted">{monster?.name ?? row.summary?.name ?? 'Companion pending'} · {row.profile.wallet}</p>
              <code className="mt-2 block break-all text-[10px] text-faint">{row.profile.address}</code>
            </div>
            <Button size="sm" variant="ghost" busy={playerLoading} onClick={() => void onRefresh()}
              icon={<Refresh className="h-4 w-4" />}>Player record</Button>
          </div>
        </div>
        <div className="border-b border-edge/60 bg-void/20 p-5">
          <p className="text-sm leading-relaxed text-muted">{row.profile.description}</p>
          {partner && <p className="mt-2 font-mono text-[10px] text-faint">PvP {row.profile.pvpSide} · paired with {partner.profile.callSign} ({partner.profile.wallet})</p>}
        </div>
        <div className="grid gap-px border-b border-edge/60 bg-edge/60 sm:grid-cols-4">
          <DetailFact label="Activity" value={status} />
          <DetailFact label="Rune" value={fmt(Number(inventory.rune ?? 0))} />
          <DetailFact label="Chests" value={fmt(player?.lootboxes.length ?? lootboxTotal(row.summary))} />
          <DetailFact label="Last action" value={actionName(player?.lastAction ?? row.summary?.lastAction)} />
        </div>
        {hasCompanion ? (
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Bar name="Energy" value={energy} max={100} tone="energy" label="Energy" right={`${energy}/100`} />
              <Bar name="Happiness" value={happiness} max={100} tone="happy" label="Happiness" right={`${happiness}/100`} />
              <Bar name="Experience" value={exp} max={Math.max(1, nextLevelExp)} tone="exp" label={`Level ${level}`} right={`${exp}/${nextLevelExp}`} />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden border border-edge/60 bg-edge/60 sm:grid-cols-4">
              <DetailFact label="Fed" value={monster ? fmt(monster.totalTimesFed) : 'Awaiting pulse'} />
              <DetailFact label="Played" value={monster ? fmt(monster.totalTimesPlay) : 'Awaiting pulse'} />
              <DetailFact label="Quested" value={monster ? fmt(monster.totalTimesQuest) : fmt(row.summary?.questsCompleted)} />
              <DetailFact label="Busy until" value={statusUntil && status !== 'Home' ? new Date(statusUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ready'} />
            </div>
          </div>
        ) : (
          <Empty icon={<Shield />} title="Waiting for companion">This agent has not completed faction setup yet.</Empty>
        )}
      </Panel>

      {playerError !== null && <ErrorNote error={playerError} onRetry={() => void onRefresh()} />}

      <Panel className="p-5">
        <SectionTitle right={<span className="font-mono text-[10px] text-faint">{berryCount} berries</span>}>Inventory sample</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(['rune', 'fire_berry', 'water_berry', 'air_berry', 'rock_berry', 'scroll', 'legendary_scroll'] as const).map((item) => (
            <div key={item} className="admin-compact-row !p-2.5">
              <span className="truncate text-[10px] text-faint">{ITEM_NAME[item]}</span>
              <span className="font-mono text-xs text-ink">{fmt(Number(inventory[item] ?? 0))}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-5">
        <SectionTitle>Plan check</SectionTitle>
        <div className="space-y-2 text-xs">
          <PlanLine label="Expected faction" value={row.profile.faction} ok={!row.summary?.faction || row.summary.faction === row.profile.faction} />
          <PlanLine label="Actual faction" value={player?.faction ?? row.summary?.faction ?? 'Not joined'} ok={!row.summary?.faction || row.summary.faction === row.profile.faction} />
          <PlanLine label="Access" value={row.summary?.unlocked ? 'Enabled' : 'Pending'} ok={Boolean(row.summary?.unlocked)} />
          <PlanLine label="Last seen" value={relativeTime(player?.lastActiveAt ?? row.summary?.lastActiveAt)} ok={Boolean(row.summary)} />
        </div>
        {row.attention.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">{row.attention.map((issue) => <Badge key={issue} tone="warn">{issue}</Badge>)}</div>
        )}
      </Panel>
    </div>
  );
}

function DetailFact({ label, value }: { label: string; value: number | string }) {
  return <div className="min-w-0 bg-surface/95 p-3"><div className="text-[9px] uppercase tracking-wider text-faint">{label}</div><div className="mt-1 truncate font-mono text-xs text-ink">{value}</div></div>;
}

function PlanLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-edge/40 pb-2">
      <span className="text-faint">{label}</span><span className={cx('text-right font-mono', ok ? 'text-ink' : 'text-warn')}>{value}</span>
    </div>
  );
}
