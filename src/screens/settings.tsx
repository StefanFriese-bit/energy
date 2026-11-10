import { useState } from 'preact/hooks';
import { getAccount } from '../lib/data';
import { isSignedIn, signedInAs, signIn, signOut, snapshot, HiveError, type SignInStep } from '../lib/hive';
import { reloadHeating, useHeating } from '../lib/heating-state';
import { isTwoRate } from '../lib/cost';
import type { Account } from '../lib/octopus';
import { updateSettings } from '../lib/store';
import { Problem, Segment, useStore } from '../ui';

const API_PAGE = 'https://octopus.energy/dashboard/new/accounts/personal-details/api-access';

export function SettingsScreen() {
  return (
    <>
      <h1>Settings</h1>
      <p class="small">Everything here stays on this phone. The app talks only to Octopus and Hive, directly.</p>
      <OctopusSettings />
      <HiveSettings />
      <section class="card">
        <b>About</b>
        <p class="small">Home Energy, built {__BUILD_DATE__}. Prices include VAT. Gas in kWh = m³ × 1.02264 × calorific value ÷ 3.6, the same sum as on the bill.</p>
      </section>
    </>
  );
}

function OctopusSettings() {
  const s = useStore().settings;
  const [account, setAccount] = useState(s.octopusAccount);
  const [key, setKey] = useState(s.octopusKey);
  const [show, setShow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<Account | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const check = async () => {
    setChecking(true); setErr(null); setFound(null);
    const next = { ...s, octopusAccount: account.trim().toUpperCase(), octopusKey: key.trim() };
    try {
      const a = await getAccount(next, true);
      updateSettings({ octopusAccount: next.octopusAccount, octopusKey: next.octopusKey });
      setFound(a);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setChecking(false); }
  };
  const twoRate = found?.meters.some((m) => m.agreements.some((a) => isTwoRate(a.tariff)));
  return (
    <section class="card">
      <b>Octopus Energy</b>
      <p class="small">Your account number (A-…) is on any bill. The API key is on <a href={API_PAGE} target="_blank" rel="noopener">Octopus ▸ Personal details ▸ API access</a> (sign in to Octopus, it starts sk_live_).</p>
      <label class="field"><span>Account number</span><input type="text" autocapitalize="characters" autocomplete="off" placeholder="A-1234ABCD" value={account} onInput={(e) => setAccount((e.target as HTMLInputElement).value)} /></label>
      <label class="field"><span>API key</span>
        <div class="with-btn"><input type={(show ? 'text' : 'password') as 'text'} autocomplete="off" autocapitalize="off" spellcheck={false} placeholder="sk_live_…" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
          <button type="button" class="btn small" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div>
      </label>
      <button type="button" class="btn primary" disabled={checking || !account.trim() || !key.trim()} onClick={check}>{checking ? 'Checking…' : 'Save and check'}</button>
      {err && <Problem>{err}</Problem>}
      {found && (
        <p class="good-box">Connected. Found {found.meters.filter((m) => !m.isExport).map((m) => (m.kind === 'electricity' ? 'an electricity meter' : 'a gas meter')).join(' and ') || 'no meters'}{found.meters.some((m) => m.isExport) ? ', plus an export meter' : ''}.</p>
      )}

      <h3>How the bill is worked out</h3>
      <span class="label">You pay by</span>
      <Segment label="Payment" value={s.pay} onChange={(v) => updateSettings({ pay: v })} options={[['DIRECT_DEBIT', 'Direct Debit'], ['NON_DIRECT_DEBIT', 'Other']] as const} />
      <span class="label">Gas meter sends</span>
      <Segment label="Gas unit" value={s.gasUnit} onChange={(v) => updateSettings({ gasUnit: v })} options={[['m3', 'm³ (most smart meters)'], ['kwh', 'kWh (older smart meters)']] as const} />
      <p class="small">If gas looks about 11 times too high or too low, switch this.</p>
      <label class="field"><span>Gas calorific value (MJ/m³, on the bill)</span>
        <input type="number" inputMode="decimal" step="0.1" min="35" max="43" value={s.calorific} onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v >= 35 && v <= 43) updateSettings({ calorific: v }); }} /></label>
      {twoRate && (
        <div class="two">
          <label class="field"><span>Night starts (GMT)</span><input type="time" value={s.nightStart} onChange={(e) => updateSettings({ nightStart: (e.target as HTMLInputElement).value })} /></label>
          <label class="field"><span>Night ends (GMT)</span><input type="time" value={s.nightEnd} onChange={(e) => updateSettings({ nightEnd: (e.target as HTMLInputElement).value })} /></label>
        </div>
      )}
    </section>
  );
}

function HiveSettings() {
  const hs = useHeating();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<SignInStep | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const after = (r: SignInStep) => {
    if (r.done) { setStep(null); setPassword(''); setCode(''); force((x) => x + 1); void reloadHeating(); } else setStep(r);
  };
  const go = async (f: () => Promise<SignInStep>) => {
    setBusy(true); setErr(null);
    try { after(await f()); } catch (e) { setErr(e instanceof HiveError ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (isSignedIn()) {
    return (
      <section class="card">
        <b>Hive</b>
        <p>Signed in as <b>{signedInAs()}</b>{hs.list.length ? ` · ${hs.list.length} thermostat${hs.list.length === 1 ? '' : 's'} found` : ''}.</p>
        {hs.error && <Problem retry={reloadHeating}>{hs.error}</Problem>}
        <div class="actions">
          <button type="button" class="btn" disabled={!hs.list.length} onClick={async () => { await navigator.clipboard.writeText(snapshot(hs.list)); setCopied(true); }}>{copied ? 'Copied ✓' : 'Copy what Hive sent'}</button>
          <button type="button" class="btn danger" onClick={() => { signOut(); force((x) => x + 1); void reloadHeating(); }}>Sign out</button>
        </div>
        <p class="small">"Copy what Hive sent" copies the thermostat's details (no password or sign-in pass) to paste to Claude if something looks wrong.</p>
      </section>
    );
  }
  return (
    <section class="card">
      <b>Hive</b>
      <p class="small">Your usual Hive app email and password. Hive then texts you a code. After that this phone stays signed in; the password is not kept.</p>
      {!step ? (
        <form onSubmit={(e) => { e.preventDefault(); void go(() => signIn(email, password)); }}>
          <label class="field"><span>Email</span><input type="email" autocomplete="username" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></label>
          <label class="field"><span>Password</span><input type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></label>
          <button type="submit" class="btn primary" disabled={busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      ) : !step.done && (
        <form onSubmit={(e) => { e.preventDefault(); void go(() => (step as Extract<SignInStep, { done: false }>).code(code)); }}>
          <p>Hive sent a code to <b>{step.sentTo}</b>.</p>
          <label class="field"><span>Code</span><input type="text" inputMode="numeric" autocomplete="one-time-code" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} /></label>
          <div class="actions">
            <button type="button" class="btn" onClick={() => { setStep(null); setCode(''); }}>Start again</button>
            <button type="submit" class="btn primary" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Confirm'}</button>
          </div>
        </form>
      )}
      {err && <Problem>{err}</Problem>}
      <p class="small">Hive has no official link for apps like this one; it uses the same route as Hive's own app. If Hive changes it, the heating part stops until the app is updated. Octopus is not affected.</p>
    </section>
  );
}
