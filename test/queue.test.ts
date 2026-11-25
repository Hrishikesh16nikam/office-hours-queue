import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localDate, weekStart } from '../src/queue.ts';
import { makeCourse } from './helpers.ts';

test('dates follow the course time zone, weeks start on Monday', () => {
  // 02:00 UTC on Monday is still Sunday evening in Boston.
  assert.deepEqual(localDate('2026-11-23T02:00:00Z', 'America/New_York'), { date: '2026-11-22', weekday: 6 });
  assert.equal(weekStart('2026-11-23T02:00:00Z', 'America/New_York'), '2026-11-16');
  assert.equal(weekStart('2026-11-25T15:00:00Z', 'America/New_York'), '2026-11-23');
});

test('students are served in arrival order', async () => {
  const { queue, session, join, at } = await makeCourse();
  await join('asha');
  at('2026-11-24T15:01:00Z');
  await join('ben');
  at('2026-11-24T15:02:00Z');
  await join('chen');
  assert.deepEqual((await queue.waiting(session.id)).map((t) => t.name), ['asha', 'ben', 'chen']);
});

test('students already helped this week move back by the fairness setting', async () => {
  const { queue, session, join, at, staffId } = await makeCourse();
  // Monday: Asha is helped once.
  at('2026-11-23T15:00:00Z');
  const monday = await queue.openSession(staffId, { title: 'Monday', mode: 'in_person', location: 'Snell 033' });
  await join('asha', monday.joinCode);
  await queue.claim(staffId, monday.id);
  at('2026-11-23T15:10:00Z');
  const [first] = await queue.helping(monday.id);
  await queue.finish(first.id);
  // Tuesday: Asha arrives 10 minutes before Ben, but was helped yesterday (15-minute penalty).
  at('2026-11-24T15:00:00Z');
  await join('asha');
  at('2026-11-24T15:10:00Z');
  await join('ben');
  const order = await queue.waiting(session.id);
  assert.deepEqual(order.map((t) => t.name), ['ben', 'asha']);
  assert.equal(order[1].helpedBefore, 1);
});

test('last week\u2019s help does not count against a student', async () => {
  const { queue, join, at, staffId } = await makeCourse('2026-11-20T15:00:00Z'); // a Friday
  const fri = await queue.openSession(staffId, { title: 'Friday', mode: 'in_person', location: 'Snell 033' });
  await join('asha', fri.joinCode);
  await queue.claim(staffId, fri.id);
  const [t] = await queue.helping(fri.id);
  await queue.finish(t.id);
  at('2026-11-24T15:00:00Z'); // the next Tuesday
  const key = await queue.studentKey('asha@example.edu');
  assert.equal(await queue.helpedThisWeek(key), 0);
});

test('a student cannot join the same session twice, and must use the course email domain', async () => {
  const { queue, session, join } = await makeCourse();
  await join('asha');
  await assert.rejects(join('asha'), /already in this queue/);
  await assert.rejects(queue.join(session.joinCode, { name: 'X', email: 'x@gmail.com', topic: 'Homework' }, 'ip'), /@example\.edu/);
});

test('paused and closed sessions refuse new students', async () => {
  const { queue, session, join } = await makeCourse();
  await queue.setSessionStatus(session.id, 'paused');
  await assert.rejects(join('asha'), /paused/);
  await queue.setSessionStatus(session.id, 'closed');
  await assert.rejects(join('ben'), /ended/);
});

test('sessions past their end time count as closed', async () => {
  const { queue, at, join } = await makeCourse();
  at('2026-11-24T18:01:00Z'); // the 3-hour session ended at 18:00
  await assert.rejects(join('asha'), /ended/);
});

test('claiming takes the next student who has not stepped away', async () => {
  const { queue, session, join, staffId } = await makeCourse();
  const a = await join('asha');
  await join('ben');
  await queue.setAway(a.token, true);
  const { tickets } = await queue.claim(staffId, session.id);
  assert.equal(tickets[0].name, 'ben');
  // Asha keeps her place for when she returns.
  await queue.setAway(a.token, false);
  assert.equal((await queue.studentView(a.token)).ticket.position, 1);
});

test('two TAs cannot claim the same student', async () => {
  const { queue, session, join, staffId, otherStaffId } = await makeCourse();
  const a = await join('asha');
  await queue.claim(staffId, session.id, [a.ticket.id]);
  await assert.rejects(queue.claim(otherStaffId, session.id, [a.ticket.id]), /already helped|took that student/);
});

test('group help claims several students with the same topic and finishes them together', async () => {
  const { queue, session, join, staffId } = await makeCourse();
  const a = await join('asha', undefined, 'Homework');
  const b = await join('ben', undefined, 'Homework');
  const c = await join('chen', undefined, 'Exam prep');
  await assert.rejects(queue.claim(staffId, session.id, [a.ticket.id, c.ticket.id]), /same topic/);
  await queue.claim(staffId, session.id, [a.ticket.id, b.ticket.id]);
  await queue.finish(a.ticket.id);
  assert.equal((await queue.ticketById(b.ticket.id))!.status, 'done');
  assert.equal((await queue.ticketById(c.ticket.id))!.status, 'waiting');
});

