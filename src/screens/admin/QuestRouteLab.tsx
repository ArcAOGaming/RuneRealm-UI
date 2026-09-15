import { useEffect, useRef, useState } from 'react';
import { mountGame, Mounted } from '../../game/boot';
import {
  QuestScene, QUEST_RENDER_SCALE, QUEST_SNAP_TOLERANCE,
} from '../../game/QuestScene';
import { Badge, Empty, Panel, SectionTitle, cx } from '../../ui/primitives';

export type QuestLayer = 'sky' | 'far' | 'mid';

export type QuestRouteCandidate = {
  id: string;
  name: string;
  state: 'in-use' | 'pending' | 'incomplete';
  layers: Partial<Record<QuestLayer, string>>;
};

const LAYERS: QuestLayer[] = ['sky', 'far', 'mid'];
const PREVIEW_SPRITE = 'wUo47CacsMRFFizJqUhSj75Rczg3f_MvHs4ytfPtCjQ';

/** Every accepted and staged route, moving through the real QuestScene. */
export default function QuestRouteLab({ routes }: { routes: QuestRouteCandidate[] }) {
  const complete = routes.filter((route) => LAYERS.every((layer) => route.layers[layer]));
  const [selectedId, setSelectedId] = useState(complete[0]?.id ?? '');
  const selected = complete.find((route) => route.id === selectedId) ?? complete[0];

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected, selectedId]);

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionTitle>Quest route viewer</SectionTitle>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Accepted routes and complete pending drafts run through the production parallax,
            floor position, companion rig, and scroll speeds. An attractive raw layer is not
            considered working until it survives here.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge tone="good">{routes.filter((route) => route.state === 'in-use').length} in use</Badge>
          <Badge tone="warn">{routes.filter((route) => route.state === 'pending').length} pending</Badge>
        </div>
      </div>

      {selected ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <QuestRouteStage route={selected} />
          <div className="space-y-2">
            {routes.map((route) => {
              const ready = LAYERS.filter((layer) => route.layers[layer]).length;
              return (
                <button
                  key={route.id}
                  type="button"
                  disabled={ready !== LAYERS.length}
                  onClick={() => setSelectedId(route.id)}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 rounded-[3px] border px-3 py-2 text-left',
                    route.id === selected.id
                      ? 'border-element/60 bg-element/10 text-ink'
                      : 'border-edge bg-void/35 text-muted hover:border-edge-strong',
                    ready !== LAYERS.length && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="min-w-0 truncate text-xs">{route.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="font-mono text-[10px] text-faint">{ready}/3</span>
                    <Badge tone={route.state === 'in-use' ? 'good' : route.state === 'pending' ? 'warn' : 'plain'}>
                      {route.state}
                    </Badge>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4"><Empty title="No complete routes">Generate or approve sky, far, and mid layers with the same route name.</Empty></div>
      )}
    </Panel>
  );
}

function QuestRouteStage({ route }: { route: QuestRouteCandidate }) {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const [ready, setReady] = useState(false);
  const { sky, far, mid } = route.layers;

  useEffect(() => {
    if (!host.current || !sky || !far || !mid) return undefined;
    setReady(false);
    const handle = mountGame(
      host.current,
      384 * QUEST_RENDER_SCALE,
      192 * QUEST_RENDER_SCALE,
      [QuestScene],
      {
        maxZoom: 4,
        snapZoomWithin: QUEST_SNAP_TOLERANCE,
        onScale: () => setReady(true),
      },
    );
    mounted.current = handle;
    handle.game.scene.start(QuestScene.KEY, {
      sprite: PREVIEW_SPRITE,
      entryNo: 1,
      route: route.name,
      layerUrls: { sky, far, mid },
      element: [255, 122, 67],
    });
    return () => {
      if (mounted.current === handle) mounted.current = null;
      handle.destroy();
    };
  }, [far, mid, route.name, sky]);

  return (
    <div className="relative overflow-hidden rounded-[3px] border border-edge bg-void">
      <div ref={host} className="grid w-full place-items-center" style={{ aspectRatio: '384 / 192' }} />
      {!ready && <div className="absolute inset-0 animate-pulse bg-raised/40" />}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-[3px] border border-edge bg-void/80 px-2 py-1 text-[10px] uppercase tracking-wide text-muted backdrop-blur-sm">
        {route.name} · {route.state}
      </div>
    </div>
  );
}
