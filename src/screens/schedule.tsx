import { useState } from 'preact/hooks';
import { HiveError, isSignedIn, sendSchedule, type Heating } from '../lib/hive';
import { applyHeating, reloadHeating, setDraft, useHeating } from '../lib/heating-state';
import {
  addSlot, changedDays, copyDay, dayBlocks, dayProblems, hoursAtOrAbove, lowestAllowed, MAX_SLOTS, MAX_TEMP, sortSlots, STEP, tempColour, tempText, weekOk, type Slot, type Week,
} from '../lib/schedule';
import { deleteWeek, saveWeek } from '../lib/store';
import { DAY_LONG, DAY_SHORT, DAYS, dayKey, hhmm, minuteOfDay, parseHhmm, weekdayOf, type Day } from '../lib/time';
import { Problem, Sheet, Spinner, Stepper, go, useStore } from '../ui';

const WARM = 18; // "the heating is asked for" for the hours summary

export function DayBar({ week, day, now }: { week: Week; day: Day; now?: number | null }) {
  return (
    <div class="daybar" aria-hidden="true">
      {dayBlocks(week, day).map((b) => (
        <span class={`blk${b.carried ? ' carried' : ''}`} style={{ left: `${(b.from / 1440) * 100}%`, width: `${((b.to - b.from) / 1440) * 100}%`, background: tempColour(b.target) }}>
          {b.to - b.from >= 150 ? tempText(b.target) : ''}
        </span>
      ))}
      {now != null && <i class="now" style={{ left: `${(now / 1440) * 100}%` }} />}
    </div>
  );
}
const Ticks = () => <div class="ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>;

function useWeek() {
  const hs = useHeating();
  const h: Heating | null = hs.list[0] ?? null;
  const original = h?.schedule ?? null;
  const week = hs.draft ?? original;
  const changed = hs.draft && original ? changedDays(original, hs.draft) : hs.draft ? [...DAYS] : [];
  return { hs, h, original, week, changed };
}

function NotReady() {
  const { hs, h } = useWeek();
  if (!isSignedIn()) return <div class="empty"><p>Sign in to Hive to see and change the heating schedule.</p><a class="btn primary" href="#/settings">Go to Settings</a></div>;
  if (hs.loading && !h) return <Spinner text="Asking Hive…" />;
  if (hs.error && !h) return <Problem retry={reloadHeating}>{hs.error}</Problem>;
  if (h && !h.schedule) return <Problem>Hive sent a heating schedule in a shape this app does not know, so it will not touch it. Settings ▸ "Copy what Hive sent" and send it to Claude.</Problem>;
  return <Spinner />;
}

