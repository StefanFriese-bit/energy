// What this phone remembers: the Octopus key and account, how the bill is worked out, and saved heating weeks.
// Kept on the phone only (localStorage). Nothing is sent anywhere except to Octopus and Hive themselves.

import type { PayMethod } from './cost';
import type { Week } from './schedule';

export interface Settings {
  octopusAccount: string;
  octopusKey: string;
  pay: PayMethod;
  /** Smart gas meters (SMETS2) send cubic metres; the older SMETS1 ones send kWh. */
  gasUnit: 'm3' | 'kwh';
  /** Calorific value on the gas bill (MJ/m³), normally 38–40. */
  calorific: number;
  /** Economy 7 only: the cheap night hours, UK winter time (GMT). */
  nightStart: string;
  nightEnd: string;
}
export interface SavedWeek { id: string; name: string; week: Week; saved: number }
export interface State { settings: Settings; weeks: SavedWeek[] }

export const DEFAULT_SETTINGS: Settings = {
  octopusAccount: '', octopusKey: '', pay: 'DIRECT_DEBIT', gasUnit: 'm3', calorific: 39.5, nightStart: '00:30', nightEnd: '07:30',
};

const KEY = 'energy-state-v1';
function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      return { settings: { ...DEFAULT_SETTINGS, ...(j.settings ?? {}) }, weeks: Array.isArray(j.weeks) ? j.weeks : [] };
    }
  } catch { /* a broken copy: start clean rather than not at all */ }
  return { settings: { ...DEFAULT_SETTINGS }, weeks: [] };
}

let state = load();
const listeners = new Set<() => void>();
export const getState = () => state;
export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function set(next: State) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full or blocked: keep working from memory */ }
  for (const l of listeners) l();
}

export function updateSettings(patch: Partial<Settings>) { set({ ...state, settings: { ...state.settings, ...patch } }); }
export const hasOctopus = (s: Settings = state.settings) => !!(s.octopusAccount.trim() && s.octopusKey.trim());

export function saveWeek(name: string, week: Week) {
  const clean = name.trim() || 'My week';
  const existing = state.weeks.find((w) => w.name.toLowerCase() === clean.toLowerCase());
  const entry: SavedWeek = { id: existing?.id ?? `w${Date.now().toString(36)}`, name: clean, week: structuredClone(week), saved: Date.now() };
  set({ ...state, weeks: existing ? state.weeks.map((w) => (w.id === existing.id ? entry : w)) : [...state.weeks, entry] });
}
export function deleteWeek(id: string) { set({ ...state, weeks: state.weeks.filter((w) => w.id !== id) }); }
