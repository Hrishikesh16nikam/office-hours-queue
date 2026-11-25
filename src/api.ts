// The HTTP API as a standard fetch handler (Request in, Response out), so it
// runs unchanged on Cloudflare Workers and on Node.

import { deliverAll, type Fetcher } from './notify.ts';
import type { VapidKeys } from './push.ts';
import { HttpError, type Queue, type Reminder, type StaffRow } from './queue.ts';
import { timingSafeEqual } from './security.ts';

export interface ApiContext {
  queue: Queue;
  setupCode: string;
  vapid: VapidKeys | null;
  /** Keep background work (sending pushes) alive after the response. */
  waitUntil: (p: Promise<unknown>) => void;
  fetchFn?: Fetcher;
}

const STAFF_COOKIE = 'ohq_staff';
const TICKET_COOKIE = 'ohq_ticket';
const JSON_LIMIT = 16 * 1024;

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

interface Req {
  request: Request;
  url: URL;
  params: Record<string, string>;
  staff: StaffRow | null;
  ip: string;
  cookies: string[];
}

type Handler = (r: Req, c: ApiContext) => Promise<unknown>;
type Access = 'public' | 'staff' | 'admin';
interface Route { method: string; pattern: RegExp; access: Access; handler: Handler }
const routes: Route[] = [];
const route = (method: string, path: string, access: Access, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), access, handler });

const num = (r: Req, key = 'id') => {
  const n = Number(r.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `invalid ${key}`);
  return n;
};

function notify(c: ApiContext, reminders: Reminder[]) {
  if (reminders.length) c.waitUntil(deliverAll(c.queue, c.vapid, reminders, c.fetchFn).catch((e) => console.error('[push]', e)));
}

