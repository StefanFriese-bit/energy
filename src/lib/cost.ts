// What the energy cost: each half hour's use times the price that applied in THAT half hour, plus the
// daily standing charge of the tariff the house was on THAT day. Pure functions, no network.

import { addDays, dayKey, londonMidnight } from './time';

/** A price that applied from `from` until `to` (ms; `to` = Infinity when open-ended). Pence, VAT included. */
export interface Rate { from: number; to: number; p: number; pm?: string | null }
export interface Interval { start: number; kwh: number }
/** The house was on `tariff` from `from` until `to`. */
export interface Agreement { tariff: string; from: number; to: number }
export interface TariffRates { unit: Rate[]; standing: Rate[]; day?: Rate[]; night?: Rate[] }
export type PayMethod = 'DIRECT_DEBIT' | 'NON_DIRECT_DEBIT';

export interface Costed { start: number; kwh: number; rate: number | null; p: number }
export interface DayTotal {
  day: string; kwh: number; energyP: number; standingP: number; totalP: number;
  /** Half hours with a reading / half hours the day has (46, 48 or 50). */
  readings: number; slots: number; unpriced: number;
}

export const HALF_HOUR = 30 * 60_000;

/** Two-rate (Economy 7) tariffs: "E-2R-…". The night hours are fixed in UTC (GMT), not moved by the clocks. */
export const isTwoRate = (tariff: string) => /^E-2R-/.test(tariff);

/** "E-1R-AGILE-24-10-01-C" → "AGILE-24-10-01" (the product), "C" (the region). */
export function splitTariff(tariff: string): { product: string; region: string } | null {
  const m = /^[EG]-[12]R-(.+)-([A-P])$/.exec(tariff);
  return m ? { product: m[1], region: m[2] } : null;
}

/** A gas meter that reads in cubic metres: m³ × volume correction × calorific value ÷ 3.6 = kWh (the formula on the bill). */
export function gasKwh(value: number, unit: 'm3' | 'kwh', calorific: number): number {
  return unit === 'kwh' ? value : (value * 1.02264 * calorific) / 3.6;
}

/** Only the prices for this way of paying (a price with no method applies to every way). */
export function forPayment(rates: Rate[], pm: PayMethod): Rate[] {
  const mine = rates.filter((r) => !r.pm || r.pm === pm);
  return mine.length ? mine : rates;
}

/** Fast "which price applied at moment t" for a list of prices. */
export function rateFinder(rates: Rate[]): (t: number) => Rate | null {
  const sorted = [...rates].sort((a, b) => a.from - b.from);
  return (t) => {
    let lo = 0, hi = sorted.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].from <= t) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    // Prices can overlap (a new price list starting before an old one is closed): take the latest that covers t.
    for (let i = hit; i >= 0 && i > hit - 4; i--) if (sorted[i].to > t) return sorted[i];
    return null;
  };
}

export function agreementAt(agreements: Agreement[], t: number): Agreement | null {
  for (const a of agreements) if (a.from <= t && t < a.to) return a;
  return null;
}

export interface CostOptions { pay: PayMethod; nightStartUtcMin: number; nightEndUtcMin: number }
export const DEFAULT_COST_OPTIONS: CostOptions = { pay: 'DIRECT_DEBIT', nightStartUtcMin: 30, nightEndUtcMin: 450 };

function inNight(t: number, o: CostOptions): boolean {
  const m = Math.floor((t % 86_400_000) / 60_000);
  return o.nightStartUtcMin <= o.nightEndUtcMin ? m >= o.nightStartUtcMin && m < o.nightEndUtcMin : m >= o.nightStartUtcMin || m < o.nightEndUtcMin;
}

type Finders = { unit: (t: number) => Rate | null; standing: (t: number) => Rate | null; day: (t: number) => Rate | null; night: (t: number) => Rate | null };
function finders(rates: Record<string, TariffRates>, o: CostOptions): Record<string, Finders> {
  const f: Record<string, Finders> = {};
  for (const [tariff, r] of Object.entries(rates)) {
    f[tariff] = {
      unit: rateFinder(forPayment(r.unit, o.pay)),
      standing: rateFinder(forPayment(r.standing, o.pay)),
      day: rateFinder(forPayment(r.day ?? [], o.pay)),
      night: rateFinder(forPayment(r.night ?? [], o.pay)),
    };
  }
  return f;
}

