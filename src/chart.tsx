// One chart for the whole app, drawn the way the business dashboard draws its graphs (Chart.js look):
// pale bars with a darker 1px edge, a 2.5px line with dots and a gently curved path, dashed lines for anything
// projected, a purple dashed divider with "Forecast →" above it, faint horizontal grid lines only, small grey
// axis figures on the left. Drawn in real pixels (not a stretched picture) so the text stays sharp on the phone.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface BarSeries {
  kind: 'bar'; name: string; colour: string; values: (number | null)[];
  /** A projected bar: no fill colour of its own, a dashed edge (the dashboard's forecast months). */
  projected?: boolean;
}
export interface LineSeries {
  kind: 'line'; name: string; colour: string; values: (number | null)[];
  dashed?: boolean; dots?: boolean; width?: number; faint?: boolean;
}
export type Series = BarSeries | LineSeries;
export interface RefLine { value: number; colour: string; label: string }

export interface ChartProps {
  /** One per column; '' = no label under that column. */
  labels: string[];
  /** One per column: what a tap on that column says. */
  titles: string[];
  series: Series[];
  selected: number | null;
  onPick: (i: number | null) => void;
  height?: number;
  yFormat: (v: number) => string;
  /** A dashed purple line between column `at - 1` and `at`, with `label` above it. */
  divider?: { at: number; label: string } | null;
  refLines?: RefLine[];
  /** Columns drawn faded (a day with no readings yet). */
  dim?: boolean[];
  ariaLabel?: string;
}

const AXIS_W = 46;
const TOP = 22;
const BOTTOM = 20;

