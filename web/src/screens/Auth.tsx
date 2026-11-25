import { useEffect, useState, type FormEvent } from 'react';
import { TbAlertTriangle } from 'react-icons/tb';
import { api, post } from '../api.ts';
import { PinPad } from '../components/PinPad.tsx';
import { Loading } from '../components/ui.tsx';
import type { Staff } from '../types.ts';

function Logo() {
  return <img src="/icons/icon.svg" alt="" className="logo" />;
}

export function Login({ onIn, go }: { onIn: (s: Staff) => void; go: (p: string) => void }) {
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<'email' | 'pin'>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      onIn((await post<{ staff: Staff }>('/api/login', { email, pin: value })).staff);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1>TA sign in</h1>
        {step === 'email' ? (
          <form className="stack full" onSubmit={(e) => { e.preventDefault(); setStep('pin'); }}>
            <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus /></label>
            <button className="btn btn-primary btn-lg">Continue</button>
          </form>
        ) : (
          <>
            <p className="muted">{email}</p>
            <PinPad value={pin} onChange={setPin} onComplete={submit} disabled={busy} />
            <button className="link" onClick={() => { setStep('email'); setPin(''); setError(null); }}>Use a different email</button>
          </>
        )}
        {error && <p className="error" role="alert"><TbAlertTriangle aria-hidden="true" /> {error}</p>}
        <button className="link" onClick={() => go('/')}>I'm a student</button>
      </div>
    </main>
  );
}

/** A TA opening their invite link chooses a PIN. */
export function AcceptInvite({ token, onIn }: { token: string; onIn: (s: Staff) => void }) {
  const [info, setInfo] = useState<{ name: string; course: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    api<{ name: string; course: string }>(`/api/invites/${encodeURIComponent(token)}`).then(setInfo, (e) => setError((e as Error).message));
  }, [token]);

  const complete = async (value: string) => {
    if (first === null) { setFirst(value); setPin(''); return; }
    if (value !== first) { setError('Those PINs didn\u2019t match. Try again.'); setFirst(null); setPin(''); return; }
    try {
      const r = await post<{ staff: Staff }>(`/api/invites/${encodeURIComponent(token)}`, { pin: value });
      window.history.replaceState(null, '', '/');
      onIn(r.staff);
    } catch (e) {
      setError((e as Error).message);
      setFirst(null);
      setPin('');
    }
  };

  if (!info) return <main className="auth">{error ? <div className="auth-card"><Logo /><p className="error">{error}</p></div> : <Loading />}</main>;
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1>Welcome, {info.name}</h1>
        <p className="muted">You've been added as a TA for <strong>{info.course}</strong>.</p>
        <p className="label">{first === null ? 'Choose a 6-digit PIN' : 'Enter it once more'}</p>
        <PinPad value={pin} onChange={(v) => { setPin(v); setError(null); }} onComplete={complete} />
        {error && <p className="error" role="alert"><TbAlertTriangle aria-hidden="true" /> {error}</p>}
      </div>
    </main>
  );
}

const DEFAULT_TOPICS = 'Programming assignment\nHomework\nLecture concepts\nExam prep\nOther';

/** First run: the course admin creates the course with the setup code. */
export function Setup({ onIn }: { onIn: (s: Staff) => void }) {
  const [form, setForm] = useState({
    setupCode: '', courseName: '', emailDomain: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    topics: DEFAULT_TOPICS, fairnessMinutes: '15', adminName: '', adminEmail: '', adminPin: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ staff: Staff }>('/api/setup', {
        ...form,
        topics: form.topics.split('\n').map((t) => t.trim()).filter(Boolean),
        fairnessMinutes: Number(form.fairnessMinutes),
      });
      onIn(r.staff);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <header className="join-head"><Logo /><h1>Set up your course</h1><p className="muted">You'll do this once. Other TAs join with invite links.</p></header>
      <form className="card stack" onSubmit={submit}>
        <label className="field"><span>Setup code</span><input className="input" value={form.setupCode} onChange={set('setupCode')} required autoComplete="off" /><small className="muted">Printed when you uploaded the secrets.</small></label>
        <h2>Course</h2>
        <label className="field"><span>Course name</span><input className="input" value={form.courseName} onChange={set('courseName')} placeholder="EECE 2540 Fundamentals of Networks · Section 02" maxLength={60} required /></label>
        <label className="field"><span>Student email domain</span><input className="input" value={form.emailDomain} onChange={set('emailDomain')} placeholder="northeastern.edu" /><small className="muted">Students must join with an email at this domain. Leave empty to allow any.</small></label>
        <label className="field"><span>Topics, one per line</span><textarea className="input" rows={5} value={form.topics} onChange={set('topics')} /></label>
        <label className="field"><span>Fairness: extra wait per earlier visit this week (minutes)</span><input className="input" type="number" min={0} max={60} value={form.fairnessMinutes} onChange={set('fairnessMinutes')} /></label>
        <label className="field"><span>Time zone</span><input className="input" value={form.timezone} onChange={set('timezone')} required /></label>
        <h2>You</h2>
        <label className="field"><span>Your name</span><input className="input" value={form.adminName} onChange={set('adminName')} maxLength={40} required /></label>
        <label className="field"><span>Your email</span><input className="input" type="email" value={form.adminEmail} onChange={set('adminEmail')} required /></label>
        <label className="field"><span>Choose a 6-digit PIN</span><input className="input" inputMode="numeric" pattern="\d{6}" maxLength={6} value={form.adminPin} onChange={set('adminPin')} required /></label>
        {error && <p className="error" role="alert"><TbAlertTriangle aria-hidden="true" /> {error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Creating…' : 'Create course'}</button>
      </form>
    </main>
  );
}
