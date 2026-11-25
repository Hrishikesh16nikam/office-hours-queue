import { useEffect, useState } from 'react';
import { api, onSignedOut } from './api.ts';
import { Loading } from './components/ui.tsx';
import { usePath } from './hooks.ts';
import { AcceptInvite, Login, Setup } from './screens/Auth.tsx';
import { Display } from './screens/Display.tsx';
import { Home } from './screens/Home.tsx';
import { Join } from './screens/Join.tsx';
import { SessionView } from './screens/SessionView.tsx';
import { CourseSettings, Dashboard, Team } from './screens/Staff.tsx';
import { Stats } from './screens/Stats.tsx';
import { Ticket } from './screens/Ticket.tsx';
import { ToastProvider } from './toast.tsx';
import type { Staff } from './types.ts';

export function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  );
}

function Root() {
  const [path, go] = usePath();
  const [status, setStatus] = useState<{ setUp: boolean; course: string } | null>(null);
  const [me, setMe] = useState<Staff | null | undefined>(undefined);

  useEffect(() => {
    api<{ setUp: boolean; course: string }>('/api/status').then(setStatus, () => setStatus({ setUp: true, course: 'Office hours' }));
    api<{ staff: Staff }>('/api/me').then((r) => setMe(r.staff), () => setMe(null));
    return onSignedOut(() => setMe(null));
  }, []);

  // Student and public pages work without signing in.
  let m = /^\/display\/([^/]+)$/.exec(path);
  if (m) return <Display code={decodeURIComponent(m[1])} go={go} />;
  m = /^\/j\/([^/]+)$/.exec(path);
  if (m) return <Join code={decodeURIComponent(m[1])} go={go} />;
  if (path === '/t') return <Ticket go={go} />;
  m = /^\/invite\/([^/]+)$/.exec(path);
  if (m) return <AcceptInvite token={decodeURIComponent(m[1])} onIn={(s) => { setMe(s); go('/'); }} />;

  if (!status || me === undefined) return <div className="boot"><Loading /></div>;
  if (!status.setUp) return <Setup onIn={(s) => { setStatus({ ...status, setUp: true }); setMe(s); go('/team'); }} />;
  if (!me) {
    if (path === '/staff' || path.startsWith('/s/') || path === '/team' || path === '/settings') return <Login onIn={(s) => { setMe(s); go(path === '/staff' ? '/' : path); }} go={go} />;
    return <Home course={status.course} go={go} />;
  }

  let screen;
  if ((m = /^\/s\/(\d+)\/stats$/.exec(path))) screen = <Stats id={Number(m[1])} go={go} />;
  else if ((m = /^\/s\/(\d+)$/.exec(path))) screen = <SessionView id={Number(m[1])} go={go} />;
  else if (path === '/team' && me.isAdmin) screen = <Team me={me} go={go} />;
  else if (path === '/settings' && me.isAdmin) screen = <CourseSettings go={go} onSaved={(s) => setStatus({ ...status, course: s.courseName })} />;
  else screen = <Dashboard me={me} go={go} course={status.course} />;
  return <div className="app"><main className="main">{screen}</main></div>;
}
