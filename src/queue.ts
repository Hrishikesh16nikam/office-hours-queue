// All of the queue's rules live here, independent of HTTP and of Cloudflare,
// so they can be tested directly.

import { stmt, type Db } from './db.ts';
import { hashPin, hmac, randomToken, sha256, validPin, verifyPin } from './security.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SessionMode = 'in_person' | 'online' | 'hybrid';
export type TicketMode = 'in_person' | 'online';
export type TicketStatus = 'waiting' | 'helping' | 'done' | 'removed' | 'left';

export interface StaffRow { id: number; name: string; email: string; isAdmin: boolean; active: boolean; joined: boolean }
export interface SessionRow {
  id: number; title: string; mode: SessionMode; location: string | null; onlineLink: string | null; joinCode: string;
  status: 'open' | 'paused' | 'closed'; openedBy: number; openedAt: string; closesAt: string; closedAt: string | null;
}
export interface TicketRow {
  id: number; sessionId: number; studentKey: string | null; name: string | null; topic: string; description: string | null;
  mode: TicketMode; whereDetail: string | null; status: TicketStatus; away: boolean; helpedBefore: number;
  priorityAt: string; joinedAt: string; startedAt: string | null; finishedAt: string | null;
  staffId: number | null; groupId: number | null; addedBy: number | null;
}
export interface Reminder {
  key: string;
  owner: { type: 'ticket' | 'staff'; id: number };
  title: string;
  body: string;
  url: string;
}

export interface Settings {
  courseName: string;
  emailDomain: string; // students must use an email at this domain; empty = any
  timezone: string;
  topics: string[];
  fairnessMinutes: number; // how far each earlier help this week moves a student back
}

const DEFAULT_TOPICS = ['Programming assignment', 'Homework', 'Lecture concepts', 'Exam prep', 'Other'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const STAFF_SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const DEFAULT_HELP_MINUTES = 8;
const MAX_QUEUE = 200;

const LIMITS = { name: 40, description: 280, where: 60, title: 60, location: 80, link: 300, course: 60 };

export function text(v: unknown, max: number, field: string, required = true): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!s) {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
}

export function normalizeEmail(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254) throw new HttpError(400, 'enter a valid email address');
  return s;
}

function safeLink(v: unknown): string | null {
  const s = text(v, LIMITS.link, 'meeting link', false);
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, 'meeting link must be a full https:// address');
  }
  if (u.protocol !== 'https:') throw new HttpError(400, 'meeting link must start with https://');
  return u.toString();
}

/** The local calendar date (YYYY-MM-DD) and weekday (0 = Monday) of an instant in a time zone. */
export function localDate(iso: string, tz: string): { date: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      .formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday };
}