function niceStep(max: number, ticks = 4): number {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/** A gently curved path through the points (like Chart.js tension 0.3); a gap (null) breaks the line. */
function curve(points: ([number, number] | null)[], tension = 0.3): string {
  let d = '';
  let run: [number, number][] = [];
  const flush = () => {
    if (!run.length) return;
    d += `M${run[0][0]},${run[0][1]}`;
    for (let i = 1; i < run.length; i++) {
      const p0 = run[i - 2] ?? run[i - 1], p1 = run[i - 1], p2 = run[i], p3 = run[i + 1] ?? p2;
      const c1x = p1[0] + ((p2[0] - p0[0]) * tension) / 2, c1y = p1[1] + ((p2[1] - p0[1]) * tension) / 2;
      const c2x = p2[0] - ((p3[0] - p1[0]) * tension) / 2, c2y = p2[1] - ((p3[1] - p1[1]) * tension) / 2;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    run = [];
  };
  for (const p of points) { if (p) run.push(p); else flush(); }
  flush();
  return d;
}

function useWidth(): [preact.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(200, Math.round(el.getBoundingClientRect().width)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Chart({ labels, titles, series, selected, onPick, height = 190, yFormat, divider, refLines = [], dim, ariaLabel = 'Chart' }: ChartProps) {
  const [ref, width] = useWidth();
  const n = labels.length;
  const plotW = width - AXIS_W - 4;
  const plotH = height - TOP - BOTTOM;
  const colW = plotW / Math.max(1, n);

  // The tallest thing drawn: a stack of bars in one column, a line point or a reference line.
  const bars = series.filter((s): s is BarSeries => s.kind === 'bar');
  const lines = series.filter((s): s is LineSeries => s.kind === 'line');
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, bars.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  for (const l of lines) for (const v of l.values) if (v != null) max = Math.max(max, v);
  for (const r of refLines) max = Math.max(max, r.value);
  const step = niceStep(Math.max(max, 0.0001));
  const top = Math.max(step, Math.ceil((max * 1.04) / step) * step);
  const y = (v: number) => TOP + plotH - (Math.max(0, v) / top) * plotH;
  const x0 = AXIS_W;
  const cx = (i: number) => x0 + colW * i + colW / 2;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  const gap = n > 40 ? 0.12 : n > 14 ? 0.22 : 0.32;
  const barW = Math.max(1, colW * (1 - gap));
  const dots = n <= 40;

  return (
    <div class="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} class={n > 40 ? 'dense' : undefined}>
        {/* grid + y axis figures */}
        {ticks.map((v) => (
          <g>
            <line x1={x0} x2={x0 + plotW} y1={y(v)} y2={y(v)} class={v === 0 ? 'axis-line' : 'grid-line'} />
            <text x={x0 - 6} y={y(v) + 3.5} class="tick" text-anchor="end">{yFormat(v)}</text>
          </g>
        ))}
        {/* the picked column */}
        {selected != null && selected < n && <rect x={x0 + colW * selected} y={TOP} width={colW} height={plotH} class="pick-band" />}
        {/* bars, stacked */}
        {Array.from({ length: n }, (_, i) => {
          let base = 0;
          return (
            <g class={dim?.[i] ? 'col dim' : 'col'}>
              {bars.map((s) => {
                const v = Math.max(0, s.values[i] ?? 0);
                if (!v) return null;
                const yTop = y(base + v), yBot = y(base);
                base += v;
                return (
                  <rect x={cx(i) - barW / 2} y={yTop} width={barW} height={Math.max(0.5, yBot - yTop)} rx={n > 40 ? 0 : 1.5}
                    class={s.projected ? 'bar-projected' : 'bar-fill'} style={{ '--c': s.colour }} />
                );
              })}
            </g>
          );
        })}
        {/* reference lines (the average) */}
        {refLines.map((r) => (
          <g>
            <line x1={x0} x2={x0 + plotW} y1={y(r.value)} y2={y(r.value)} class="ref-line" style={{ '--c': r.colour }} />
            <text x={x0 + plotW - 2} y={y(r.value) - 5} class="ref-label" text-anchor="end" style={{ '--c': r.colour }}>{r.label}</text>
          </g>
        ))}
        {/* lines */}
        {lines.map((l) => {
          const pts = l.values.map((v, i) => (v == null ? null : ([cx(i), y(v)] as [number, number])));
          return (
            <g class={l.faint ? 'line faint' : 'line'} style={{ '--c': l.colour }}>
              <path d={curve(pts)} class="line-path" stroke-width={l.width ?? 2.5} stroke-dasharray={l.dashed ? '6 4' : undefined} />
              {dots && l.dots !== false && pts.map((p) => p && <circle cx={p[0]} cy={p[1]} r={n <= 14 ? 3.5 : 2.5} class="line-dot" />)}
            </g>
          );
        })}
        {/* the forecast divider */}
        {divider && divider.at > 0 && divider.at < n && (
          <g class="divider">
            <line x1={x0 + colW * divider.at} x2={x0 + colW * divider.at} y1={TOP} y2={TOP + plotH} />
            <text x={x0 + colW * divider.at} y={TOP - 8} text-anchor="middle">{divider.label}</text>
          </g>
        )}
        {/* x labels */}
        {labels.map((t, i) => t && <text x={cx(i)} y={height - 5} class="tick" text-anchor="middle">{t}</text>)}
        {/* tap targets, one per column, on top of everything */}
        {Array.from({ length: n }, (_, i) => (
          <rect x={x0 + colW * i} y={TOP} width={colW} height={plotH + BOTTOM} fill="transparent" class={`bar${selected === i ? ' sel' : ''}`} onClick={() => onPick(selected === i ? null : i)}>
            <title>{titles[i]}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}

/** The legend under a chart: a swatch in the series' own style (bar, line or dashed), as on the dashboard. */
export function Legend({ items }: { items: { label: string; colour: string; style: 'bar' | 'line' | 'dashed' | 'projected' }[] }) {
  return (
    <div class="legend">
      {items.map((it) => <span><i class={`sw sw-${it.style}`} style={{ '--c': it.colour }} />{it.label}</span>)}
    </div>
  );
}
