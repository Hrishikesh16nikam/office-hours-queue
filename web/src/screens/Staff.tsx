import { useState, type FormEvent } from 'react';
import { TbAlertTriangle, TbArrowLeft, TbChartBar, TbChevronRight, TbCopy, TbPlus, TbSettings, TbUsers } from 'react-icons/tb';
import { patch, post } from '../api.ts';
import { Empty, Loading, Pill } from '../components/ui.tsx';
import { clock, day, MODE_LABEL } from '../format.ts';
import { useApi } from '../hooks.ts';
import { useToast } from '../toast.tsx';
import type { SessionMode, SessionSummary, Settings, Staff } from '../types.ts';

function Back({ go, title, to = '/' }: { go: (p: string) => void; title: string; to?: string }) {
  return (
    <header className="screen-head with-back">
      <button className="back" onClick={() => go(to)} aria-label="Back"><TbArrowLeft size={20} /></button>
      <h1>{title}</h1>
    </header>
  );
}

export function Dashboard({ me, go, course }: { me: Staff; go: (p: string) => void; course: string }) {
  const sessions = useApi<{ sessions: SessionSummary[] }>('/api/sessions', 15_000);
  const [opening, setOpening] = useState(false);
  const live = sessions.data?.sessions.filter((s) => s.status !== 'closed') ?? [];
  const past = sessions.data?.sessions.filter((s) => s.status === 'closed') ?? [];
  return (
    <div className="screen">
      <header className="hello">
        <div>
          <p className="eyebrow">{course}</p>
          <h1>Hi, {me.name}</h1>
        </div>
      </header>

      {opening ? <OpenSession go={go} onCancel={() => setOpening(false)} /> : (
        <button className="btn btn-primary btn-lg" onClick={() => setOpening(true)}><TbPlus aria-hidden="true" /> Start office hours</button>
      )}

      <section>
        <div className="section-head"><h2>Running now</h2></div>
        {!sessions.data ? <Loading /> : live.length === 0 ? <Empty icon={TbUsers} title="No office hours running" /> : (
          <ul className="list-card">{live.map((s) => (
            <li key={s.id}><button className="link-row" onClick={() => go(`/s/${s.id}`)}>
              <span className="link-row-text"><strong>{s.title}</strong><span className="muted small"> · {MODE_LABEL[s.mode]} · until {clock(s.closesAt)} · code {s.joinCode}</span></span>
              {s.status === 'paused' && <Pill tone="wait">Paused</Pill>}
              <TbChevronRight size={18} aria-hidden="true" />
            </button></li>
          ))}</ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <div className="section-head"><h2>Past sessions</h2></div>
          <ul className="list-card">{past.map((s) => (
            <li key={s.id}><button className="link-row" onClick={() => go(`/s/${s.id}/stats`)}>
              <span className="link-row-text"><strong>{s.title}</strong><span className="muted small"> · {day(s.openedAt)}</span></span>
              <TbChartBar size={18} aria-hidden="true" />
            </button></li>
          ))}</ul>
        </section>
      )}

      <nav className="list-card" aria-label="Course">
        {me.isAdmin && <button className="row" onClick={() => go('/team')}><span className="row-icon"><TbUsers size={18} /></span><span className="row-text"><span className="row-label">Team</span><span className="row-hint">Add TAs and send invite links</span></span><TbChevronRight className="row-chev" size={18} /></button>}
        {me.isAdmin && <button className="row" onClick={() => go('/settings')}><span className="row-icon"><TbSettings size={18} /></span><span className="row-text"><span className="row-label">Course settings</span><span className="row-hint">Topics, email domain, fairness rule</span></span><TbChevronRight className="row-chev" size={18} /></button>}
      </nav>
      <button className="btn btn-quiet" onClick={() => post('/api/logout').finally(() => window.location.assign('/staff'))}>Sign out</button>
    </div>
  );
}

