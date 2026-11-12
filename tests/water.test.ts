import { describe, expect, it } from 'vitest';
import { parseHeating, parseHotWater } from '../src/lib/hive';
import type { Week } from '../src/lib/schedule';
import { addWaterSlot, hoursOn, nextWaterChange, OFF, ON, onStretches, stretchesText, waterDayProblems, waterFromHive, waterIsOn, waterOnAt, waterToHive, waterWeekOk } from '../src/lib/water';
import { DAYS } from '../src/lib/time';

// The shape Hive sends for hot water (from the Home Assistant Hive library's own sample of a real account).
const hiveDay = () => [
  { value: { status: 'ON' }, start: 405 }, { value: { status: 'OFF' }, start: 435 }, { value: { status: 'OFF' }, start: 720 },
  { value: { status: 'ON' }, start: 1020 }, { value: { status: 'OFF' }, start: 1080 }, { value: { status: 'OFF' }, start: 1290 },
];
const hiveWeek = () => Object.fromEntries(DAYS.map((d) => [d, hiveDay()]));
const product = (state: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
  id: 'hotwater-1', type: 'hotwater', parent: 'boilermodule-1',
  props: { online: true, model: 'SLR2', zone: 'boilermodule-1', maxEvents: 6, capabilities: ['BOOST', 'HOLIDAY_MODE'], previous: { mode: 'OFF' }, ...props },
  state: { name: 'Hotwater', mode: 'SCHEDULE', schedule: hiveWeek(), boost: null, status: 'OFF', ...state },
});

