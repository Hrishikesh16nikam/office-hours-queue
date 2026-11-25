import { useState, type FormEvent } from 'react';
import { TbArrowRight } from 'react-icons/tb';

/** The landing page: students enter a join code; TAs sign in. */
export function Home({ course, go }: { course: string; go: (p: string) => void }) {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) go(`/j/${c}`);
  };
  return (
    <main className="auth">
      <div className="auth-card">
        <img src="/icons/icon.svg" alt="" className="logo" />
        <p className="eyebrow">{course}</p>
        <h1>Office hours</h1>
        <p className="muted">Scan the code on the screen, or enter the join code your TA shared.</p>
        <form className="code-form" onSubmit={submit}>
          <input className="input code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7Q4P" maxLength={8} autoCapitalize="characters" autoComplete="off" aria-label="Join code" />
          <button className="btn btn-primary" aria-label="Join"><TbArrowRight size={18} /></button>
        </form>
        <button className="link" onClick={() => go('/staff')}>TA sign in</button>
      </div>
    </main>
  );
}
