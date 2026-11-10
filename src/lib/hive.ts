// Hive (British Gas) heating. Hive has no official public API: this uses the same route as Hive's own app and
// the Home Assistant Hive integration (pyhiveapi). If Hive changes it, this part stops working until it is updated.
// Sign-in: Hive's Amazon Cognito user pool (email + password, then a code by text message). After the first
// sign-in this phone is "remembered" by Hive and stays signed in on its own (the password is never stored).

import { AuthenticationDetails, CognitoUser, CognitoUserPool, type CognitoUserSession } from 'amazon-cognito-identity-js';
import { fromHive, toHive, sameDay, type Week } from './schedule';
import { DAYS } from './time';

export const BEEKEEPER = 'https://beekeeper.hivehome.com/1.0';
const SSO = 'https://sso.hivehome.com/';
// What sso.hivehome.com said on 10/11/2026; it is asked again at every sign-in in case Hive changes it.
const FALLBACK = { pool: 'eu-west-1_SamNfoWtf', client: '3rl4i0ajrmtdm8sbre54p9dvd9' };
const POOL_KEY = 'energy-hive-pool';
const TEST_TOKEN_KEY = 'energy-hive-test-token'; // the browser tests stand in for Hive with this; real Hive refuses it

export class HiveError extends Error {
  constructor(public why: 'signin' | 'sms' | 'network' | 'hive' | 'notfound' | 'format', message: string) { super(message); }
}

function savedPool(): { pool: string; client: string } {
  try { const j = JSON.parse(localStorage.getItem(POOL_KEY) ?? ''); if (j?.pool && j?.client) return j; } catch { /* none yet */ }
  return FALLBACK;
}
async function freshPool(): Promise<{ pool: string; client: string }> {
  try {
    const html = await (await fetch(SSO)).text();
    const pool = /HiveSSOPoolId\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1];
    const client = /HiveSSOPublicCognitoClientId\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1];
    if (pool && client) return { pool, client };
  } catch { /* use the last known one */ }
  return savedPool();
}
const userPool = (c = savedPool()) => new CognitoUserPool({ UserPoolId: c.pool, ClientId: c.client });

export function isSignedIn(): boolean {
  try { if (localStorage.getItem(TEST_TOKEN_KEY)) return true; } catch { /* ignore */ }
  return !!userPool().getCurrentUser();
}
export function signedInAs(): string | null {
  try { if (localStorage.getItem(TEST_TOKEN_KEY)) return 'test@example.com'; } catch { /* ignore */ }
  return userPool().getCurrentUser()?.getUsername() ?? null;
}

export type SignInStep = { done: true } | { done: false; sentTo: string; code: (code: string) => Promise<SignInStep> };

function rememberDevice(user: CognitoUser, confirmNeeded: boolean): Promise<void> {
  if (!confirmNeeded) return Promise.resolve();
  return new Promise((resolve) => user.setDeviceStatusRemembered({ onSuccess: () => resolve(), onFailure: () => resolve() }));
}

function plain(err: any): HiveError {
  const code = err?.code ?? err?.name ?? '';
  if (code === 'NotAuthorizedException' || code === 'UserNotFoundException') return new HiveError('signin', 'Hive did not accept that email and password.');
  if (code === 'CodeMismatchException') return new HiveError('sms', 'That code was not right. Check the text message and try again.');
  if (code === 'ExpiredCodeException') return new HiveError('sms', 'That code has expired. Start the sign-in again for a new one.');
  if (code === 'LimitExceededException' || code === 'TooManyRequestsException') return new HiveError('signin', 'Hive says too many tries. Wait a few minutes.');
  if (code === 'NetworkError' || /network/i.test(String(err?.message))) return new HiveError('network', 'Could not reach Hive. Check the phone has internet.');
  return new HiveError('signin', `Hive sign-in failed: ${err?.message ?? code ?? 'unknown reason'}`);
}

