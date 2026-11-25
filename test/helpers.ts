import { fileURLToPath } from 'node:url';
import { nodeDb } from '../src/db-node.ts';
import { Queue } from '../src/queue.ts';

export const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
export const PEPPER = 'test-pepper-0123456789';

/** A course with two TAs and a 3-hour hybrid session opened on a Tuesday, Boston time. */
export async function makeCourse(startIso = '2026-11-24T15:00:00Z') {
  const clock = { now: new Date(startIso) };
  const queue = new Queue(nodeDb(':memory:', MIGRATIONS), { pepper: PEPPER, now: () => clock.now });
  const admin = await queue.setup({
    courseName: 'EECE 2540', emailDomain: 'example.edu', timezone: 'America/New_York',
    topics: ['Programming assignment', 'Homework', 'Exam prep'], fairnessMinutes: 15,
    adminName: 'Hrishikesh', adminEmail: 'ta@example.edu', adminPin: '246810',
  });
  const other = await queue.addStaff('Sam', 'sam@example.edu');
  const { token } = await queue.createInvite(other.id);
  await queue.acceptInvite(token, '135790');
  const session = await queue.openSession(admin.id, {
    title: 'Tuesday', mode: 'hybrid', location: 'Snell 033', onlineLink: 'https://example.zoom.us/j/1', durationMinutes: 180,
  });
  let ip = 0;
  const join = (name: string, code = session.joinCode, topic = 'Programming assignment', mode = 'in_person') =>
    queue.join(code, { name, email: `${name}@example.edu`, topic, mode }, `10.0.0.${++ip}`);
  return { queue, session, join, staffId: admin.id, otherStaffId: other.id, at: (iso: string) => { clock.now = new Date(iso); } };
}
