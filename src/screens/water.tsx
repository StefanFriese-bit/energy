import { useState } from 'preact/hooks';
import { boostWater, HiveError, isSignedIn, sendWaterSchedule, setWaterMode, stopWaterBoost, type HotWater } from '../lib/hive';
import { applyWater, reloadHeating, setWaterDraft, useHeating } from '../lib/heating-state';
import { changedDays, copyDay, sortSlots, type Slot, type Week } from '../lib/schedule';
import { DAY_LONG, DAY_SHORT, DAYS, dayKey, hhmm, minuteOfDay, parseHhmm, weekdayOf, type Day } from '../lib/time';
import { addWaterSlot, hoursOn, nextWaterChange, OFF, ON, onStretches, stretchesText, waterDayProblems, waterIsOn, waterWeekOk } from '../lib/water';
import { Problem, Segment, Sheet, Spinner, go } from '../ui';

export function WaterBar({ week, day, now }: { week: Week; day: Day; now?: number | null }) {
  return (
    <div class="daybar" aria-hidden="true">
      {onStretches(week, day).map((b) => (
        <span class="blk water" style={{ left: `${(b.from / 1440) * 100}%`, width: `${((b.to - b.from) / 1440) * 100}%` }}>{b.to - b.from >= 150 ? 'On' : ''}</span>
      ))}
      {now != null && <i class="now" style={{ left: `${(now / 1440) * 100}%` }} />}
    </div>
  );
}
const Ticks = () => <div class="ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>;

export const modeWord = (m: string) => (m === 'MANUAL' ? 'Always on' : m === 'OFF' ? 'Off' : m === 'BOOST' ? 'Boost' : 'Schedule');
export function nextText(w: HotWater, today: Day, minute: number): string | null {
  if (w.mode !== 'SCHEDULE' || !w.schedule) return null;
  const n = nextWaterChange(w.schedule, today, minute);
  if (!n) return null;
  return `Goes ${n.on ? 'on' : 'off'} at ${hhmm(n.start)}${n.inDays === 1 ? ' tomorrow' : n.inDays > 1 ? ` on ${DAY_LONG[n.day]}` : ''}.`;
}

function useWater() {
  const hs = useHeating();
  const w: HotWater | null = hs.water[0] ?? null;
  const original = w?.schedule ?? null;
  const week = hs.waterDraft ?? original;
  const changed = hs.waterDraft && original ? changedDays(original, hs.waterDraft) : [];
  return { hs, w, original, week, changed };
}

/** Why the temperature is not on this page: said once, plainly. */
const TempNote = () => (
  <p class="info-box">
    <b>How hot the water gets is not set here.</b> Hive only switches the hot water on and off. The temperature is the dial on the hot water tank's own thermostat (normally 60°), or on the boiler.
  </p>
);

function NotReady() {
  const { hs, w } = useWater();
  if (!isSignedIn()) return <div class="empty"><p>Sign in to Hive to see and change the hot water.</p><a class="btn primary" href="#/settings">Go to Settings</a></div>;
  if (hs.loading && !hs.at) return <Spinner text="Asking Hive…" />;
  if (hs.error && !hs.at) return <Problem retry={reloadHeating}>{hs.error}</Problem>;
  if (hs.at && !w) {
    return (
      <div class="empty left">
        <p><b>Hive does not list hot water for this house.</b></p>
        <p>That is normal with a combi boiler: it heats water as you run the tap, so there is nothing for Hive to switch. How hot it comes out is the hot water dial or setting on the boiler itself.</p>
        <p>If you do have a hot water tank and can switch it in Hive's own app, go to Settings ▸ "Copy what Hive sent" and paste it to Claude.</p>
        <button type="button" class="btn" onClick={reloadHeating}>Ask Hive again</button>
      </div>
    );
  }
  return <Spinner />;
}

