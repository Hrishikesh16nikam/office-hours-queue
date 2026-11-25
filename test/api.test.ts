import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleApi } from '../src/api.ts';
import { makeCourse } from './helpers.ts';

async function client() {
  const course = await makeCourse();
  const jars = new Map<string, Map<string, string>>();
  const call = async (who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const jar = jars.get(who) ?? new Map<string, string>();
    jars.set(who, jar);
    const h = new Headers({ ...headers, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') });
    if (body !== undefined) h.set('content-type', 'application/json');
    const res = await handleApi(new Request(`https://oh.test${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), {
      queue: course.queue, setupCode: 'setup-code', vapid: null, waitUntil: () => {},
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (v) jar.set(k, v); else jar.delete(k);
    }
    return { status: res.status, body: await res.json() as Record<string, any> };
  };
  return { ...course, call };
}

test('students join with a link and see only their own ticket', async () => {
  const { call, session } = await client();
  const info = await call('asha', 'GET', `/api/join/${session.joinCode}`);
  assert.equal(info.status, 200);
  assert.equal(info.body.waitingCount, 0);
  assert.ok(!JSON.stringify(info.body).includes('zoom')); // the meeting link is never public
  const joined = await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.ticket.position, 1);
  await call('ben', 'POST', `/api/join/${session.joinCode}`, { name: 'Ben', email: 'ben@example.edu', topic: 'Homework', mode: 'in_person' });
  const ben = await call('ben', 'GET', '/api/ticket');
  assert.equal(ben.body.ticket.name, 'Ben');
  assert.equal(ben.body.ticket.position, 2);
  assert.equal((await call('stranger', 'GET', '/api/ticket')).status, 404);
});

test('students cannot use TA actions', async () => {
  const { call, session } = await client();
  await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' });
  assert.equal((await call('asha', 'GET', `/api/sessions/${session.id}`)).status, 401);
  assert.equal((await call('asha', 'POST', `/api/sessions/${session.id}/claim`, {})).status, 401);
});

test('TAs sign in, claim and finish; only the admin manages the team', async () => {
  const { call, session } = await client();
  await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' });
  assert.equal((await call('ta', 'POST', '/api/login', { email: 'ta@example.edu', pin: '246810' })).status, 200);
  const claimed = await call('ta', 'POST', `/api/sessions/${session.id}/claim`, {});
  assert.equal(claimed.body.helping.length, 1);
  const asha = await call('asha', 'GET', '/api/ticket');
  assert.equal(asha.body.ticket.status, 'helping');
  assert.equal(asha.body.ticket.joinLink, 'https://example.zoom.us/j/1');
  const done = await call('ta', 'POST', `/api/tickets/${claimed.body.helping[0].id}/finish`, {});
  assert.equal(done.body.helpedCount, 1);
  await call('sam', 'POST', '/api/login', { email: 'sam@example.edu', pin: '135790' });
  assert.equal((await call('sam', 'POST', '/api/staff', { name: 'X', email: 'x@example.edu' })).status, 403);
  assert.equal((await call('ta', 'POST', '/api/staff', { name: 'X', email: 'x@example.edu' })).status, 200);
});

test('cross-site writes are rejected', async () => {
  const { call, session } = await client();
  const r = await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('the projector view shows counts, never names', async () => {
  const { call, session } = await client();
  await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' });
  const d = await call('anyone', 'GET', `/api/display/${session.joinCode}`);
  assert.equal(d.body.waitingCount, 1);
  assert.ok(!JSON.stringify(d.body).includes('Asha'));
});

test('push subscriptions must point at a real browser push service', async () => {
  const { call, session } = await client();
  await call('asha', 'POST', `/api/join/${session.joinCode}`, { name: 'Asha', email: 'asha@example.edu', topic: 'Homework', mode: 'online' });
  const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
  assert.equal((await call('asha', 'POST', '/api/ticket/push', { endpoint: 'https://internal.example/hook', keys })).status, 400);
  assert.equal((await call('asha', 'POST', '/api/ticket/push', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys })).status, 200);
});