/** The unit price (pence per kWh) that applied at moment t, or null if we do not know it. */
export function unitPriceAt(t: number, agreements: Agreement[], rates: Record<string, TariffRates>, o: CostOptions = DEFAULT_COST_OPTIONS, f = finders(rates, o)): number | null {
  const a = agreementAt(agreements, t);
  if (!a || !f[a.tariff]) return null;
  if (isTwoRate(a.tariff)) return (inNight(t, o) ? f[a.tariff].night(t) : f[a.tariff].day(t))?.p ?? f[a.tariff].unit(t)?.p ?? null;
  return f[a.tariff].unit(t)?.p ?? null;
}

export function costIntervals(intervals: Interval[], agreements: Agreement[], rates: Record<string, TariffRates>, o: CostOptions = DEFAULT_COST_OPTIONS): Costed[] {
  const f = finders(rates, o);
  return intervals.map((iv) => {
    const rate = unitPriceAt(iv.start, agreements, rates, o, f);
    return { start: iv.start, kwh: iv.kwh, rate, p: rate == null ? 0 : iv.kwh * rate };
  });
}

/** The standing charge (pence) for one UK day: the price at midday of the tariff the house was on at midday. */
export function standingForDay(day: string, agreements: Agreement[], rates: Record<string, TariffRates>, o: CostOptions = DEFAULT_COST_OPTIONS): number | null {
  const noon = londonMidnight(day) + 12 * 3_600_000;
  const a = agreementAt(agreements, noon);
  if (!a || !rates[a.tariff]) return null;
  return rateFinder(forPayment(rates[a.tariff].standing, o.pay))(noon)?.p ?? null;
}

/** One line per UK day from `first` to `last` (inclusive), days without readings included (as zeros). */
export function dayTotals(costed: Costed[], first: string, last: string, agreements: Agreement[], rates: Record<string, TariffRates>, o: CostOptions = DEFAULT_COST_OPTIONS): DayTotal[] {
  const byDay = new Map<string, Costed[]>();
  for (const c of costed) {
    const k = dayKey(c.start);
    const list = byDay.get(k);
    if (list) list.push(c); else byDay.set(k, [c]);
  }
  const out: DayTotal[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const list = byDay.get(d) ?? [];
    const slots = Math.round((londonMidnight(addDays(d, 1)) - londonMidnight(d)) / HALF_HOUR);
    const kwh = list.reduce((s, c) => s + c.kwh, 0);
    const energyP = list.reduce((s, c) => s + c.p, 0);
    const unpriced = list.filter((c) => c.rate == null && c.kwh > 0).length;
    // No readings at all = we know nothing about that day yet, so no standing charge is counted either.
    const standingP = list.length ? standingForDay(d, agreements, rates, o) ?? 0 : 0;
    out.push({ day: d, kwh, energyP, standingP, totalP: energyP + standingP, readings: list.length, slots, unpriced });
  }
  return out;
}

export interface Summary { kwh: number; energyP: number; standingP: number; totalP: number; days: number; fullDays: number; avgRate: number | null; unpriced: number }
export function summarise(days: DayTotal[]): Summary {
  const s = { kwh: 0, energyP: 0, standingP: 0, totalP: 0, days: days.length, fullDays: 0, avgRate: null as number | null, unpriced: 0 };
  for (const d of days) {
    s.kwh += d.kwh; s.energyP += d.energyP; s.standingP += d.standingP; s.totalP += d.totalP; s.unpriced += d.unpriced;
    if (d.readings >= d.slots) s.fullDays++;
  }
  s.avgRate = s.kwh > 0 ? s.energyP / s.kwh : null;
  return s;
}

/** £12.34 from pence. */
export function pounds(p: number, decimals = 2): string {
  const v = p / 100;
  return `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}
export function kwhText(k: number): string {
  return `${k.toLocaleString('en-GB', { maximumFractionDigits: k < 10 ? 2 : k < 100 ? 1 : 0 })} kWh`;
}
export function pence(p: number): string { return `${p.toLocaleString('en-GB', { maximumFractionDigits: 2 })}p`; }