export function weekStart(iso: string, tz: string): string {
  const { date, weekday } = localDate(iso, tz);
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

const addMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();
const minutesBetween = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 60_000;

const mapStaff = (r: Record<string, unknown>): StaffRow => ({
  id: Number(r.id), name: String(r.name), email: String(r.email), isAdmin: Boolean(r.is_admin), active: Boolean(r.active), joined: r.pin_hash != null,
});
const mapSession = (r: Record<string, unknown>): SessionRow => ({
  id: Number(r.id), title: String(r.title), mode: r.mode as SessionMode, location: (r.location as string) ?? null,
  onlineLink: (r.online_link as string) ?? null, joinCode: String(r.join_code), status: r.status as SessionRow['status'],
  openedBy: Number(r.opened_by), openedAt: String(r.opened_at), closesAt: String(r.closes_at), closedAt: (r.closed_at as string) ?? null,
});
const mapTicket = (r: Record<string, unknown>): TicketRow => ({
  id: Number(r.id), sessionId: Number(r.session_id), studentKey: (r.student_key as string) ?? null, name: (r.name as string) ?? null,
  topic: String(r.topic), description: (r.description as string) ?? null, mode: r.mode as TicketMode, whereDetail: (r.where_detail as string) ?? null,
  status: r.status as TicketStatus, away: Boolean(r.away), helpedBefore: Number(r.helped_before), priorityAt: String(r.priority_at),
  joinedAt: String(r.joined_at), startedAt: (r.started_at as string) ?? null, finishedAt: (r.finished_at as string) ?? null,
  staffId: r.staff_id == null ? null : Number(r.staff_id), groupId: r.group_id == null ? null : Number(r.group_id),
  addedBy: r.added_by == null ? null : Number(r.added_by),
});

export interface QueueOptions {
  pepper: string;
  now?: () => Date;
}

export class Queue {
  db: Db;
  private pepper: string;
  private clock: () => Date;

  constructor(db: Db, opts: QueueOptions) {
    if (!opts.pepper || opts.pepper.length < 16) throw new Error('PIN_PEPPER must be at least 16 characters');
    this.db = db;
    this.pepper = opts.pepper;
    this.clock = opts.now ?? (() => new Date());
  }

  now(): Date {
    return this.clock();
  }
  private iso(): string {
    return this.clock().toISOString();
  }

  // ---- settings and setup ---------------------------------------------------

  async isSetUp(): Promise<boolean> {
    return Boolean(await this.db.get('SELECT 1 AS x FROM staff LIMIT 1'));
  }

  async settings(): Promise<Settings> {
    const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      courseName: m.courseName ?? 'Office hours',
      emailDomain: m.emailDomain ?? '',
      timezone: m.timezone ?? 'America/New_York',
      topics: m.topics ? JSON.parse(m.topics) : DEFAULT_TOPICS,
      fairnessMinutes: Number(m.fairnessMinutes ?? 15),
    };
  }

  private settingStmts(s: Partial<Settings>) {
    return Object.entries(s).map(([k, v]) =>
      stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, Array.isArray(v) ? JSON.stringify(v) : String(v)));
  }

  validateSettings(input: Record<string, unknown>, partial = false): Partial<Settings> {
    const out: Partial<Settings> = {};
    if (!partial || input.courseName !== undefined) out.courseName = text(input.courseName, LIMITS.course, 'course name')!;
    if (!partial || input.emailDomain !== undefined) {
      const d = String(input.emailDomain ?? '').trim().toLowerCase().replace(/^@/, '');
      if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new HttpError(400, 'email domain looks wrong, for example northeastern.edu');
      out.emailDomain = d;
    }
    if (!partial || input.timezone !== undefined) {
      const tz = String(input.timezone ?? '');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        throw new HttpError(400, 'unknown time zone');
      }
      if (!tz) throw new HttpError(400, 'time zone is required');
      out.timezone = tz;
    }
    if (!partial || input.topics !== undefined) {
      const topics = Array.isArray(input.topics) ? input.topics.map((t) => text(t, 40, 'topic')!).filter(Boolean) : DEFAULT_TOPICS;
      const unique = [...new Set(topics)];
      if (unique.length < 1 || unique.length > 12) throw new HttpError(400, 'add between 1 and 12 topics');
      out.topics = unique;
    }
    if (!partial || input.fairnessMinutes !== undefined) {
      const f = Number(input.fairnessMinutes ?? 15);
      if (!Number.isInteger(f) || f < 0 || f > 60) throw new HttpError(400, 'fairness setting must be 0 to 60 minutes');
      out.fairnessMinutes = f;
    }
    return out;
  }

  async setup(input: Record<string, unknown>): Promise<StaffRow> {
    if (await this.isSetUp()) throw new HttpError(409, 'already set up');
    const settings = this.validateSettings(input);
    const name = text(input.adminName, LIMITS.name, 'your name')!;
    const email = normalizeEmail(input.adminEmail);
    if (!validPin(input.adminPin)) throw new HttpError(400, 'choose a 6-digit PIN that is not too simple');
    const pinHash = await hashPin(this.pepper, 1, String(input.adminPin));
    await this.db.batch([
      ...this.settingStmts(settings),
      stmt('INSERT INTO staff (id, name, email, pin_hash, is_admin, created_at) VALUES (1, ?, ?, ?, 1, ?)', name, email, pinHash, this.iso()),
    ]);
    return (await this.staffById(1))!;
  }

  async updateSettings(input: Record<string, unknown>): Promise<Settings> {
    await this.db.batch(this.settingStmts(this.validateSettings(input, true)));
    return this.settings();
  }

  // ---- staff accounts ------------------------------------------------------

  async staffById(id: number): Promise<StaffRow | undefined> {
    const r = await this.db.get('SELECT * FROM staff WHERE id = ?', id);
    return r ? mapStaff(r) : undefined;
  }

  async staffList(): Promise<StaffRow[]> {
    return (await this.db.all('SELECT * FROM staff ORDER BY id')).map(mapStaff);
  }

  async addStaff(name: unknown, email: unknown): Promise<StaffRow> {
    const n = text(name, LIMITS.name, 'name')!;
    const e = normalizeEmail(email);
    if (await this.db.get('SELECT 1 FROM staff WHERE email = ?', e)) throw new HttpError(409, 'someone with that email is already on the team');
    const { lastId } = await this.db.run('INSERT INTO staff (name, email, created_at) VALUES (?, ?, ?)', n, e, this.iso());
    return (await this.staffById(lastId))!;
  }

  async setStaffActive(actorId: number, id: number, active: boolean): Promise<StaffRow> {
    if (id === actorId) throw new HttpError(400, 'you cannot deactivate yourself');
    const s = await this.staffById(id);
    if (!s) throw new HttpError(404, 'not found');
    await this.db.batch([
      stmt('UPDATE staff SET active = ? WHERE id = ?', active, id),
      ...(active ? [] : [stmt('DELETE FROM staff_sessions WHERE staff_id = ?', id)]),
    ]);
    return (await this.staffById(id))!;
  }

  async createInvite(staffId: number): Promise<{ token: string }> {
    const s = await this.staffById(staffId);
    if (!s || !s.active) throw new HttpError(404, 'not found');
    const token = randomToken();
    await this.db.batch([
      stmt('DELETE FROM staff_invites WHERE staff_id = ? AND used_at IS NULL', staffId),
      stmt('INSERT INTO staff_invites (token_hash, staff_id, expires_at) VALUES (?, ?, ?)', await sha256(token), staffId, addMinutes(this.iso(), INVITE_DAYS * 1440)),
    ]);
    return { token };
  }

  async inviteInfo(token: string): Promise<{ name: string; course: string }> {
    const inv = await this.validInvite(token);
    return { name: inv.name, course: (await this.settings()).courseName };
  }

  private async validInvite(token: string) {
    const r = await this.db.get<{ staff_id: number; expires_at: string; used_at: string | null; name: string }>(
      'SELECT i.staff_id, i.expires_at, i.used_at, s.name FROM staff_invites i JOIN staff s ON s.id = i.staff_id WHERE i.token_hash = ? AND s.active = 1',
      await sha256(token));
    if (!r || r.used_at || r.expires_at < this.iso()) throw new HttpError(404, 'this invite link has expired or was already used');
    return r;
  }

  async acceptInvite(token: string, pin: unknown): Promise<{ token: string; staff: StaffRow }> {
    const inv = await this.validInvite(token);
    if (!validPin(pin)) throw new HttpError(400, 'choose a 6-digit PIN that is not too simple');
    const session = randomToken();
    await this.db.batch([
      stmt('UPDATE staff SET pin_hash = ? WHERE id = ?', await hashPin(this.pepper, inv.staff_id, pin), inv.staff_id),
      stmt('UPDATE staff_invites SET used_at = ? WHERE token_hash = ?', this.iso(), await sha256(token)),
      stmt('INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)', await sha256(session), inv.staff_id, addMinutes(this.iso(), STAFF_SESSION_DAYS * 1440)),
    ]);
    return { token: session, staff: (await this.staffById(inv.staff_id))! };
  }

  /** Email + PIN sign-in. 5 tries per account and 30 per network address per 15 minutes. */
  async login(email: unknown, pin: unknown, ip: string): Promise<{ token: string; staff: StaffRow }> {
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const since = addMinutes(this.iso(), -15);
    const [byAccount, byIp] = await Promise.all([
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?', `acct:${e}`, since),
      this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?', `ip:${ip}`, since),
    ]);
    if ((byAccount?.n ?? 0) >= 5 || (byIp?.n ?? 0) >= 30) throw new HttpError(429, 'too many attempts, try again in 15 minutes');
    const row = await this.db.get<{ id: number; pin_hash: string | null; active: number }>('SELECT id, pin_hash, active FROM staff WHERE email = ?', e);
    const ok = await verifyPin(this.pepper, row?.id ?? 0, String(pin ?? ''), row?.pin_hash ?? null);
    if (!row || !row.active || !ok) {
      await this.db.batch([
        stmt('INSERT INTO login_attempts (key, at) VALUES (?, ?)', `acct:${e}`, this.iso()),
        stmt('INSERT INTO login_attempts (key, at) VALUES (?, ?)', `ip:${ip}`, this.iso()),
      ]);
      throw new HttpError(401, 'wrong email or PIN');
    }
    const token = randomToken();
    await this.db.batch([
      stmt('DELETE FROM login_attempts WHERE key = ?', `acct:${e}`),
      stmt('INSERT INTO staff_sessions (token_hash, staff_id, expires_at) VALUES (?, ?, ?)', await sha256(token), row.id, addMinutes(this.iso(), STAFF_SESSION_DAYS * 1440)),
    ]);
    return { token, staff: (await this.staffById(row.id))! };
  }

  async staffFromSession(token: string | undefined): Promise<StaffRow | null> {
    if (!token) return null;
    const r = await this.db.get('SELECT s.* FROM staff_sessions x JOIN staff s ON s.id = x.staff_id WHERE x.token_hash = ? AND x.expires_at > ? AND s.active = 1', await sha256(token), this.iso());
    return r ? mapStaff(r) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.run('DELETE FROM staff_sessions WHERE token_hash = ?', await sha256(token));
  }

  async changePin(staffId: number, current: unknown, next: unknown): Promise<void> {
    const row = await this.db.get<{ pin_hash: string | null }>('SELECT pin_hash FROM staff WHERE id = ?', staffId);
    if (!(await verifyPin(this.pepper, staffId, String(current ?? ''), row?.pin_hash ?? null))) throw new HttpError(403, 'current PIN is wrong');
    if (!validPin(next)) throw new HttpError(400, 'choose a 6-digit PIN that is not too simple');
    await this.db.batch([
      stmt('UPDATE staff SET pin_hash = ? WHERE id = ?', await hashPin(this.pepper, staffId, next), staffId),
      stmt('DELETE FROM staff_sessions WHERE staff_id = ?', staffId),
    ]);
  }

  // ---- sessions --------------------------------------------------------------

  private async newCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(5));
      const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!(await this.db.get('SELECT 1 FROM oh_sessions WHERE join_code = ?', code))) return code;
    }
    throw new Error('could not create a join code');
  }

  async openSession(staffId: number, input: Record<string, unknown>): Promise<SessionRow> {
    const title = text(input.title, LIMITS.title, 'title')!;
    const mode = String(input.mode) as SessionMode;
    if (!['in_person', 'online', 'hybrid'].includes(mode)) throw new HttpError(400, 'choose in person, online or both');
    const location = text(input.location, LIMITS.location, 'room', mode !== 'online');
    const onlineLink = safeLink(input.onlineLink);
    if (mode !== 'in_person' && !onlineLink) throw new HttpError(400, 'add the meeting link for online students');
    const minutes = Number(input.durationMinutes ?? 120);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) throw new HttpError(400, 'length must be 15 minutes to 8 hours');
    const now = this.iso();
    const { lastId } = await this.db.run(
      "INSERT INTO oh_sessions (title, mode, location, online_link, join_code, status, opened_by, opened_at, closes_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)",
      title, mode, mode === 'online' ? null : location, mode === 'in_person' ? null : onlineLink, await this.newCode(), staffId, now, addMinutes(now, minutes));
    return (await this.sessionById(lastId))!;
  }

  async sessionById(id: number): Promise<SessionRow | undefined> {
    const r = await this.db.get('SELECT * FROM oh_sessions WHERE id = ?', id);
    return r ? mapSession(r) : undefined;
  }

  async sessionByCode(code: string): Promise<SessionRow | undefined> {
    const r = await this.db.get('SELECT * FROM oh_sessions WHERE join_code = ?', String(code).toUpperCase());
    return r ? mapSession(r) : undefined;
  }

  async recentSessions(limit = 20): Promise<SessionRow[]> {
    return (await this.db.all('SELECT * FROM oh_sessions ORDER BY opened_at DESC LIMIT ?', limit)).map(mapSession);
  }

  async setSessionStatus(id: number, status: 'open' | 'paused' | 'closed'): Promise<SessionRow> {
    const s = await this.sessionById(id);
    if (!s) throw new HttpError(404, 'session not found');
    if (s.status === 'closed') throw new HttpError(409, 'this session is already closed');
    if (status === 'closed') {
      await this.db.batch([
        stmt("UPDATE oh_sessions SET status = 'closed', closed_at = ? WHERE id = ?", this.iso(), id),
        stmt("UPDATE tickets SET status = 'removed', finished_at = ? WHERE session_id = ? AND status = 'waiting'", this.iso(), id),
        stmt("UPDATE tickets SET status = 'done', finished_at = ? WHERE session_id = ? AND status = 'helping'", this.iso(), id),
      ]);
    } else {
      await this.db.run('UPDATE oh_sessions SET status = ? WHERE id = ?', status, id);
    }
    return (await this.sessionById(id))!;
  }

  async extendSession(id: number, minutes: number): Promise<SessionRow> {
    const s = await this.sessionById(id);
    if (!s || s.status === 'closed') throw new HttpError(409, 'session is closed');
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) throw new HttpError(400, 'extend by 5 to 120 minutes');
    const base = s.closesAt > this.iso() ? s.closesAt : this.iso();
    await this.db.run('UPDATE oh_sessions SET closes_at = ? WHERE id = ?', addMinutes(base, minutes), id);
    return (await this.sessionById(id))!;
  }

  // ---- joining and the fairness rule -----------------------------------------

  studentKey(email: string): Promise<string> {
    return hmac(this.pepper, `student:${email}`);
  }

  /** How many times this student has been helped since Monday, in the course's time zone. */
  async helpedThisWeek(studentKey: string): Promise<number> {
    const { timezone } = await this.settings();
    const start = weekStart(this.iso(), timezone);
    const rows = await this.db.all<{ finished_at: string }>(
      "SELECT finished_at FROM tickets WHERE student_key = ? AND status = 'done' AND started_at IS NOT NULL AND finished_at > ?",
      studentKey, addMinutes(this.iso(), -8 * 1440));
    return rows.filter((r) => localDate(r.finished_at, timezone).date >= start).length;
  }

  async join(code: string, input: Record<string, unknown>, ip: string): Promise<{ token: string; ticket: TicketRow }> {
    const s = await this.sessionByCode(code);
    if (!s) throw new HttpError(404, 'no office hours session with that code');
    if (s.status !== 'open' || s.closesAt <= this.iso()) throw new HttpError(409, s.status === 'paused' ? 'the queue is paused, so no new students right now' : 'this session has ended');
    const settings = await this.settings();
    const name = text(input.name, LIMITS.name, 'name')!;
    const email = normalizeEmail(input.email);
    if (settings.emailDomain && !email.endsWith(`@${settings.emailDomain}`)) throw new HttpError(400, `use your @${settings.emailDomain} email`);
    const topic = String(input.topic ?? '');
    if (!settings.topics.includes(topic)) throw new HttpError(400, 'choose a topic');
    const description = text(input.description, LIMITS.description, 'question', false);
    const mode = (s.mode === 'hybrid' ? String(input.mode) : s.mode) as TicketMode;
    if (!['in_person', 'online'].includes(mode)) throw new HttpError(400, 'choose in person or online');
    const whereDetail = text(input.where, LIMITS.where, mode === 'in_person' ? 'where you are sitting' : 'your name on the call', false);

    // Spam guard: 20 joins per network address per 10 minutes, and a size cap.
    const since = addMinutes(this.iso(), -10);
    const recent = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?', `join:${ip}`, since);
    if ((recent?.n ?? 0) >= 20) throw new HttpError(429, 'too many requests, try again in a few minutes');
    const waiting = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE session_id = ? AND status IN ('waiting', 'helping')", s.id);
    if ((waiting?.n ?? 0) >= MAX_QUEUE) throw new HttpError(409, 'the queue is full');

    const key = await this.studentKey(email);
    if (await this.db.get("SELECT 1 FROM tickets WHERE session_id = ? AND student_key = ? AND status IN ('waiting', 'helping')", s.id, key)) {
      throw new HttpError(409, 'you are already in this queue. Open the link on the device you joined with, or ask a TA');
    }
    const helped = await this.helpedThisWeek(key);
    const now = this.iso();
    const token = randomToken();
    const { lastId } = await this.db.batch([
      stmt('INSERT INTO login_attempts (key, at) VALUES (?, ?)', `join:${ip}`, now),
      stmt(`INSERT INTO tickets (session_id, student_key, token_hash, name, topic, description, mode, where_detail, status, helped_before, priority_at, joined_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
      s.id, key, await sha256(token), name, topic, description, mode, whereDetail, helped, addMinutes(now, helped * settings.fairnessMinutes), now),
    ]).then((r) => r[1]);
    return { token, ticket: (await this.ticketById(lastId))! };
  }

  /** A TA adds someone who emailed or asked in person. They get no private link and no fairness history. */
  async addByStaff(staffId: number, sessionId: number, input: Record<string, unknown>): Promise<TicketRow> {
    const s = await this.sessionById(sessionId);
    if (!s || s.status === 'closed') throw new HttpError(409, 'session is closed');
    const settings = await this.settings();
    const name = text(input.name, LIMITS.name, 'name')!;
    const topic = String(input.topic ?? '');
    if (!settings.topics.includes(topic)) throw new HttpError(400, 'choose a topic');
    const mode = (s.mode === 'hybrid' ? String(input.mode) : s.mode) as TicketMode;
    if (!['in_person', 'online'].includes(mode)) throw new HttpError(400, 'choose in person or online');
    const now = this.iso();
    const { lastId } = await this.db.run(
      `INSERT INTO tickets (session_id, name, topic, description, mode, where_detail, status, priority_at, joined_at, added_by)
       VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?)`,
      sessionId, name, topic, text(input.description, LIMITS.description, 'question', false), mode, text(input.where, LIMITS.where, 'details', false), now, now, staffId);
    return (await this.ticketById(lastId))!;
  }

  async ticketById(id: number): Promise<TicketRow | undefined> {
    const r = await this.db.get('SELECT * FROM tickets WHERE id = ?', id);
    return r ? mapTicket(r) : undefined;
  }

  async ticketByToken(token: string | undefined): Promise<TicketRow | undefined> {
    if (!token) return undefined;
    const r = await this.db.get('SELECT * FROM tickets WHERE token_hash = ?', await sha256(token));
    return r ? mapTicket(r) : undefined;
  }

  // ---- the queue -----------------------------------------------------------------

  /** Waiting tickets in serving order: fairness-adjusted join time, then arrival. */
  async waiting(sessionId: number): Promise<TicketRow[]> {
    return (await this.db.all("SELECT * FROM tickets WHERE session_id = ? AND status = 'waiting' ORDER BY priority_at, id", sessionId)).map(mapTicket);
  }

  async helping(sessionId: number): Promise<TicketRow[]> {
    return (await this.db.all("SELECT * FROM tickets WHERE session_id = ? AND status = 'helping' ORDER BY started_at, id", sessionId)).map(mapTicket);
  }

  /**
   * Estimated wait in minutes for each waiting position. Uses this session's
   * average help time (8 minutes until there is data) and the number of TAs
   * active in the last 20 minutes. Students who stepped away don't count.
   */
  async estimates(sessionId: number): Promise<{ avgHelpMinutes: number; activeStaff: number; waitFor: (position: number) => number }> {
    const done = await this.db.all<{ started_at: string; finished_at: string; group_id: number | null; id: number }>(
      "SELECT id, started_at, finished_at, group_id FROM tickets WHERE session_id = ? AND status = 'done' AND started_at IS NOT NULL", sessionId);
    const seen = new Set<number>();
    const durations: number[] = [];
    for (const d of done) {
      const g = d.group_id ?? d.id;
      if (seen.has(g)) continue; // a group help counts once
      seen.add(g);
      durations.push(minutesBetween(d.started_at, d.finished_at));
    }
    const avg = durations.length ? Math.min(30, Math.max(3, durations.reduce((a, b) => a + b, 0) / durations.length)) : DEFAULT_HELP_MINUTES;
    const recent = await this.db.all<{ staff_id: number }>(
      "SELECT DISTINCT staff_id FROM tickets WHERE session_id = ? AND staff_id IS NOT NULL AND (status = 'helping' OR finished_at > ?)",
      sessionId, addMinutes(this.iso(), -20));
    const activeStaff = Math.max(1, recent.length);
    return { avgHelpMinutes: avg, activeStaff, waitFor: (position) => Math.max(1, Math.round((avg * position) / activeStaff)) };
  }

  /** What a student sees for their own ticket. */
  async studentView(token: string | undefined) {
    const t = await this.ticketByToken(token);
    if (!t) throw new HttpError(404, 'ticket not found');
    const s = (await this.sessionById(t.sessionId))!;
    const settings = await this.settings();
    const queue = await this.waiting(s.id);
    const ahead = queue.filter((q) => !q.away);
    const position = t.status === 'waiting' ? ahead.findIndex((q) => q.id === t.id) + 1 : 0;
    const est = await this.estimates(s.id);
    const staff = t.staffId ? await this.staffById(t.staffId) : undefined;
    return {
      course: settings.courseName,
      fairnessMinutes: settings.fairnessMinutes,
      session: this.publicSession(s),
      ticket: {
        id: t.id, name: t.name, topic: t.topic, description: t.description, mode: t.mode, where: t.whereDetail,
        status: t.status, away: t.away, helpedBefore: t.helpedBefore, joinedAt: t.joinedAt,
        position: t.away ? null : position || null,
        waitMinutes: t.status === 'waiting' && !t.away && position ? est.waitFor(position) : null,
        helper: staff ? staff.name : null,
        // The meeting link is only shown once it's this student's turn.
        joinLink: t.status === 'helping' && t.mode === 'online' ? s.onlineLink : null,
      },
      waitingCount: ahead.length,
    };
  }

  publicSession(s: SessionRow) {
    return { title: s.title, mode: s.mode, location: s.location, status: this.effectiveStatus(s), closesAt: s.closesAt, joinCode: s.joinCode };
  }

  private effectiveStatus(s: SessionRow): SessionRow['status'] {
    return s.status !== 'closed' && s.closesAt <= this.iso() ? 'closed' : s.status;
  }

  /** What anyone with the join link sees before joining (no names). */
  async joinInfo(code: string) {
    const s = await this.sessionByCode(code);
    if (!s) throw new HttpError(404, 'no office hours session with that code');
    const settings = await this.settings();
    const queue = (await this.waiting(s.id)).filter((q) => !q.away);
    const est = await this.estimates(s.id);
    return {
      course: settings.courseName, topics: settings.topics, emailDomain: settings.emailDomain, fairnessMinutes: settings.fairnessMinutes,
      session: this.publicSession(s), waitingCount: queue.length, waitMinutes: est.waitFor(queue.length + 1),
    };
  }

  async setAway(token: string | undefined, away: boolean): Promise<void> {
    const t = await this.ticketByToken(token);
    if (!t || t.status !== 'waiting') throw new HttpError(409, 'you are not waiting in a queue');
    await this.db.run('UPDATE tickets SET away = ? WHERE id = ?', away, t.id);
  }

  async updateQuestion(token: string | undefined, description: unknown): Promise<void> {
    const t = await this.ticketByToken(token);
    if (!t || t.status !== 'waiting') throw new HttpError(409, 'you are not waiting in a queue');
    await this.db.run('UPDATE tickets SET description = ? WHERE id = ?', text(description, LIMITS.description, 'question', false), t.id);
  }

  async leave(token: string | undefined): Promise<void> {
    const t = await this.ticketByToken(token);
    if (!t || t.status !== 'waiting') throw new HttpError(409, 'you are not waiting in a queue');
    await this.db.run("UPDATE tickets SET status = 'left', finished_at = ? WHERE id = ?", this.iso(), t.id);
  }

  // ---- TA actions --------------------------------------------------------------

  /**
   * Start helping one or more waiting students. Several tickets with the same
   * topic can be helped together as a group. With no ids, takes the next
   * student who hasn't stepped away.
   */
  async claim(staffId: number, sessionId: number, ids: number[] = []): Promise<{ tickets: TicketRow[]; reminders: Reminder[] }> {
    const s = await this.sessionById(sessionId);
    if (!s || this.effectiveStatus(s) === 'closed') throw new HttpError(409, 'session is closed');
    const queue = await this.waiting(sessionId);
    let chosen: TicketRow[];
    if (ids.length === 0) {
      const next = queue.find((q) => !q.away);
      if (!next) throw new HttpError(409, 'nobody is waiting');
      chosen = [next];
    } else {
      chosen = ids.map((id) => queue.find((q) => q.id === id)).filter((t): t is TicketRow => Boolean(t));
      if (chosen.length !== ids.length) throw new HttpError(409, 'someone was already helped or left, refresh and try again');
      if (new Set(chosen.map((t) => t.topic)).size > 1) throw new HttpError(400, 'group help only works for students with the same topic');
    }
    const now = this.iso();
    const groupId = chosen.length > 1 ? chosen[0].id : null;
    // The status check in the WHERE clause makes double-claims by two TAs impossible.
    const results = await this.db.batch(chosen.map((t) =>
      stmt("UPDATE tickets SET status = 'helping', staff_id = ?, started_at = ?, away = 0, group_id = ? WHERE id = ? AND status = 'waiting'", staffId, now, groupId, t.id)));
    if (results.some((r) => r.changes === 0)) throw new HttpError(409, 'another TA just took that student, refresh and try again');
    const staff = (await this.staffById(staffId))!;
    const reminders: Reminder[] = chosen.filter((t) => t.studentKey).map((t) => ({
      key: `turn:${t.id}:${now}`,
      owner: { type: 'ticket', id: t.id },
      title: "It's your turn",
      body: t.mode === 'online' ? `${staff.name} is ready. Open the queue page to join the call.` : `${staff.name} is coming to help you now.`,
      url: `/t`,
    }));
    reminders.push(...(await this.upNextReminders(sessionId)));
    return { tickets: (await Promise.all(chosen.map((t) => this.ticketById(t.id)))) as TicketRow[], reminders };
  }

  /** Finish helping. Finishing one ticket of a group finishes the whole group. */
  async finish(ticketId: number): Promise<Reminder[]> {
    const t = await this.ticketById(ticketId);
    if (!t || t.status !== 'helping') throw new HttpError(409, 'that student is not being helped');
    const now = this.iso();
    if (t.groupId) await this.db.run("UPDATE tickets SET status = 'done', finished_at = ? WHERE group_id = ? AND status = 'helping'", now, t.groupId);
    else await this.db.run("UPDATE tickets SET status = 'done', finished_at = ? WHERE id = ?", now, ticketId);
    return this.upNextReminders(t.sessionId);
  }

  /** The student wasn't there: put them back in line, keeping their place, or remove them. */
  async requeue(ticketId: number): Promise<void> {
    const t = await this.ticketById(ticketId);
    if (!t || t.status !== 'helping') throw new HttpError(409, 'that student is not being helped');
    await this.db.run("UPDATE tickets SET status = 'waiting', staff_id = NULL, started_at = NULL, group_id = NULL WHERE id = ?", ticketId);
  }

  async remove(ticketId: number): Promise<Reminder[]> {
    const t = await this.ticketById(ticketId);
    if (!t || !['waiting', 'helping'].includes(t.status)) throw new HttpError(409, 'that student is no longer in the queue');
    await this.db.run("UPDATE tickets SET status = 'removed', finished_at = ? WHERE id = ?", this.iso(), ticketId);
    return this.upNextReminders(t.sessionId);
  }

  /** "You're next" for whoever is first in line now, sent at most once per ticket. */
  async upNextReminders(sessionId: number): Promise<Reminder[]> {
    const s = await this.sessionById(sessionId);
    const next = (await this.waiting(sessionId)).find((q) => !q.away && q.studentKey);
    if (!s || !next) return [];
    return [{
      key: `next:${next.id}`,
      owner: { type: 'ticket', id: next.id },
      title: "You're next",
      body: s.mode === 'online' || next.mode === 'online' ? 'Get ready: a TA will start your call soon.' : 'Head back to the room if you stepped out.',
      url: '/t',
    }];
  }

  /** Everything the TA dashboard shows for a session. */
  async staffView(sessionId: number) {
    const s = await this.sessionById(sessionId);
    if (!s) throw new HttpError(404, 'session not found');
    const [waitingRows, helpingRows, est, staff] = await Promise.all([this.waiting(sessionId), this.helping(sessionId), this.estimates(sessionId), this.staffList()]);
    const names = new Map(staff.map((m) => [m.id, m.name]));
    let position = 0;
    const view = (t: TicketRow) => ({
      id: t.id, name: t.name, topic: t.topic, description: t.description, mode: t.mode, where: t.whereDetail,
      status: t.status, away: t.away, helpedBefore: t.helpedBefore, joinedAt: t.joinedAt, startedAt: t.startedAt,
      helper: t.staffId ? names.get(t.staffId) ?? null : null, staffId: t.staffId, groupId: t.groupId, addedByStaff: t.addedBy != null,
      position: t.status === 'waiting' && !t.away ? ++position : null,
    });
    const doneCount = await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tickets WHERE session_id = ? AND status = 'done'", sessionId);
    return {
      session: { ...this.publicSession(s), id: s.id, onlineLink: s.onlineLink, openedAt: s.openedAt },
      waiting: waitingRows.map(view),
      helping: helpingRows.map(view),
      helpedCount: doneCount?.n ?? 0,
      avgHelpMinutes: Math.round(est.avgHelpMinutes),
      activeStaff: est.activeStaff,
    };
  }

  /** Public projector screen: queue length and ticket numbers only, never names. */
  async displayView(code: string) {
    const info = await this.joinInfo(code);
    const s = (await this.sessionByCode(code))!;
    const helping = await this.helping(s.id);
    return { ...info, nowHelping: helping.length, topics: undefined };
  }

  // ---- statistics (anonymous) ---------------------------------------------------

  async stats(sessionId: number) {
    const s = await this.sessionById(sessionId);
    if (!s) throw new HttpError(404, 'session not found');
    const rows = await this.db.all<{ topic: string; status: string; joined_at: string; started_at: string | null; finished_at: string | null; mode: string; helped_before: number }>(
      'SELECT topic, status, joined_at, started_at, finished_at, mode, helped_before FROM tickets WHERE session_id = ?', sessionId);
    const helped = rows.filter((r) => r.status === 'done' && r.started_at);
    const waits = helped.map((r) => minutesBetween(r.joined_at, r.started_at!)).sort((a, b) => a - b);
    const helps = helped.filter((r) => r.finished_at).map((r) => minutesBetween(r.started_at!, r.finished_at!)).sort((a, b) => a - b);
    const median = (xs: number[]) => (xs.length ? Math.round(xs[Math.floor((xs.length - 1) / 2)]) : null);
    const topics: Record<string, number> = {};
    for (const r of rows) topics[r.topic] = (topics[r.topic] ?? 0) + 1;
    return {
      session: { id: s.id, title: s.title, openedAt: s.openedAt, closedAt: s.closedAt, status: this.effectiveStatus(s) },
      joined: rows.length,
      helped: helped.length,
      leftOrRemoved: rows.filter((r) => r.status === 'left' || r.status === 'removed').length,
      repeatVisitors: rows.filter((r) => r.helped_before > 0).length,
      medianWaitMinutes: median(waits),
      longestWaitMinutes: waits.length ? Math.round(waits[waits.length - 1]) : null,
      medianHelpMinutes: median(helps),
      byMode: { in_person: rows.filter((r) => r.mode === 'in_person').length, online: rows.filter((r) => r.mode === 'online').length },
      topics: Object.entries(topics).sort((a, b) => b[1] - a[1]).map(([topic, count]) => ({ topic, count })),
    };
  }

  // ---- push subscriptions ------------------------------------------------------

  async subscribe(owner: { type: 'ticket' | 'staff'; id: number }, sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }): Promise<void> {
    const endpoint = String(sub.endpoint ?? '');
    const p256dh = String(sub.keys?.p256dh ?? '');
    const auth = String(sub.keys?.auth ?? '');
    let host = '';
    try {
      const u = new URL(endpoint);
      if (u.protocol !== 'https:') throw new Error();
      host = u.hostname;
    } catch {
      throw new HttpError(400, 'invalid push subscription');
    }
    // Only real browser push services, so the server can't be pointed at other hosts.
    const allowed = /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/.test(host);
    if (!allowed || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) throw new HttpError(400, 'invalid push subscription');
    await this.db.run(
      `INSERT INTO push_subscriptions (owner_type, owner_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET owner_type = excluded.owner_type, owner_id = excluded.owner_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      owner.type, owner.id, endpoint, p256dh, auth, this.iso());
  }

  async subscriptions(owner: { type: string; id: number }) {
    return this.db.all<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner_type = ? AND owner_id = ?', owner.type, owner.id);
  }

  // ---- housekeeping (runs on a schedule) ------------------------------------------

  /**
   * Closes sessions that ran past their end time, then erases names, questions
   * and seats from sessions closed more than a day ago, and removes push
   * subscriptions for finished tickets.
   */
  async housekeeping(): Promise<{ closed: number; anonymized: number }> {
    const now = this.iso();
    const overdue = await this.db.all<{ id: number }>("SELECT id FROM oh_sessions WHERE status != 'closed' AND closes_at <= ?", now);
    for (const s of overdue) await this.setSessionStatus(s.id, 'closed');
    const old = await this.db.all<{ id: number }>("SELECT id FROM oh_sessions WHERE status = 'closed' AND anonymized = 0 AND closed_at <= ?", addMinutes(now, -1440));
    for (const s of old) {
      await this.db.batch([
        stmt('UPDATE tickets SET name = NULL, description = NULL, where_detail = NULL, token_hash = NULL WHERE session_id = ?', s.id),
        stmt('UPDATE oh_sessions SET anonymized = 1 WHERE id = ?', s.id),
      ]);
    }
    await this.db.batch([
      stmt("DELETE FROM push_subscriptions WHERE owner_type = 'ticket' AND owner_id IN (SELECT id FROM tickets WHERE status NOT IN ('waiting', 'helping'))"),
      stmt('DELETE FROM login_attempts WHERE at < ?', addMinutes(now, -1440)),
      stmt('DELETE FROM staff_sessions WHERE expires_at < ?', now),
      stmt('DELETE FROM notifications WHERE sent_at < ?', addMinutes(now, -14 * 1440)),
    ]);
    return { closed: overdue.length, anonymized: old.length };
  }
}

