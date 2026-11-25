import { useEffect, useState } from 'react';
import { TbArrowLeft, TbMaximize } from 'react-icons/tb';
import { QrCode } from '../components/QrCode.tsx';
import { Loading } from '../components/ui.tsx';
import { clock, duration } from '../format.ts';
import { useApi } from '../hooks.ts';
import type { DisplayView } from '../types.ts';

/** Full-screen view for the projector: QR code, queue length, no names. */
export function Display({ code, go }: { code: string; go: (p: string) => void }) {
  const view = useApi<DisplayView>(`/api/display/${encodeURIComponent(code)}`, 5000);
  const [controls, setControls] = useState(true);
  const back = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    if (window.history.length > 1) window.history.back();
    else go('/');
  };
  useEffect(() => {
    document.body.classList.add('display-mode');
    // Controls show on mouse movement or a tap, then fade so the projector stays clean.
    let timer = window.setTimeout(() => setControls(false), 4000);
    const wake = () => {
      setControls(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setControls(false), 4000);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) back();
      else wake();
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('display-mode');
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toolbar = (
    <div className={`display-controls${controls ? '' : ' hidden'}`}>
      <button className="btn btn-on-accent-ghost" onClick={back}><TbArrowLeft aria-hidden="true" /> Back to the queue</button>
      {document.fullscreenEnabled && (
        <button className="btn btn-on-accent-ghost" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}>
          <TbMaximize aria-hidden="true" /> Full screen
        </button>
      )}
    </div>
  );
  if (!view.data) return <main className="display">{toolbar}{view.error ? <p>{view.error}</p> : <Loading />}</main>;
  const d = view.data;
  const url = `${window.location.origin}/j/${d.session.joinCode}`;
  const open = d.session.status === 'open';
  return (
    <main className="display">
      {toolbar}
      <div className="display-text">
        <p className="display-course">{d.course}</p>
        <h1>{d.session.title}</h1>
        <p className="display-lead">{open ? 'Scan to get in line' : d.session.status === 'paused' ? 'The queue is paused' : 'Office hours have ended'}</p>
        <p className="display-url">{url.replace(/^https?:\/\//, '')}</p>
        <div className="display-stats">
          <div><strong>{d.waitingCount}</strong><span>waiting</span></div>
          <div><strong>{d.nowHelping}</strong><span>being helped</span></div>
          <div><strong>{d.waitingCount ? `~${duration(d.waitMinutes)}` : 'No wait'}</strong><span>for new students</span></div>
        </div>
        <p className="display-fine">Until {clock(d.session.closesAt)} · Join code {d.session.joinCode}</p>
      </div>
      <div className={`display-qr${open ? '' : ' dim'}`}>
        <QrCode value={url} label={`QR code for ${url}`} />
      </div>
    </main>
  );
}