export function WaterScreen() {
  const { hs, w, original, week, changed } = useWater();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!w) return <><h1>Hot water</h1><NotReady /></>;
  const today = weekdayOf(dayKey(Date.now()));
  const minute = minuteOfDay(Date.now());
  const ok = week ? waterWeekOk(week, w.maxSlots) : false;

  return (
    <>
      <div class="row-between"><h1>Hot water</h1>{hs.loading && <span class="small">Updating…</span>}</div>
      <ControlCard w={w} today={today} minute={minute} />
      <TempNote />

      <h2>Hot water week</h2>
      {!week || !original ? (
        <Problem>Hive sent a hot water schedule in a shape this app does not know, so it will not touch it. Settings ▸ "Copy what Hive sent" and send it to Claude.</Problem>
      ) : (
        <>
          {w.mode !== 'SCHEDULE' && w.mode !== 'BOOST' && (
            <p class="note-box">The hot water is on <b>{modeWord(w.mode)}</b>, so it is not following this week. Switch it to Schedule above.</p>
          )}
          <p class="small">Tap a day to change it. Nothing reaches Hive until you press <b>Send to Hive</b>.</p>
          <div class="week">
            <Ticks />
            {DAYS.map((d) => (
              <a class={`dayrow tall${d === today ? ' today' : ''}`} href={`#/water/${d}`}>
                <span class="dname">{DAY_SHORT[d]}{changed.includes(d) && <i class="changed" title="Changed, not sent yet" />}</span>
                <span class="barcol">
                  <WaterBar week={week} day={d} now={d === today ? minute : null} />
                  <span class="meta">{stretchesText(week, d)} · {hoursText(hoursOn(week, d))}</span>
                </span>
              </a>
            ))}
          </div>
          <p class="small">On for <b>{hoursText(DAYS.reduce((a, d) => a + hoursOn(week, d), 0))}</b> a week in all.</p>

          {changed.length > 0 && (
            <div class="sendbar">
              <span>{changed.length === 7 ? 'Whole week' : changed.map((d) => DAY_SHORT[d]).join(', ')} changed</span>
              <button type="button" class="btn" onClick={() => setWaterDraft(null)}>Undo</button>
              <button type="button" class="btn primary" disabled={!ok} onClick={() => { setDone(null); setConfirm(true); }}>Send to Hive</button>
            </div>
          )}
          {done && <p class="good-box" role="status">{done}</p>}
          {confirm && <SendSheet w={w} week={week} changed={changed} onClose={() => setConfirm(false)} onDone={(m) => { setConfirm(false); setDone(m); }} />}
        </>
      )}
    </>
  );
}