export function ScheduleScreen() {
  const { hs, h, original, week, changed } = useWeek();
  const s = useStore();
  const [confirm, setConfirm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const today = weekdayOf(dayKey(Date.now()));
  if (!h || !week || !original) return <><h1>Heating week</h1><NotReady /></>;
  const ok = weekOk(week, lowestAllowed(original));
  const avgWeekday = DAYS.slice(0, 5).reduce((a, d) => a + hoursAtOrAbove(week, d, WARM), 0) / 5;
  const avgWeekend = (hoursAtOrAbove(week, 'saturday', WARM) + hoursAtOrAbove(week, 'sunday', WARM)) / 2;

  return (
    <>
      <div class="row-between"><h1>Heating week</h1>{hs.loading && <span class="small">Updating…</span>}</div>
      {h.mode !== 'SCHEDULE' && h.mode !== 'BOOST' && (
        <p class="note-box">The thermostat is on <b>{h.mode === 'OFF' ? 'Off' : 'Manual'}</b>, so it is not following this week. Switch it to Schedule on the <a href="#/now">Now</a> screen.</p>
      )}
      <p class="small">Tap a day to change it. Nothing reaches the thermostat until you press <b>Send to Hive</b>.</p>
      <div class="week">
        <Ticks />
        {DAYS.map((d) => (
          <a class={`dayrow${d === today ? ' today' : ''}`} href={`#/day/${d}`}>
            <span class="dname">{DAY_SHORT[d]}{changed.includes(d) && <i class="changed" title="Changed, not sent yet" />}</span>
            <DayBar week={week} day={d} now={d === today ? minuteOfDay(Date.now()) : null} />
          </a>
        ))}
      </div>
      <p class="small">Warm ({WARM}° or more): about <b>{avgWeekday.toFixed(1)} h</b> a weekday and <b>{avgWeekend.toFixed(1)} h</b> a weekend day.</p>

      {changed.length > 0 && (
        <div class="sendbar">
          <span>{changed.length === 7 ? 'Whole week' : changed.map((d) => DAY_SHORT[d]).join(', ')} changed</span>
          <button type="button" class="btn" onClick={() => setDraft(null)}>Undo</button>
          <button type="button" class="btn primary" disabled={!ok} onClick={() => setConfirm(true)}>Send to Hive</button>
        </div>
      )}
      {done && <p class="good-box" role="status">{done}</p>}

      <h2>Saved weeks</h2>
      <p class="small">Keep a week to use again (e.g. "Winter", "Away", "Holidays"). Using one only fills in the week above; you still send it.</p>
      {s.weeks.length === 0 && <p class="small"><i>None saved yet.</i></p>}
      <div class="list">
        {s.weeks.map((w) => (
          <div class="list-row">
            <div><b>{w.name}</b><span class="meta">saved {new Date(w.saved).toLocaleDateString('en-GB')}</span></div>
            <div class="row-actions">
              <button type="button" class="btn small" onClick={() => { setDraft(w.week); setDone(null); window.scrollTo(0, 0); }}>Use</button>
              <button type="button" class="btn small danger" aria-label={`Delete ${w.name}`} onClick={() => { if (confirm_(`Delete the saved week "${w.name}"?`)) deleteWeek(w.id); }}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      <form class="inline-form" onSubmit={(e) => { e.preventDefault(); saveWeek(saveName, week); setSaveName(''); }}>
        <input type="text" placeholder="Name, e.g. Winter" value={saveName} onInput={(e) => setSaveName((e.target as HTMLInputElement).value)} aria-label="Name for this week" />
        <button type="submit" class="btn">Save this week</button>
      </form>

      {confirm && <SendSheet h={h} week={week} changed={changed} onClose={() => setConfirm(false)} onDone={(m) => { setConfirm(false); setDone(m); }} />}
    </>
  );
}
const confirm_ = (q: string) => window.confirm(q);

function SendSheet({ h, week, changed, onClose, onDone }: { h: Heating; week: Week; changed: Day[]; onClose: () => void; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const after = await sendSchedule(h, week);
      applyHeating(after);
      setDraft(null);
      onDone('Saved on Hive. The thermostat shows the new week.');
    } catch (e) {
      setErr(e instanceof HiveError ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet title="Send to Hive?" onClose={onClose}>
      <p>This replaces the heating week on your thermostat. Changed: <b>{changed.map((d) => DAY_LONG[d]).join(', ')}</b>.</p>
      {changed.map((d) => (
        <div class="confirm-day"><span class="dname">{DAY_SHORT[d]}</span><DayBar week={week} day={d} /></div>
      ))}
      {err && <Problem>{err}</Problem>}
      <div class="bottom-actions">
        <button type="button" class="btn big" onClick={onClose} disabled={busy}>Not yet</button>
        <button type="button" class="btn big primary" onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Sheet>
  );
}

export function DayScreen({ day }: { day: Day }) {
  const { h, original, week } = useWeek();
  const [copyTo, setCopyTo] = useState<Day[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  if (!h || !week || !original) return <><a class="btn ghost back" href="#/schedule">‹ Week</a><NotReady /></>;
  const low = lowestAllowed(original);
  const slots = sortSlots(week[day]);
  const problems = dayProblems(slots, low);
  const i = DAYS.indexOf(day);
  const put = (next: Slot[]) => { setDraft({ ...week, [day]: next }); setCopied(null); };
  const edit = (k: number, p: Partial<Slot>) => put(slots.map((s, j) => (j === k ? { ...s, ...p } : s)));
  const doCopy = (targets: Day[]) => {
    const t = targets.filter((d) => d !== day);
    if (!t.length) return;
    setDraft(copyDay(week, day, t));
    setCopyTo([]);
    setCopied(`Copied to ${t.map((d) => DAY_SHORT[d]).join(', ')}.`);
  };
  const toggle = (d: Day) => setCopyTo(copyTo.includes(d) ? copyTo.filter((x) => x !== d) : [...copyTo, d]);

  return (
    <div class="day-edit">
      <div class="row-between">
        <a class="btn ghost back" href="#/schedule">‹ Week</a>
        <div class="row-actions">
          <a class="btn small" aria-label="Day before" href={`#/day/${DAYS[(i + 6) % 7]}`}>‹ {DAY_SHORT[DAYS[(i + 6) % 7]]}</a>
          <a class="btn small" aria-label="Day after" href={`#/day/${DAYS[(i + 1) % 7]}`}>{DAY_SHORT[DAYS[(i + 1) % 7]]} ›</a>
        </div>
      </div>
      <h1>{DAY_LONG[day]}</h1>
      <Ticks />
      <DayBar week={week} day={day} />
      <p class="small">Each line is a time the thermostat changes temperature. Before the first one, {DAY_LONG[DAYS[(i + 6) % 7]]}'s last temperature carries on.</p>

      <ul class="slots">
        {slots.map((s, k) => (
          <li>
            <label class="time">
              <span class="sr">Time</span>
              <input type="time" step={900} value={hhmm(s.start)} onChange={(e) => { const v = parseHhmm((e.target as HTMLInputElement).value); if (v != null) edit(k, { start: v }); }} />
            </label>
            <Stepper label="temperature" value={s.target} min={low} max={MAX_TEMP} step={STEP} format={(v) => (v < 5 ? `Off (${tempText(v)})` : tempText(v))} onChange={(v) => edit(k, { target: v })} />
            <button type="button" class="btn round danger" aria-label={`Remove the ${hhmm(s.start)} change`} disabled={slots.length <= 1} onClick={() => put(slots.filter((_, j) => j !== k))}>×</button>
          </li>
        ))}
      </ul>
      <button type="button" class="btn" disabled={slots.length >= MAX_SLOTS} onClick={() => put(addSlot(slots))}>+ Add a change{slots.length >= MAX_SLOTS ? ` (${MAX_SLOTS} is the most)` : ''}</button>
      {problems.length > 0 && <Problem>{problems.join(' ')}</Problem>}
      {original && original[day] && JSON.stringify(sortSlots(original[day])) !== JSON.stringify(slots) && (
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
        <button type="button" class="btn big primary" onClick={() => go('#/schedule')}>Done — back to the week</button>
      </div>
    </div>
  );
}
