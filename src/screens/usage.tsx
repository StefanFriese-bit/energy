import { useEffect, useMemo, useState } from 'preact/hooks';
import { kwhText, pence, pounds, summarise, type DayTotal } from '../lib/cost';
import { loadUsage, type Usage } from '../lib/data';
import type { Kind } from '../lib/octopus';
import { hasOctopus } from '../lib/store';
import { addDays, addMonths, clock, dayKey, daysInMonth, mondayOf, monthShort, niceDay, niceMonth, DAY_SHORT, weekdayOf } from '../lib/time';
import { Bars, Problem, Segment, Spinner, useStore, type Bar } from '../ui';

type Fuel = Kind | 'both';
type Period = 'day' | 'week' | 'month' | 'year';
export const ELEC = 'var(--elec)';
export const GAS = 'var(--gas)';

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
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(yesterday);
  const [unit, setUnit] = useState<'gbp' | 'kwh'>('gbp');
  const [pick, setPick] = useState<number | null>(null);
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
      {data && <UsageBody data={data} kinds={kinds} period={period} range={range} unit={unit} setUnit={setUnit} pick={pick} setPick={setPick} yesterday={yesterday} />}
    </>
  );
}

/** "the end of Mon 9 Nov" or "Tue 10 Nov 14:30": where the newest reading ends. */
export function readingsUpTo(latestStart: number): string {
  if (!latestStart) return 'none yet';
  const end = latestStart + 1_800_000;
  return clock(end) === '00:00' ? `the end of ${niceDay(dayKey(end - 1))}` : `${niceDay(dayKey(end))} ${clock(end)}`;
}

function UsageBody({ data, kinds, period, range, unit, setUnit, pick, setPick, yesterday }: {
  data: Loaded; kinds: Kind[]; period: Period; range: [string, string]; unit: 'gbp' | 'kwh'; setUnit: (u: 'gbp' | 'kwh') => void;
  pick: number | null; setPick: (i: number | null) => void; yesterday: string;
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

  const bars: Bar[] = useMemo(() => {
    if (period === 'day') {
      const out: Bar[] = [];
      const series = present.map((k) => data.cur[k]!.costed);
      const starts = [...new Set(series.flat().map((c) => c.start))].sort((a, b) => a - b);
      for (const t of starts) {
        const vals = series.map((list) => { const c = list.find((x) => x.start === t); return c ? (unit === 'gbp' ? c.p : c.kwh) : 0; });
        const m = clock(t);
        out.push({ label: m.endsWith(':00') && +m.slice(0, 2) % 6 === 0 ? m.slice(0, 2) : '', values: vals, title: `${m}: ${vals.map(fmt).join(' + ')}` });
      }
      return out;
    }
    if (period === 'year') {
      const months = new Map<string, number[]>();
      present.forEach((k, i) => { for (const d of days(k)) { const m = d.day.slice(0, 7); const a = months.get(m) ?? present.map(() => 0); a[i] += v(d); months.set(m, a); } });
      return [...months.entries()].map(([m, vals]) => ({ label: monthShort(m).slice(0, 1), values: vals, title: `${niceMonth(m)}: ${fmt(vals.reduce((a, b) => a + b, 0))}`, dim: m > yesterday.slice(0, 7) }));
    }
    const first = days(present[0]);
    return first.map((d, i) => {
      const vals = present.map((k) => v(days(k)[i]));
      return { label: period === 'week' ? DAY_SHORT[weekdayOf(d.day)].slice(0, 2) : +d.day.slice(8) % 5 === 1 ? String(+d.day.slice(8)) : '', values: vals, title: `${niceDay(d.day)}: ${fmt(vals.reduce((a, b) => a + b, 0))}`, dim: d.day > yesterday || d.readings === 0 };
    });
  }, [data, period, unit, present.join()]);

  if (!present.length) return <Problem>Octopus does not list a {kinds.join(' or ')} meter on this account.</Problem>;

  const totalNow = tot(cur, unit === 'gbp' ? 'totalP' : 'kwh');
  const totalPrev = tot(prev, unit === 'gbp' ? 'totalP' : 'kwh');
  const diff = totalNow - totalPrev;
  const latest = Math.max(...present.map((k) => data.cur[k]!.latest ?? 0));
  const partial = present.flatMap((k) => days(k).filter((d) => d.day <= yesterday && d.readings > 0 && d.readings < d.slots).map((d) => d.day));
  const unpriced = cur.reduce((a, x) => a + x.unpriced, 0);
  const picked = pick != null ? bars[pick] : null;
  const thisMonthRunning = period === 'month' && range[1] > yesterday && doneDays > 0;
  const totalDays = period === 'month' ? days(present[0]).length : 0;
  const priciest = period === 'week' || period === 'month'
    ? days(present[0]).map((d, i) => ({ d: d.day, p: present.reduce((a, k) => a + days(k)[i].totalP, 0) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p)[0]
    : null;

  return (
    <>
      <div class="totals">
        <div class="big-number">{fmt(totalNow)}</div>
        <Segment label="Show" value={unit} onChange={setUnit} options={[['gbp', '£'], ['kwh', 'kWh']] as const} />
      </div>
      {both && (
        <div class="legend">
          <span><i style={{ background: ELEC }} />Electricity {unit === 'gbp' ? pounds(cur[0].totalP) : kwhText(cur[0].kwh)}</span>
          <span><i style={{ background: GAS }} />Gas {unit === 'gbp' ? pounds(cur[1].totalP) : kwhText(cur[1].kwh)}</span>
        </div>
      )}
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

      <Bars bars={bars} colours={present.map((k) => (k === 'electricity' ? ELEC : GAS))} selected={pick} onPick={setPick} />
      <p class="pick-line" aria-live="polite">{picked ? picked.title : 'Tap a bar for its figure.'}</p>

      <div class="facts">
        {unit === 'gbp' && <p>Of that, <b>{pounds(tot(cur, 'standingP'))}</b> is standing charge (paid whatever you use) and <b>{pounds(tot(cur, 'energyP'))}</b> is the energy itself.</p>}
        {present.map((k, i) => cur[i].avgRate != null && (
          <p>{k === 'electricity' ? 'Electricity' : 'Gas'}: {kwhText(cur[i].kwh)} at an average <b>{pence(cur[i].avgRate!)}</b> per kWh{prev[i].avgRate != null ? ` (before: ${pence(prev[i].avgRate!)})` : ''}.</p>
        ))}
        {thisMonthRunning && unit === 'gbp' && <p>So far {pounds(totalNow)} in {doneDays} days. At this rate the month comes to about <b>{pounds((totalNow / doneDays) * totalDays, 0)}</b>.</p>}
        {priciest && unit === 'gbp' && <p>Dearest day: <b>{niceDay(priciest.d)}</b>, {pounds(priciest.p)}.</p>}
      </div>

      {missing.length > 0 && <p class="small">No {missing.join(' or ')} meter on this Octopus account.</p>}
      {unpriced > 0 && <p class="note-box">{unpriced} half hour{unpriced === 1 ? '' : 's'} had no price from Octopus, so {unpriced === 1 ? 'it is' : 'they are'} left out of the £ figure.</p>}
      {partial.length > 0 && <p class="small">Some half hours are still missing for {[...new Set(partial)].slice(0, 4).map((d) => niceDay(d)).join(', ')}{partial.length > 4 ? '…' : ''}: the meter sends them late now and then.</p>}
      <p class="small">Readings up to {readingsUpTo(latest)}. Octopus usually has yesterday's readings by the morning; today's are not there yet.</p>
    </>
  );
}
