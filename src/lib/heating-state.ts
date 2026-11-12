// One shared copy of the thermostat and the hot water for every screen, plus the weeks being edited (kept until sent or undone).

import { useEffect, useState } from 'preact/hooks';
import { getHome, isSignedIn, type Heating, type HotWater } from './hive';
import { cloneWeek, type Week } from './schedule';

export interface HeatingState {
  list: Heating[]; loading: boolean; error: string | null; at: number | null;
  /** The week being edited on the Schedule screen; null = nothing changed. */
  draft: Week | null;
  /** Hot water as Hive lists it (empty = this Hive has no hot water control, e.g. a combi boiler). */
  water: HotWater[];
  /** The hot water week being edited; null = nothing changed. */
  waterDraft: Week | null;
}
let s: HeatingState = { list: [], loading: false, error: null, at: null, draft: null, water: [], waterDraft: null };
const listeners = new Set<() => void>();
function put(p: Partial<HeatingState>) { s = { ...s, ...p }; for (const l of listeners) l(); }

const DRAFT_KEY = 'energy-schedule-draft-v1';
const WATER_DRAFT_KEY = 'energy-water-draft-v1';
try { const d = localStorage.getItem(DRAFT_KEY); if (d) s.draft = JSON.parse(d); } catch { /* none */ }
try { const d = localStorage.getItem(WATER_DRAFT_KEY); if (d) s.waterDraft = JSON.parse(d); } catch { /* none */ }

export const heating = () => s.list[0] ?? null;

let inflight: Promise<void> | null = null;
export function reloadHeating(): Promise<void> {
  if (!isSignedIn()) { put({ list: [], water: [], error: null, loading: false }); return Promise.resolve(); }
  if (inflight) return inflight;
  put({ loading: true, error: null });
  inflight = getHome()
    .then(({ heating: list, water }) => put({ list, water, loading: false, at: Date.now(), error: list.length ? null : 'Hive did not list a heating thermostat on this account.' }))
    .catch((e) => put({ loading: false, error: e?.message ?? String(e) }))
    .finally(() => { inflight = null; });
  return inflight;
}
export function applyHeating(h: Heating) { put({ list: s.list.map((x) => (x.id === h.id ? h : x)), at: Date.now(), error: null }); }

export function applyWater(w: HotWater) { put({ water: s.water.map((x) => (x.id === w.id ? w : x)), at: Date.now() }); }

export function setWaterDraft(w: Week | null) {
  put({ waterDraft: w ? cloneWeek(w) : null });
  try { if (w) localStorage.setItem(WATER_DRAFT_KEY, JSON.stringify(w)); else localStorage.removeItem(WATER_DRAFT_KEY); } catch { /* ignore */ }
}

export function setDraft(w: Week | null) {
  put({ draft: w ? cloneWeek(w) : null });
  try { if (w) localStorage.setItem(DRAFT_KEY, JSON.stringify(w)); else localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

export function useHeating(): HeatingState {
  const [v, set] = useState(s);
  useEffect(() => {
    const l = () => set(s);
    listeners.add(l);
    l(); // an update between this screen's first paint and this line would otherwise be missed
    if (!s.at && !s.loading) void reloadHeating();
    return () => { listeners.delete(l); };
  }, []);
  return v;
}

/** Refresh when the app comes back to the front (the thermostat may have changed in the meantime). */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && s.at && Date.now() - s.at > 60_000) void reloadHeating();
});