function OpenSession({ go, onCancel }: { go: (p: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(`${new Date().toLocaleDateString([], { weekday: 'long' })} office hours`);
  const [mode, setMode] = useState<SessionMode>('hybrid');
  const [location, setLocation] = useState('');
  const [onlineLink, setOnlineLink] = useState('');
  const [durationMinutes, setDuration] = useState(120);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await post<{ id: number }>('/api/sessions', { title, mode, location, onlineLink, durationMinutes });
      go(`/s/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>Start office hours</h2>
      <label className="field"><span>Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} required /></label>
      <div className="segmented three">
        {(['in_person', 'hybrid', 'online'] as SessionMode[]).map((m) => (
          <button type="button" key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'hybrid' ? 'Both' : MODE_LABEL[m]}</button>
        ))}
      </div>
      {mode !== 'online' && <label className="field"><span>Room</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Snell 033" maxLength={80} required /></label>}
      {mode !== 'in_person' && <label className="field"><span>Meeting link</span><input className="input" type="url" value={onlineLink} onChange={(e) => setOnlineLink(e.target.value)} placeholder="https://northeastern.zoom.us/j/…" required /><small className="muted">Students only see it when it's their turn.</small></label>}
      <label className="field"><span>Length</span>
        <select className="input" value={durationMinutes} onChange={(e) => setDuration(Number(e.target.value))}>
          {[60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m / 60} hour{m === 60 ? '' : 's'}</option>)}
        </select>
      </label>
      {error && <p className="error" role="alert"><TbAlertTriangle aria-hidden="true" /> {error}</p>}
      <div className="row-actions">
        <button className="btn btn-primary btn-lg">Open the queue</button>
        <button type="button" className="btn btn-lg" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function Team({ me, go }: { me: Staff; go: (p: string) => void }) {
  const toast = useToast();
  const list = useApi<{ staff: Staff[] }>('/api/staff');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const invite = async (s: Staff) => {
    try {
      const { url } = await post<{ url: string }>(`/api/staff/${s.id}/invite`);
      await navigator.clipboard.writeText(url).then(() => toast(`Invite link for ${s.name} copied. It works once, for 7 days.`), () => toast(url));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await post('/api/staff', { name, email });
      setName('');
      setEmail('');
      void list.reload();
      toast('Added. Copy their invite link and send it to them.');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const setActive = async (s: Staff, active: boolean) => {
    try {
      await patch(`/api/staff/${s.id}`, { active });
      void list.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back go={go} title="Team" />
      {!list.data ? <Loading /> : (
        <ul className="list-card">{list.data.staff.map((s) => (
          <li key={s.id} className={`member${s.active ? '' : ' inactive'}`}>
            <div className="member-text"><strong>{s.name}{s.id === me.id ? ' (you)' : ''}</strong><span className="muted small">{s.email} · {!s.active ? 'Deactivated' : s.joined ? (s.isAdmin ? 'Admin' : 'Joined') : 'Invite not accepted yet'}</span></div>
            {s.id !== me.id && (
              <div className="member-actions">
                {s.active && <button className="btn btn-sm" onClick={() => invite(s)}><TbCopy aria-hidden="true" /> {s.joined ? 'New link' : 'Invite link'}</button>}
                <button className="btn btn-sm btn-quiet" onClick={() => setActive(s, !s.active)}>{s.active ? 'Deactivate' : 'Reactivate'}</button>
              </div>
            )}
          </li>
        ))}</ul>
      )}
      <form className="card stack" onSubmit={add}>
        <h2>Add a TA</h2>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></label>
        <label className="field"><span>Email</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <button className="btn btn-primary"><TbPlus aria-hidden="true" /> Add</button>
      </form>
    </div>
  );
}

export function CourseSettings({ go, onSaved }: { go: (p: string) => void; onSaved: (s: Settings) => void }) {
  const toast = useToast();
  const current = useApi<Settings>('/api/settings');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  if (!current.data) return <div className="screen"><Back go={go} title="Course settings" /><Loading /></div>;
  const f = form ?? { courseName: current.data.courseName, emailDomain: current.data.emailDomain, timezone: current.data.timezone, topics: current.data.topics.join('\n'), fairnessMinutes: String(current.data.fairnessMinutes) };
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...f, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const s = await patch<Settings>('/api/settings', { ...f, topics: f.topics.split('\n').map((t) => t.trim()).filter(Boolean), fairnessMinutes: Number(f.fairnessMinutes) });
      onSaved(s);
      toast('Settings saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="screen">
      <Back go={go} title="Course settings" />
      <form className="card stack" onSubmit={save}>
        <label className="field"><span>Course name</span><input className="input" value={f.courseName} onChange={set('courseName')} maxLength={60} required /></label>
        <label className="field"><span>Student email domain</span><input className="input" value={f.emailDomain} onChange={set('emailDomain')} placeholder="northeastern.edu" /></label>
        <label className="field"><span>Topics, one per line</span><textarea className="input" rows={6} value={f.topics} onChange={set('topics')} /></label>
        <label className="field"><span>Extra wait per earlier visit this week (minutes, 0 turns the rule off)</span><input className="input" type="number" min={0} max={60} value={f.fairnessMinutes} onChange={set('fairnessMinutes')} /></label>
        <label className="field"><span>Time zone</span><input className="input" value={f.timezone} onChange={set('timezone')} required /></label>
        <button className="btn btn-primary btn-lg">Save</button>
      </form>
    </div>
  );
}