/** Step 1: email + password. Hive then normally texts a code (step 2, `code`). */
export async function signIn(email: string, password: string): Promise<SignInStep> {
  const conf = await freshPool();
  const user = new CognitoUser({ Username: email.trim().toLowerCase(), Pool: userPool(conf) });
  const details = new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password });
  const finish = async (confirmNeeded: boolean): Promise<SignInStep> => {
    localStorage.setItem(POOL_KEY, JSON.stringify(conf));
    await rememberDevice(user, confirmNeeded);
    return { done: true };
  };
  return new Promise<SignInStep>((resolve, reject) => {
    const afterCode = (challenge: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA') => (code: string) =>
      new Promise<SignInStep>((res, rej) =>
        user.sendMFACode(code.trim(), { onSuccess: (_s: CognitoUserSession, c?: boolean) => finish(!!c).then(res, rej), onFailure: (e: any) => rej(plain(e)) }, challenge),
      );
    user.authenticateUser(details, {
      onSuccess: (_s, confirmNeeded) => finish(!!confirmNeeded).then(resolve, reject),
      onFailure: (e) => reject(plain(e)),
      mfaRequired: (_name, params) => resolve({ done: false, sentTo: params?.CODE_DELIVERY_DESTINATION ?? 'your phone', code: afterCode('SMS_MFA') }),
      totpRequired: () => resolve({ done: false, sentTo: 'your authenticator app', code: afterCode('SOFTWARE_TOKEN_MFA') }),
      selectMFAType: () => user.sendMFASelectionAnswer('SMS_MFA', {
        onSuccess: (_s: CognitoUserSession) => finish(false).then(resolve, reject),
        onFailure: (e: any) => reject(plain(e)),
        mfaRequired: (_n: string, p: any) => resolve({ done: false, sentTo: p?.CODE_DELIVERY_DESTINATION ?? 'your phone', code: afterCode('SMS_MFA') }),
      } as any),
      newPasswordRequired: () => reject(new HiveError('signin', 'Hive wants a new password first. Set it in the Hive app, then sign in here.')),
    });
  });
}

export function signOut() {
  try { localStorage.removeItem(TEST_TOKEN_KEY); } catch { /* ignore */ }
  userPool().getCurrentUser()?.signOut();
}

/** The sign-in pass Hive's servers want (refreshed automatically when it runs out). */
function token(forceRefresh = false): Promise<string> {
  try { const t = localStorage.getItem(TEST_TOKEN_KEY); if (t) return Promise.resolve(t); } catch { /* ignore */ }
  const user = userPool().getCurrentUser();
  if (!user) return Promise.reject(new HiveError('signin', 'Not signed in to Hive on this phone.'));
  return new Promise((resolve, reject) =>
    user.getSession((err: any, session: CognitoUserSession | null) => {
      if (err || !session) return reject(new HiveError('signin', 'Hive signed this phone out. Sign in again (Settings).'));
      if (!forceRefresh) return resolve(session.getIdToken().getJwtToken());
      user.refreshSession(session.getRefreshToken(), (e: any, s: CognitoUserSession) => (e || !s ? reject(new HiveError('signin', 'Hive signed this phone out. Sign in again (Settings).')) : resolve(s.getIdToken().getJwtToken())));
    }),
  );
}

