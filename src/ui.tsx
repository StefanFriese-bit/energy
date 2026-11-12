import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getState, subscribe, type State } from './lib/store';
import { DAYS, type Day } from './lib/time';

export function useStore(): State {
  const [s, set] = useState(getState());
  useEffect(() => { const off = subscribe(() => set(getState())); set(getState()); return off; }, []);
  return s;
}

// ---- routing (hash) -------------------------------------------------------------------------------------------------
export type Route = { name: 'now' | 'schedule' | 'water' | 'usage' | 'prices' | 'settings' } | { name: 'day' | 'waterday'; day: Day };
export function parseRoute(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'day' && (DAYS as readonly string[]).includes(b)) return { name: 'day', day: b as Day };
  if (a === 'water' && (DAYS as readonly string[]).includes(b)) return { name: 'waterday', day: b as Day };
  if (a === 'schedule' || a === 'water' || a === 'usage' || a === 'prices' || a === 'settings') return { name: a };
  return { name: 'now' };
}
let current = parseRoute(location.hash);
const routeListeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parseRoute(location.hash);
  for (const l of routeListeners) l();
});
export function useRoute(): Route {
  const [r, set] = useState(current);
  useEffect(() => {
    const l = () => set(current);
    routeListeners.add(l);
    // A tap in the moment between the first paint and this line would otherwise be missed (found by the tests).
    l();
    return () => { routeListeners.delete(l); };
  }, []);
  return r;
}
export const go = (hash: string) => { location.hash = hash; };

// ---- small parts ----------------------------------------------------------------------------------------------------
export function Segment<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segment" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button type="button" role="radio" aria-checked={value === v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min, max, step, format, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; format: (v: number) => string; label: string }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v / step) * step));
  return (
    <div class="stepper" role="group" aria-label={label}>
      <button type="button" class="btn round" aria-label={`Lower ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
      <strong aria-live="polite">{format(value)}</strong>
      <button type="button" class="btn round" aria-label={`Raise ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
    </div>
  );
}

export function Problem({ children, retry }: { children: ComponentChildren; retry?: () => void }) {
  return (
    <div class="problem" role="alert">
      <div>{children}</div>
      {retry && <button type="button" class="btn small" onClick={retry}>Try again</button>}
    </div>
  );
}

export const Spinner = ({ text = 'Loading…' }: { text?: string }) => <p class="loading" aria-live="polite"><span class="dot" /> {text}</p>;

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="sheet" role="dialog" aria-label={title}>
        <div class="sheet-head"><h2>{title}</h2><button type="button" class="btn ghost" onClick={onClose}>Close</button></div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
