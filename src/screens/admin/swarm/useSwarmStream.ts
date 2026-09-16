/**
 * Client for the local swarm stream (`backend/native/swarm/stream.mjs`).
 *
 * `/snapshot` gives the history; `/events` keeps it current: `tick` every 5 s,
 * `acct`/`trade`/`brake` as they arrive, `run` when a newer run starts. The
 * stream is read-only and on 127.0.0.1 — nothing here reaches a node or a run.
 *
 * `msg` records are not pushed, so per-account message counters and last
 * round trip only move when the snapshot is re-read; that happens every 30 s.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyAcct, applyBrake, applyTick, applyTrade } from './model';
import type { SwarmSnapshot, SwarmTick } from './types';

export const SWARM_STREAM_URL: string = import.meta.env.VITE_SWARM_STREAM_URL || 'http://127.0.0.1:8787';
const SNAPSHOT_REFRESH_MS = 30_000;

export type StreamStatus = 'connecting' | 'live' | 'replay' | 'offline';

export function useSwarmStream(enabled: boolean, base = SWARM_STREAM_URL) {
  const [data, setData] = useState<SwarmSnapshot | null>(null);
  /** null follows the live run; an id replays that run. */
  const [run, setRun] = useState<string | null>(null);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<string[]>([]);
  const latest = useRef(0);
  const shownRun = useRef<string | null>(null);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const url = new URL('/snapshot', base);
      if (run) url.searchParams.set('run', run);
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json() as SwarmSnapshot & { error?: string };
      if (request !== latest.current) return;
      setRuns(Array.isArray(body.runs) ? body.runs : []);
      if (!response.ok) throw new Error(body.error ?? `stream answered ${response.status}`);
      shownRun.current = body.run;
      setData(body);
      setError(null);
      setStatus((current) => (run && run !== body.live ? 'replay' : current === 'offline' || current === 'replay' ? 'connecting' : current));
    } catch (err) {
      if (request !== latest.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('offline');
    }
  }, [base, run]);

  useEffect(() => {
    if (!enabled) return undefined;
    void load();
    if (run) return undefined;
    const timer = window.setInterval(() => { void load(); }, SNAPSHOT_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, load, run]);

  useEffect(() => {
    if (!enabled || run || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(new URL('/events', base).toString());
    const parse = <T,>(event: MessageEvent) => {
      try { return JSON.parse(event.data) as T; } catch { return null; }
    };
    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('offline');
    source.addEventListener('tick', (event) => {
      const tick = parse<SwarmTick>(event as MessageEvent);
      if (!tick) return;
      if (tick.run !== shownRun.current) {
        void load();
        return;
      }
      setData((current) => (current && current.run === tick.run ? applyTick(current, tick) : current));
    });
    source.addEventListener('acct', (event) => {
      const rec = parse<Parameters<typeof applyAcct>[1]>(event as MessageEvent);
      if (rec) setData((current) => (current ? applyAcct(current, rec) : current));
    });
    source.addEventListener('trade', (event) => {
      const rec = parse<Parameters<typeof applyTrade>[1]>(event as MessageEvent);
      if (rec) setData((current) => (current ? applyTrade(current, rec) : current));
    });
    source.addEventListener('brake', (event) => {
      const rec = parse<Parameters<typeof applyBrake>[1]>(event as MessageEvent);
      if (rec) setData((current) => (current ? applyBrake(current, rec) : current));
    });
    source.addEventListener('run', () => { void load(); });
    return () => source.close();
  }, [base, enabled, load, run]);

  return { data, run, setRun, runs, status, error, reload: load, base };
}
