// Asks Octopus's REAL public price lists (no account, no key). Runs only with LIVE=1, never on the publish robot:
//   LIVE=1 npx vitest run tests/live-octopus.test.ts
import { describe, expect, it } from 'vitest';
import { costIntervals, rateFinder, standingForDay, type Agreement } from '../src/lib/cost';
import { fetchRates, fetchProduct } from '../src/lib/octopus';
import { londonMidnight } from '../src/lib/time';

const live = process.env.LIVE === '1' ? describe : describe.skip;
const from = londonMidnight('2026-10-01');
const to = londonMidnight('2026-11-01');

live('Octopus public price lists', () => {
  it('Flexible: a price set before the month is still returned for the month (prices overlap the period)', async () => {
    const r = await fetchRates('E-1R-VAR-22-11-01-C', 'standard-unit-rates', from, to);
    expect(r.length).toBeGreaterThan(0);
    const find = rateFinder(r.filter((x) => !x.pm || x.pm === 'DIRECT_DEBIT'));
    for (const t of [from, from + 15 * 86_400_000, to - 1]) {
      const hit = find(t);
      expect(hit, `a price at ${new Date(t).toISOString()}`).not.toBeNull();
      expect(hit!.p).toBeGreaterThan(5);
      expect(hit!.p).toBeLessThan(80);
    }
    console.log('Flexible C unit prices in Oct 2026:', r.map((x) => `${x.p}p ${x.pm} from ${new Date(x.from).toISOString().slice(0, 10)}`).join('; '));
  }, 30_000);

  it('Flexible gas + standing charges', async () => {
    const unit = await fetchRates('G-1R-VAR-22-11-01-C', 'standard-unit-rates', from, to);
    const sc = await fetchRates('G-1R-VAR-22-11-01-C', 'standing-charges', from, to);
    expect(unit.length).toBeGreaterThan(0);
    expect(sc.length).toBeGreaterThan(0);
    const a: Agreement[] = [{ tariff: 'G-1R-VAR-22-11-01-C', from: 0, to: Infinity }];
    const s = standingForDay('2026-10-15', a, { 'G-1R-VAR-22-11-01-C': { unit, standing: sc } });
    expect(s).toBeGreaterThan(10);
    console.log('Flexible C gas standing charge 15 Oct:', s, 'p/day');
  }, 30_000);

  it('Agile: a whole month of half-hour prices comes back over several pages, every half hour priced', async () => {
    const r = await fetchRates('E-1R-AGILE-24-10-01-C', 'standard-unit-rates', from, to);
    expect(r.length).toBeGreaterThanOrEqual(31 * 48 - 2); // the clocks went back on 25 Oct: 1,490 half hours
    const intervals = [];
    for (let t = from; t < to; t += 1_800_000) intervals.push({ start: t, kwh: 0.5 });
    const c = costIntervals(intervals, [{ tariff: 'E-1R-AGILE-24-10-01-C', from: 0, to: Infinity }], { 'E-1R-AGILE-24-10-01-C': { unit: r, standing: [] } });
    expect(c.length).toBe(31 * 48 + 2);
    expect(c.filter((x) => x.rate == null)).toEqual([]);
    console.log('Agile C Oct 2026:', r.length, 'prices; range', Math.min(...r.map((x) => x.p)), 'to', Math.max(...r.map((x) => x.p)), 'p');
  }, 60_000);

  it('product names', async () => {
    expect((await fetchProduct('VAR-22-11-01'))?.name).toMatch(/Flexible/);
    expect(await fetchProduct('NOT-A-PRODUCT-99')).toBeNull();
  }, 30_000);
});
