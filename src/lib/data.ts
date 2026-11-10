// Brings the Octopus pieces together: account → meter → readings + the prices of each tariff the house was on
// → cost per day. Finished months are kept on the phone (IndexedDB), so a year view loads fast the second time.

import { createStore, get, set } from 'idb-keyval';
import { costIntervals, dayTotals, gasKwh, isTwoRate, type Agreement, type CostOptions, type DayTotal, type Interval, type Rate, type TariffRates, type Costed } from './cost';
import { fetchAccount, fetchConsumption, fetchProduct, fetchRates, type Account, type Kind, type Meter, type Product, type RateList } from './octopus';
import type { Settings } from './store';
import { addDays, addMonths, londonMidnight, parseHhmm } from './time';

const db = createStore('energy-cache', 'kv');
const HOUR = 3_600_000;

async function cached<T>(key: string, maxAgeMs: number, fetcher: () => Promise<T>): Promise<T> {
  let hit: { at: number; v: T } | undefined;
  try { hit = await get(key, db); } catch { /* storage blocked: just fetch */ }
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.v;
  try {
    const v = await fetcher();
    try { await set(key, { at: Date.now(), v }, db); } catch { /* keep going without a copy */ }
    return v;
  } catch (e) {
    if (hit) return hit.v; // no signal: an older copy beats nothing
    throw e;
  }
}

let accountMemo: { key: string; p: Promise<Account> } | null = null;
export function getAccount(s: Settings, fresh = false): Promise<Account> {
  const k = `${s.octopusAccount.trim().toUpperCase()}|${s.octopusKey.trim()}`;
  if (!fresh && accountMemo?.key === k) return accountMemo.p;
  const p = cached(`account:${k.split('|')[0]}`, fresh ? 0 : 6 * HOUR, () => fetchAccount({ account: s.octopusAccount, key: s.octopusKey }));
  accountMemo = { key: k, p };
  p.catch(() => { if (accountMemo?.p === p) accountMemo = null; });
  return p;
}

/** The meter that measures what the house USES (an export meter for solar is a separate thing). */
export const importMeter = (a: Account, kind: Kind): Meter | undefined => a.meters.find((m) => m.kind === kind && !m.isExport);

const monthStart = (month: string) => londonMidnight(`${month}-01`);
/** Readings of a month that ended more than a week ago no longer change; newer ones are re-asked after an hour. */
const ageFor = (month: string, extraDays: number) => (Date.now() > monthStart(addMonths(month, 1)) + extraDays * 24 * HOUR ? 3650 * 24 * HOUR : HOUR);

function monthsCovering(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first.slice(0, 7); m <= last.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

async function monthReadings(m: Meter, month: string, key: string): Promise<Interval[]> {
  return cached(`use:${m.kind}:${m.point}:${month}`, ageFor(month, 7), () => fetchConsumption(m, monthStart(month), monthStart(addMonths(month, 1)), key));
}

async function monthRates(tariff: string, list: RateList, month: string, key: string): Promise<Rate[]> {
  return cached(`rate:${tariff}:${list}:${month}`, ageFor(month, 2), () => fetchRates(tariff, list, monthStart(month), monthStart(addMonths(month, 1)), key));
}

function dedupe(rates: Rate[]): Rate[] {
  const seen = new Set<string>();
  return rates.filter((r) => { const k = `${r.from}|${r.to}|${r.pm}|${r.p}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Every price list for the tariffs the house was on during these months. */
export async function ratesFor(agreements: Agreement[], months: string[], key: string): Promise<Record<string, TariffRates>> {
  const from = monthStart(months[0]);
  const to = monthStart(addMonths(months[months.length - 1], 1));
  const out: Record<string, TariffRates> = {};
  for (const a of agreements) {
    if (a.to <= from || a.from >= to || out[a.tariff]) continue;
    const ms = months.filter((m) => monthStart(m) < a.to && monthStart(addMonths(m, 1)) > a.from);
    const lists: RateList[] = isTwoRate(a.tariff) ? ['day-unit-rates', 'night-unit-rates', 'standing-charges'] : ['standard-unit-rates', 'standing-charges'];
    const got: Partial<Record<RateList, Rate[]>> = {};
    for (const l of lists) got[l] = dedupe((await Promise.all(ms.map((m) => monthRates(a.tariff, l, m, key)))).flat());
    out[a.tariff] = { unit: got['standard-unit-rates'] ?? [], standing: got['standing-charges'] ?? [], day: got['day-unit-rates'], night: got['night-unit-rates'] };
  }
  return out;
}

export function costOptions(s: Settings): CostOptions {
  return { pay: s.pay, nightStartUtcMin: parseHhmm(s.nightStart) ?? 30, nightEndUtcMin: parseHhmm(s.nightEnd) ?? 450 };
}

export interface Usage {
  kind: Kind; meter: Meter; first: string; last: string;
  costed: Costed[]; days: DayTotal[]; rates: Record<string, TariffRates>;
  /** The newest half hour Octopus has a reading for (readings usually arrive the next day). */
  latest: number | null;
}

/** Use and cost per day from `first` to `last` (UK dates, inclusive). */
export async function loadUsage(s: Settings, kind: Kind, first: string, last: string): Promise<Usage | null> {
  const account = await getAccount(s);
  const meter = importMeter(account, kind);
  if (!meter) return null;
  const months = monthsCovering(first, last);
  const from = londonMidnight(first);
  const to = londonMidnight(addDays(last, 1));
  const raw = (await Promise.all(months.map((m) => monthReadings(meter, m, s.octopusKey.trim())))).flat().filter((iv) => iv.start >= from && iv.start < to);
  const intervals = kind === 'gas' ? raw.map((iv) => ({ start: iv.start, kwh: gasKwh(iv.kwh, s.gasUnit, s.calorific) })) : raw;
  const rates = await ratesFor(meter.agreements, months, s.octopusKey.trim());
  const o = costOptions(s);
  const costed = costIntervals(intervals, meter.agreements, rates, o);
  return { kind, meter, first, last, costed, rates, days: dayTotals(costed, first, last, meter.agreements, rates, o), latest: intervals.length ? intervals[intervals.length - 1].start : null };
}

export function productName(tariff: string, key?: string): Promise<Product | null> {
  const code = /^[EG]-[12]R-(.+)-[A-P]$/.exec(tariff)?.[1];
  if (!code) return Promise.resolve(null);
  return cached(`product:${code}`, 30 * 24 * HOUR, () => fetchProduct(code, key));
}

/** The unit prices for a tariff over the next while (for the Prices screen: today, and tomorrow once published). */
export async function upcomingRates(tariff: string, from: number, to: number, key: string): Promise<TariffRates> {
  const list: RateList[] = isTwoRate(tariff) ? ['day-unit-rates', 'night-unit-rates', 'standing-charges'] : ['standard-unit-rates', 'standing-charges'];
  const got = await Promise.all(list.map((l) => cached(`up:${tariff}:${l}:${Math.floor(from / HOUR)}`, HOUR / 2, () => fetchRates(tariff, l, from, to, key))));
  const by = Object.fromEntries(list.map((l, i) => [l, got[i]])) as Record<RateList, Rate[]>;
  return { unit: by['standard-unit-rates'] ?? [], standing: by['standing-charges'] ?? [], day: by['day-unit-rates'], night: by['night-unit-rates'] };
}