describe('hot water', () => {
  it('reads Hive\'s week and sends back exactly the same thing', () => {
    const w = waterFromHive(hiveWeek())!;
    expect(w.monday[0]).toEqual({ start: 405, target: ON });
    expect(w.monday[1]).toEqual({ start: 435, target: OFF });
    expect(waterToHive(w)).toEqual(hiveWeek());
  });

  it('refuses a week it does not understand, so it can never be overwritten', () => {
    expect(waterFromHive(null)).toBeNull();
    expect(waterFromHive({ ...hiveWeek(), sunday: [] })).toBeNull();
    expect(waterFromHive({ ...hiveWeek(), sunday: [{ start: 60, value: { status: 'MAYBE' } }] })).toBeNull();
    expect(waterFromHive({ ...hiveWeek(), sunday: [{ start: 60, value: { target: 20 } }] })).toBeNull(); // a heating week is not a water week
    expect(waterFromHive({ ...hiveWeek(), sunday: [{ start: '60', value: { status: 'ON' } }] })).toBeNull();
  });

  it('on stretches, hours and words for a day', () => {
    const w = waterFromHive(hiveWeek())!;
    expect(onStretches(w, 'monday')).toEqual([{ from: 405, to: 435 }, { from: 1020, to: 1080 }]);
    expect(hoursOn(w, 'monday')).toBe(1.5);
    expect(stretchesText(w, 'monday')).toBe('06:45–07:15, 17:00–18:00');
    const off: Week = { ...w, tuesday: [{ start: 0, target: OFF }] };
    expect(stretchesText(off, 'tuesday')).toBe('Off all day');
    const on: Week = { ...w, tuesday: [{ start: 0, target: ON }] };
    expect(stretchesText(on, 'tuesday')).toBe('On all day');
  });

  it('a day that ends on carries on into the next morning until its first line', () => {
    const w = waterFromHive(hiveWeek())!;
    const late: Week = { ...w, monday: [{ start: 600, target: OFF }, { start: 1380, target: ON }] };
    expect(onStretches(late, 'monday')).toEqual([{ from: 1380, to: 1440 }]);
    expect(onStretches(late, 'tuesday')[0]).toEqual({ from: 0, to: 435 }); // Monday's "on" until 06:45, joined to Tuesday's own 06:45–07:15
    expect(waterOnAt(late, 'tuesday', 60)).toBe(true);
    expect(waterOnAt(late, 'monday', 60)).toBe(false); // Sunday ended off
  });

  it('next change: skips lines that do not switch anything', () => {
    const w = waterFromHive(hiveWeek())!;
    expect(nextWaterChange(w, 'monday', 420)).toEqual({ day: 'monday', start: 435, on: false, inDays: 0 });
    expect(nextWaterChange(w, 'monday', 500)).toEqual({ day: 'monday', start: 1020, on: true, inDays: 0 }); // not the 12:00 "off" line
    expect(nextWaterChange(w, 'sunday', 1300)).toEqual({ day: 'monday', start: 405, on: true, inDays: 1 });
  });

  it('what cannot be sent', () => {
    const w = waterFromHive(hiveWeek())!;
    expect(waterWeekOk(w)).toBe(true);
    expect(waterDayProblems([])).toContain('A day needs at least one line.');
    expect(waterDayProblems([{ start: 60, target: ON }, { start: 60, target: OFF }])).toContain('Two lines are at the same time.');
    expect(waterDayProblems(w.monday, 4)).toContain('At most 4 lines a day.');
    expect(waterDayProblems([{ start: 60, target: 20 }])).toContain('A line is neither on nor off.');
    expect(waterDayProblems([{ start: 1440, target: ON }])).toContain('A time is not a time of day.');
  });

  it('adding a line switches the other way from the last one, and stops at the most Hive takes', () => {
    expect(addWaterSlot([{ start: 420, target: ON }])).toEqual([{ start: 420, target: ON }, { start: 480, target: OFF }]);
    expect(addWaterSlot([{ start: 420, target: OFF }])[1]).toEqual({ start: 480, target: ON });
    const full = waterFromHive(hiveWeek())!.monday;
    expect(addWaterSlot(full)).toHaveLength(6);
    expect(addWaterSlot(full, 8)).toHaveLength(7);
  });

  it('reads the hot water out of what Hive lists, and leaves the heating alone', () => {
    const heating = { id: 'h1', type: 'heating', state: { mode: 'SCHEDULE', target: 20 }, props: { temperature: 19 } };
    const all = { products: [heating, product()], devices: [] };
    const [w] = parseHotWater(all);
    expect(w).toMatchObject({ id: 'hotwater-1', name: 'Hotwater', mode: 'SCHEDULE', status: false, boostMinutes: null, previousMode: 'OFF', online: true, canBoost: true, maxSlots: 6 });
    expect(w.schedule!.monday).toHaveLength(6);
    expect(parseHeating(all)).toHaveLength(1);
    expect(parseHotWater({ products: [heating], devices: [] })).toEqual([]); // a combi boiler: no hot water listed
    expect(parseHotWater(null)).toEqual([]);
  });

  it('a boost carries its minutes; a receiver without boost offers none', () => {
    expect(parseHotWater({ products: [product({ mode: 'BOOST', boost: 42 })] })[0]).toMatchObject({ mode: 'BOOST', boostMinutes: 42 });
    expect(parseHotWater({ products: [product({}, { capabilities: ['HOLIDAY_MODE'] })] })[0].canBoost).toBe(false);
    expect(parseHotWater({ products: [product({ schedule: { monday: [] } })] })[0].schedule).toBeNull();
  });

  it('is the water on now: boost and always-on yes, off no, schedule = what the week says', () => {
    const [w] = parseHotWater({ products: [product()] });
    expect(waterIsOn(w, 'monday', 420)).toBe(true);
    expect(waterIsOn(w, 'monday', 500)).toBe(false);
    expect(waterIsOn({ ...w, mode: 'OFF' }, 'monday', 420)).toBe(false);
    expect(waterIsOn({ ...w, mode: 'MANUAL' }, 'monday', 500)).toBe(true);
    expect(waterIsOn({ ...w, mode: 'BOOST' }, 'monday', 500)).toBe(true);
    expect(waterIsOn({ ...w, schedule: null, status: true }, 'monday', 500)).toBe(true); // unknown week: Hive's own word
  });
});
