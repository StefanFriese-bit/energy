// Octopus Energy's official public API (api.octopus.energy). The account and meter readings need the
// account's own API key (Octopus account > Personal details > API access); the price lists are public.
// Everything is called straight from the phone: Octopus allows that, so no server sits in between.

import type { Agreement, Interval, Rate } from './cost';
import { splitTariff } from './cost';

export const OCTOPUS = 'https://api.octopus.energy/v1';
export type Kind = 'electricity' | 'gas';

export class OctopusError extends Error {
  constructor(public why: 'key' | 'account' | 'network' | 'server', message: string) { super(message); }
}

export interface OctopusCreds { account: string; key: string }

const auth = (key?: string): HeadersInit => (key ? { Authorization: `Basic ${btoa(`${key}:`)}` } : {});

async function getJson(url: string, key?: string): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { headers: auth(key) });
  } catch {
    throw new OctopusError('network', 'Could not reach Octopus. Check the phone has internet.');
  }
  if (r.status === 401 || r.status === 403) throw new OctopusError('key', 'Octopus did not accept the API key.');
  if (r.status === 404) throw new OctopusError('account', 'Octopus does not know that account number (or the key belongs to another account).');
  if (!r.ok) throw new OctopusError('server', `Octopus answered with an error (${r.status}). Try again in a minute.`);
  return r.json();
}

/** Follows Octopus's "next page" links to the end. */
async function getAll(url: string, key?: string): Promise<any[]> {
  const out: any[] = [];
  let next: string | null = url;
  for (let page = 0; next && page < 60; page++) {
    const j: any = await getJson(next, key);
    out.push(...(j.results ?? []));
    next = j.next ?? null;
  }
  return out;
}

const ms = (iso: string | null | undefined, open: number) => (iso ? Date.parse(iso) : open);

export interface Meter {
  kind: Kind;
  /** MPAN (electricity) or MPRN (gas). */
  point: string;
  serials: string[];
  agreements: Agreement[];
  isExport: boolean;
}
export interface Account { number: string; meters: Meter[]; movedIn: number | null }

export function parseAccount(j: any): Account {
  const props: any[] = j?.properties ?? [];
  // The house lived in now: the property with no move-out date (else the newest one).
  const p = props.find((x) => !x.moved_out_at) ?? props[props.length - 1];
  const meters: Meter[] = [];
  const agreements = (list: any[]): Agreement[] =>
    (list ?? []).map((a) => ({ tariff: a.tariff_code, from: ms(a.valid_from, 0), to: ms(a.valid_to, Infinity) })).sort((a, b) => a.from - b.from);
  for (const e of p?.electricity_meter_points ?? []) {
    meters.push({ kind: 'electricity', point: e.mpan, serials: (e.meters ?? []).map((m: any) => m.serial_number).filter(Boolean), agreements: agreements(e.agreements), isExport: !!e.is_export });
  }
  for (const g of p?.gas_meter_points ?? []) {
    meters.push({ kind: 'gas', point: g.mprn, serials: (g.meters ?? []).map((m: any) => m.serial_number).filter(Boolean), agreements: agreements(g.agreements), isExport: false });
  }
  return { number: j?.number ?? '', meters, movedIn: p?.moved_in_at ? Date.parse(p.moved_in_at) : null };
}

export async function fetchAccount(c: OctopusCreds): Promise<Account> {
  const number = c.account.trim().toUpperCase();
  if (!/^A-[0-9A-F]{8}$/.test(number)) throw new OctopusError('account', 'An Octopus account number looks like A-1234ABCD.');
  return parseAccount(await getJson(`${OCTOPUS}/accounts/${number}/`, c.key.trim()));
}

/** Half-hourly readings, oldest first. A meter that was swapped has several serial numbers: all are read, one value per half hour kept. */
export async function fetchConsumption(m: Meter, from: number, to: number, key: string): Promise<Interval[]> {
  const kindPath = m.kind === 'electricity' ? 'electricity-meter-points' : 'gas-meter-points';
  const byStart = new Map<number, number>();
  for (const serial of m.serials) {
    const url = `${OCTOPUS}/${kindPath}/${encodeURIComponent(m.point)}/meters/${encodeURIComponent(serial)}/consumption/?period_from=${new Date(from).toISOString()}&period_to=${new Date(to).toISOString()}&page_size=25000&order_by=period`;
    let rows: any[];
    try {
      rows = await getAll(url, key);
    } catch (e) {
      // An old serial number Octopus no longer reads answers "not found": that is no reading, not a failure.
      if (e instanceof OctopusError && e.why === 'account') continue;
      throw e;
    }
    for (const r of rows) {
      const t = Date.parse(r.interval_start);
      const v = Number(r.consumption);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      // Two meters both reporting a half hour (the old one often sends zeros after the swap): keep the real reading.
      if (!byStart.has(t) || (byStart.get(t) === 0 && v !== 0)) byStart.set(t, v);
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([start, kwh]) => ({ start, kwh }));
}

export const parseRates = (rows: any[]): Rate[] =>
  rows
    .map((r) => ({ from: ms(r.valid_from, 0), to: ms(r.valid_to, Infinity), p: Number(r.value_inc_vat), pm: r.payment_method ?? null }))
    .filter((r) => Number.isFinite(r.p));

export type RateList = 'standard-unit-rates' | 'day-unit-rates' | 'night-unit-rates' | 'standing-charges';

export async function fetchRates(tariff: string, list: RateList, from: number, to: number, key?: string): Promise<Rate[]> {
  const s = splitTariff(tariff);
  if (!s) return [];
  const kind = tariff.startsWith('G-') ? 'gas-tariffs' : 'electricity-tariffs';
  const url = `${OCTOPUS}/products/${encodeURIComponent(s.product)}/${kind}/${encodeURIComponent(tariff)}/${list}/?period_from=${new Date(from).toISOString()}&period_to=${new Date(to).toISOString()}&page_size=1500`;
  try {
    return parseRates(await getAll(url, key));
  } catch (e) {
    if (e instanceof OctopusError && e.why === 'account') return []; // a product Octopus no longer lists
    throw e;
  }
}

export interface Product { code: string; name: string; fullName: string; variable: boolean; tracker: boolean }
export async function fetchProduct(code: string, key?: string): Promise<Product | null> {
  try {
    const j = await getJson(`${OCTOPUS}/products/${encodeURIComponent(code)}/`, key);
    return { code, name: j.display_name ?? code, fullName: j.full_name ?? j.display_name ?? code, variable: !!j.is_variable, tracker: !!j.is_tracker };
  } catch (e) {
    if (e instanceof OctopusError && e.why === 'account') return null;
    throw e;
  }
}