async function bee(path: string, init: { method?: string; body?: unknown } = {}, retried = false): Promise<any> {
  const t = await token(retried);
  let r: Response;
  try {
    r = await fetch(`${BEEKEEPER}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Accept: '*/*', Authorization: t },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new HiveError('network', 'Could not reach Hive. Check the phone has internet.');
  }
  if ((r.status === 401 || r.status === 403) && !retried) return bee(path, init, true);
  if (r.status === 401 || r.status === 403) throw new HiveError('signin', 'Hive signed this phone out. Sign in again (Settings).');
  if (!r.ok) throw new HiveError('hive', `Hive answered with an error (${r.status}). Nothing was changed if you were saving; try again.`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export type HeatMode = 'SCHEDULE' | 'MANUAL' | 'OFF' | 'BOOST';
export interface Heating {
  id: string; type: string; name: string;
  mode: HeatMode; target: number | null; current: number | null;
  /** True while the boiler is actually heating. */
  working: boolean | null;
  boostMinutes: number | null;
  previousMode: HeatMode | null; previousTarget: number | null;
  online: boolean | null;
  minTemp: number; maxTemp: number;
  schedule: Week | null;
  raw: any;
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function listOf(j: any, k: 'products' | 'devices'): any[] {
  if (Array.isArray(j?.[k])) return j[k];
  if (Array.isArray(j)) return j.filter((x) => (k === 'products' ? x?.type && x?.state : x?.type && !x?.state));
  return [];
}

export function parseHeating(j: any): Heating[] {
  const products = listOf(j, 'products');
  const devices = listOf(j, 'devices');
  return products
    .filter((p) => p?.type === 'heating' || p?.type === 'nathermostat')
    .map((p) => {
      const st = p.state ?? {}, pr = p.props ?? {};
      const dev = devices.find((d) => d?.id === pr.zone || d?.props?.zone === pr.zone) ?? devices.find((d) => d?.id === p.parent);
      const online = typeof pr.online === 'boolean' ? pr.online : typeof dev?.props?.online === 'boolean' ? dev.props.online : null;
      return {
        id: p.id, type: p.type, name: st.name ?? pr.name ?? 'Heating',
        mode: (st.mode ?? 'SCHEDULE') as HeatMode,
        target: n(st.target ?? st.heat), current: n(pr.temperature),
        working: typeof pr.working === 'boolean' ? pr.working : null,
        boostMinutes: st.mode === 'BOOST' ? n(st.boost) : null,
        previousMode: (pr.previous?.mode ?? null) as HeatMode | null, previousTarget: n(pr.previous?.target),
        online,
        minTemp: n(pr.minHeat) ?? 5, maxTemp: n(pr.maxHeat) ?? 32,
        schedule: fromHive(st.schedule),
        raw: p,
      };
    });
}

export async function getHeating(): Promise<Heating[]> {
  return parseHeating(await bee('/nodes/all?products=true&devices=true&actions=true'));
}

async function change(h: Heating, body: Record<string, unknown>): Promise<Heating> {
  await bee(`/nodes/${h.type}/${h.id}`, { method: 'POST', body });
  const after = (await getHeating()).find((x) => x.id === h.id);
  if (!after) throw new HiveError('notfound', 'Hive no longer lists this thermostat.');
  return after;
}

export const setMode = (h: Heating, mode: 'SCHEDULE' | 'MANUAL' | 'OFF', target?: number) =>
  change(h, mode === 'MANUAL' && target != null ? { mode, target } : { mode });
export const setTarget = (h: Heating, target: number) => change(h, { target });
export const boost = (h: Heating, minutes: number, target: number) => change(h, { mode: 'BOOST', boost: minutes, target });
export function stopBoost(h: Heating) {
  const prev = h.previousMode && h.previousMode !== 'BOOST' ? h.previousMode : 'SCHEDULE';
  return change(h, prev === 'MANUAL' || prev === 'OFF' ? { mode: prev, target: h.previousTarget ?? 7 } : { mode: prev });
}

/** Sends the whole week and reads it back: only "saved" when Hive shows exactly what was sent. */
export async function sendSchedule(h: Heating, week: Week): Promise<Heating> {
  if (!h.schedule) throw new HiveError('format', 'Hive sent a schedule this app does not understand, so it will not overwrite it.');
  const after = await change(h, { schedule: toHive(week) });
  if (!after.schedule || DAYS.some((d) => !sameDay(after.schedule![d], week[d]))) {
    throw new HiveError('hive', 'Hive took the change but shows a different schedule. Pull down to reload and check before trying again.');
  }
  return after;
}

/** What Hive sent about the thermostat, for fixing this app if Hive changes something. No sign-in pass inside. */
export function snapshot(list: Heating[]): string {
  return JSON.stringify(list.map((h) => h.raw), null, 2);
}
