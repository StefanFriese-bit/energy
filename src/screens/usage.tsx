import { useEffect, useMemo, useState } from 'preact/hooks';
import { kwhText, monthOutlook, pence, pounds, summarise, type DayTotal } from '../lib/cost';
import { loadUsage, type Usage } from '../lib/data';
import type { Kind } from '../lib/octopus';
import { hasOctopus } from '../lib/store';
import { addDays, addMonths, clock, dayKey, daysInMonth, mondayOf, monthShort, niceDay, niceMonth, DAY_SHORT, weekdayOf } from '../lib/time';
import { Chart, Legend, type Series } from '../chart';
import { Problem, Segment, Spinner, useStore } from '../ui';

type Fuel = Kind | 'both';
type Period = 'day' | 'week' | 'month' | 'year';
export const ELEC = 'var(--elec)';
export const GAS = 'var(--gas)';
export const PROJ = 'var(--proj)';
export const AVG = 'var(--avg)';
const TOTAL = 'var(--accent)';
const LAST = 'var(--faint)';

function rangeOf(p: Period, anchor: string): [string, string] {
  if (p === 'day') return [anchor, anchor];
  if (p === 'week') { const m = mondayOf(anchor); return [m, addDays(m, 6)]; }
  const month = anchor.slice(0, 7);
  if (p === 'month') return [`${month}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`];
  const first = addMonths(month, -11);
  return [`${first}-01`, `${month}-${String(daysInMonth(month)).padStart(2, '0')}`];
}
function shift(p: Period, anchor: string, n: number): string {
  if (p === 'day') return addDays(anchor, n);
  if (p === 'week') return addDays(anchor, 7 * n);
  const m = addMonths(anchor.slice(0, 7), p === 'month' ? n : 12 * n);
  return `${m}-${String(Math.min(+anchor.slice(8), daysInMonth(m))).padStart(2, '0')}`;
}
function title(p: Period, [a, b]: [string, string]): string {
  if (p === 'day') return niceDay(a, true);
  if (p === 'week') return `${niceDay(a)} – ${niceDay(b)}`;
  if (p === 'month') return niceMonth(a.slice(0, 7));
  return `${niceMonth(a.slice(0, 7))} – ${niceMonth(b.slice(0, 7))}`;
}

interface Loaded { cur: Partial<Record<Kind, Usage | null>>; prev: Partial<Record<Kind, Usage | null>> }

export function UsageScreen() {
  const s = useStore().settings;
  const yesterday = addDays(dayKey(Date.now()), -1);
  const [fuel, setFuel] = useState<Fuel>('both');
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(yesterday);
  const [unit, setUnit] = useState<'gbp' | 'kwh'>('gbp');
  const [pick, setPick] = useState<number | null>(null);
  const [view, setView] = useState<'day' | 'running'>('day');
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const range = rangeOf(period, anchor);
  const prevRange = rangeOf(period, shift(period, anchor, -1));
  const kinds: Kind[] = fuel === 'both' ? ['electricity', 'gas'] : [fuel];

  useEffect(() => {
    if (!hasOctopus(s)) return;
    let live = true;
    setErr(null); setData(null); setPick(null);
    const want: Kind[] = ['electricity', 'gas'];
    Promise.all([
      Promise.all(want.map((k) => loadUsage(s, k, range[0], range[1]))),
      Promise.all(want.map((k) => loadUsage(s, k, prevRange[0], prevRange[1]))),
    ])
      .then(([c, p]) => { if (live) setData({ cur: { electricity: c[0], gas: c[1] }, prev: { electricity: p[0], gas: p[1] } }); })
      .catch((e) => { if (live) setErr(e?.message ?? String(e)); });
    return () => { live = false; };
  }, [range[0], range[1], s.octopusAccount, s.octopusKey, s.pay, s.gasUnit, s.calorific, s.nightStart, s.nightEnd, tick]);

  if (!hasOctopus(s)) return <><h1>Usage</h1><div class="empty"><p>Add your Octopus account number and API key to see what the house uses and what it costs.</p><a class="btn primary" href="#/settings">Go to Settings</a></div></>;

  const canNext = range[1] < yesterday;
  return (
    <>
      <h1>Usage</h1>
      <Segment label="Fuel" value={fuel} onChange={(v) => { setFuel(v); setPick(null); }} options={[['both', 'Both'], ['electricity', 'Electricity'], ['gas', 'Gas']] as const} />
      <Segment label="Period" value={period} onChange={(v) => { setPeriod(v); setPick(null); }} options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']] as const} />
      <div class="period-nav">
        <button type="button" class="btn round" aria-label="Earlier" onClick={() => setAnchor(shift(period, anchor, -1))}>‹</button>
        <strong>{title(period, range)}</strong>
        <button type="button" class="btn round" aria-label="Later" disabled={!canNext} onClick={() => setAnchor(shift(period, anchor, 1) > yesterday ? yesterday : shift(period, anchor, 1))}>›</button>
      </div>
      {err && <Problem retry={() => setTick(tick + 1)}>{err}</Problem>}
      {!err && !data && <Spinner text="Asking Octopus…" />}
      {data && <UsageBody data={data} kinds={kinds} period={period} range={range} unit={unit} setUnit={setUnit} pick={pick} setPick={setPick} yesterday={yesterday} view={view} setView={(v) => { setView(v); setPick(null); }} />}
    </>
  );
}

