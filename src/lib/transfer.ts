// Moving this app's settings to another phone or computer without any server: one device copies a code,
// the other pastes it. Between a Mac and an iPhone on the same Apple ID, iOS's Universal Clipboard carries it.
// The code holds the Octopus account + key, how the bill is worked out, and the saved heating weeks.
// It never holds the Hive sign-in: Hive wants each device to sign in itself (one text-message code).

import type { SavedWeek, Settings } from './store';
import { DAYS } from './time';

const PREFIX = 'HOMEENERGY-1:';

export interface Transfer { settings: Partial<Settings>; weeks: SavedWeek[] }

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function makeCode(settings: Settings, weeks: SavedWeek[]): string {
  return PREFIX + toBase64(JSON.stringify({ settings, weeks }));
}

const KEYS: Record<keyof Settings, 'string' | 'number'> = {
  octopusAccount: 'string', octopusKey: 'string', pay: 'string', gasUnit: 'string', calorific: 'number', nightStart: 'string', nightEnd: 'string',
};

function goodWeek(w: any): boolean {
  return !!w && DAYS.every((d) => Array.isArray(w[d]) && w[d].length > 0 && w[d].every((s: any) => Number.isFinite(s?.start) && Number.isFinite(s?.target)));
}

/** The settings inside a pasted code, or a plain-words reason it is not one. Only known, well-formed values are taken. */
export function readCode(raw: string): Transfer | { error: string } {
  const text = raw.replace(/\s+/g, '');
  const at = text.indexOf(PREFIX);
  if (at < 0) return { error: 'That is not a settings code from this app. Copy it again on the other device.' };
  let j: any;
  try { j = JSON.parse(fromBase64(text.slice(at + PREFIX.length))); } catch { return { error: 'The code is cut short or changed. Copy it again on the other device.' }; }
  const settings: Partial<Settings> = {};
  for (const [k, type] of Object.entries(KEYS) as [keyof Settings, 'string' | 'number'][]) {
    if (typeof j?.settings?.[k] === type) (settings as any)[k] = j.settings[k];
  }
  if (settings.pay && settings.pay !== 'DIRECT_DEBIT' && settings.pay !== 'NON_DIRECT_DEBIT') delete settings.pay;
  if (settings.gasUnit && settings.gasUnit !== 'm3' && settings.gasUnit !== 'kwh') delete settings.gasUnit;
  if (settings.calorific != null && !(settings.calorific >= 35 && settings.calorific <= 43)) delete settings.calorific;
  const weeks: SavedWeek[] = (Array.isArray(j?.weeks) ? j.weeks : [])
    .filter((w: any) => typeof w?.name === 'string' && goodWeek(w.week))
    .map((w: any) => ({ id: typeof w.id === 'string' ? w.id : `w${Math.random().toString(36).slice(2)}`, name: w.name, week: w.week, saved: Number(w.saved) || Date.now() }));
  if (!Object.keys(settings).length && !weeks.length) return { error: 'The code has no settings in it.' };
  return { settings, weeks };
}

/** Saved weeks after taking in another device's: same name = the incoming one replaces it, others are kept. */
export function mergeWeeks(mine: SavedWeek[], incoming: SavedWeek[]): SavedWeek[] {
  const names = new Set(incoming.map((w) => w.name.toLowerCase()));
  return [...mine.filter((w) => !names.has(w.name.toLowerCase())), ...incoming];
}