test('a no-show can be put back in line without losing their place', async () => {
  const { queue, session, join, staffId } = await makeCourse();
  const a = await join('asha');
  await join('ben');
  await queue.claim(staffId, session.id, [a.ticket.id]);
  await queue.requeue(a.ticket.id);
  assert.deepEqual((await queue.waiting(session.id)).map((t) => t.name), ['asha', 'ben']);
});

test('wait estimates use real help times and the number of active TAs', async () => {
  const { queue, session, join, at, staffId, otherStaffId } = await makeCourse();
  const est0 = await queue.estimates(session.id);
  assert.equal(est0.avgHelpMinutes, 8); // default before any data
  const a = await join('asha');
  const b = await join('ben');
  await join('chen');
  await join('diego');
  await queue.claim(staffId, session.id, [a.ticket.id]);
  await queue.claim(otherStaffId, session.id, [b.ticket.id]);
  at('2026-11-24T15:12:00Z');
  await queue.finish(a.ticket.id);
  await queue.finish(b.ticket.id);
  const est = await queue.estimates(session.id);
  assert.equal(est.avgHelpMinutes, 12);
  assert.equal(est.activeStaff, 2);
  assert.equal(est.waitFor(2), 12); // 12 minutes x 2 positions / 2 TAs
});

test('students see their position, and the call link only when it is their turn', async () => {
  const { queue, session, join, staffId } = await makeCourse();
  await join('asha');
  const b = await join('ben', undefined, 'Homework', 'online');
  let view = await queue.studentView(b.token);
  assert.equal(view.ticket.position, 2);
  assert.equal(view.ticket.joinLink, null);
  await queue.claim(staffId, session.id, [b.ticket.id]);
  view = await queue.studentView(b.token);
  assert.equal(view.ticket.status, 'helping');
  assert.equal(view.ticket.joinLink, 'https://example.zoom.us/j/1');
  assert.equal(view.ticket.helper, 'Hrishikesh');
});

test('claiming notifies the student and whoever is next, once', async () => {
  const { queue, session, join, staffId } = await makeCourse();
  const a = await join('asha');
  const b = await join('ben');
  const { reminders } = await queue.claim(staffId, session.id, [a.ticket.id]);
  assert.deepEqual(reminders.map((r) => [r.title, r.owner.id]), [["It's your turn", a.ticket.id], ["You're next", b.ticket.id]]);
  assert.equal(reminders[1].key, `next:${b.ticket.id}`); // stable key: delivered at most once
});

test('TAs can add students who emailed; they wait in line like everyone else', async () => {
  const { queue, session, join, at, staffId } = await makeCourse();
  await join('asha');
  at('2026-11-24T15:05:00Z');
  await queue.addByStaff(staffId, session.id, { name: 'Priya (email)', topic: 'Homework', mode: 'online' });
  const order = await queue.waiting(session.id);
  assert.deepEqual(order.map((t) => t.name), ['asha', 'Priya (email)']);
  assert.equal(order[1].addedBy, staffId);
});

test('closing a session clears the line, and a day later names are erased', async () => {
  const { queue, session, join, at, staffId } = await makeCourse();
  const a = await join('asha');
  await join('ben');
  await queue.claim(staffId, session.id, [a.ticket.id]);
  at('2026-11-24T15:20:00Z');
  await queue.setSessionStatus(session.id, 'closed');
  assert.equal((await queue.waiting(session.id)).length, 0);
  at('2026-11-25T15:21:00Z');
  const r = await queue.housekeeping();
  assert.equal(r.anonymized, 1);
  const rows = await queue.db.all<{ name: string | null; token_hash: string | null; topic: string }>('SELECT name, token_hash, topic FROM tickets');
  assert.ok(rows.every((x) => x.name === null && x.token_hash === null));
  assert.ok(rows.every((x) => x.topic)); // anonymous statistics remain
  const stats = await queue.stats(session.id);
  assert.equal(stats.joined, 2);
  assert.equal(stats.helped, 1);
  assert.equal(stats.medianWaitMinutes, 0);
});

test('emails are never stored, only a keyed fingerprint', async () => {
  const { queue, join } = await makeCourse();
  await join('asha');
  const dump = JSON.stringify(await queue.db.all('SELECT * FROM tickets'));
  assert.ok(!dump.includes('asha@example.edu'));
});

test('housekeeping closes sessions that ran past their end time', async () => {
  const { queue, session, join, at } = await makeCourse();
  await join('asha');
  at('2026-11-24T18:30:00Z');
  assert.equal((await queue.housekeeping()).closed, 1);
  assert.equal((await queue.sessionById(session.id))!.status, 'closed');
});

test('staff sign-in is rate limited', async () => {
  const { queue } = await makeCourse();
  for (let i = 0; i < 5; i++) await assert.rejects(queue.login('ta@example.edu', '000111', 'ip1'), /wrong email or PIN/);
  await assert.rejects(queue.login('ta@example.edu', '246810', 'ip1'), /too many attempts/);
});

test('meeting links must be https', async () => {
  const { queue, staffId } = await makeCourse();
  await assert.rejects(queue.openSession(staffId, { title: 'x', mode: 'online', onlineLink: 'javascript:alert(1)' }), /https/);
  await assert.rejects(queue.openSession(staffId, { title: 'x', mode: 'online', onlineLink: 'http://zoom.us/j/1' }), /https/);
});
