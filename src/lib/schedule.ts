// The heating week: for each day, the times the thermostat changes temperature and what it changes to.
// Hive keeps it as { monday: [{ start: <minutes after midnight>, value: { target: <°C> } }, …], … }.

import { DAYS, type Day } from './time';

export interface Slot { start: number; target: number }
export type Week = Record<Day, Slot[]>;

export const MAX_SLOTS = 6;
export const MIN_TEMP = 5;
export const MAX_TEMP = 32;
export const STEP = 0.5;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** Hive's schedule → ours. Null if it is not a heating week we understand (then nothing is ever sent back). */
export function fromHive(s: any): Week | null {
  if (!s || typeof s !== 'object') return null;
  const w = {} as Week;
  for (const d of DAYS) {
    const list = s[d];
    if (!Array.isArray(list) || !list.length) return null;
    const slots: Slot[] = [];
    for (const e of list) {
      const start = num(e?.start);
      const target = num(e?.value?.target ?? e?.value?.heat);
      if (!Number.isFinite(start) || !Number.isFinite(target)) return null;
      slots.push({ start, target });
    }
    w[d] = sortSlots(slots);
  }
  return w;
}

export function toHive(w: Week): Record<Day, { start: number; value: { target: number } }[]> {
  const out = {} as Record<Day, { start: number; value: { target: number } }[]>;
  for (const d of DAYS) out[d] = sortSlots(w[d]).map((s) => ({ start: s.start, value: { target: s.target } }));
  return out;
}

export const sortSlots = (slots: Slot[]) => [...slots].sort((a, b) => a.start - b.start);
export const cloneWeek = (w: Week): Week => Object.fromEntries(DAYS.map((d) => [d, w[d].map((s) => ({ ...s }))])) as Week;
export const sameDay = (a: Slot[], b: Slot[]) => {
  const x = sortSlots(a), y = sortSlots(b);
  return x.length === y.length && x.every((s, i) => s.start === y[i].start && s.target === y[i].target);
};
export const changedDays = (a: Week, b: Week): Day[] => DAYS.filter((d) => !sameDay(a[d], b[d]));

/** The lowest temperature the editor offers: 5 °C, or lower if the schedule Hive sent already uses a lower one (its "off"). */
export function lowestAllowed(original: Week | null): number {
  let low = MIN_TEMP;
  if (original) for (const d of DAYS) for (const s of original[d]) low = Math.min(low, s.target);
  return low;
}

/** What is wrong with a day, in plain words; empty when Hive can take it. */
export function dayProblems(slots: Slot[], low = MIN_TEMP): string[] {
  const p: string[] = [];
  if (!slots.length) p.push('A day needs at least one change.');
  if (slots.length > MAX_SLOTS) p.push(`At most ${MAX_SLOTS} changes a day.`);
  const starts = slots.map((s) => s.start);
  if (new Set(starts).size !== starts.length) p.push('Two changes are at the same time.');
  if (slots.some((s) => !Number.isInteger(s.start) || s.start < 0 || s.start >= 1440)) p.push('A time is not a time of day.');
  if (slots.some((s) => s.target < low || s.target > MAX_TEMP)) p.push(`Temperatures go from ${low} to ${MAX_TEMP} °C.`);
  return p;
}
export const weekOk = (w: Week, low = MIN_TEMP) => DAYS.every((d) => dayProblems(w[d], low).length === 0);

const prevDay = (d: Day) => DAYS[(DAYS.indexOf(d) + 6) % 7];

/** The temperature asked for at this minute of this day (before the day's first change, yesterday's last one still holds). */
export function targetAt(w: Week, day: Day, minute: number): number {
  const today = sortSlots(w[day]);
  let t: Slot | undefined;
  for (const s of today) if (s.start <= minute) t = s;
  if (t) return t.target;
  const y = sortSlots(w[prevDay(day)]);
  return y[y.length - 1]?.target ?? today[0]?.target ?? MIN_TEMP;
}

/** Blocks for drawing a day as a bar: [from, to) minutes with the temperature in force. */
export function dayBlocks(w: Week, day: Day): { from: number; to: number; target: number; carried: boolean }[] {
  const s = sortSlots(w[day]);
  const out: { from: number; to: number; target: number; carried: boolean }[] = [];
  if (!s.length) return out;
  if (s[0].start > 0) out.push({ from: 0, to: s[0].start, target: targetAt(w, day, 0), carried: true });
  s.forEach((x, i) => out.push({ from: x.start, to: s[i + 1]?.start ?? 1440, target: x.target, carried: false }));
  return out;
}

/** The next time the temperature changes after (day, minute): which day, when, and to what. */
export function nextChange(w: Week, day: Day, minute: number): { day: Day; start: number; target: number; inDays: number } | null {
  const i0 = DAYS.indexOf(day);
  const now = targetAt(w, day, minute);
  for (let k = 0; k < 8; k++) {
    const d = DAYS[(i0 + k) % 7];
    for (const s of sortSlots(w[d])) {
      if (k === 0 && s.start <= minute) continue;
      if (s.target !== now) return { day: d, start: s.start, target: s.target, inDays: k };
    }
  }
  return null;
}

export function copyDay(w: Week, from: Day, to: Day[]): Week {
  const n = cloneWeek(w);
  for (const d of to) if (d !== from) n[d] = w[from].map((s) => ({ ...s }));
  return n;
}

/** Add a change between the last one and midnight (or an hour after the last), at the temperature in force then. */
export function addSlot(slots: Slot[]): Slot[] {
  const s = sortSlots(slots);
  if (s.length >= MAX_SLOTS) return s;
  const taken = new Set(s.map((x) => x.start));
  const last = s[s.length - 1];
  let start = last ? Math.min(1425, last.start + 60) : 7 * 60;
  while (taken.has(start) && start > 0) start -= 15;
  return sortSlots([...s, { start, target: last?.target ?? 18 }]);
}

/** Hours a day spends at or above this temperature: a rough "how long is the heating asked for". */
export function hoursAtOrAbove(w: Week, day: Day, temp: number): number {
  return dayBlocks(w, day).reduce((h, b) => h + (b.target >= temp ? (b.to - b.from) / 60 : 0), 0);
}

/** A colour per temperature band, cool to warm: blues below 16°, amber 16–17.5°, then orange to red from 18°. */
export function tempColour(t: number): string {
  if (t < 12) return '#4f7fc4';
  if (t < 16) return '#6f9fd8';
  if (t < 18) return '#d9a13a';
  if (t < 20) return '#e07f35';
  if (t < 22) return '#d4582c';
  return '#b8352a';
}
export const tempText = (t: number) => `${Number.isInteger(t) ? t : t.toFixed(1)}°`;
