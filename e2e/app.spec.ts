// The whole app in a real browser (iPhone engine + Chrome) with Octopus and Hive played by this file.
// Nothing here reaches the real Octopus or Hive: every request to them is answered below, anything else fails the test.
import { expect, test, type Page, type Route } from '@playwright/test';

const ACCOUNT = 'A-1234ABCD';
const H = 3_600_000;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

// UK midnight of a date (test-side copy, kept deliberately simple: Intl does the zone sums).
function londonMidnight(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23', day: '2-digit' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const off = Number(p.day) !== d ? -(24 - Number(p.hour)) : Number(p.hour);
  return guess - off * H;
}
const ukToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const addDays = (k: string, n: number) => new Date(Date.parse(`${k}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const week = (t: number[]) => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [
  { start: 390, value: { target: t[0] } }, { start: 510, value: { target: 16 } }, { start: 1020, value: { target: 20 } }, { start: 1350, value: { target: 15 } },
]]));

// Hot water as Hive keeps it: on 06:30–07:30 and 17:00–18:00 every day.
const waterWeek = () => Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, [
  { start: 390, value: { status: 'ON' } }, { start: 450, value: { status: 'OFF' } }, { start: 1020, value: { status: 'ON' } }, { start: 1080, value: { status: 'OFF' } },
]]));

interface Fake { heating: any; water: any; posts: any[]; waterPosts: any[]; octopusCalls: string[] }

async function fakeServices(page: Page, opts: { hive?: boolean; water?: boolean } = {}): Promise<Fake> {
  const f: Fake = {
    heating: { id: 'h1', type: 'heating', parent: 'd1', state: { name: 'Heating', mode: 'SCHEDULE', target: 20, schedule: week([20]) }, props: { temperature: 19.43, working: true, zone: 'z1', previous: { mode: 'SCHEDULE' } } },
    water: { id: 'hw', type: 'hotwater', parent: 'bm1', state: { name: 'Hot water', mode: 'SCHEDULE', status: 'OFF', boost: null, schedule: waterWeek() }, props: { online: true, maxEvents: 6, capabilities: ['BOOST', 'HOLIDAY_MODE'], previous: { mode: 'OFF' } } },
    posts: [], waterPosts: [], octopusCalls: [],
  };
  // Anything else on the internet = a request this app should not make. (Registered first: Playwright asks the newest route first.)
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  const endOfYesterday = londonMidnight(ukToday());
  await page.route(/^https:\/\/api\.octopus\.energy\//, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    f.octopusCalls.push(url.pathname);
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const auth = req.headers()['authorization'];
    if (url.pathname === `/v1/accounts/${ACCOUNT}/`) {
      if (auth !== `Basic ${Buffer.from('sk_live_test:').toString('base64')}`) return json({ detail: 'no' }, 401);
      return json({
        number: ACCOUNT,
        properties: [{
          moved_in_at: '2022-01-01T00:00:00Z', moved_out_at: null,
          electricity_meter_points: [{ mpan: '1100000000001', is_export: false, meters: [{ serial_number: 'E1' }], agreements: [{ tariff_code: 'E-1R-AGILE-24-10-01-C', valid_from: '2024-01-01T00:00:00Z', valid_to: null }] }],
          gas_meter_points: [{ mprn: '9999', meters: [{ serial_number: 'G1' }], agreements: [{ tariff_code: 'G-1R-VAR-22-11-01-C', valid_from: '2024-01-01T00:00:00Z', valid_to: null }] }],
        }],
      });
    }
    const from = Date.parse(url.searchParams.get('period_from') ?? '');
    const to = Date.parse(url.searchParams.get('period_to') ?? '');
    if (/consumption/.test(url.pathname)) {
      const gas = url.pathname.includes('gas-meter-points');
      const rows = [];
      for (let t = from; t < Math.min(to, endOfYesterday); t += H / 2) rows.push({ consumption: gas ? 0.1 : 0.2, interval_start: new Date(t).toISOString(), interval_end: new Date(t + H / 2).toISOString() });
      return json({ count: rows.length, next: null, results: rows });
    }
    if (/standard-unit-rates/.test(url.pathname) && url.pathname.includes('AGILE')) {
      const rows = [];
      for (let t = from; t < to; t += H / 2) {
        const hr = new Date(t).getUTCHours();
        rows.push({ value_exc_vat: 0, value_inc_vat: hr >= 2 && hr < 5 ? 8 : hr >= 16 && hr < 19 ? 35 : 20, valid_from: new Date(t).toISOString(), valid_to: new Date(t + H / 2).toISOString(), payment_method: null });
      }
      return json({ count: rows.length, next: null, results: rows.reverse() });
    }
    if (/standard-unit-rates/.test(url.pathname)) return json({ count: 2, next: null, results: [{ value_inc_vat: 6, valid_from: '2025-01-01T00:00:00Z', valid_to: null, payment_method: 'DIRECT_DEBIT' }, { value_inc_vat: 7, valid_from: '2025-01-01T00:00:00Z', valid_to: null, payment_method: 'NON_DIRECT_DEBIT' }] });
    if (/standing-charges/.test(url.pathname)) return json({ count: 1, next: null, results: [{ value_inc_vat: url.pathname.includes('gas') ? 30 : 50, valid_from: '2025-01-01T00:00:00Z', valid_to: null, payment_method: null }] });
    if (url.pathname === '/v1/products/AGILE-24-10-01/') return json({ display_name: 'Agile Octopus', full_name: 'Agile Octopus October 2024 v1', is_variable: true });
    if (url.pathname === '/v1/products/VAR-22-11-01/') return json({ display_name: 'Flexible Octopus', full_name: 'Flexible Octopus November 2022 v1', is_variable: true });
    return json({ detail: 'Not found.' }, 404);
  });
  await page.route(/^https:\/\/beekeeper\.hivehome\.com\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers()['authorization'] !== 'test-token') return route.fulfill({ status: 401, headers: cors, body: '{}' });
    const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      const path = new URL(req.url()).pathname;
      if (path === '/1.0/nodes/hotwater/hw') {
        f.waterPosts.push(body);
        const ws = f.water.state;
        if (body.schedule) ws.schedule = body.schedule;
        if (body.mode) { if (body.mode === 'BOOST') f.water.props.previous = { mode: ws.mode }; ws.mode = body.mode; ws.boost = body.mode === 'BOOST' ? body.boost : null; }
        return json({});
      }
      if (path !== '/1.0/nodes/heating/h1') return route.fulfill({ status: 404, headers: cors, body: '{}' });
      f.posts.push(body);
      const st = f.heating.state;
      if (body.schedule) st.schedule = body.schedule;
      if (body.mode) { if (body.mode === 'BOOST') f.heating.props.previous = { mode: st.mode, target: st.target }; st.mode = body.mode; }
      if (body.target != null) st.target = body.target;
      if (body.boost != null) st.boost = body.boost;
      return json({});
    }
    return json({ products: opts.water === false ? [f.heating] : [f.heating, f.water], devices: [{ id: 'd1', type: 'thermostatui', props: { online: true, zone: 'z1' } }] });
  });
  await page.addInitScript(({ hive }) => {
    if (hive && !sessionStorage.getItem('seeded')) { localStorage.setItem('energy-hive-test-token', 'test-token'); sessionStorage.setItem('seeded', '1'); }
  }, { hive: opts.hive ?? true });
  return f;
}

// First visit loads the page; after that, move between screens like a tapped link does (only the # part changes).
async function open(page: Page, hash: string) {
  if (!page.url().startsWith('http')) return void (await page.goto(hash));
  await page.evaluate((h) => { location.hash = h; }, hash);
  await expect(page).toHaveURL(new RegExp(hash.replace(/[/#]/g, '\\$&') + '$'));
}

async function connectOctopus(page: Page) {
  await open(page, '#/settings');
  await page.getByLabel('Account number').fill(ACCOUNT.toLowerCase());
  await page.getByLabel('API key').fill('sk_live_test');
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(page.getByText('Connected. Found an electricity meter and a gas meter.')).toBeVisible();
}

test('a wrong Octopus key is told plainly, and nothing is saved', async ({ page }) => {
  await fakeServices(page);
  await open(page, '#/settings');
  await page.getByLabel('Account number').fill(ACCOUNT);
  await page.getByLabel('API key').fill('sk_live_wrong');
  await page.getByRole('button', { name: 'Save and check' }).click();
  await expect(page.getByText('Octopus did not accept the API key.')).toBeVisible();
  await open(page, '#/usage');
  await expect(page.getByText('Add your Octopus account number and API key')).toBeVisible();
});

test('usage: a gas day is worked out like the bill (m³ → kWh × price + standing charge)', async ({ page }) => {
  await fakeServices(page);
  await connectOctopus(page);
  await open(page, '#/usage');
  await page.getByRole('radio', { name: 'Gas' }).click();
  await page.getByRole('radio', { name: 'Day' }).click();
  // 48 half hours × 0.1 m³ = 4.8 m³ × 1.02264 × 39.5 ÷ 3.6 = 53.859 kWh; × 6p = 323.15p; + 30p standing = £3.53
  await expect(page.locator('.big-number')).toHaveText('£3.53');
  await page.getByRole('radio', { name: 'kWh' }).click();
  await expect(page.locator('.big-number')).toHaveText('53.9 kWh');
  // Electricity on Agile, one day: each half hour at its own price. 0.2 kWh × (6×8 + 6×35 + 36×20)p = 195.6p + 50p
  await page.getByRole('radio', { name: 'Electricity' }).click();
  await page.getByRole('radio', { name: '£' }).click();
  await expect(page.locator('.big-number')).toHaveText('£2.46');
});

test('usage week view, both fuels, with the day picked by tapping a bar', async ({ page }) => {
  await fakeServices(page);
  await connectOctopus(page);
  await open(page, '#/usage');
  await expect(page.locator('.legend')).toContainText('Electricity');
  await expect(page.locator('.legend')).toContainText('Gas');
  await page.locator('.chart .bar').first().click();
  await expect(page.locator('.pick-line')).toContainText('£');
  await expect(page.getByText(/is standing charge/)).toBeVisible();
  await expect(page.getByText(/^Readings up to the end of (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ [A-Z][a-z]{2}\./)).toBeVisible();
});

test('heating week: change Saturday, copy it to Sunday, send — Hive gets the whole week with exactly that change', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/schedule');
  await expect(page.locator('.dayrow')).toHaveCount(7);
  await page.locator('a.dayrow[href="#/day/saturday"]').click();
  await expect(page.getByRole('heading', { name: 'Saturday', exact: true })).toBeVisible();
  const first = page.locator('.slots li').first();
  await first.getByRole('button', { name: 'Raise temperature' }).click();
  await first.getByRole('button', { name: 'Raise temperature' }).click();
  await first.locator('input[type=time]').fill('08:00');
  await page.getByRole('button', { name: 'Weekend' }).click();
  await expect(page.getByText('Copied to Sun.')).toBeVisible();
  await page.getByRole('button', { name: 'Done — back to the week' }).click();
  await expect(page.locator('.sendbar')).toContainText('Sat, Sun changed');
  expect(f.posts).toEqual([]); // nothing sent yet
  await page.getByRole('button', { name: 'Send to Hive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Saved on Hive.')).toBeVisible();
  expect(f.posts).toHaveLength(1);
  const sent = f.posts[0].schedule;
  expect(Object.keys(f.posts[0])).toEqual(['schedule']);
  expect(sent.saturday[0]).toEqual({ start: 480, value: { target: 21 } });
  expect(sent.sunday[0]).toEqual({ start: 480, value: { target: 21 } });
  expect(sent.friday).toEqual(week([20]).friday);
  await expect(page.locator('.sendbar')).toHaveCount(0);
});

test('heating week: an unfinished edit survives closing the app, and Undo puts it back', async ({ page }) => {
  await fakeServices(page);
  await open(page, '#/day/monday');
  await page.locator('.slots li').first().getByRole('button', { name: 'Lower temperature' }).click();
  await page.reload();
  await open(page, '#/schedule');
  await expect(page.locator('.sendbar')).toContainText('Mon changed');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.sendbar')).toHaveCount(0);
});

test('heating week: two changes at the same time cannot be sent', async ({ page }) => {
  await fakeServices(page);
  await open(page, '#/day/tuesday');
  await page.locator('.slots li').nth(1).locator('input[type=time]').fill('06:30');
  await expect(page.getByText('Two changes are at the same time.')).toBeVisible();
  await open(page, '#/schedule');
  await expect(page.getByRole('button', { name: 'Send to Hive' })).toBeDisabled();
});

test('saved weeks: keep the week, change it, then use the saved one again', async ({ page }) => {
  await fakeServices(page);
  await open(page, '#/schedule');
  await page.getByLabel('Name for this week').fill('Winter');
  await page.getByRole('button', { name: 'Save this week' }).click();
  await expect(page.locator('.list-row')).toContainText('Winter');
  await open(page, '#/day/wednesday');
  await page.locator('.slots li').first().getByRole('button', { name: 'Raise temperature' }).click();
  await open(page, '#/schedule');
  await expect(page.locator('.sendbar')).toContainText('Wed changed');
  await page.getByRole('button', { name: 'Use' }).click();
  await expect(page.locator('.sendbar')).toHaveCount(0);
});

test('now: room temperature, boiler on, boost for an hour sends exactly that', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/now');
  await expect(page.locator('.huge').first()).toHaveText('19.4°');
  await expect(page.getByText('Boiler heating now')).toBeVisible();
  await page.getByRole('button', { name: '1 h' }).click();
  await page.getByRole('button', { name: 'Boost', exact: true }).click();
  await expect(page.getByText(/Boost: 60 min left/)).toBeVisible();
  expect(f.posts).toEqual([{ mode: 'BOOST', boost: 60, target: 21 }]);
  await page.getByRole('button', { name: 'Stop boost' }).click();
  await expect(page.getByText(/Boost:/)).toHaveCount(0);
  expect(f.posts[1]).toEqual({ mode: 'SCHEDULE' });
});

test('now: switch to Manual at a chosen temperature', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/now');
  await page.getByRole('radio', { name: 'Manual' }).click();
  await expect(page.getByRole('button', { name: 'Set' })).toBeVisible();
  expect(f.posts[0]).toEqual({ mode: 'MANUAL', target: 20 });
  await page.getByRole('button', { name: 'Raise temperature' }).click();
  await page.getByRole('button', { name: 'Set' }).click();
  await expect.poll(() => f.posts.length).toBe(2);
  expect(f.posts[1]).toEqual({ target: 20.5 });
});

test('hot water: the week as Hive has it, always on, back to schedule, boost and stop — each sends exactly that', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/water');
  await expect(page.getByRole('heading', { name: 'Hot water', exact: true })).toBeVisible();
  await expect(page.locator('.dayrow')).toHaveCount(7);
  await expect(page.locator('.dayrow').first()).toContainText('06:30–07:30, 17:00–18:00 · 2 h');
  await expect(page.getByText('On for 14 h a week in all.')).toBeVisible();
  await expect(page.getByText('How hot the water gets is not set here.')).toBeVisible();
  expect(f.waterPosts).toEqual([]);

  await page.getByRole('radio', { name: 'Always on' }).click();
  await expect(page.getByText('On all the time until you change it.')).toBeVisible();
  await expect(page.locator('.huge').first()).toHaveText('On');
  await expect(page.getByText(/so it is not following this week/)).toBeVisible();
  expect(f.waterPosts).toEqual([{ mode: 'MANUAL' }]);

  await page.getByRole('radio', { name: 'Off', exact: true }).click();
  await expect(page.getByText('Off until you change it.')).toBeVisible();
  await expect(page.locator('.huge').first()).toHaveText('Off');
  expect(f.waterPosts[1]).toEqual({ mode: 'OFF' });

  await page.getByRole('radio', { name: 'Schedule' }).click();
  await expect(page.getByText(/^Goes (on|off) at \d\d:\d\d/)).toBeVisible();
  expect(f.waterPosts[2]).toEqual({ mode: 'SCHEDULE' });

  await page.getByRole('button', { name: '30 min' }).click();
  await page.getByRole('button', { name: 'Boost', exact: true }).click();
  await expect(page.getByText('Boosting: 30 min left')).toBeVisible();
  await expect(page.locator('.huge').first()).toHaveText('On');
  expect(f.waterPosts[3]).toEqual({ mode: 'BOOST', boost: 30 });
  await page.getByRole('button', { name: 'Stop boost' }).click();
  await expect(page.getByText(/Boosting/)).toHaveCount(0);
  expect(f.waterPosts[4]).toEqual({ mode: 'SCHEDULE' });
  expect(f.posts).toEqual([]); // the heating was never touched
});

test('hot water week: change Saturday, copy to Sunday, send — Hive gets the whole week with exactly that change', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/water');
  await page.locator('a.dayrow[href="#/water/saturday"]').click();
  await expect(page.getByRole('heading', { name: 'Saturday hot water' })).toBeVisible();
  // The lines stay in time order, so move the "off" later first, then the "on".
  await page.locator('.slots li').nth(1).locator('input[type=time]').fill('09:30');
  await page.locator('.slots li').first().locator('input[type=time]').fill('08:00');
  await expect(page.getByText('08:00–09:30, 17:00–18:00')).toBeVisible();
  await page.locator('.slots li').nth(2).getByRole('radio', { name: 'Off' }).click(); // the evening goes
  await expect(page.getByText('08:00–09:30.')).toBeVisible();
  await page.getByRole('button', { name: 'Weekend' }).click();
  await expect(page.getByText('Copied to Sun.')).toBeVisible();
  await page.getByRole('button', { name: 'Done — back to hot water' }).click();
  await expect(page.locator('.sendbar')).toContainText('Sat, Sun changed');
  expect(f.waterPosts).toEqual([]); // nothing sent yet
  await page.reload(); // an unfinished edit survives closing the app
  await expect(page.locator('.sendbar')).toContainText('Sat, Sun changed');
  await page.getByRole('button', { name: 'Send to Hive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Saved on Hive.')).toBeVisible();
  expect(f.waterPosts).toHaveLength(1);
  expect(Object.keys(f.waterPosts[0])).toEqual(['schedule']);
  const sent = f.waterPosts[0].schedule;
  const want = [{ start: 480, value: { status: 'ON' } }, { start: 570, value: { status: 'OFF' } }, { start: 1020, value: { status: 'OFF' } }, { start: 1080, value: { status: 'OFF' } }];
  expect(sent.saturday).toEqual(want);
  expect(sent.sunday).toEqual(want);
  expect(sent.friday).toEqual(waterWeek().friday);
  await expect(page.locator('.sendbar')).toHaveCount(0);
  expect(f.posts).toEqual([]);
});

test('hot water week: two lines at the same time cannot be sent, and Undo puts the week back', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/water/tuesday');
  await page.locator('.slots li').nth(1).locator('input[type=time]').fill('06:30');
  await expect(page.getByText('Two lines are at the same time.')).toBeVisible();
  await open(page, '#/water');
  await expect(page.getByRole('button', { name: 'Send to Hive' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.sendbar')).toHaveCount(0);
  expect(f.waterPosts).toEqual([]);
});

test('hot water on the Now screen: heat water for an hour sends exactly that', async ({ page }) => {
  const f = await fakeServices(page);
  await open(page, '#/now');
  await expect(page.locator('.water-card')).toContainText(/(On|Off) now · schedule/);
  await page.getByRole('button', { name: 'Heat water for an hour' }).click();
  await expect(page.locator('.water-card')).toContainText('On now · boosting, 60 min left');
  expect(f.waterPosts).toEqual([{ mode: 'BOOST', boost: 60 }]);
  expect(f.posts).toEqual([]);
});

test('a house where Hive lists no hot water (combi boiler): said plainly, nothing to press, nothing sent', async ({ page }) => {
  const f = await fakeServices(page, { water: false });
  await open(page, '#/water');
  await expect(page.getByText('Hive does not list hot water for this house.')).toBeVisible();
  await expect(page.locator('.dayrow')).toHaveCount(0);
  await open(page, '#/now');
  await expect(page.getByText('Boiler heating now')).toBeVisible();
  await expect(page.locator('.water-card')).toHaveCount(0);
  expect(f.waterPosts).toEqual([]);
});

test('prices: Agile shows today\'s half-hour prices and the cheapest 3 hours; gas its flat price', async ({ page }) => {
  await fakeServices(page);
  await connectOctopus(page);
  await open(page, '#/prices');
  await expect(page.getByText('Agile Octopus').first()).toBeVisible();
  await expect(page.getByText('Flexible Octopus').first()).toBeVisible();
  await expect(page.getByText(/Cheapest 3 hours ahead/)).toBeVisible();
  await expect(page.locator('section.card').nth(1)).toContainText('6p');
  await expect(page.locator('section.card').nth(1)).toContainText('30p');
});

test('not signed in to Hive: the sign-in form, and no Hive request is made', async ({ page }) => {
  let hiveCalls = 0;
  page.on('request', (r) => { if (r.url().includes('hivehome.com')) hiveCalls++; });
  await fakeServices(page, { hive: false });
  await open(page, '#/schedule');
  await expect(page.getByText('Sign in to Hive to see and change the heating schedule.')).toBeVisible();
  await open(page, '#/water');
  await expect(page.getByText('Sign in to Hive to see and change the hot water.')).toBeVisible();
  await open(page, '#/settings');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  expect(hiveCalls).toBe(0);
});

test('the Hive sign-in library loads and starts in the browser (no Node-only parts missing)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let cognito = 0;
  await fakeServices(page, { hive: false });
  // Hive's sign-in service answers "wrong password" so the whole first step runs in the page.
  await page.route('https://sso.hivehome.com/', (r) => r.fulfill({ status: 200, headers: cors, body: "<script>window.HiveSSOPoolId = 'eu-west-1_TestPool'\nwindow.HiveSSOPublicCognitoClientId = 'testclient'</script>" }));
  await page.route('https://cognito-idp.eu-west-1.amazonaws.com/', async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    cognito++;
    const target = r.request().headers()['x-amz-target'];
    const body = r.request().postDataJSON();
    expect(target).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    expect(body.AuthFlow).toBe('USER_SRP_AUTH');
    expect(body.ClientId).toBe('testclient');
    expect(body.AuthParameters.USERNAME).toBe('someone@example.com');
    expect(body.AuthParameters.SRP_A).toMatch(/^[0-9a-f]{200,}$/);
    return r.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/x-amz-json-1.1', 'x-amzn-errortype': 'NotAuthorizedException' }, body: JSON.stringify({ __type: 'NotAuthorizedException', message: 'Incorrect username or password.' }) });
  });
  await open(page, '#/settings');
  await page.getByLabel('Email').fill(' Someone@Example.com ');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Hive did not accept that email and password.')).toBeVisible();
  expect(cognito).toBe(1);
  expect(errors).toEqual([]);
});

test('another device: set up once, copy, paste on the other — Octopus + weeks come across, Hive sign-in does not', async ({ browser, browserName }) => {
  // Device A: set up, save a week, copy.
  const a = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Europe/London' });
  if (browserName === 'chromium') await a.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pa = await a.newPage();
  await fakeServices(pa);
  await connectOctopus(pa);
  await open(pa, '#/schedule');
  await pa.getByLabel('Name for this week').fill('Winter');
  await pa.getByRole('button', { name: 'Save this week' }).click();
  await open(pa, '#/settings');
  await pa.getByRole('button', { name: 'Copy settings for another device' }).click();
  const box = pa.getByLabel('Your settings code');
  if (!(await box.isVisible())) await pa.getByText(/Show the code|Copying did not work/).click();
  const code = await box.inputValue();
  expect(code).toMatch(/^HOMEENERGY-1:/);
  if (browserName === 'chromium') expect(await pa.evaluate(() => navigator.clipboard.readText())).toBe(code);

  // Device B: brand new, not signed in to anything.
  const b = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'Africa/Johannesburg' });
  const pb = await b.newPage();
  await fakeServices(pb, { hive: false });
  await pb.goto('#/settings');
  await expect(pb.getByRole('button', { name: 'Paste settings from my other device' })).toBeVisible();
  await pb.getByLabel('Settings code').fill(`\n${code} `);
  await pb.getByRole('button', { name: 'Use these settings' }).click();
  await expect(pb.getByText(/Done: Octopus details, bill settings, 1 saved week taken over/)).toBeVisible();
  await expect(pb.getByLabel('Account number')).toHaveValue('A-1234ABCD');
  await expect(pb.getByLabel('Email')).toBeVisible(); // Hive: still to sign in on this device
  await open(pb, '#/usage');
  await expect(pb.locator('.big-number')).toHaveText(/£/);
  await open(pb, '#/schedule');
  await expect(pb.getByText('Sign in to Hive to see and change the heating schedule.')).toBeVisible();
  await a.close(); await b.close();
});
