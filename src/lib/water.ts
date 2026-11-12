// Hot water. Hive only switches the hot water ON or OFF at set times (plus a boost for a while). It does not know or
// set how hot the water gets: that is the dial on the hot water tank's own thermostat, or on the boiler.
// Hive keeps the week as { monday: [{ start: <minutes after midnight>, value: { status: 'ON' | 'OFF' } }, …], … }.
// Here a water week reuses the heating week's shape, so the same tested sums work: `target` 1 = on, 0 = off.

import { dayBlocks, nextChange, sortSlots, targetAt, type Slot, type Week } from './schedule';
import { DAYS, hhmm, type Day } from './time';

export const ON = 1;
export const OFF = 0;
/** What Hive's own hot water lists carry when it does not say (its `maxEvents`). */
export const WATER_MAX_SLOTS = 6;

/** Hive's hot water schedule → ours. Null if it is not a week we understand (then nothing is ever sent back). */
export function waterFromHive(s: any): Week | null {
  if (!s || typeof s !== 'object') return null;
  const w = {} as Week;
  for (const d of DAYS) {
    const list = s[d];
    if (!Array.isArray(list) || !list.length) return null;
    const slots: Slot[] = [];
    for (const e of list) {
      const start = typeof e?.start === 'number' ? e.start : NaN;
      const status = e?.value?.status;
      if (!Number.isFinite(start) || (status !== 'ON' && status !== 'OFF')) return null;
      slots.push({ start, target: status === 'ON' ? ON : OFF });
    }
    w[d] = sortSlots(slots);
  }
  return w;
}

export function waterToHive(w: Week): Record<Day, { start: number; value: { status: 'ON' | 'OFF' } }[]> {
  const out = {} as Record<Day, { start: number; value: { status: 'ON' | 'OFF' } }[]>;
  for (const d of DAYS) out[d] = sortSlots(w[d]).map((s) => ({ start: s.start, value: { status: s.target === ON ? 'ON' : 'OFF' } }));
  return out;
}

/** What is wrong with a day, in plain words; empty when Hive can take it. */
export function waterDayProblems(slots: Slot[], max = WATER_MAX_SLOTS): string[] {
  const p: string[] = [];
  if (!slots.length) p.push('A day needs at least one line.');
  if (slots.length > max) p.push(`At most ${max} lines a day.`);
  const starts = slots.map((s) => s.start);
  if (new Set(starts).size !== starts.length) p.push('Two lines are at the same time.');
  if (slots.some((s) => !Number.isInteger(s.start) || s.start < 0 || s.start >= 1440)) p.push('A time is not a time of day.');
  if (slots.some((s) => s.target !== ON && s.target !== OFF)) p.push('A line is neither on nor off.');
  return p;
}
export const waterWeekOk = (w: Week, max = WATER_MAX_SLOTS) => DAYS.every((d) => waterDayProblems(w[d], max).length === 0);

/** Is the schedule asking for hot water at this minute of this day? */
export const waterOnAt = (w: Week, day: Day, minute: number) => targetAt(w, day, minute) === ON;

/** The stretches of a day the water is on: [from, to) minutes, neighbours joined (06:00 on, 06:30 on again = one stretch). */
export function onStretches(w: Week, day: Day): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const b of dayBlocks(w, day)) {
    if (b.target !== ON) continue;
    const last = out[out.length - 1];
    if (last && last.to === b.from) last.to = b.to; else out.push({ from: b.from, to: b.to });
  }
  return out;
}
export const hoursOn = (w: Week, day: Day) => onStretches(w, day).reduce((h, s) => h + (s.to - s.from) / 60, 0);

/** "06:30–07:15, 17:00–18:00", or "Off all day" / "On all day". */
export function stretchesText(w: Week, day: Day): string {
  const s = onStretches(w, day);
  if (!s.length) return 'Off all day';
  if (s.length === 1 && s[0].from === 0 && s[0].to === 1440) return 'On all day';
  return s.map((x) => `${hhmm(x.from)}–${x.to === 1440 ? '24:00' : hhmm(x.to)}`).join(', ');
}

/** The next time the schedule switches the water the other way. */
export function nextWaterChange(w: Week, day: Day, minute: number): { day: Day; start: number; on: boolean; inDays: number } | null {
  const n = nextChange(w, day, minute);
  return n ? { day: n.day, start: n.start, on: n.target === ON, inDays: n.inDays } : null;
}

/** Add a line an hour after the last one (or at 07:00), switching the other way from the last. */
export function addWaterSlot(slots: Slot[], max = WATER_MAX_SLOTS): Slot[] {
  const s = sortSlots(slots);
  if (s.length >= max) return s;
  const taken = new Set(s.map((x) => x.start));
  const last = s[s.length - 1];
  let start = last ? Math.min(1425, last.start + 60) : 7 * 60;
  while (taken.has(start) && start > 0) start -= 15;
  return sortSlots([...s, { start, target: last && last.target === ON ? OFF : ON }]);
}

/** Is the hot water being called for right now? Boost and "always on" = yes, Off = no, Schedule = what the week says for this minute. */
export function waterIsOn(w: { mode: string; status: boolean | null; schedule: Week | null }, day: Day, minute: number): boolean | null {
  if (w.mode === 'BOOST' || w.mode === 'MANUAL') return true;
  if (w.mode === 'OFF') return false;
  return w.schedule ? waterOnAt(w.schedule, day, minute) : w.status;
}