async function json(r: Req): Promise<Record<string, unknown>> {
  if (!(r.request.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'expected JSON');
  const declared = Number(r.request.headers.get('content-length') ?? NaN);
  if (declared > JSON_LIMIT) throw new HttpError(413, 'request too large');
  const buf = new Uint8Array(await r.request.arrayBuffer());
  if (buf.length > JSON_LIMIT) throw new HttpError(413, 'request too large');
  try {
    const v = JSON.parse(new TextDecoder().decode(buf) || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid JSON');
  }
}

function cookie(r: Req, name: string, value: string, maxAge: number): string {
  const secure = r.url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || undefined;
  }
  return undefined;
}

const ticketToken = (r: Req) => readCookie(r.request, TICKET_COOKIE);
const publicStaff = (s: StaffRow) => ({ id: s.id, name: s.name, email: s.email, isAdmin: s.isAdmin, active: s.active, joined: s.joined });

// ---- setup and status ------------------------------------------------------------

route('GET', '/api/status', 'public', async (_r, c) => ({
  setUp: await c.queue.isSetUp(),
  course: (await c.queue.settings()).courseName,
}));

route('POST', '/api/setup', 'public', async (r, c) => {
  const b = await json(r);
  if (!c.setupCode || !timingSafeEqual(String(b.setupCode ?? ''), c.setupCode)) throw new HttpError(403, 'wrong setup code');
  const admin = await c.queue.setup(b);
  const { token, staff } = await c.queue.login(admin.email, String(b.adminPin), r.ip);
  r.cookies.push(cookie(r, STAFF_COOKIE, token, 30 * 86400));
  return { staff: publicStaff(staff) };
});

route('GET', '/api/push/key', 'public', async (_r, c) => ({ publicKey: c.vapid?.publicKey ?? null }));

// ---- students ------------------------------------------------------------------

route('GET', '/api/join/:code', 'public', async (r, c) => c.queue.joinInfo(r.params.code));

route('POST', '/api/join/:code', 'public', async (r, c) => {
  const { token } = await c.queue.join(r.params.code, await json(r), r.ip);
  r.cookies.push(cookie(r, TICKET_COOKIE, token, 86400));
  return c.queue.studentView(token);
});

route('GET', '/api/ticket', 'public', async (r, c) => c.queue.studentView(ticketToken(r)));

route('POST', '/api/ticket/away', 'public', async (r, c) => {
  await c.queue.setAway(ticketToken(r), Boolean((await json(r)).away));
  const t = await c.queue.ticketByToken(ticketToken(r));
  if (t) notify(c, await c.queue.upNextReminders(t.sessionId));
  return c.queue.studentView(ticketToken(r));
});

route('POST', '/api/ticket/question', 'public', async (r, c) => {
  await c.queue.updateQuestion(ticketToken(r), (await json(r)).description);
  return c.queue.studentView(ticketToken(r));
});

route('POST', '/api/ticket/leave', 'public', async (r, c) => {
  const t = await c.queue.ticketByToken(ticketToken(r));
  await c.queue.leave(ticketToken(r));
  if (t) notify(c, await c.queue.upNextReminders(t.sessionId));
  r.cookies.push(cookie(r, TICKET_COOKIE, '', 0));
  return { ok: true };
});

route('POST', '/api/ticket/push', 'public', async (r, c) => {
  const t = await c.queue.ticketByToken(ticketToken(r));
  if (!t || !['waiting', 'helping'].includes(t.status)) throw new HttpError(409, 'you are not in a queue');
  await c.queue.subscribe({ type: 'ticket', id: t.id }, await json(r));
  return { ok: true };
});

route('GET', '/api/display/:code', 'public', async (r, c) => c.queue.displayView(r.params.code));

// ---- staff sign-in and invites ----------------------------------------------------

route('POST', '/api/login', 'public', async (r, c) => {
  const b = await json(r);
  const { token, staff } = await c.queue.login(b.email, b.pin, r.ip);
  r.cookies.push(cookie(r, STAFF_COOKIE, token, 30 * 86400));
  return { staff: publicStaff(staff) };
});

route('POST', '/api/logout', 'public', async (r, c) => {
  await c.queue.logout(readCookie(r.request, STAFF_COOKIE));
  r.cookies.push(cookie(r, STAFF_COOKIE, '', 0));
  return { ok: true };
});

route('GET', '/api/invites/:token', 'public', async (r, c) => c.queue.inviteInfo(r.params.token));

route('POST', '/api/invites/:token', 'public', async (r, c) => {
  const { token, staff } = await c.queue.acceptInvite(r.params.token, (await json(r)).pin);
  r.cookies.push(cookie(r, STAFF_COOKIE, token, 30 * 86400));
  return { staff: publicStaff(staff) };
});

route('GET', '/api/me', 'staff', async (r) => ({ staff: publicStaff(r.staff!) }));

route('POST', '/api/me/pin', 'staff', async (r, c) => {
  const b = await json(r);
  await c.queue.changePin(r.staff!.id, b.current, b.next);
  r.cookies.push(cookie(r, STAFF_COOKIE, '', 0));
  return { ok: true };
});

route('POST', '/api/push/subscribe', 'staff', async (r, c) => {
  await c.queue.subscribe({ type: 'staff', id: r.staff!.id }, await json(r));
  return { ok: true };
});

route('POST', '/api/push/unsubscribe', 'public', async (r, c) => {
  const endpoint = String((await json(r)).endpoint ?? '');
  const staff = await c.queue.staffFromSession(readCookie(r.request, STAFF_COOKIE));
  const ticket = await c.queue.ticketByToken(ticketToken(r));
  // Only the owner of a subscription may remove it.
  if (staff) await c.queue.db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_type = 'staff' AND owner_id = ?", endpoint, staff.id);
  if (ticket) await c.queue.db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_type = 'ticket' AND owner_id = ?", endpoint, ticket.id);
  return { ok: true };
});

// ---- course settings and team (admin) -----------------------------------------------

route('GET', '/api/settings', 'staff', async (_r, c) => c.queue.settings());
route('PATCH', '/api/settings', 'admin', async (r, c) => c.queue.updateSettings(await json(r)));

route('GET', '/api/staff', 'staff', async (_r, c) => ({ staff: (await c.queue.staffList()).map(publicStaff) }));
route('POST', '/api/staff', 'admin', async (r, c) => {
  const b = await json(r);
  return { staff: publicStaff(await c.queue.addStaff(b.name, b.email)) };
});
route('POST', '/api/staff/:id/invite', 'admin', async (r, c) => {
  const { token } = await c.queue.createInvite(num(r));
  return { url: `${r.url.origin}/invite/${token}` };
});
route('PATCH', '/api/staff/:id', 'admin', async (r, c) => {
  const b = await json(r);
  return { staff: publicStaff(await c.queue.setStaffActive(r.staff!.id, num(r), Boolean(b.active))) };
});

// ---- sessions and the queue (any TA) -------------------------------------------------

route('GET', '/api/sessions', 'staff', async (_r, c) => ({
  sessions: (await c.queue.recentSessions()).map((s) => ({ ...c.queue.publicSession(s), id: s.id, openedAt: s.openedAt })),
}));

route('POST', '/api/sessions', 'staff', async (r, c) => {
  const s = await c.queue.openSession(r.staff!.id, await json(r));
  return { id: s.id, joinCode: s.joinCode };
});

route('GET', '/api/sessions/:id', 'staff', async (r, c) => c.queue.staffView(num(r)));

route('POST', '/api/sessions/:id/status', 'staff', async (r, c) => {
  const status = String((await json(r)).status);
  if (!['open', 'paused', 'closed'].includes(status)) throw new HttpError(400, 'invalid status');
  await c.queue.setSessionStatus(num(r), status as 'open' | 'paused' | 'closed');
  return c.queue.staffView(num(r));
});

route('POST', '/api/sessions/:id/extend', 'staff', async (r, c) => {
  await c.queue.extendSession(num(r), Number((await json(r)).minutes));
  return c.queue.staffView(num(r));
});

route('POST', '/api/sessions/:id/claim', 'staff', async (r, c) => {
  const b = await json(r);
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const { reminders } = await c.queue.claim(r.staff!.id, num(r), ids);
  notify(c, reminders);
  return c.queue.staffView(num(r));
});

route('POST', '/api/sessions/:id/add', 'staff', async (r, c) => {
  await c.queue.addByStaff(r.staff!.id, num(r), await json(r));
  return c.queue.staffView(num(r));
});

route('GET', '/api/sessions/:id/stats', 'staff', async (r, c) => c.queue.stats(num(r)));

async function ticketSession(c: ApiContext, id: number): Promise<number> {
  const t = await c.queue.ticketById(id);
  if (!t) throw new HttpError(404, 'ticket not found');
  return t.sessionId;
}

route('POST', '/api/tickets/:id/finish', 'staff', async (r, c) => {
  const sid = await ticketSession(c, num(r));
  notify(c, await c.queue.finish(num(r)));
  return c.queue.staffView(sid);
});

route('POST', '/api/tickets/:id/requeue', 'staff', async (r, c) => {
  const sid = await ticketSession(c, num(r));
  await c.queue.requeue(num(r));
  return c.queue.staffView(sid);
});

route('POST', '/api/tickets/:id/remove', 'staff', async (r, c) => {
  const sid = await ticketSession(c, num(r));
  notify(c, await c.queue.remove(num(r)));
  return c.queue.staffView(sid);
});

// ---- dispatcher ------------------------------------------------------------------

export async function handleApi(request: Request, c: ApiContext): Promise<Response> {
  const url = new URL(request.url);
  const r: Req = {
    request, url, params: {}, staff: null, cookies: [],
    ip: request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local',
  };
  try {
    const allowed: string[] = [];
    for (const rt of routes) {
      const m = rt.pattern.exec(url.pathname);
      if (!m) continue;
      allowed.push(rt.method);
      if (rt.method !== request.method) continue;
      r.params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      if (request.method !== 'GET') {
        // CSRF: browsers send Origin on cross-site writes; it must be ours.
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'cross-origin request rejected');
      }
      if (rt.access !== 'public') {
        r.staff = await c.queue.staffFromSession(readCookie(request, STAFF_COOKIE));
        if (!r.staff) throw new HttpError(401, 'please sign in');
        if (rt.access === 'admin' && !r.staff.isAdmin) throw new HttpError(403, 'only the course admin can do that');
      }
      return jsonResponse(200, await rt.handler(r, c), r.cookies);
    }
    if (allowed.length) throw new HttpError(405, 'method not allowed');
    throw new HttpError(404, 'not found');
  } catch (e) {
    if (e instanceof HttpError) return jsonResponse(e.status, { error: e.message }, r.cookies);
    console.error(`[api] ${request.method} ${url.pathname}`, e);
    return jsonResponse(500, { error: 'something went wrong' }, []);
  }
}

function jsonResponse(status: number, body: unknown, cookies: string[]): Response {
  const headers = new Headers({ ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
