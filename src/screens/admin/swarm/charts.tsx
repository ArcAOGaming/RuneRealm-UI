/**
 * Hand-rolled SVG charts for the SwarmMonitor (no chart library is installed).
 *
 * Marks carry series colour from `--sw-N` (defined once in `SwarmMonitorView`),
 * everything else wears the app's text and edge tokens, so a theme change moves
 * every chart at once. Lines are 2px, grids are solid hairlines, bars have a
 * 2px surface gap, and every plot has a hover readout listing every series.
 */
import { PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';

export interface Series<Row> {
  key: string;
  label: string;
  /** A CSS colour, normally `rgb(var(--sw-1))`. */
  color: string;
  value: (row: Row) => number | null;
  /** Hover text for a value; defaults to the chart's `format`. */
  describe?: (row: Row) => string;
  /** Thinner, for a supporting line next to the headline one. */
  thin?: boolean;
}

const DEFAULT_WIDTH = 600;
const PAD = { top: 8, right: 10, bottom: 18, left: 44 };

/** Container width via ResizeObserver; a fixed width when rendered without a DOM. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function niceMax(value: number) {
  if (!(value > 0)) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * exponent;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Groups rows so there is at most one point per `minPx` pixels. Lines keep each
 * group's maximum so a spike is never averaged away; bars average rates.
 */
function group<Row extends { t: number }>(rows: Row[], plotWidth: number, minPx: number) {
  const max = Math.max(1, Math.floor(plotWidth / minPx));
  const size = Math.max(1, Math.ceil(rows.length / max));
  const groups: Row[][] = [];
  for (let i = 0; i < rows.length; i += size) groups.push(rows.slice(i, i + size));
  return groups;
}

function Legend<Row>({ series, shape, reference }: {
  series: Series<Row>[]; shape: 'line' | 'rect'; reference?: { label: string };
}) {
  if (series.length < 2 && !reference) return null;
  return (
    <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
      {series.map((entry) => (
        <span key={entry.key} className="inline-flex items-center gap-1.5">
          {shape === 'line'
            ? <span className="inline-block h-[2px] w-3 rounded" style={{ background: entry.color }} />
            : <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: entry.color }} />}
          {entry.label}
        </span>
      ))}
      {reference && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 border-t border-dashed border-muted" />
          {reference.label}
        </span>
      )}
    </div>
  );
}

