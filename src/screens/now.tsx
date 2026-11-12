import { useEffect, useState } from 'preact/hooks';
import { kwhText, pence, pounds, summarise } from '../lib/cost';
import { getAccount, importMeter, loadUsage } from '../lib/data';
import { boost, boostWater, HiveError, isSignedIn, setMode, setTarget, stopBoost, type Heating, type HotWater } from '../lib/hive';
import { applyHeating, applyWater, reloadHeating, useHeating } from '../lib/heating-state';
import { nextChange, STEP, tempText } from '../lib/schedule';
import { hasOctopus, type Settings } from '../lib/store';
import { addDays, addMonths, DAY_LONG, dayKey, daysInMonth, hhmm, minuteOfDay, niceDay, weekdayOf } from '../lib/time';
import { Problem, Segment, Spinner, Stepper, useStore } from '../ui';
import { tariffNow, type TariffNow } from './prices';
import { waterIsOn } from '../lib/water';
import { DayBar } from './schedule';
import { modeWord, nextText } from './water';

export function NowScreen() {
  const s = useStore().settings;
  return (
    <>
      <h1>Home energy</h1>
      {isSignedIn() ? <HeatingCard /> : <div class="empty"><p>Sign in to Hive (Settings) to control the heating from here.</p><a class="btn" href="#/settings">Settings</a></div>}
      {isSignedIn() && <WaterCard />}
      {hasOctopus(s) ? <EnergyCard s={s} /> : <div class="empty"><p>Add your Octopus details (Settings) to see use, prices and cost.</p><a class="btn" href="#/settings">Settings</a></div>}
    </>
  );
}

