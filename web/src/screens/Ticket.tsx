import { useEffect, useRef, useState } from 'react';
import { TbBell, TbBellCheck, TbCircleCheck, TbClock, TbDeviceLaptop, TbExternalLink, TbMapPin, TbPlayerPause, TbPlayerPlay, TbUsers, TbX } from 'react-icons/tb';
import { post } from '../api.ts';
import { Loading, Sheet } from '../components/ui.tsx';
import { duration } from '../format.ts';
import { useApi } from '../hooks.ts';
import { alertStudent, currentSubscription, enablePush, isIOS, isStandalone, pushSupported } from '../pwa.ts';
import { useToast } from '../toast.tsx';
import type { StudentView } from '../types.ts';

export function Ticket({ go }: { go: (p: string) => void }) {
  const toast = useToast();
  const view = useApi<StudentView>('/api/ticket', 4000);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const prev = useRef<{ status?: string; position?: number | null }>({});

  useEffect(() => {
    currentSubscription().then((s) => setPushOn(Boolean(s)), () => setPushOn(false));
  }, []);

  // Chime when this student becomes next, and again when it's their turn.
  useEffect(() => {
    const t = view.data?.ticket;
    if (!t) return;
    const p = prev.current;
    if (p.status && p.status === 'waiting' && t.status === 'helping') alertStudent('Your turn!');
    else if (p.position && p.position > 1 && t.position === 1) alertStudent("You're next");
    prev.current = { status: t.status, position: t.position };
  }, [view.data]);

  if (!view.data) {
    if (view.status === 404) {
      return (
        <main className="page narrow">
          <div className="card stack center">
            <h1>You're not in a queue</h1>
            <p className="muted">Scan the code on the screen or open the link your TA shared.</p>
            <button className="btn btn-primary btn-lg" onClick={() => go('/')}>Enter a join code</button>
          </div>
        </main>
      );
    }
    return <main className="page narrow">{view.error ? <div className="card">{view.error}</div> : <Loading />}</main>;
  }

  const { ticket: t, session, course } = view.data;
  const act = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    try {
      view.setData(await post<StudentView>(path, body));
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    try {
      await post('/api/ticket/leave');
      toast('You left the queue');
      go(`/j/${session.joinCode}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const turnOnPush = async () => {
    try {
      await enablePush('/api/ticket/push');
      setPushOn(true);
      toast("You'll get a notification when it's your turn");
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <main className="page narrow">
      <header className="join-head">
        <p className="eyebrow">{course}</p>
        <h1>{session.title}</h1>
      </header>

      {t.status === 'waiting' && (
        <section className={`ticket-card${t.away ? ' is-away' : ''}`} aria-live="polite">
          {t.away ? (
            <>
              <p className="ticket-label">You stepped away</p>
              <p className="ticket-big small">Your place is saved</p>
              <p className="ticket-sub">TAs will skip you until you're back.</p>
            </>
          ) : (
            <>
              <p className="ticket-label">{t.position === 1 ? "You're next" : 'Your place in line'}</p>
              <p className="ticket-big">{t.position === 1 ? <TbCircleCheck aria-label="next" /> : `#${t.position}`}</p>
              <p className="ticket-sub"><TbClock aria-hidden="true" /> About {duration(t.waitMinutes ?? 1)}</p>
            </>
          )}
        </section>
      )}

      {t.status === 'helping' && (
        <section className="ticket-card is-turn" aria-live="assertive">
          <p className="ticket-label">It's your turn</p>
          <p className="ticket-big small">{t.helper ?? 'A TA'} {t.mode === 'online' ? 'is ready for you' : 'is coming to you'}</p>
          {t.mode === 'online' && t.joinLink && (
            <a className="btn btn-on-accent btn-lg" href={t.joinLink} target="_blank" rel="noopener noreferrer">
              <TbExternalLink aria-hidden="true" /> Join the call
            </a>
          )}
          {t.mode === 'in_person' && <p className="ticket-sub"><TbMapPin aria-hidden="true" /> {t.where ? `They'll find you: ${t.where}` : 'Wave so they can find you'}</p>}
        </section>
      )}

      {['done', 'removed', 'left'].includes(t.status) && (
        <section className="card stack center">
          <h2>{t.status === 'done' ? 'All set. Good luck!' : t.status === 'left' ? 'You left the queue' : 'You were removed from the queue'}</h2>
          <p className="muted">{t.status === 'removed' ? 'If you still need help and the session is open, you can join again.' : 'Thanks for coming to office hours.'}</p>
          {session.status === 'open' && <button className="btn" onClick={() => go(`/j/${session.joinCode}`)}>Join again</button>}
        </section>
      )}

      {t.status === 'waiting' && (
        <>
          <div className="card details">
            <div className="detail-row"><span>Topic</span><strong>{t.topic}</strong></div>
            <div className="detail-row"><span>Joining</span><strong>{t.mode === 'online' ? <><TbDeviceLaptop aria-hidden="true" /> Online</> : <><TbUsers aria-hidden="true" /> In the room</>}</strong></div>
            {t.where && <div className="detail-row"><span>{t.mode === 'online' ? 'On the call as' : 'Seat'}</span><strong>{t.where}</strong></div>}
            <div className="detail-row column"><span>Question</span><p>{t.description || <span className="muted">None yet</span>}</p></div>
            <button className="link" onClick={() => setEditing(true)}>{t.description ? 'Edit question' : 'Add a question'}</button>
          </div>

          {pushSupported() && pushOn === false && (
            <div className="banner">
              <TbBell size={18} aria-hidden="true" />
              <p>Get a notification when you're next, so you can keep working.</p>
              <button className="btn btn-sm" onClick={turnOnPush}>Notify me</button>
            </div>
          )}
          {pushOn && <p className="fine center"><TbBellCheck aria-hidden="true" /> Notifications are on for this device.</p>}
          {!pushSupported() && isIOS() && !isStandalone() && (
            <p className="fine center">Keep this page open: it will chime when it's your turn. For notifications on iPhone, add this page to your Home Screen.</p>
          )}

          <div className="row-actions">
            <button className="btn" disabled={busy} onClick={() => act('/api/ticket/away', { away: !t.away }, t.away ? "Welcome back, you're in line" : 'Your place is saved')}>
              {t.away ? <><TbPlayerPlay aria-hidden="true" /> I'm back</> : <><TbPlayerPause aria-hidden="true" /> Step away</>}
            </button>
            <button className="btn btn-quiet" onClick={() => setConfirmLeave(true)}><TbX aria-hidden="true" /> Leave queue</button>
          </div>
          {view.data.fairnessMinutes > 0 && t.helpedBefore > 0 && (
            <p className="fine center">You were helped {t.helpedBefore} {t.helpedBefore === 1 ? 'time' : 'times'} already this week, so students who haven't been helped yet go first.</p>
          )}
        </>
      )}

      {editing && <QuestionSheet initial={t.description ?? ''} onClose={() => setEditing(false)} onSave={(d) => act('/api/ticket/question', { description: d }, 'Question updated').then(() => setEditing(false))} />}
      {confirmLeave && (
        <Sheet title="Leave the queue?" onClose={() => setConfirmLeave(false)}>
          <p className="muted">You'll lose your place. You can join again later, but you'll be at the back of the line.</p>
          <button className="btn btn-danger btn-lg" onClick={leave}>Leave the queue</button>
          <button className="btn btn-lg" onClick={() => setConfirmLeave(false)}>Stay in line</button>
        </Sheet>
      )}
    </main>
  );
}

function QuestionSheet({ initial, onClose, onSave }: { initial: string; onClose: () => void; onSave: (d: string) => void }) {
  const [d, setD] = useState(initial);
  return (
    <Sheet title="Your question" onClose={onClose}>
      <textarea className="input" rows={4} maxLength={280} value={d} onChange={(e) => setD(e.target.value)} autoFocus />
      <button className="btn btn-primary btn-lg" onClick={() => onSave(d)}>Save</button>
    </Sheet>
  );
}
