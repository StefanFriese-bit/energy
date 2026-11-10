import { describe, expect, it } from 'vitest';
import { costIntervals, dayTotals, gasKwh, rateFinder, splitTariff, standingForDay, summarise, unitPriceAt, type Agreement, type TariffRates } from '../src/lib/cost';
import { parseAccount } from '../src/lib/octopus';
import { parseHeating } from '../src/lib/hive';
import { addSlot, changedDays, copyDay, dayBlocks, dayProblems, fromHive, lowestAllowed, nextChange, targetAt, toHive, type Week } from '../src/lib/schedule';
import { addDays, dayKey, londonMidnight, mondayOf, weekdayOf } from '../src/lib/time';

const H = 3_600_000;

describe('UK time', () => {
  it('UK midnight in winter and summer', () => {
    expect(new Date(londonMidnight('2026-01-15')).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(new Date(londonMidnight('2026-07-15')).toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });
  it('clock-change days are 23 and 25 hours long', () => {
    expect((londonMidnight('2026-03-30') - londonMidnight('2026-03-29')) / H).toBe(23);
    expect((londonMidnight('2026-10-26') - londonMidnight('2026-10-25')) / H).toBe(25);
  });
  it('a moment belongs to its UK date, not its UTC date', () => {
    expect(dayKey(Date.parse('2026-07-14T23:30:00Z'))).toBe('2026-07-15');
    expect(dayKey(Date.parse('2026-01-14T23:30:00Z'))).toBe('2026-01-14');
  });
  it('weekdays and weeks', () => {
    expect(weekdayOf('2026-11-10')).toBe('tuesday');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('cost', () => {
  const flat: TariffRates = { unit: [{ from: 0, to: Infinity, p: 25, pm: 'DIRECT_DEBIT' }, { from: 0, to: Infinity, p: 27, pm: 'NON_DIRECT_DEBIT' }], standing: [{ from: 0, to: Infinity, p: 50, pm: 'DIRECT_DEBIT' }, { from: 0, to: Infinity, p: 55, pm: 'NON_DIRECT_DEBIT' }] };
  const ag: Agreement[] = [{ tariff: 'E-1R-VAR-22-11-01-C', from: 0, to: Infinity }];

  it('tariff codes', () => {
    expect(splitTariff('E-1R-AGILE-24-10-01-C')).toEqual({ product: 'AGILE-24-10-01', region: 'C' });
    expect(splitTariff('G-1R-VAR-22-11-01-N')).toEqual({ product: 'VAR-22-11-01', region: 'N' });
    expect(splitTariff('rubbish')).toBeNull();
  });

  it('uses the price for the way of paying', () => {
    expect(unitPriceAt(1000, ag, { [ag[0].tariff]: flat })).toBe(25);
    expect(unitPriceAt(1000, ag, { [ag[0].tariff]: flat }, { pay: 'NON_DIRECT_DEBIT', nightStartUtcMin: 30, nightEndUtcMin: 450 })).toBe(27);
  });

  it('each half hour at the price of THAT half hour (time-of-use)', () => {
    const t0 = londonMidnight('2026-11-09');
    const unit = [{ from: t0, to: t0 + 1.5 * H, p: 10 }, { from: t0 + 1.5 * H, to: Infinity, p: 30 }];
    const r = { 'E-1R-AGILE-24-10-01-C': { unit, standing: [{ from: 0, to: Infinity, p: 60 }] } };
    const a = [{ tariff: 'E-1R-AGILE-24-10-01-C', from: 0, to: Infinity }];
    const c = costIntervals([{ start: t0, kwh: 1 }, { start: t0 + H, kwh: 1 }, { start: t0 + 2 * H, kwh: 1 }], a, r);
    expect(c.map((x) => x.p)).toEqual([10, 10, 30]);
    const d = dayTotals(c, '2026-11-09', '2026-11-09', a, r);
    expect(d[0]).toMatchObject({ kwh: 3, energyP: 50, standingP: 60, totalP: 110, readings: 3, slots: 48 });
  });

  it('a tariff switch mid-range: each day on its own tariff, standing charge too', () => {
    const switchAt = londonMidnight('2026-11-05');
    const a: Agreement[] = [{ tariff: 'E-1R-OLD-C', from: 0, to: switchAt }, { tariff: 'E-1R-NEW-C', from: switchAt, to: Infinity }];
    const r = { 'E-1R-OLD-C': { unit: [{ from: 0, to: Infinity, p: 20 }], standing: [{ from: 0, to: Infinity, p: 40 }] }, 'E-1R-NEW-C': { unit: [{ from: 0, to: Infinity, p: 30 }], standing: [{ from: 0, to: Infinity, p: 45 }] } };
    const iv = [{ start: londonMidnight('2026-11-04') + H, kwh: 2 }, { start: londonMidnight('2026-11-05') + H, kwh: 2 }];
    const d = dayTotals(costIntervals(iv, a, r), '2026-11-04', '2026-11-05', a, r);
    expect(d.map((x) => [x.energyP, x.standingP])).toEqual([[40, 40], [60, 45]]);
  });

  it('a day with no readings has no charge counted (not yet known)', () => {
    const d = dayTotals([], '2026-11-09', '2026-11-09', ag, { [ag[0].tariff]: flat });
    expect(d[0]).toMatchObject({ totalP: 0, standingP: 0, readings: 0 });
  });

  it('half hours with no known price are counted and flagged, not priced at 0 silently', () => {
    const c = costIntervals([{ start: 5, kwh: 1 }], [], {});
    expect(c[0].rate).toBeNull();
    const s = summarise(dayTotals(c, dayKey(5), dayKey(5), [], {}));
    expect(s.unpriced).toBe(1);
  });

  it('Economy 7: night price in the GMT night hours, all year', () => {
    const r = { 'E-2R-VAR-22-11-01-C': { unit: [], standing: [], day: [{ from: 0, to: Infinity, p: 30 }], night: [{ from: 0, to: Infinity, p: 12 }] } };
    const a = [{ tariff: 'E-2R-VAR-22-11-01-C', from: 0, to: Infinity }];
    expect(unitPriceAt(Date.parse('2026-07-10T01:00:00Z'), a, r)).toBe(12);
    expect(unitPriceAt(Date.parse('2026-07-10T08:00:00Z'), a, r)).toBe(30);
    expect(unitPriceAt(Date.parse('2026-07-10T00:00:00Z'), a, r)).toBe(30);
  });

  it('gas cubic metres to kWh like the bill', () => {
    expect(gasKwh(1, 'm3', 39.5)).toBeCloseTo(11.2206, 3);
    expect(gasKwh(5, 'kwh', 39.5)).toBe(5);
  });

  it('overlapping price lists: the newest that covers the moment wins', () => {
    const f = rateFinder([{ from: 0, to: Infinity, p: 20 }, { from: 100, to: Infinity, p: 22 }]);
    expect(f(50)?.p).toBe(20);
    expect(f(150)?.p).toBe(22);
  });

  it('standing charge for the day = the one at UK midday', () => {
    const noonChange = londonMidnight('2026-11-09') + 13 * H;
    const r = { T: { unit: [], standing: [{ from: 0, to: noonChange, p: 40 }, { from: noonChange, to: Infinity, p: 50 }] } };
    expect(standingForDay('2026-11-09', [{ tariff: 'T', from: 0, to: Infinity }], r)).toBe(40);
  });
});

describe('Octopus account', () => {
  it('takes the house lived in now, its meters, serials and tariffs', () => {
    const a = parseAccount({
      number: 'A-1234ABCD',
      properties: [
        { moved_in_at: '2019-01-01T00:00:00Z', moved_out_at: '2022-01-01T00:00:00Z', electricity_meter_points: [{ mpan: 'OLD', meters: [], agreements: [] }], gas_meter_points: [] },
        {
          moved_in_at: '2022-01-01T00:00:00Z', moved_out_at: null,
          electricity_meter_points: [
            { mpan: '1100000000001', is_export: false, meters: [{ serial_number: '19L1' }, { serial_number: '22L2' }], agreements: [{ tariff_code: 'E-1R-VAR-22-11-01-C', valid_from: '2024-01-01T00:00:00Z', valid_to: null }, { tariff_code: 'E-1R-OLD-C', valid_from: '2022-01-01T00:00:00Z', valid_to: '2024-01-01T00:00:00Z' }] },
            { mpan: '1100000000002', is_export: true, meters: [{ serial_number: 'EX' }], agreements: [] },
          ],
          gas_meter_points: [{ mprn: '9999', meters: [{ serial_number: 'G4' }], agreements: [{ tariff_code: 'G-1R-VAR-22-11-01-C', valid_from: '2024-01-01T00:00:00Z', valid_to: null }] }],
        },
      ],
    });
    expect(a.meters.map((m) => [m.kind, m.point, m.isExport])).toEqual([['electricity', '1100000000001', false], ['electricity', '1100000000002', true], ['gas', '9999', false]]);
    expect(a.meters[0].serials).toEqual(['19L1', '22L2']);
    expect(a.meters[0].agreements.map((x) => x.tariff)).toEqual(['E-1R-OLD-C', 'E-1R-VAR-22-11-01-C']);
    expect(a.meters[0].agreements[1].to).toBe(Infinity);
  });
});

// A week shaped like Hive's own: { monday: [{ start, value: { target } }] }
const hiveWeek = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [
  { start: 390, value: { target: 20 } }, { start: 510, value: { target: 16 } }, { start: 1020, value: { target: 20.5 } }, { start: 1350, value: { target: 15 } },
]]));

describe('heating schedule', () => {
  const w = fromHive(hiveWeek)!;
  it('reads and writes Hive\'s shape unchanged', () => {
    expect(w.monday[0]).toEqual({ start: 390, target: 20 });
    expect(toHive(w)).toEqual(hiveWeek);
  });
  it('refuses a shape it does not know (so it never overwrites what it cannot read)', () => {
    expect(fromHive({ monday: [{ begin: 1 }] })).toBeNull();
    expect(fromHive({ ...hiveWeek, sunday: [] })).toBeNull();
    expect(fromHive(null)).toBeNull();
  });
  it('before the first change of the day, last night\'s temperature holds', () => {
    expect(targetAt(w, 'tuesday', 60)).toBe(15);
    expect(targetAt(w, 'tuesday', 400)).toBe(20);
    expect(dayBlocks(w, 'tuesday')[0]).toEqual({ from: 0, to: 390, target: 15, carried: true });
  });
  it('the next change', () => {
    expect(nextChange(w, 'tuesday', 600)).toMatchObject({ day: 'tuesday', start: 1020, target: 20.5, inDays: 0 });
    expect(nextChange(w, 'tuesday', 1400)).toMatchObject({ day: 'wednesday', start: 390, inDays: 1 });
  });
  it('copy a day to others, and see which days changed', () => {
    const edited: Week = { ...w, saturday: [{ start: 480, target: 21 }] };
    const n = copyDay(edited, 'saturday', ['sunday']);
    expect(n.sunday).toEqual([{ start: 480, target: 21 }]);
    expect(changedDays(w, n)).toEqual(['saturday', 'sunday']);
    expect(w.sunday).toHaveLength(4); // the original is untouched
  });
  it('day rules', () => {
    expect(dayProblems([])).toHaveLength(1);
    expect(dayProblems([{ start: 60, target: 18 }, { start: 60, target: 20 }])[0]).toMatch(/same time/);
    expect(dayProblems(Array.from({ length: 7 }, (_, i) => ({ start: i * 60, target: 18 })))[0]).toMatch(/At most 6/);
    expect(dayProblems([{ start: 60, target: 40 }])[0]).toMatch(/Temperatures/);
    expect(addSlot(w.monday)).toHaveLength(5);
  });
  it('a low "off" temperature Hive already uses stays allowed', () => {
    const withOff = fromHive({ ...hiveWeek, monday: [{ start: 0, value: { target: 1 } }] })!;
    expect(lowestAllowed(withOff)).toBe(1);
    expect(dayProblems(withOff.monday, lowestAllowed(withOff))).toEqual([]);
    expect(lowestAllowed(w)).toBe(5);
  });
});

describe('Hive thermostat reading', () => {
  it('finds the heating product and its fields', () => {
    const list = parseHeating({
      products: [
        { id: 'hw1', type: 'hotwater', state: { mode: 'SCHEDULE' }, props: {} },
        { id: 'h1', type: 'heating', parent: 'd1', state: { name: 'Heating', mode: 'BOOST', target: 22, boost: 45, schedule: hiveWeek }, props: { temperature: 19.37, working: true, zone: 'z1', previous: { mode: 'SCHEDULE', target: 20 } } },
      ],
      devices: [{ id: 'd1', type: 'thermostatui', props: { online: true, zone: 'z1' } }],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'h1', type: 'heating', mode: 'BOOST', target: 22, current: 19.37, working: true, boostMinutes: 45, previousMode: 'SCHEDULE', online: true });
    expect(list[0].schedule?.friday).toHaveLength(4);
  });
});
