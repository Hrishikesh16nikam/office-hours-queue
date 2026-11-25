import { TbArrowLeft, TbChartBar } from 'react-icons/tb';
import { Empty, Loading } from '../components/ui.tsx';
import { day } from '../format.ts';
import { useApi } from '../hooks.ts';
import type { Stats as StatsT } from '../types.ts';

export function Stats({ id, go }: { id: number; go: (p: string) => void }) {
  const stats = useApi<StatsT>(`/api/sessions/${id}/stats`);
  if (!stats.data) return <div className="screen">{stats.error ? <Empty icon={TbChartBar} title={stats.error} /> : <Loading />}</div>;
  const s = stats.data;
  const max = Math.max(1, ...s.topics.map((t) => t.count));
  const m = (v: number | null) => (v == null ? '–' : `${v} min`);
  return (
    <div className="screen">
      <header className="screen-head with-back">
        <button className="back" onClick={() => go('/')} aria-label="Back"><TbArrowLeft size={20} /></button>
        <div><h1>{s.session.title}</h1><p className="muted small">{day(s.session.openedAt)} · anonymous statistics</p></div>
      </header>
      <div className="stats four">
        <div className="stat"><span className="stat-label">Students</span><span className="stat-value">{s.joined}</span></div>
        <div className="stat"><span className="stat-label">Helped</span><span className="stat-value">{s.helped}</span></div>
        <div className="stat"><span className="stat-label">Median wait</span><span className="stat-value">{m(s.medianWaitMinutes)}</span></div>
        <div className="stat"><span className="stat-label">Median help</span><span className="stat-value">{m(s.medianHelpMinutes)}</span></div>
      </div>
      <div className="card stack">
        <h2>What students needed help with</h2>
        {s.topics.length === 0 ? <p className="muted">No students joined.</p> : (
          <ul className="bars">{s.topics.map((t) => (
            <li key={t.topic}>
              <span className="bar-who">{t.topic}</span>
              <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width: `${(t.count / max) * 100}%` }} /></span>
              <span className="bar-num">{t.count}</span>
            </li>
          ))}</ul>
        )}
        <p className="fine">Share this with your instructor: the most common topics show what to revisit in class.</p>
      </div>
      <div className="card details">
        <div className="detail-row"><span>Longest wait</span><strong>{m(s.longestWaitMinutes)}</strong></div>
        <div className="detail-row"><span>In the room / online</span><strong>{s.byMode.in_person} / {s.byMode.online}</strong></div>
        <div className="detail-row"><span>Returning this week</span><strong>{s.repeatVisitors}</strong></div>
        <div className="detail-row"><span>Left or removed</span><strong>{s.leftOrRemoved}</strong></div>
      </div>
      <p className="fine">Names and questions are erased a day after each session. These numbers never identify a student.</p>
    </div>
  );
}
