import { describe, expect, it } from 'vitest';
import { monthOutlook, type DayTotal } from '../src/lib/cost';

const day = (d: number, totalP: number, readings = 48): DayTotal => ({ day: `2026-11-${String(d).padStart(2, '0')}`, kwh: totalP / 10, energyP: totalP - 50, standingP: 50, totalP, readings, slots: 48, unpriced: 0 });

describe('the month graph: so far, the average day, projected', () => {
  it('a month part way through: average of the days with readings, carried to the month end', () => {
    // 11 days read, 30-day month: 11 × £3 = £33 so far, £3 a day, + 19 days × £3 = £90
    const days = Array.from({ length: 11 }, (_, i) => day(i + 1, 300));
    const o = monthOutlook(days, 30);
    expect(o).toEqual({ daysDone: 11, daysInMonth: 30, soFar: 3300, avgPerDay: 300, projected: 9000 });
  });
  it('a day Octopus has not sent yet does not pull the average down — it is counted as still to come', () => {
    const days = [day(1, 400), day(2, 200), day(3, 0, 0)];
    const o = monthOutlook(days, 30);
    expect(o.daysDone).toBe(2);
    expect(o.avgPerDay).toBe(300);
    expect(o.projected).toBe(600 + 300 * 28);
  });
  it('a finished month: projected = what it cost', () => {
    const days = Array.from({ length: 30 }, (_, i) => day(i + 1, 100 + i));
    const o = monthOutlook(days);
    expect(o.projected).toBe(o.soFar);
  });
  it('no readings at all: nothing to project from', () => {
    expect(monthOutlook([], 30)).toEqual({ daysDone: 0, daysInMonth: 30, soFar: 0, avgPerDay: null, projected: null });
  });
  it('works on kWh too', () => {
    expect(monthOutlook([day(1, 300), day(2, 100)], 4, (d) => d.kwh).projected).toBeCloseTo(80);
  });
});
