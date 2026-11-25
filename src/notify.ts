import type { Queue, Reminder } from './queue.ts';
import { sendPush, type VapidKeys } from './push.ts';

export type Fetcher = typeof fetch;

/**
 * Deliver a notification to every device the owner enabled, at most once:
 * the key is recorded before sending, so retries never double-notify.
 * Subscriptions the push service reports as gone are deleted.
 */
export async function deliver(queue: Queue, keys: VapidKeys | null, r: Reminder, fetchFn: Fetcher = fetch): Promise<string> {
  const { changes } = await queue.db.run(
    "INSERT OR IGNORE INTO notifications (key, title, body, status, sent_at) VALUES (?, ?, ?, 'sending', ?)",
    r.key, r.title, r.body, queue.now().toISOString());
  if (changes === 0) return 'duplicate';
  const subs = await queue.subscriptions(r.owner);
  let status = 'no-device';
  const errors: string[] = [];
  if (keys && subs.length) {
    let ok = 0;
    for (const s of subs) {
      try {
        const res = await sendPush(s, { title: r.title, body: r.body, url: r.url, tag: r.key.split(':').slice(0, 2).join(':') }, keys, fetchFn);
        if (res.ok) ok++;
        else if (res.gone) await queue.db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
        else errors.push(`HTTP ${res.status}`);
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    status = ok > 0 ? 'sent' : 'failed';
  }
  await queue.db.run('UPDATE notifications SET status = ?, error = ? WHERE key = ?', status, errors.join('; ').slice(0, 300) || null, r.key);
  return status;
}

export async function deliverAll(queue: Queue, keys: VapidKeys | null, reminders: Reminder[], fetchFn: Fetcher = fetch): Promise<void> {
  for (const r of reminders) await deliver(queue, keys, r, fetchFn);
}