function HeatingCard() {
  const hs = useHeating();
  const h = hs.list[0] ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState<number | null>(null);
  const [boostTemp, setBoostTemp] = useState<number | null>(null);
  const [boostMins, setBoostMins] = useState(60);
  if (!h) return <section class="card">{hs.error ? <Problem retry={reloadHeating}>{hs.error}</Problem> : <Spinner text="Asking Hive…" />}</section>;

  const act = async (label: string, f: () => Promise<Heating>) => {
    setBusy(label); setErr(null);
    try { applyHeating(await f()); setManual(null); } catch (e) { setErr(e instanceof HiveError ? e.message : String(e)); } finally { setBusy(null); }
  };
  const today = weekdayOf(dayKey(Date.now()));
  const minute = minuteOfDay(Date.now());
  const next = h.schedule && (h.mode === 'SCHEDULE' || h.mode === 'BOOST') ? nextChange(h.schedule, today, minute) : null;
  const manualT = manual ?? h.target ?? 20;
  const bT = boostTemp ?? Math.max(21, (h.target ?? 20) + 1);
  const shownMode = h.mode === 'BOOST' ? 'BOOST' : h.mode;

  return (
    <section class="card heating">
      <div class="card-top"><b>{h.name}</b>{hs.loading ? <span class="small">Updating…</span> : <button type="button" class="btn ghost small" onClick={reloadHeating}>Refresh</button>}</div>
      <div class="temps">
        <div><span class="meta">Room now</span><strong class="huge">{h.current != null ? tempText(Math.round(h.current * 10) / 10) : '–'}</strong></div>
        <div><span class="meta">Set to</span><strong class="huge muted">{h.mode === 'OFF' ? 'Off' : h.target != null ? tempText(h.target) : '–'}</strong></div>
      </div>
      <p class={`status ${h.working ? 'on' : ''}`}>
        {h.working == null ? '' : h.working ? '🔥 Boiler heating now' : 'Boiler not heating'}
        {h.online === false ? ' · ⚠ Thermostat offline' : ''}
      </p>
      {h.mode === 'BOOST' && (
        <div class="note-box row-between"><span>Boost{h.boostMinutes != null ? `: ${h.boostMinutes} min left` : ''}</span>
          <button type="button" class="btn small" disabled={!!busy} onClick={() => act('stop', () => stopBoost(h))}>{busy === 'stop' ? 'Stopping…' : 'Stop boost'}</button></div>
      )}
      {next && <p class="small">Next: <b>{tempText(next.target)}</b> at {hhmm(next.start)}{next.inDays === 1 ? ' tomorrow' : next.inDays > 1 ? ` on ${DAY_LONG[next.day]}` : ''}.</p>}
      {h.schedule && <><DayBar week={h.schedule} day={today} now={minute} /><p class="small"><a href="#/schedule">Change the heating week ›</a></p></>}

      <h3>Mode</h3>
      <Segment label="Mode" value={shownMode === 'BOOST' ? (h.previousMode ?? 'SCHEDULE') : shownMode}
        options={[['SCHEDULE', 'Schedule'], ['MANUAL', 'Manual'], ['OFF', 'Off']] as const}
        onChange={(m) => { if (!busy) void act(m, () => setMode(h, m as 'SCHEDULE' | 'MANUAL' | 'OFF', m === 'MANUAL' ? manualT : undefined)); }} />
      {h.mode === 'MANUAL' && (
        <div class="control-row">
          <Stepper label="temperature" value={manualT} min={h.minTemp} max={h.maxTemp} step={STEP} format={tempText} onChange={setManual} />
          <button type="button" class="btn primary" disabled={!!busy || manualT === h.target} onClick={() => act('set', () => setTarget(h, manualT))}>{busy === 'set' ? 'Setting…' : 'Set'}</button>
        </div>
      )}
      {h.mode !== 'BOOST' && h.mode !== 'OFF' && (
        <>
          <h3>Boost</h3>
          <div class="chips">{[30, 60, 120].map((m) => <button type="button" class={`chip${boostMins === m ? ' on' : ''}`} onClick={() => setBoostMins(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}</div>
          <div class="control-row">
            <Stepper label="boost temperature" value={bT} min={h.minTemp} max={h.maxTemp} step={STEP} format={tempText} onChange={setBoostTemp} />
            <button type="button" class="btn primary" disabled={!!busy} onClick={() => act('boost', () => boost(h, boostMins, bT))}>{busy === 'boost' ? 'Boosting…' : 'Boost'}</button>
          </div>
        </>
      )}
      {busy && !['stop', 'set', 'boost'].includes(busy) && <Spinner text="Telling Hive…" />}
      {err && <Problem>{err}</Problem>}
    </section>
  );
}

/** Hot water at a glance; shown only when Hive lists hot water for the house. Everything else is on the Water screen. */
function WaterCard() {
  const w: HotWater | null = useHeating().water[0] ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!w) return null;
  const today = weekdayOf(dayKey(Date.now()));
  const minute = minuteOfDay(Date.now());
  const on = waterIsOn(w, today, minute);
  const hour = async () => {
    setBusy(true); setErr(null);
    try { applyWater(await boostWater(w, 60)); } catch (e) { setErr(e instanceof HiveError ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <section class="card water-card">
      <div class="card-top"><b>Hot water</b><a class="small" href="#/water">More ›</a></div>
      <p>
        <b>{on == null ? '–' : on ? 'On now' : 'Off now'}</b> · {w.mode === 'BOOST' ? `boosting${w.boostMinutes != null ? `, ${w.boostMinutes} min left` : ''}` : modeWord(w.mode).toLowerCase()}
        {nextText(w, today, minute) ? <span class="small"> · {nextText(w, today, minute)}</span> : null}
      </p>
      {w.mode !== 'BOOST' && w.canBoost && <button type="button" class="btn small" disabled={busy} onClick={hour}>{busy ? 'Telling Hive…' : 'Heat water for an hour'}</button>}
      {err && <Problem>{err}</Problem>}
    </section>
  );
}

interface Snap { yesterday: { e: number; g: number; ek: number; gk: number }; month: { p: number; days: number; total: number; prevP: number }; price: TariffNow | null; hasGas: boolean; hasElec: boolean; latestDay: string | null }

async function snapshot(s: Settings): Promise<Snap> {
  const y = addDays(dayKey(Date.now()), -1);
  const month = y.slice(0, 7);
  const prevMonth = addMonths(month, -1);
  const doneDays = +y.slice(8);
  const prevLast = `${prevMonth}-${String(Math.min(doneDays, daysInMonth(prevMonth))).padStart(2, '0')}`;
  const acc = await getAccount(s);
  const kinds = (['electricity', 'gas'] as const).filter((k) => importMeter(acc, k));
  const cur = await Promise.all(kinds.map((k) => loadUsage(s, k, `${month}-01`, y)));
  const prev = await Promise.all(kinds.map((k) => loadUsage(s, k, `${prevMonth}-01`, prevLast)));
  const elecMeter = importMeter(acc, 'electricity');
  const price = elecMeter ? await tariffNow(s, elecMeter).catch(() => null) : null;
  const yd = (k: string) => cur[kinds.indexOf(k as never)]?.days.find((d) => d.day === y);
  const days = Math.max(0, ...cur.map((u) => u?.days.filter((d) => d.readings > 0).length ?? 0));
  const latest = Math.max(0, ...cur.map((u) => u?.latest ?? 0));
  return {
    yesterday: { e: yd('electricity')?.totalP ?? 0, g: yd('gas')?.totalP ?? 0, ek: yd('electricity')?.kwh ?? 0, gk: yd('gas')?.kwh ?? 0 },
    month: { p: cur.reduce((a, u) => a + (u ? summarise(u.days).totalP : 0), 0), days, total: daysInMonth(month), prevP: prev.reduce((a, u) => a + (u ? summarise(u.days.slice(0, days)).totalP : 0), 0) },
    price, hasGas: kinds.includes('gas'), hasElec: kinds.includes('electricity'), latestDay: latest ? dayKey(latest) : null,
  };
}

function EnergyCard({ s }: { s: Settings }) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    snapshot(s).then((x) => live && setSnap(x)).catch((e) => live && setErr(e?.message ?? String(e)));
    return () => { live = false; };
  }, [s.octopusAccount, s.octopusKey, s.pay, s.gasUnit, s.calorific, tick]);
  if (err) return <section class="card"><Problem retry={() => setTick(tick + 1)}>{err}</Problem></section>;
  if (!snap) return <section class="card"><Spinner text="Asking Octopus…" /></section>;
  const y = snap.yesterday;
  const m = snap.month;
  const diff = m.p - m.prevP;
  const noYesterday = y.ek + y.gk === 0;
  return (
    <section class="card">
      <div class="card-top"><b>Energy</b><a class="small" href="#/usage">More ›</a></div>
      <h3>Yesterday</h3>
      {noYesterday ? <p class="small">Octopus has no readings for yesterday yet{snap.latestDay ? ` (newest: ${niceDay(snap.latestDay)})` : ''}. They usually arrive by the morning.</p> : (
        <div class="price-grid">
          {snap.hasElec && <div><span class="meta">Electricity</span><strong>{pounds(y.e)}</strong><span class="meta">{kwhText(y.ek)}</span></div>}
          {snap.hasGas && <div><span class="meta">Gas</span><strong>{pounds(y.g)}</strong><span class="meta">{kwhText(y.gk)}</span></div>}
          <div><span class="meta">Together</span><strong>{pounds(y.e + y.g)}</strong></div>
        </div>
      )}
      {m.days > 0 && (
        <>
          <h3>This month so far</h3>
          <p><b>{pounds(m.p)}</b> in {m.days} day{m.days === 1 ? '' : 's'} · heading for about <b>{pounds((m.p / m.days) * m.total, 0)}</b> for the month.</p>
          {m.prevP > 0 && (Math.abs(diff) < Math.max(50, m.prevP * 0.005) ? <p class="compare">About the same as the same days last month.</p> : <p class={`compare ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '▲' : '▼'} {pounds(Math.abs(diff))} {diff > 0 ? 'more' : 'less'} than the same days last month.</p>)}
        </>
      )}
      {snap.price && snap.price.unitNow != null && (
        <p class="small">Electricity now: <b>{pence(snap.price.unitNow)}</b>/kWh ({snap.price.name}). <a href="#/prices">Prices ›</a></p>
      )}
    </section>
  );
}