const hoursText = (h: number) => {
  const m = Math.round(h * 60);
  return m === 0 ? '0 h' : m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function ControlCard({ w, today, minute }: { w: HotWater; today: Day; minute: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mins, setMins] = useState(60);
  const act = async (label: string, f: () => Promise<HotWater>) => {
    setBusy(label); setErr(null);
    try { applyWater(await f()); } catch (e) { setErr(e instanceof HiveError ? e.message : String(e)); } finally { setBusy(null); }
  };
  const on = waterIsOn(w, today, minute);
  const next = nextText(w, today, minute);
  return (
    <section class="card heating">
      <div class="card-top"><b>{w.name}</b><button type="button" class="btn ghost small" onClick={reloadHeating}>Refresh</button></div>
      <div class="temps">
        <div><span class="meta">Hot water now</span><strong class={`huge${on ? ' hot' : ' muted'}`}>{on == null ? '–' : on ? 'On' : 'Off'}</strong></div>
        <div><span class="meta">Set to</span><strong class="huge word muted">{modeWord(w.mode)}</strong></div>
      </div>
      <p class="status">
        {w.mode === 'MANUAL' ? 'On all the time until you change it.' : w.mode === 'OFF' ? 'Off until you change it.' : next ?? ''}
        {w.online === false ? ' ⚠ Hive says the receiver is offline.' : ''}
      </p>
      {w.mode === 'BOOST' && (
        <div class="note-box row-between"><span>Boosting{w.boostMinutes != null ? `: ${w.boostMinutes} min left` : ''}</span>
          <button type="button" class="btn small" disabled={!!busy} onClick={() => act('stop', () => stopWaterBoost(w))}>{busy === 'stop' ? 'Stopping…' : 'Stop boost'}</button></div>
      )}
      {w.schedule && <WaterBar week={w.schedule} day={today} now={minute} />}

      <h3>Mode</h3>
      <Segment label="Hot water mode" value={w.mode === 'BOOST' ? (w.previousMode && w.previousMode !== 'BOOST' ? w.previousMode : 'SCHEDULE') : w.mode}
        options={[['SCHEDULE', 'Schedule'], ['MANUAL', 'Always on'], ['OFF', 'Off']] as const}
        onChange={(m) => { if (!busy && m !== w.mode) void act(m, () => setWaterMode(w, m as 'SCHEDULE' | 'MANUAL' | 'OFF')); }} />
      {w.mode !== 'BOOST' && w.canBoost && (
        <>
          <h3>Boost: heat the water now, then go back to {modeWord(w.mode)}</h3>
          <div class="control-row">
            <div class="chips">{[30, 60, 120].map((m) => <button type="button" class={`chip${mins === m ? ' on' : ''}`} aria-pressed={mins === m} onClick={() => setMins(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}</div>
            <button type="button" class="btn primary" disabled={!!busy} onClick={() => act('boost', () => boostWater(w, mins))}>{busy === 'boost' ? 'Boosting…' : 'Boost'}</button>
          </div>
        </>
      )}
      {busy && !['stop', 'boost'].includes(busy) && <Spinner text="Telling Hive…" />}
      {err && <Problem>{err}</Problem>}
    </section>
  );
}

function SendSheet({ w, week, changed, onClose, onDone }: { w: HotWater; week: Week; changed: Day[]; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      applyWater(await sendWaterSchedule(w, week));
      setWaterDraft(null);
      onDone('Saved on Hive. The hot water follows the new week.');
    } catch (e) {
      setErr(e instanceof HiveError ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Send to Hive?" onClose={onClose}>
      <p>This replaces the hot water week on Hive. Changed: <b>{changed.map((d) => DAY_LONG[d]).join(', ')}</b>.</p>
      {changed.map((d) => (
        <div class="confirm-day"><span class="dname">{DAY_SHORT[d]}</span><span class="barcol"><WaterBar week={week} day={d} /><span class="meta">{stretchesText(week, d)}</span></span></div>
      ))}
      {err && <Problem>{err}</Problem>}
      <div class="bottom-actions">
        <button type="button" class="btn big" onClick={onClose} disabled={busy}>Not yet</button>
        <button type="button" class="btn big primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Sheet>
  );
}

export function WaterDayScreen({ day }: { day: Day }) {
  const { w, original, week } = useWater();
  const [copyTo, setCopyTo] = useState<Day[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  if (!w || !week || !original) return <><a class="btn ghost back" href="#/water">‹ Hot water</a><NotReady /></>;
  const slots = sortSlots(week[day]);
  const problems = waterDayProblems(slots, w.maxSlots);
  const i = DAYS.indexOf(day);
  const put = (next: Slot[]) => { setWaterDraft({ ...week, [day]: next }); setCopied(null); };
  const edit = (k: number, p: Partial<Slot>) => put(slots.map((s, j) => (j === k ? { ...s, ...p } : s)));
  const doCopy = (targets: Day[]) => {
    const t = targets.filter((d) => d !== day);
    if (!t.length) return;
    setWaterDraft(copyDay(week, day, t));
    setCopyTo([]);
    setCopied(`Copied to ${t.map((d) => DAY_SHORT[d]).join(', ')}.`);
  };
  const toggle = (d: Day) => setCopyTo(copyTo.includes(d) ? copyTo.filter((x) => x !== d) : [...copyTo, d]);

  return (
    <div class="day-edit">
      <div class="row-between">
        <a class="btn ghost back" href="#/water">‹ Hot water</a>
        <div class="row-actions">
          <a class="btn small" aria-label="Day before" href={`#/water/${DAYS[(i + 6) % 7]}`}>‹ {DAY_SHORT[DAYS[(i + 6) % 7]]}</a>
          <a class="btn small" aria-label="Day after" href={`#/water/${DAYS[(i + 1) % 7]}`}>{DAY_SHORT[DAYS[(i + 1) % 7]]} ›</a>
        </div>
      </div>
      <h1>{DAY_LONG[day]} hot water</h1>
      <Ticks />
      <WaterBar week={week} day={day} />
      <p class="small"><b>{stretchesText(week, day)}</b>. Each line is a time the hot water switches on or off. Before the first one, {DAY_LONG[DAYS[(i + 6) % 7]]}'s last line carries on.</p>

      <ul class="slots">
        {slots.map((s, k) => (
          <li>
            <label class="time">
              <span class="sr">Time</span>
              <input type="time" step={900} value={hhmm(s.start)} onChange={(e) => { const v = parseHhmm((e.target as HTMLInputElement).value); if (v != null) edit(k, { start: v }); }} />
            </label>
            <Segment label={`Hot water from ${hhmm(s.start)}`} value={s.target === ON ? 'on' : 'off'} options={[['on', 'On'], ['off', 'Off']] as const} onChange={(v) => edit(k, { target: v === 'on' ? ON : OFF })} />
            <button type="button" class="btn round danger" aria-label={`Remove the ${hhmm(s.start)} line`} disabled={slots.length <= 1} onClick={() => put(slots.filter((_, j) => j !== k))}>×</button>
          </li>
        ))}
      </ul>
      <button type="button" class="btn" disabled={slots.length >= w.maxSlots} onClick={() => put(addWaterSlot(slots, w.maxSlots))}>+ Add a line{slots.length >= w.maxSlots ? ` (${w.maxSlots} is the most)` : ''}</button>
      {problems.length > 0 && <Problem>{problems.join(' ')}</Problem>}
      {JSON.stringify(sortSlots(original[day])) !== JSON.stringify(slots) && (
        <button type="button" class="btn ghost" onClick={() => put(original[day].map((x) => ({ ...x })))}>Undo {DAY_LONG[day]}'s changes</button>
      )}

      <h2>Copy {DAY_LONG[day]} to other days</h2>
      <div class="chips">
        <button type="button" class="chip" onClick={() => doCopy(DAYS.slice(0, 5))}>All weekdays</button>
        <button type="button" class="chip" onClick={() => doCopy(['saturday', 'sunday'])}>Weekend</button>
        <button type="button" class="chip" onClick={() => doCopy([...DAYS])}>Every day</button>
      </div>
      <div class="chips">
        {DAYS.filter((d) => d !== day).map((d) => (
          <button type="button" class={`chip${copyTo.includes(d) ? ' on' : ''}`} aria-pressed={copyTo.includes(d)} onClick={() => toggle(d)}>{DAY_SHORT[d]}</button>
        ))}
        <button type="button" class="btn small" disabled={!copyTo.length} onClick={() => doCopy(copyTo)}>Copy</button>
      </div>
      {copied && <p class="good-box" role="status">{copied}</p>}

      <div class="bottom-actions">
        <button type="button" class="btn big primary" onClick={() => go('#/water')}>Done — back to hot water</button>
      </div>
    </div>
  );
}
