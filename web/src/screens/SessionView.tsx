import { useState, type FormEvent } from 'react';
import {
  TbArrowBackUp, TbArrowLeft, TbCheck, TbClockPlus, TbDeviceLaptop, TbExternalLink, TbPlayerPause, TbPlayerPlay,
  TbPlus, TbQrcode, TbSquareRoundedX, TbTrash, TbUserPlus, TbUsers, TbUsersGroup,
} from 'react-icons/tb';
import { post } from '../api.ts';
import { Empty, Loading, Pill, Sheet } from '../components/ui.tsx';
import { clock, duration, MODE_LABEL, minutesSince } from '../format.ts';
import { useApi, useNow } from '../hooks.ts';
import { useToast } from '../toast.tsx';
import type { Settings, StaffTicket, StaffView, TicketMode } from '../types.ts';

export function SessionView({ id, go }: { id: number; go: (p: string) => void }) {
  const toast = useToast();
  const view = useApi<StaffView>(`/api/sessions/${id}`, 4000);
  const settings = useApi<Settings>('/api/settings');
  const now = useNow(20_000);
  const [selected, setSelected] = useState<number[]>([]);
  const [adding, setAdding] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!view.data) return <div className="screen">{view.error ? <Empty icon={TbSquareRoundedX} title={view.error} /> : <Loading />}</div>;
  const v = view.data;
  const s = v.session;
  const closed = s.status === 'closed';

  const act = async (path: string, body: unknown = {}, ok = '') => {
    setBusy(true);
    try {
      view.setData(await post<StaffView>(path, body));
      if (ok) toast(ok);
      setSelected([]);
    } catch (e) {
      toast((e as Error).message, 'error');
      void view.reload();
    } finally {
      setBusy(false);
    }
  };

  const selectedTopic = selected.length ? v.waiting.find((t) => t.id === selected[0])?.topic : null;
  const toggle = (t: StaffTicket) => setSelected((sel) => (sel.includes(t.id) ? sel.filter((x) => x !== t.id) : [...sel, t.id]));
  const waitingNow = v.waiting.filter((t) => !t.away).length;
  const joinUrl = `${window.location.origin}/j/${s.joinCode}`;

  return (
    <div className="screen">
      <header className="screen-head with-back">
        <button className="back" onClick={() => go('/')} aria-label="All sessions"><TbArrowLeft size={20} /></button>
        <div>
          <h1>{s.title}</h1>
          <p className="muted small">{MODE_LABEL[s.mode]}{s.location ? ` · ${s.location}` : ''} · until {clock(s.closesAt)}</p>
        </div>
      </header>

      <section className="join-strip">
        <div>
          <span className="muted small">Students join at</span>
          <strong className="join-url">{joinUrl.replace(/^https?:\/\//, '')}</strong>
        </div>
        <div className="join-strip-actions">
          <button className="btn" onClick={() => go(`/display/${s.joinCode}`)}><TbQrcode aria-hidden="true" /> Show QR code</button>
          <button className="btn" onClick={() => navigator.clipboard.writeText(joinUrl).then(() => toast('Join link copied'), () => toast(joinUrl))}>Copy link</button>
        </div>
      </section>

      {closed ? (
        <div className="card notice">This session is closed. <button className="link" onClick={() => go(`/s/${s.id}/stats`)}>See its statistics</button></div>
      ) : (
        <div className="control-bar">
          <button className="btn btn-primary btn-lg" disabled={busy || waitingNow === 0} onClick={() => act(`/api/sessions/${id}/claim`, {}, '')}>
            <TbCheck aria-hidden="true" /> Help next student
          </button>
          <div className="control-secondary">
            {s.status === 'open'
              ? <button className="btn" disabled={busy} onClick={() => act(`/api/sessions/${id}/status`, { status: 'paused' }, 'New students are paused')}><TbPlayerPause aria-hidden="true" /> Pause joining</button>
              : <button className="btn" disabled={busy} onClick={() => act(`/api/sessions/${id}/status`, { status: 'open' }, 'Joining is open again')}><TbPlayerPlay aria-hidden="true" /> Resume joining</button>}
            <button className="btn" disabled={busy} onClick={() => act(`/api/sessions/${id}/extend`, { minutes: 30 }, 'Extended by 30 minutes')}><TbClockPlus aria-hidden="true" /> +30 min</button>
            <button className="btn" onClick={() => setAdding(true)}><TbUserPlus aria-hidden="true" /> Add student</button>
            <button className="btn btn-quiet" onClick={() => setConfirmClose(true)}>End session</button>
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat"><span className="stat-label">Waiting</span><span className="stat-value">{waitingNow}</span></div>
        <div className="stat"><span className="stat-label">Being helped</span><span className="stat-value">{v.helping.length}</span></div>
        <div className="stat"><span className="stat-label">Helped</span><span className="stat-value">{v.helpedCount}</span></div>
        <div className="stat"><span className="stat-label">Avg. help</span><span className="stat-value">{v.avgHelpMinutes} min</span></div>
      </div>

      {v.helping.length > 0 && (
        <section>
          <div className="section-head"><h2>Being helped</h2></div>
          <ul className="list-card">
            {v.helping.map((t) => (
              <li key={t.id} className="qrow helping">
                <TicketInfo t={t} />
                <div className="qrow-side">
                  <span className="muted small">{t.helper} · {duration(minutesSince(t.startedAt!, now))}</span>
                  <div className="qrow-actions">
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(`/api/tickets/${t.id}/finish`, {}, t.groupId ? 'Group finished' : 'Done')}><TbCheck aria-hidden="true" /> Done</button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => act(`/api/tickets/${t.id}/requeue`, {}, 'Back in line, same place')} title="They weren't there: keep their place"><TbArrowBackUp aria-hidden="true" /> Not here</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {s.onlineLink && v.helping.some((t) => t.mode === 'online') && (
            <a className="link small" href={s.onlineLink} target="_blank" rel="noopener noreferrer"><TbExternalLink aria-hidden="true" /> Open the meeting</a>
          )}
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Waiting</h2>
          {selected.length > 1 && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(`/api/sessions/${id}/claim`, { ids: selected }, `Helping ${selected.length} students together`)}>
              <TbUsersGroup aria-hidden="true" /> Help {selected.length} together
            </button>
          )}
        </div>
        {v.waiting.length === 0 ? (
          <Empty icon={TbUsers} title="Nobody is waiting">Share the join link or show the QR code in the room.</Empty>
        ) : (
          <>
            <p className="fine">Tick students with the same topic to help them together.</p>
            <ul className="list-card">
              {v.waiting.map((t) => {
                const canGroup = !selectedTopic || selectedTopic === t.topic;
                return (
                  <li key={t.id} className={`qrow${t.away ? ' away' : ''}${selected.includes(t.id) ? ' selected' : ''}`}>
                    <label className="qrow-check">
                      <input type="checkbox" checked={selected.includes(t.id)} disabled={closed || t.away || !canGroup} onChange={() => toggle(t)} aria-label={`Select ${t.name ?? 'student'} for group help`} />
                      <span className="qrow-pos">{t.away ? '–' : t.position}</span>
                    </label>
                    <TicketInfo t={t} />
                    <div className="qrow-side">
                      <span className="muted small">waiting {duration(minutesSince(t.joinedAt, now))}</span>
                      {!closed && (
                        <div className="qrow-actions">
                          <button className="btn btn-sm" disabled={busy || t.away} onClick={() => act(`/api/sessions/${id}/claim`, { ids: [t.id] }, '')}><TbCheck aria-hidden="true" /> Help</button>
                          <button className="icon-btn" disabled={busy} onClick={() => act(`/api/tickets/${t.id}/remove`, {}, 'Removed from the queue')} aria-label={`Remove ${t.name ?? 'student'}`} title="Remove"><TbTrash size={16} /></button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {adding && settings.data && <AddStudent topics={settings.data.topics} sessionMode={s.mode} onClose={() => setAdding(false)} onAdd={(b) => act(`/api/sessions/${id}/add`, b, 'Added to the queue').then(() => setAdding(false))} />}
      {confirmClose && (
        <Sheet title="End this session?" onClose={() => setConfirmClose(false)}>
          <p className="muted">Students still waiting will be told the session has ended. You'll see the session's statistics next.</p>
          <button className="btn btn-danger btn-lg" onClick={() => act(`/api/sessions/${id}/status`, { status: 'closed' }, 'Session ended').then(() => go(`/s/${id}/stats`))}>End session</button>
          <button className="btn btn-lg" onClick={() => setConfirmClose(false)}>Keep it open</button>
        </Sheet>
      )}
    </div>
  );
}

function TicketInfo({ t }: { t: StaffTicket }) {
  return (
    <div className="qrow-main">
      <div className="qrow-title">
        <strong>{t.name}</strong>
        <span className="mode-tag">{t.mode === 'online' ? <><TbDeviceLaptop aria-hidden="true" /> Online</> : <><TbUsers aria-hidden="true" /> In room</>}</span>
        {t.where && <span className="muted small">{t.where}</span>}
      </div>
      <div className="qrow-tags">
        <span className="topic-tag">{t.topic}</span>
        {t.away && <Pill tone="wait">Stepped away</Pill>}
        {t.helpedBefore > 0 && <Pill tone="muted">Helped {t.helpedBefore}× this week</Pill>}
        {t.addedByStaff && <Pill tone="muted">Added by a TA</Pill>}
        {t.groupId && <Pill tone="good">Group</Pill>}
      </div>
      {t.description && <p className="qrow-question">{t.description}</p>}
    </div>
  );
}

function AddStudent({ topics, sessionMode, onClose, onAdd }: { topics: string[]; sessionMode: string; onClose: () => void; onAdd: (b: Record<string, string>) => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState(topics[0] ?? '');
  const [mode, setMode] = useState<TicketMode>(sessionMode === 'online' ? 'online' : 'in_person');
  const [description, setDescription] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd({ name, topic, mode, description });
  };
  return (
    <Sheet title="Add a student" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">For students who emailed or can't use the link. They wait in line like everyone else.</p>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoFocus /></label>
        <label className="field"><span>Topic</span>
          <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>{topics.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        {sessionMode === 'hybrid' && (
          <div className="segmented">
            <button type="button" className={mode === 'in_person' ? 'on' : ''} onClick={() => setMode('in_person')}>In the room</button>
            <button type="button" className={mode === 'online' ? 'on' : ''} onClick={() => setMode('online')}>Online</button>
          </div>
        )}
        <label className="field"><span>Question (optional)</span><textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} /></label>
        <button className="btn btn-primary btn-lg"><TbPlus aria-hidden="true" /> Add to the queue</button>
      </form>
    </Sheet>
  );
}