function Tooltip({ x, width, title, rows }: {
  x: number; width: number; title: string; rows: Array<{ key: string; color: string; label: string; value: string }>;
}) {
  const left = Math.min(Math.max(0, x + 10), Math.max(0, width - 150));
  return (
    <div className="pointer-events-none absolute top-0 z-10 min-w-[9rem] rounded-[3px] border border-edge bg-surface/95 px-2 py-1.5 shadow-lift"
      style={{ left }}>
      <div className="font-mono text-[10px] text-faint">{title}</div>
      {rows.map((row) => (
        <div key={row.key} className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span className="inline-block h-[2px] w-2.5 rounded" style={{ background: row.color }} />
          <span className="font-mono font-semibold text-ink">{row.value}</span>
          <span className="text-faint">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function Axes({ width, height, max, format, start, end }: {
  width: number; height: number; max: number; format: (value: number) => string; start?: number; end?: number;
}) {
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = [0, 0.5, 1];
  return (
    <g>
      {ticks.map((fraction) => {
        const y = PAD.top + plotH * (1 - fraction);
        return (
          <g key={fraction}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="rgb(var(--edge) / 0.55)" strokeWidth={1} />
            <text x={PAD.left - 5} y={y + 3} textAnchor="end" fontSize={9} fill="rgb(var(--faint))"
              style={{ fontVariantNumeric: 'tabular-nums' }}>{format(max * fraction)}</text>
          </g>
        );
      })}
      {start !== undefined && (
        <text x={PAD.left} y={height - 4} fontSize={9} fill="rgb(var(--faint))">{clock(start)}</text>
      )}
      {end !== undefined && (
        <text x={width - PAD.right} y={height - 4} textAnchor="end" fontSize={9} fill="rgb(var(--faint))">{clock(end)}</text>
      )}
    </g>
  );
}

export function LineChart<Row extends { t: number }>({
  rows, series, height = 150, format, reference, title,
}: {
  rows: Row[];
  series: Series<Row>[];
  height?: number;
  format: (value: number) => string;
  /** A limit drawn as a dashed threshold, labelled. */
  reference?: { value: number; label: string };
  title: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const groups = group(rows, plotW, 3);
  const points = groups.map((members) => {
    const values: Record<string, number | null> = {};
    const texts: Record<string, string | undefined> = {};
    for (const entry of series) {
      let best: number | null = null;
      let bestRow: Row | null = null;
      for (const row of members) {
        const value = entry.value(row);
        if (value !== null && Number.isFinite(value) && (best === null || value > best)) {
          best = value;
          bestRow = row;
        }
      }
      values[entry.key] = best;
      texts[entry.key] = bestRow && entry.describe ? entry.describe(bestRow) : undefined;
    }
    return { t: members[0].t, end: members[members.length - 1].t, values, texts };
  });
  const peak = Math.max(
    reference?.value ?? 0,
    ...points.flatMap((point) => Object.values(point.values).filter((value): value is number => value !== null)),
  );
  const max = niceMax(peak);
  const x = (index: number) => PAD.left + (points.length <= 1 ? plotW / 2 : (plotW * index) / (points.length - 1));
  const y = (value: number) => PAD.top + plotH * (1 - value / max);

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const index = points.length <= 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, index)));
  };

  const active = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative min-w-0" data-chart="line">
      <Legend series={series.length > 1 ? series : []} shape="line" reference={reference} />
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
        <Axes width={width} height={height} max={max} format={format}
          start={points[0]?.t} end={points.length ? points[points.length - 1].end : undefined} />
        {reference && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.value)} y2={y(reference.value)}
              stroke="rgb(var(--muted))" strokeWidth={1} strokeDasharray="4 3" />
          </g>
        )}
        {series.map((entry) => {
          let path = '';
          let pen = false;
          points.forEach((point, index) => {
            const value = point.values[entry.key];
            if (value === null) { pen = false; return; }
            path += `${pen ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
            pen = true;
          });
          // A sample with no neighbour draws no segment; give it a dot so sparse processes still show.
          const lonely = points.map((point, index) => {
            const value = point.values[entry.key];
            const prev = index > 0 ? points[index - 1].values[entry.key] : null;
            const next = index < points.length - 1 ? points[index + 1].values[entry.key] : null;
            return value !== null && prev === null && next === null
              ? <circle key={point.t} cx={x(index)} cy={y(value)} r={entry.thin ? 1.5 : 2} fill={entry.color} />
              : null;
          });
          return (
            <g key={entry.key}>
              <path d={path} fill="none" stroke={entry.color} strokeWidth={entry.thin ? 1.25 : 2}
                strokeLinejoin="round" strokeLinecap="round" />
              {lonely}
            </g>
          );
        })}
        {active && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgb(var(--muted))" strokeWidth={1} />
            {series.map((entry) => {
              const value = active.values[entry.key];
              return value === null ? null : (
                <circle key={entry.key} cx={x(hover)} cy={y(value)} r={4} fill={entry.color}
                  stroke="rgb(var(--surface))" strokeWidth={2} />
              );
            })}
          </g>
        )}
      </svg>
      {active && hover !== null && (
        <Tooltip x={x(hover)} width={width} title={clock(active.t)} rows={series.map((entry) => {
          const value = active.values[entry.key];
          return {
            key: entry.key,
            color: entry.color,
            label: entry.label,
            value: active.texts[entry.key] ?? (value === null ? '—' : format(value)),
          };
        })} />
      )}
    </div>
  );
}

export function BarChart<Row extends { t: number }>({
  rows, series, stacked = false, height = 110, format, title,
}: {
  rows: Row[];
  series: Series<Row>[];
  stacked?: boolean;
  height?: number;
  format: (value: number) => string;
  title: string;
}) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const perGroup = stacked ? 1 : series.length;
  const groups = group(rows, plotW, stacked ? 6 : 4 * perGroup + 2);
  const points = groups.map((members) => ({
    t: members[0].t,
    end: members[members.length - 1].t,
    values: Object.fromEntries(series.map((entry) => {
      const values = members.map(entry.value).filter((value): value is number => value !== null && Number.isFinite(value));
      return [entry.key, values.length ? values.reduce((a, b) => a + b, 0) / members.length : null];
    })) as Record<string, number | null>,
  }));
  const peak = Math.max(0, ...points.map((point) => (stacked
    ? series.reduce((sum, entry) => sum + (point.values[entry.key] ?? 0), 0)
    : Math.max(0, ...series.map((entry) => point.values[entry.key] ?? 0)))));
  const max = niceMax(peak);
  const slot = plotW / Math.max(1, points.length);
  const gap = 2;
  const barW = Math.max(1, Math.min(24, (slot - gap) / perGroup - (perGroup > 1 ? gap : 0)));
  const scale = (value: number) => (plotH * value) / max;

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    setHover(Math.min(points.length - 1, Math.max(0, Math.floor((px - PAD.left) / slot))));
  };

  const baseline = PAD.top + plotH;
  const active = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative min-w-0" data-chart="bar">
      <Legend series={series} shape="rect" />
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
        <Axes width={width} height={height} max={max} format={format}
          start={points[0]?.t} end={points.length ? points[points.length - 1].end : undefined} />
        {points.map((point, index) => {
          const left = PAD.left + slot * index + gap / 2;
          let top = baseline;
          const marks: ReactNode[] = [];
          series.forEach((entry, seriesIndex) => {
            const value = point.values[entry.key];
            if (value === null || value <= 0) return;
            const h = scale(value);
            if (stacked) {
              const drawn = Math.max(0.5, h - (top < baseline ? gap : 0));
              marks.push(<rect key={entry.key} x={left} y={top - h} width={barW} height={drawn} fill={entry.color} />);
              top -= h;
            } else {
              const bx = left + seriesIndex * (barW + gap);
              marks.push(<rect key={entry.key} x={bx} y={baseline - h} width={barW} height={h} rx={Math.min(2, barW / 2)} fill={entry.color} />);
            }
          });
          return (
            <g key={point.t} opacity={hover === null || hover === index ? 1 : 0.55}>{marks}</g>
          );
        })}
      </svg>
      {active && hover !== null && (
        <Tooltip x={PAD.left + slot * hover} width={width} title={clock(active.t)} rows={series.map((entry) => ({
          key: entry.key,
          color: entry.color,
          label: entry.label,
          value: active.values[entry.key] === null ? '—' : format(active.values[entry.key] as number),
        }))} />
      )}
    </div>
  );
}

/** A 12-to-60 point trend with no axes, for table cells. */
export function Sparkline({ values, color, label, width = 64, height = 18 }: {
  values: Array<number | null>; color: string; label: string; width?: number; height?: number;
}) {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length < 2) return <span className="inline-block text-[10px] text-faint" style={{ width }}>—</span>;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  let path = '';
  let pen = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { pen = false; return; }
    const px = 1 + ((width - 2) * index) / (values.length - 1);
    const py = 2 + (height - 4) * (1 - (value - lo) / span);
    path += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = true;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${label}: ${finite[0]} to ${finite[finite.length - 1]}`} className="inline-block align-middle">
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

