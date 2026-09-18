/**
 * Client for the local swarm stream (`backend/native/swarm/stream.mjs`), live run only.
 *
 * `/snapshot` gives the history; `/events` keeps it current: `tick` every 5 s,
 * `acct`/`trade`/`halt`/`alert`/`msg`/`send`/`launch` as they arrive, `run` when a
 * newer run starts. The stream is read-only and on 127.0.0.1 — nothing here
 * reaches a node or a run.
 *
 * The stream lives and dies with the swarm process, so it is expected to vanish
 * and come back. `/snapshot` is re-read every 5 s while it is unreachable or no
 * run is active, when the event source reconnects, and when a new run appears
 * (whose snapshot replaces everything held, so nothing of the old run is kept).
 * Frames that arrive while `/snapshot` is being fetched are replayed onto it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyFrame } from './model';
import type { Connection, StreamFrame } from './model';
import type { LaunchRecord, SwarmSnapshot, SwarmTick } from './types';

export const SWARM_STREAM_URL: string = import.meta.env.VITE_SWARM_STREAM_URL || 'http://127.0.0.1:8787';

export const RETRY_MS = 5_000;

export function useSwarmStream(base = SWARM_STREAM_URL) {
  const [data, setData] = useState<SwarmSnapshot | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  /** Bumped to open a new event source after the browser gave up on one. */
  const [generation, setGeneration] = useState(0);
  const latest = useRef(0);
  const busy = useRef(false);
  const shownRun = useRef<string | null>(null);
  /** Frames that arrived while a snapshot was being fetched, replayed onto it. */
  const pending = useRef<StreamFrame[] | null>(null);

  const load = useCallback(async () => {
    const request = ++latest.current;
    busy.current = true;
    pending.current ??= [];
    try {
      const response = await fetch(new URL('/snapshot', base), { cache: 'no-store' });
      const body = await response.json().catch(() => null) as SwarmSnapshot | null;
      if (request !== latest.current) return;
      const frames = pending.current ?? [];
      pending.current = null;
      setConnection('open');
      // 404 is a reachable stream with no run yet.
      if (!response.ok || !body || !Array.isArray(body.accounts)) {
        shownRun.current = null;
        setData(null);
        return;
      }
      shownRun.current = body.run;
      setData(frames.filter((frame) => frame.kind !== 'tick' || frame.rec.run === body.run).reduce(applyFrame, body));
    } catch {
      if (request !== latest.current) return;
      pending.current = null;
      setConnection('unreachable');
    } finally {
      if (request === latest.current) busy.current = false;
    }
  }, [base]);

  /** A load unless one is already in the air, so a slow snapshot is not abandoned every 5 s. */
  const poll = useCallback(() => {
    if (!busy.current) void load();
  }, [load]);

  /** A different run: drop everything held for the old one before reading the new one. */
  const switchRun = useCallback(() => {
    shownRun.current = null;
    pending.current = [];
    setData(null);
    setConnection('connecting');
    void load();
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  const waiting = connection !== 'open' || data?.active !== true;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(poll, RETRY_MS);
    return () => window.clearInterval(timer);
  }, [poll, waiting]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(new URL('/events', base).toString());
    let retry: number | undefined;
    let dropped = false;
    const parse = <T,>(event: Event) => {
      try { return JSON.parse((event as MessageEvent).data) as T; } catch { return null; }
    };
    const fold = (frame: StreamFrame) => {
      pending.current?.push(frame);
      setData((current) => (current ? applyFrame(current, frame) : current));
    };
    source.onopen = () => {
      // A reconnect: re-read what happened while the connection was down.
      if (dropped) void load();
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
      poll();
      // A network error is retried by the browser; anything else closes the source for good.
      if (source.readyState === EventSource.CLOSED) {
        retry = window.setTimeout(() => setGeneration((value) => value + 1), RETRY_MS);
      }
    };
    source.addEventListener('tick', (event) => {
      const tick = parse<SwarmTick>(event);
      if (!tick) return;
      if (tick.run !== shownRun.current) {
        if (shownRun.current === null) poll();
        else switchRun();
        return;
      }
      fold({ kind: 'tick', rec: tick });
    });
    source.addEventListener('launch', (event) => {
      const rec = parse<LaunchRecord>(event);
      if (!rec) return;
      if (shownRun.current === null || (typeof rec.run === 'string' && rec.run !== shownRun.current)) {
        if (shownRun.current === null) poll();
        else switchRun();
        return;
      }
      fold({ kind: 'launch', rec });
    });
    for (const kind of ['acct', 'trade', 'halt', 'alert', 'msg', 'send'] as const) {
      source.addEventListener(kind, (event) => {
        const rec = parse<StreamFrame['rec']>(event);
        if (!rec) return;
        fold({ kind, rec } as StreamFrame);
      });
    }
    source.addEventListener('run', (event) => {
      const run = parse<{ run: string | null }>(event)?.run ?? null;
      if (run !== null && run === shownRun.current) void load();
      else switchRun();
    });
    return () => {
      window.clearTimeout(retry);
      source.close();
    };
  }, [base, generation, load, poll, switchRun]);

  return { data, connection, base };
}
