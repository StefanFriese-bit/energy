import { useEffect, useState } from 'preact/hooks';
import { agreementAt, forPayment, isTwoRate, pence, rateFinder, type Rate, type TariffRates } from '../lib/cost';
import { getAccount, importMeter, productName, upcomingRates } from '../lib/data';
import type { Account, Meter } from '../lib/octopus';
import { hasOctopus, type Settings } from '../lib/store';
import { addDays, clock, dayKey, londonMidnight, niceDay } from '../lib/time';
import { Chart } from '../chart';
import { Problem, Spinner, useStore } from '../ui';
import { AVG, ELEC, GAS } from './usage';

export interface TariffNow {
  meter: Meter; tariff: string; name: string; since: number;
  unitNow: number | null; standing: number | null; day?: number | null; night?: number | null;
  /** Half-hour prices from the start of today to as far as Octopus has published (only for prices that change during the day). */
  slots: Rate[] | null;
}

export async function tariffNow(s: Settings, meter: Meter): Promise<TariffNow | null> {
  const now = Date.now();
  const a = agreementAt(meter.agreements, now) ?? meter.agreements[meter.agreements.length - 1];
  if (!a) return null;
  const from = londonMidnight(dayKey(now));
  const to = londonMidnight(addDays(dayKey(now), 2));
  const [r, prod] = await Promise.all([upcomingRates(a.tariff, from, to, s.octopusKey.trim()), productName(a.tariff, s.octopusKey.trim())]);
  const pick = (list: Rate[] | undefined) => rateFinder(forPayment(list ?? [], s.pay))(now)?.p ?? null;
  const unit = forPayment(r.unit, s.pay).filter((x) => x.to > from).sort((x, y) => x.from - y.from);
  const varies = new Set(unit.filter((x) => x.from < now + 86_400_000).map((x) => x.p)).size > 2;
  return {
    meter, tariff: a.tariff, name: prod?.name ?? a.tariff, since: a.from,
    unitNow: pick(r.unit), standing: pick(r.standing), day: isTwoRate(a.tariff) ? pick(r.day) : undefined, night: isTwoRate(a.tariff) ? pick((r as TariffRates).night) : undefined,
    slots: varies ? unit : null,
  };
}

/** The cheapest stretch of `n` half hours from now on (for running the washing machine, a charger…). */
export function cheapestWindow(slots: Rate[], n: number, now = Date.now()): { from: number; avg: number } | null {
  const fut = slots.filter((x) => x.to > now);
  let best: { from: number; avg: number } | null = null;
  for (let i = 0; i + n <= fut.length; i++) {
    const w = fut.slice(i, i + n);
    if (w.some((x, k) => k > 0 && x.from !== w[k - 1].to)) continue;
    const avg = w.reduce((a, x) => a + x.p, 0) / n;
    if (!best || avg < best.avg) best = { from: w[0].from, avg };
  }
  return best;
}

export function PricesScreen() {
  const s = useStore().settings;
  const [acc, setAcc] = useState<Account | null>(null);
  const [now, setNow] = useState<(TariffNow | null)[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!hasOctopus(s)) return;
    let live = true;
    setErr(null);
    getAccount(s)
      .then(async (a) => {
        if (!live) return;
        setAcc(a);
        const meters = (['electricity', 'gas'] as const).map((k) => importMeter(a, k)).filter(Boolean) as Meter[];
        const t = await Promise.all(meters.map((m) => tariffNow(s, m)));
        if (live) setNow(t);
        const all = [...new Set(a.meters.flatMap((m) => m.agreements.map((x) => x.tariff)))];
        const n: Record<string, string> = {};
        for (const code of all) n[code] = (await productName(code, s.octopusKey.trim()).catch(() => null))?.name ?? code;
        if (live) setNames(n);
      })
      .catch((e) => { if (live) setErr(e?.message ?? String(e)); });
    return () => { live = false; };
  }, [s.octopusAccount, s.octopusKey, s.pay, tick]);

  if (!hasOctopus(s)) return <><h1>Prices</h1><div class="empty"><p>Add your Octopus details in Settings to see your prices.</p><a class="btn primary" href="#/settings">Go to Settings</a></div></>;
  return (
    <>
      <h1>Prices</h1>
      <p class="small">What Octopus charges you, VAT included, paying by {s.pay === 'DIRECT_DEBIT' ? 'Direct Debit' : 'cash/cheque (not Direct Debit)'}.</p>
      {err && <Problem retry={() => setTick(tick + 1)}>{err}</Problem>}
      {!err && !now && <Spinner text="Asking Octopus…" />}
      {now?.map((t) => t && <TariffCard t={t} />)}
      {acc && acc.meters.some((m) => m.isExport) && <p class="small">An export meter (selling to the grid) is on the account too; this app does not show it yet.</p>}
      {acc && (
        <>
          <h2>Tariff history</h2>
          <div class="list">
            {acc.meters.filter((m) => !m.isExport).flatMap((m) => [...m.agreements].reverse().map((a) => (
              <div class="list-row">
                <div><b>{m.kind === 'electricity' ? 'Electricity' : 'Gas'}: {names[a.tariff] ?? a.tariff}</b>
                  <span class="meta">{niceDay(dayKey(a.from), true)} – {Number.isFinite(a.to) ? niceDay(dayKey(a.to - 1), true) : 'now'}</span></div>
              </div>
            )))}
          </div>
        </>
      )}
    </>
  );
}

