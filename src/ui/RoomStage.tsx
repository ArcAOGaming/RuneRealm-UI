/**
 * The companion status window.
 *
 * React selects the scene and watches durable game state. Phaser owns every
 * moving pixel inside the scene, while the feed celebration uses a transparent
 * Three.js layer so it can arc above the pixel world without changing its grid.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ActivityReceipt, CharacterOutfit, Element, Monster,
} from '../lib/types';
import { cx } from './primitives';
import { mountGame, type Mounted } from '../game/boot';
import { RoomScene } from '../game/RoomScene';
import { PlayScene } from '../game/PlayScene';
import { QuestScene } from '../game/QuestScene';
import {
  homeUrl, playNames, playUrl, questLayerUrl, questRoutes,
} from '../game/assets';
import { ITEM_ART } from './art';
import type { FeedFx } from '../game/FeedFx';
import type { ActivityFx } from '../game/ActivityFx';

const BASE_W = 384;
const BASE_H = 192;
const DEFAULT_HOME = 'house-cottage';

const isActivity = (kind: Monster['status']['type']): kind is ActivityReceipt['kind'] =>
  kind === 'Play' || kind === 'Quest';

/** Stable per companion, then advanced by one after every completed quest. */
function sceneSeed(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const ELEMENT_RGB: Record<Element, [number, number, number]> = {
  fire: [255, 122, 67], water: [74, 176, 255],
  air: [126, 226, 200], rock: [201, 162, 93],
};

const gateway = ((import.meta.env.VITE_ARWEAVE_GATEWAY as string | undefined)
  || 'https://arweave.net').replace(/\/$/, '');

export default function RoomStage({
  monster,
  playerOutfit,
  playerSpriteTxId,
  playerSpriteUrl,
  activityReceipt,
  homeOverride,
  playOverride,
  questOverride,
  className,
}: {
  monster: Monster;
  playerOutfit?: CharacterOutfit;
  /** Legacy uploaded character, used only when no outfit recipe exists. */
  playerSpriteTxId?: string;
  /** Scene-lab override for a ready-made player sheet. */
  playerSpriteUrl?: string;
  /** The exact rewards returned by the most recent Play / Quest claim. */
  activityReceipt?: ActivityReceipt;
  /** Scene-lab overrides for reviewing every asset explicitly. */
  homeOverride?: string;
  playOverride?: string;
  questOverride?: string;
  className?: string;
}) {
  const kind = monster.status.type;
  const hostRef = useRef<HTMLDivElement>(null);
  const fxHostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<Mounted | null>(null);
  const feedFxRef = useRef<FeedFx | null>(null);
  const activityFxRef = useRef<ActivityFx | null>(null);
  const pendingActivityFx = useRef<((fx: ActivityFx) => void) | null>(null);
  const previousKind = useRef(kind);
  const shownReceipt = useRef<string>();
  const previousFeeds = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [builtPlayerSprite, setBuiltPlayerSprite] = useState<string>();
  const [randomPlay] = useState(() => {
    const names = playNames();
    return names[Math.floor(Math.random() * names.length)] ?? 'forest';
  });

  const away = kind === 'Battle';
  const home = useMemo(() => {
    const wanted = homeOverride || DEFAULT_HOME;
    return homeUrl(wanted) ? wanted : DEFAULT_HOME;
  }, [homeOverride]);
  const playBackdrop = playOverride && playUrl(playOverride) ? playOverride : randomPlay;
  const questRoute = useMemo(() => {
    if (questOverride && questLayerUrl(questOverride, 'sky')) return questOverride;
    const routes = questRoutes();
    if (!routes.length) return 'japan';
    const identity = monster.id || monster.sprite;
    const index = (sceneSeed(identity) + monster.totalTimesQuest) % routes.length;
    return routes[index];
  }, [questOverride, monster.id, monster.sprite, monster.totalTimesQuest]);
  const legacyPlayerSprite = playerSpriteTxId ? `${gateway}/${playerSpriteTxId}` : undefined;
  const playerSprite = playerSpriteUrl
    || (playerOutfit ? builtPlayerSprite : legacyPlayerSprite);
  const rgb = monster.elementType === 'normal'
    ? [150, 159, 184] as [number, number, number]
    : ELEMENT_RGB[monster.elementType];
  const berryUrl = monster.berryItem ? ITEM_ART[monster.berryItem] ?? '' : '';

  const queueActivityFx = useCallback((command: (fx: ActivityFx) => void) => {
    if (activityFxRef.current) command(activityFxRef.current);
    else pendingActivityFx.current = command;
  }, []);

  // A saved character is a six-piece recipe. Build the same 576x60 sheet the
  // creator previews, in memory, only when the fetch scene needs it.
  useEffect(() => {
    if (kind !== 'Play' || !playerOutfit || playerSpriteUrl) {
      setBuiltPlayerSprite(undefined);
      return undefined;
    }
    let cancelled = false;
    const canvas = document.createElement('canvas');
    void import('../lib/sprites')
      .then(({ composite }) => composite(playerOutfit, canvas))
      .then(() => {
        if (!cancelled) setBuiltPlayerSprite(canvas.toDataURL('image/png'));
      })
      .catch(() => {
        if (!cancelled) setBuiltPlayerSprite(undefined);
      });
    return () => { cancelled = true; };
  }, [kind, playerOutfit, playerSpriteUrl]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    setReady(false);

    const Scene = kind === 'Quest' ? QuestScene : kind === 'Play' ? PlayScene : RoomScene;
    const mounted = mountGame(host, BASE_W, BASE_H, [Scene], {
      maxZoom: 4,
      onScale: () => setReady(true),
    });
    mountedRef.current = mounted;

    if (kind === 'Quest') {
      mounted.game.scene.start(QuestScene.KEY, {
        sprite: monster.sprite, entryNo: monster.entryNo, route: questRoute, element: rgb,
      });
    } else if (kind === 'Play') {
      mounted.game.scene.start(PlayScene.KEY, {
        sprite: monster.sprite, entryNo: monster.entryNo, backdrop: playBackdrop, playerSprite, element: rgb,
      });
    } else {
      mounted.game.scene.start(RoomScene.KEY, {
        sprite: monster.sprite, entryNo: monster.entryNo, backdrop: home, away, element: rgb,
      });
    }

    return () => {
      if (mountedRef.current === mounted) mountedRef.current = null;
      mounted.destroy();
    };
  }, [kind, monster.sprite, monster.entryNo, monster.elementType, playerSprite,
    home, playBackdrop, questRoute, away]);

  // One transparent renderer stays above every room state. It is lazy like
  // the feed effect and completely parked between its short ceremonies.
  useEffect(() => {
    const host = fxHostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    void import('../game/ActivityFx').then(({ mountActivityFx }) => {
      if (cancelled) return;
      const fx = mountActivityFx(host, rgb);
      activityFxRef.current = fx;
      if (fx && pendingActivityFx.current) {
        const command = pendingActivityFx.current;
        pendingActivityFx.current = null;
        command(fx);
      }
    });
    return () => {
      cancelled = true;
      pendingActivityFx.current = null;
      activityFxRef.current?.destroy();
      activityFxRef.current = null;
    };
  }, [monster.elementType]);

  // Durable status drives the wipe, so a failed start or claim cannot play a
  // transition. A matching claim receipt owns the exit and reward reveal;
  // administrative/status-only returns still receive the simple exit wipe.
  useEffect(() => {
    const previous = previousKind.current;
    if (previous === kind) return;

    if (isActivity(kind)) {
      queueActivityFx((fx) => fx.enter(kind));
    } else if (isActivity(previous) && kind === 'Home') {
      const rewardWillReveal = activityReceipt?.kind === previous
        && shownReceipt.current !== activityReceipt.id;
      if (!rewardWillReveal) queueActivityFx((fx) => fx.exit(previous));
    }
    previousKind.current = kind;
  }, [kind, activityReceipt, queueActivityFx]);

  // Claim rewards exist on one reply only. The receipt is captured by the
  // companion screen and keyed so this cannot replay on unrelated renders.
  useEffect(() => {
    if (!activityReceipt || shownReceipt.current === activityReceipt.id) return;
    shownReceipt.current = activityReceipt.id;
    queueActivityFx((fx) => fx.reveal(activityReceipt));
  }, [activityReceipt, queueActivityFx]);

  // The berry renderer itself is fetched only for a home scene. It stays out
  // of quest/play, where this layer has nothing to draw.
  useEffect(() => {
    const host = fxHostRef.current;
    if (!host || kind !== 'Home' || !berryUrl) return undefined;
    let cancelled = false;
    void import('../game/FeedFx').then(({ mountFeedFx }) => {
      if (cancelled) return;
      feedFxRef.current = mountFeedFx(host, berryUrl, rgb);
    });
    return () => {
      cancelled = true;
      feedFxRef.current?.destroy();
      feedFxRef.current = null;
    };
  }, [kind, berryUrl, monster.elementType]);

  // A feed is already represented in durable state. Watching that counter
  // keeps animation and transaction success together and prevents a failed
  // click from playing a reward the player did not receive.
  useEffect(() => {
    if (previousFeeds.current === null) {
      previousFeeds.current = monster.totalTimesFed;
      return;
    }
    const fed = monster.totalTimesFed > previousFeeds.current;
    previousFeeds.current = monster.totalTimesFed;
    if (!fed || kind !== 'Home') return;

    const scene = mountedRef.current?.scene<RoomScene>(RoomScene.KEY);
    scene?.feed();
    feedFxRef.current?.play(scene?.petAnchor() ?? { x: 0.5, y: 0.7 });
  }, [monster.totalTimesFed, kind]);

  const label = kind === 'Quest'
    ? `${monster.name} travelling on a quest`
    : kind === 'Play'
      ? `${monster.name} playing fetch${playerSprite ? ' with you' : ''}`
      : away ? `${monster.name} away at the arena` : `${monster.name} at home`;
  const rewardAnnouncement = activityReceipt && kind === 'Home'
    ? [
      activityReceipt.rewards.happiness
        ? `${activityReceipt.rewards.happiness} happiness` : '',
      activityReceipt.rewards.exp ? `${activityReceipt.rewards.exp} experience` : '',
      activityReceipt.rewards.lootbox
        ? `one tier ${activityReceipt.rewards.lootbox} loot box` : '',
    ].filter(Boolean).join(', ')
    : '';

  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-[3px] border border-edge/70 bg-void/60',
        className,
      )}
    >
      <div
        ref={hostRef}
        className="grid w-full place-items-center overflow-hidden"
        style={{ aspectRatio: `${BASE_W} / ${BASE_H}` }}
        aria-label={label}
        role="img"
      />
      <div
        ref={fxHostRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      />
      <span className="sr-only" aria-live="polite">
        {rewardAnnouncement ? `${monster.name} earned ${rewardAnnouncement}.` : ''}
      </span>
      {!ready && <div className="absolute inset-0 z-10 animate-pulse bg-raised/40" />}
    </div>
  );
}
