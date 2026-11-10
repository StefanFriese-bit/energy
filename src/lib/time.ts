// Every date and time in this app is UK time (Europe/London), wherever the phone happens to be:
// the house, its meter and its thermostat are in the UK.

export const TZ = 'Europe/London';
export const DAY_MS = 86_400_000;
export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_SHORT: Record<Day, string> = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
export const DAY_LONG: Record<Day, string> = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday' };

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long',
});

export interface London { y: number; m: number; d: number; hh: number; mm: number; day: Day }
export function london(t: number | Date): London {
  const o: Record<string, string> = {};
  for (const p of parts.formatToParts(typeof t === 'number' ? new Date(t) : t)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour % 24, mm: +o.minute, day: o.weekday.toLowerCase() as Day };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-10" for the UK date of this moment. */
export function dayKey(t: number | Date): string {
  const l = london(t);
  return `${l.y}-${pad(l.m)}-${pad(l.d)}`;
}
export function monthKey(t: number | Date): string { return dayKey(t).slice(0, 7); }

/** Minutes the UK is ahead of UTC at this moment (0 in winter, 60 in summer). */
export function londonOffsetMin(t: number): number {
  const l = london(t);
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm);
  return Math.round((asUtc - (t - (t % 60_000))) / 60_000);
}

/** The moment UK midnight starts this date. (The clocks change at 01:00 UTC, so midnight always exists.) */
export function londonMidnight(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - londonOffsetMin(guess) * 60_000;
}

/** The date `n` days after this one (calendar days, so a clock change does not shift it). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}
export function weekdayOf(key: string): Day {
  const [y, m, d] = key.split('-').map(Number);
  return DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}
/** Monday of the week this date is in. */
export function mondayOf(key: string): string { return addDays(key, -DAYS.indexOf(weekdayOf(key))); }
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Minutes since UK midnight. */
export function minuteOfDay(t: number): number { const l = london(t); return l.hh * 60 + l.mm; }
export function hhmm(minutes: number): string { return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`; }
export function parseHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return +m[1] < 24 && +m[2] < 60 ? v : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 10 Nov" */
export function niceDay(key: string, withYear = false): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${DAY_SHORT[weekdayOf(key)]} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}
/** "November 2026" */
export function niceMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)))} ${y}`;
}
export const monthShort = (month: string) => MONTHS[+month.slice(5, 7) - 1];
/** "14:30" UK time for a moment. */
export function clock(t: number): string { return hhmm(minuteOfDay(t)); }
