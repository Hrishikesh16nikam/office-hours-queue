import { useEffect, useState, type FormEvent } from 'react';
import { TbAlertTriangle, TbDeviceLaptop, TbMapPin, TbUsers } from 'react-icons/tb';
import { api, post } from '../api.ts';
import { Loading } from '../components/ui.tsx';
import { clock, duration } from '../format.ts';
import { useApi } from '../hooks.ts';
import { unlockSound } from '../pwa.ts';
import type { JoinInfo, StudentView, TicketMode } from '../types.ts';

const REMEMBER = 'ohq-student';

export function Join({ code, go }: { code: string; go: (p: string) => void }) {
  const info = useApi<JoinInfo>(`/api/join/${encodeURIComponent(code)}`, 15_000);
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(REMEMBER) ?? '{}') as { name?: string; email?: string }; } catch { return {}; }
  })();
  const [name, setName] = useState(saved.name ?? '');
  const [email, setEmail] = useState(saved.email ?? '');
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<TicketMode | ''>('');
  const [where, setWhere] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already in this queue on this device? Go straight to the ticket.
  useEffect(() => {
    api<StudentView>('/api/ticket').then((v) => {
      if (v.session.joinCode === code.toUpperCase() && ['waiting', 'helping'].includes(v.ticket.status)) go('/t');
    }, () => undefined);
  }, [code, go]);

  if (!info.data) {
    return <main className="page narrow">{info.error ? <div className="card error-card"><TbAlertTriangle aria-hidden="true" /> {info.error}</div> : <Loading />}</main>;
  }
  const { session, course, topics, emailDomain, fairnessMinutes } = info.data;
  const effectiveMode: TicketMode | '' = session.mode === 'hybrid' ? mode : session.mode;
  const closed = session.status !== 'open';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    unlockSound(); // a tap is needed before the page may play its arrival chime
    setBusy(true);
    setError(null);
    try {
      await post<StudentView>(`/api/join/${encodeURIComponent(code)}`, { name, email, topic, mode: effectiveMode, where, description: question });
      try { localStorage.setItem(REMEMBER, JSON.stringify({ name, email })); } catch { /* private mode */ }
      go('/t');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page narrow">
      <header className="join-head">
        <p className="eyebrow">{course}</p>
        <h1>{session.title}</h1>
        <p className="muted">
          {session.mode !== 'online' && session.location && <><TbMapPin aria-hidden="true" /> {session.location} · </>}
          until {clock(session.closesAt)}
        </p>
      </header>

      <div className="queue-glance" aria-live="polite">
        <div><strong>{info.data.waitingCount}</strong><span>waiting</span></div>
        <div><strong>{info.data.waitingCount ? `~${duration(info.data.waitMinutes)}` : 'No wait'}</strong><span>estimated</span></div>
      </div>

      {closed ? (
        <div className="card notice">{session.status === 'paused' ? 'The queue is paused for now. Check back in a few minutes.' : 'This session has ended.'}</div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <h2>Get in line</h2>
          <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required /></label>
          <label className="field">
            <span>School email</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={emailDomain ? `you@${emailDomain}` : 'you@school.edu'} autoComplete="email" required />
            <small className="muted">Used only to keep the queue fair. It is never shown or stored as text.</small>
          </label>
          <fieldset className="field">
            <legend>What do you need help with?</legend>
            <div className="chips">
              {topics.map((t) => (
                <button type="button" key={t} className={topic === t ? 'chip on' : 'chip'} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>
              ))}
            </div>
          </fieldset>
          {session.mode === 'hybrid' && (
            <fieldset className="field">
              <legend>How are you joining?</legend>
              <div className="segmented">
                <button type="button" className={mode === 'in_person' ? 'on' : ''} aria-pressed={mode === 'in_person'} onClick={() => setMode('in_person')}><TbUsers aria-hidden="true" /> In the room</button>
                <button type="button" className={mode === 'online' ? 'on' : ''} aria-pressed={mode === 'online'} onClick={() => setMode('online')}><TbDeviceLaptop aria-hidden="true" /> Online</button>
              </div>
            </fieldset>
          )}
          {effectiveMode && (
            <label className="field">
              <span>{effectiveMode === 'in_person' ? 'Where are you sitting? (optional)' : 'Your name on the call (optional)'}</span>
              <input className="input" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={60} placeholder={effectiveMode === 'in_person' ? 'Back row, by the window' : 'As it appears in Zoom'} />
            </label>
          )}
          <label className="field">
            <span>Your question (optional)</span>
            <textarea className="input" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={280} placeholder="My socket closes before the reply arrives" />
            <small className="muted">A short note helps TAs group similar questions and help several people at once.</small>
          </label>
          {error && <p className="error" role="alert"><TbAlertTriangle aria-hidden="true" /> {error}</p>}
          <button className="btn btn-primary btn-lg" disabled={busy || !topic || !effectiveMode}>{busy ? 'Joining…' : 'Join the queue'}</button>
          {fairnessMinutes > 0 && <p className="fine">To keep things fair, students who were already helped this week wait {fairnessMinutes} minutes longer for each earlier visit.</p>}
        </form>
      )}
    </main>
  );
}