function TariffCard({ t }: { t: TariffNow }) {
  const [pick, setPick] = useState<number | null>(null);
  const elec = t.meter.kind === 'electricity';
  const now = Date.now();
  const slots = t.slots;
  const avg = slots?.length ? slots.reduce((a, x) => a + x.p, 0) / slots.length : null;
  const nowAt = slots ? slots.findIndex((x) => x.from <= now && now < x.to) : -1;
  const cheap = t.slots ? cheapestWindow(t.slots, 6, now) : null;
  const neg = t.slots?.filter((x) => x.to > now && x.p < 0) ?? [];
  return (
    <section class="card">
      <div class="card-top"><b>{elec ? 'Electricity' : 'Gas'}</b><span class="badge">{t.name}</span></div>
      <div class="price-grid">
        {t.day != null || t.night != null ? (
          <>
            <div><span class="meta">Day</span><strong>{t.day != null ? pence(t.day) : '–'}</strong><span class="meta">per kWh</span></div>
            <div><span class="meta">Night</span><strong>{t.night != null ? pence(t.night) : '–'}</strong><span class="meta">per kWh</span></div>
          </>
        ) : (
          <div><span class="meta">{t.slots ? 'Right now' : 'Unit price'}</span><strong>{t.unitNow != null ? pence(t.unitNow) : '–'}</strong><span class="meta">per kWh</span></div>
        )}
        <div><span class="meta">Standing charge</span><strong>{t.standing != null ? pence(t.standing) : '–'}</strong><span class="meta">per day</span></div>
      </div>
      <p class="small">On this tariff since {niceDay(dayKey(t.since), true)}.</p>
      {slots && (
        <>
          <h3>Price per half hour, today{slots.length > 50 ? ' and tomorrow' : ' (tomorrow comes out around 4 pm)'}</h3>
          <Chart
            labels={slots.map((x) => (clock(x.from).endsWith(':00') && +clock(x.from).slice(0, 2) % 6 === 0 ? clock(x.from).slice(0, 2) : ''))}
            titles={slots.map((x) => `${niceDay(dayKey(x.from))} ${clock(x.from)}: ${pence(x.p)}/kWh`)}
            series={[{ kind: 'bar', name: 'Price', colour: elec ? ELEC : GAS, values: slots.map((x) => Math.max(0, x.p)) }]}
            dim={slots.map((x) => x.to <= now)}
            divider={nowAt > 0 ? { at: nowAt, label: 'Now' } : null}
            refLines={avg != null ? [{ value: avg, colour: AVG, label: `Average ${pence(Math.round(avg * 100) / 100)}` }] : []}
            yFormat={(v) => `${Math.round(v)}p`} selected={pick} onPick={setPick} height={170} ariaLabel="Price per half hour" />
          <p class="pick-line">{pick != null ? `${niceDay(dayKey(slots[pick].from))} ${clock(slots[pick].from)}: ${pence(slots[pick].p)}/kWh` : 'Tap a bar for its price.'}</p>
          {cheap && <p>Cheapest 3 hours ahead: from <b>{clock(cheap.from)}</b>{dayKey(cheap.from) !== dayKey(now) ? ` ${niceDay(dayKey(cheap.from))}` : ''}, average {pence(cheap.avg)}/kWh.</p>}
          {neg.length > 0 && <p class="good-box">Octopus pays you to use electricity in {neg.length} half hour{neg.length === 1 ? '' : 's'} ahead (price below zero).</p>}
        </>
      )}
    </section>
  );
}