/** "the end of Mon 9 Nov" or "Tue 10 Nov 14:30": where the newest reading ends. */
export function readingsUpTo(latestStart: number): string {
  if (!latestStart) return 'none yet';
  const end = latestStart + 1_800_000;
  return clock(end) === '00:00' ? `the end of ${niceDay(dayKey(end - 1))}` : `${niceDay(dayKey(end))} ${clock(end)}`;
}

/** Short money/energy figures for the chart's left axis: £3, £2.50, 40 kWh. */
function axisText(unit: 'gbp' | 'kwh') {
  return (v: number) => {
    if (unit === 'kwh') return v >= 1000 ? `${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k` : v.toLocaleString('en-GB', { maximumFractionDigits: 1 });
    const pnd = v / 100;
    return `£${pnd.toLocaleString('en-GB', { maximumFractionDigits: pnd >= 10 || Number.isInteger(pnd) ? 0 : 2 })}`;
  };
}

interface ChartData { labels: string[]; titles: string[]; series: Series[]; dim: boolean[]; divider: { at: number; label: string } | null; refLines: { value: number; colour: string; label: string }[] }

function UsageBody({ data, kinds, period, range, unit, setUnit, pick, setPick, yesterday, view, setView }: {
  data: Loaded; kinds: Kind[]; period: Period; range: [string, string]; unit: 'gbp' | 'kwh'; setUnit: (u: 'gbp' | 'kwh') => void;
  pick: number | null; setPick: (i: number | null) => void; yesterday: string; view: 'day' | 'running'; setView: (v: 'day' | 'running') => void;
}) {
  const present = kinds.filter((k) => data.cur[k]);
  const missing = kinds.filter((k) => !data.cur[k]);
  const days = (k: Kind, which: 'cur' | 'prev' = 'cur'): DayTotal[] => data[which][k]?.days ?? [];
  // Only days that have readings count, so a week still in progress is compared with the same days of the week before.
  const doneDays = Math.max(0, ...present.map((k) => days(k).filter((d) => d.readings > 0).length));
  const sum = (k: Kind, which: 'cur' | 'prev') => summarise(which === 'prev' && period !== 'year' ? days(k, which).slice(0, doneDays) : days(k, which));
  const cur = present.map((k) => sum(k, 'cur'));
  const prev = present.map((k) => sum(k, 'prev'));
  const tot = (xs: typeof cur, f: 'totalP' | 'kwh' | 'standingP' | 'energyP') => xs.reduce((a, x) => a + x[f], 0);
  const both = present.length > 1;
  const v = (d: DayTotal) => (unit === 'gbp' ? d.totalP : d.kwh);
  const fmt = (x: number) => (unit === 'gbp' ? pounds(x) : kwhText(x));
  const colourOf = (k: Kind) => (k === 'electricity' ? ELEC : GAS);
  const nameOf = (k: Kind) => (k === 'electricity' ? 'Electricity' : 'Gas');

  // The month: where it stands, the average day and where that takes it (per fuel, then added up).
  const isMonth = period === 'month';
  const monthDays = isMonth && present.length ? days(present[0]).length : 0;
  const outlooks = isMonth ? present.map((k) => monthOutlook(days(k), monthDays, v)) : [];
  const running = isMonth && range[1] > yesterday;
  const avgDay = outlooks.length && outlooks.every((o) => o.avgPerDay != null) ? outlooks.reduce((a, o) => a + o.avgPerDay!, 0) : null;
  const projected = outlooks.length && outlooks.every((o) => o.projected != null) ? outlooks.reduce((a, o) => a + o.projected!, 0) : null;
  const lastMonthTotal = isMonth ? present.reduce((a, k) => a + days(k, 'prev').reduce((b, d) => b + v(d), 0), 0) : 0;
  const lastMonthHasData = isMonth && present.some((k) => days(k, 'prev').some((d) => d.readings > 0));

  const chart: ChartData = useMemo(() => {
    const none = { divider: null, refLines: [] as ChartData['refLines'] };
    if (period === 'day') {
      const series = present.map((k) => data.cur[k]!.costed);
      const starts = [...new Set(series.flat().map((c) => c.start))].sort((a, b) => a - b);
      const cols = starts.map((t) => series.map((list) => { const c = list.find((x) => x.start === t); return c ? (unit === 'gbp' ? c.p : c.kwh) : 0; }));
      return {
        ...none,
        labels: starts.map((t) => { const m = clock(t); return m.endsWith(':00') && +m.slice(0, 2) % 6 === 0 ? m.slice(0, 2) : ''; }),
        titles: starts.map((t, i) => `${clock(t)}: ${cols[i].map(fmt).join(' + ')}`),
        series: present.map((k, j) => ({ kind: 'bar' as const, name: nameOf(k), colour: colourOf(k), values: cols.map((c) => c[j]) })),
        dim: starts.map(() => false),
      };
    }
    if (period === 'year') {
      const months = new Map<string, number[]>();
      present.forEach((k, i) => { for (const d of days(k)) { const m = d.day.slice(0, 7); const a = months.get(m) ?? present.map(() => 0); a[i] += v(d); months.set(m, a); } });
      const list = [...months.entries()];
      return {
        ...none,
        labels: list.map(([m]) => monthShort(m).slice(0, 1)),
        titles: list.map(([m, vals]) => `${niceMonth(m)}: ${fmt(vals.reduce((a, b) => a + b, 0))}`),
        series: present.map((k, j) => ({ kind: 'bar' as const, name: nameOf(k), colour: colourOf(k), values: list.map(([, vals]) => vals[j]) })),
        dim: list.map(([m]) => m > yesterday.slice(0, 7)),
      };
    }
    const first = days(present[0]);
    const labels = first.map((d) => (period === 'week' ? DAY_SHORT[weekdayOf(d.day)].slice(0, 2) : +d.day.slice(8) === 1 || +d.day.slice(8) % 5 === 0 ? String(+d.day.slice(8)) : ''));
    const has = first.map((_, i) => present.some((k) => days(k)[i].readings > 0));
    const actual = (i: number) => present.reduce((a, k) => a + v(days(k)[i]), 0);
    // In a month still running, the days at the end with no readings yet (today, the rest of the month, and yesterday
    // until Octopus sends it) are the ones still to come: drawn as projected, like the dashboard's forecast months.
    let futureFrom = first.length;
    if (running) while (futureFrom > 0 && !has[futureFrom - 1]) futureFrom--;
    const avgText = avgDay != null ? `Average ${unit === 'gbp' ? pounds(avgDay) : kwhText(avgDay)} a day` : '';

    if (isMonth && view === 'running') {
      let acc = 0;
      const cum = first.map((_, i) => (i < futureFrom ? (acc += actual(i)) : null));
      const lastActual = futureFrom - 1;
      const proj = first.map((_, i) => (running && avgDay != null && i >= Math.max(0, lastActual) ? (lastActual >= 0 ? cum[lastActual]! : 0) + avgDay * (i - lastActual) : null));
      const prevDays = days(present[0], 'prev');
      let pacc = 0;
      const lastMonth = lastMonthHasData ? first.map((_, i) => (i < prevDays.length ? (pacc += present.reduce((a, k) => { const d = days(k, 'prev')[i]; return a + (d ? v(d) : 0); }, 0)) : null)) : null;
      const series: Series[] = [];
      if (lastMonth) series.push({ kind: 'line', name: 'Last month', colour: LAST, values: lastMonth, dots: false, width: 1.5, faint: true });
      if (proj.some((x) => x != null)) series.push({ kind: 'line', name: 'Projected', colour: PROJ, values: proj, dashed: true, dots: false, width: 2 });
      series.push({ kind: 'line', name: 'So far', colour: both ? TOTAL : colourOf(present[0]), values: cum });
      return {
        labels, series, dim: first.map(() => false), refLines: [],
        divider: running && futureFrom < first.length ? { at: futureFrom, label: 'Forecast →' } : null,
        titles: first.map((d, i) => cum[i] != null
          ? `${niceDay(d.day)}: ${fmt(cum[i]!)} so far this month${lastMonth?.[i] != null ? ` (last month by the same day: ${fmt(lastMonth[i]!)})` : ''}`
          : `${niceDay(d.day)}: about ${fmt(proj[i] ?? 0)} by then, if the rest of the month goes like the average day`),
      };
    }

    const series: Series[] = present.map((k) => ({ kind: 'bar', name: nameOf(k), colour: colourOf(k), values: first.map((_, i) => (i < futureFrom ? v(days(k)[i]) : null)) }));
    if (isMonth && running && avgDay != null && futureFrom < first.length) {
      series.push({ kind: 'bar', name: 'Projected', colour: PROJ, projected: true, values: first.map((_, i) => (i >= futureFrom ? avgDay : null)) });
    }
    return {
      labels, series,
      dim: first.map((d, i) => i < futureFrom && (d.day > yesterday || !has[i])),
      divider: isMonth && running && futureFrom > 0 && futureFrom < first.length ? { at: futureFrom, label: 'Forecast →' } : null,
      refLines: isMonth && avgDay != null && avgDay > 0 ? [{ value: avgDay, colour: AVG, label: avgText }] : [],
      titles: first.map((d, i) => {
        if (i >= futureFrom) return `${niceDay(d.day)}: about ${fmt(avgDay ?? 0)} expected (the average day so far)`;
        const vals = present.map((k) => v(days(k)[i]));
        const total = vals.reduce((a, b) => a + b, 0);
        return `${niceDay(d.day)}: ${fmt(total)}${both ? ` (electricity ${fmt(vals[0])}, gas ${fmt(vals[1])})` : ''}${isMonth && avgDay ? ` · ${total >= avgDay ? 'above' : 'below'} the average day` : ''}`;
      }),
    };
  }, [data, period, unit, view, present.join(), avgDay, running]);

  if (!present.length) return <Problem>Octopus does not list a {kinds.join(' or ')} meter on this account.</Problem>;

  const totalNow = tot(cur, unit === 'gbp' ? 'totalP' : 'kwh');
  const totalPrev = tot(prev, unit === 'gbp' ? 'totalP' : 'kwh');
  const diff = totalNow - totalPrev;
  const latest = Math.max(...present.map((k) => data.cur[k]!.latest ?? 0));
  const partial = present.flatMap((k) => days(k).filter((d) => d.day <= yesterday && d.readings > 0 && d.readings < d.slots).map((d) => d.day));
  const unpriced = cur.reduce((a, x) => a + x.unpriced, 0);
  const picked = pick != null ? chart.titles[pick] : null;
  const priciest = period === 'week' || period === 'month'
    ? days(present[0]).map((d, i) => ({ d: d.day, p: present.reduce((a, k) => a + days(k)[i].totalP, 0) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)[0]
    : null;
  const monthName = niceMonth(range[0].slice(0, 7)).split(' ')[0];

  const legend: { label: string; colour: string; style: 'bar' | 'line' | 'dashed' | 'projected' }[] = [];
  if (isMonth && view === 'running') {
    legend.push({ label: 'So far', colour: both ? TOTAL : colourOf(present[0]), style: 'line' });
    if (running && projected != null) legend.push({ label: 'Projected', colour: PROJ, style: 'dashed' });
    if (lastMonthHasData) legend.push({ label: 'Last month', colour: LAST, style: 'line' });
  } else {
    present.forEach((k, i) => legend.push({ label: `${nameOf(k)} ${unit === 'gbp' ? pounds(cur[i].totalP) : kwhText(cur[i].kwh)}`, colour: colourOf(k), style: 'bar' }));
    if (isMonth && avgDay != null) legend.push({ label: 'Average day', colour: AVG, style: 'dashed' });
    if (isMonth && running && projected != null && chart.series.some((x) => x.kind === 'bar' && x.projected)) legend.push({ label: 'Projected', colour: PROJ, style: 'projected' });
  }

  return (
    <>
      <div class="totals">
        <div class="big-number">{fmt(totalNow)}</div>
        <Segment label="Show" value={unit} onChange={setUnit} options={[['gbp', '£'], ['kwh', 'kWh']] as const} />
      </div>
      {totalPrev > 0 && doneDays > 0 && (
        Math.abs(diff) < Math.max(0.5, totalPrev * 0.005) ? (
          <p class="compare">About the same as {period === 'year' ? 'the 12 months before' : `the ${period} before`}{period !== 'year' && doneDays < days(present[0]).length ? ` (first ${doneDays} day${doneDays === 1 ? '' : 's'} of each)` : ''}.</p>
        ) : (
          <p class={`compare ${diff > 0 ? 'up' : 'down'}`}>
            {diff > 0 ? '▲' : '▼'} {fmt(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than {period === 'year' ? 'the 12 months before' : `the ${period} before`}
            {period !== 'year' && doneDays < days(present[0]).length ? ` (first ${doneDays} day${doneDays === 1 ? '' : 's'} of each)` : ''} · {diff > 0 ? '+' : ''}{Math.round((diff / totalPrev) * 100)}%
          </p>
        )
      )}

      {isMonth && outlooks.length > 0 && (
        <div class="tiles" aria-label="This month">
          <div class="tile"><span class="meta">So far</span><strong>{fmt(outlooks.reduce((a, o) => a + o.soFar, 0))}</strong><span class="meta">{doneDays} of {monthDays} days</span></div>
          <div class="tile"><span class="meta">Average day</span><strong>{avgDay != null ? fmt(avgDay) : '–'}</strong><span class="meta">{both && avgDay != null ? <>elec {fmt(outlooks[0].avgPerDay ?? 0)}<br />gas {fmt(outlooks[1].avgPerDay ?? 0)}</> : 'per day'}</span></div>
          <div class="tile proj"><span class="meta">{running ? 'Projected' : 'Month total'}</span><strong>{projected == null ? '–' : unit === 'gbp' ? pounds(projected, running ? 0 : 2) : kwhText(projected)}</strong>
            <span class="meta">{lastMonthHasData ? <>last month<br />{fmt(lastMonthTotal)}</> : running ? 'at the average day' : ''}</span></div>
        </div>
      )}

      {isMonth && <Segment label="Graph" value={view} onChange={setView} options={[['day', 'Per day'], ['running', 'Running total']] as const} />}

      <section class="card chart-card">
      <Chart labels={chart.labels} titles={chart.titles} series={chart.series} selected={pick} onPick={setPick} dim={chart.dim}
        divider={chart.divider} refLines={chart.refLines} yFormat={axisText(unit)} height={isMonth ? 220 : 190}
        ariaLabel={isMonth ? `${monthName}, ${view === 'running' ? 'running total' : 'day by day'}` : 'Use and cost'} />
      <Legend items={legend} />
      <p class="pick-line" aria-live="polite">{picked ?? (isMonth ? 'Tap a day for its figure.' : 'Tap a bar for its figure.')}</p>
      </section>

      <div class="facts">
        {unit === 'gbp' && <p>Of that, <b>{pounds(tot(cur, 'standingP'))}</b> is standing charge (paid whatever you use) and <b>{pounds(tot(cur, 'energyP'))}</b> is the energy itself.</p>}
        {present.map((k, i) => cur[i].avgRate != null && (
          <p>{nameOf(k)}: {kwhText(cur[i].kwh)} at an average <b>{pence(cur[i].avgRate!)}</b> per kWh{prev[i].avgRate != null ? ` (before: ${pence(prev[i].avgRate!)})` : ''}.</p>
        ))}
        {isMonth && running && projected != null && <p>So far {fmt(outlooks.reduce((a, o) => a + o.soFar, 0))} in {doneDays} day{doneDays === 1 ? '' : 's'}. If the other {monthDays - doneDays} days cost the same as the average day, {monthName} comes to about <b>{fmt(projected)}</b>.</p>}
        {priciest && unit === 'gbp' && <p>Dearest day: <b>{niceDay(priciest.d)}</b>, {pounds(priciest.p)}.</p>}
      </div>

      {missing.length > 0 && <p class="small">No {missing.join(' or ')} meter on this Octopus account.</p>}
      {unpriced > 0 && <p class="note-box">{unpriced} half hour{unpriced === 1 ? '' : 's'} had no price from Octopus, so {unpriced === 1 ? 'it is' : 'they are'} left out of the £ figure.</p>}
      {partial.length > 0 && <p class="small">Some half hours are still missing for {[...new Set(partial)].slice(0, 4).map((d) => niceDay(d)).join(', ')}{partial.length > 4 ? '…' : ''}: the meter sends them late now and then.</p>}
      <p class="small">Readings up to {readingsUpTo(latest)}. Octopus usually has yesterday's readings by the morning; today's are not there yet.</p>
    </>
  );
}
