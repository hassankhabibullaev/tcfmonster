// Messages (docs/COCE.md §2c): the person's one thread with the owner. GET /api/messages reads it — the messages and the
// person's reports on questions, by date — and POST /api/messages adds one of theirs; POST /api/messages/read marks the
// owner's answers read (the dot on « Messages » goes). The owner's side is in worker/admin.ts (/api/admin/threads).
// Free plan: one row a message, at most MESSAGES_PER_DAY a person in 24 hours (the page shows what is left), none past
// the hold.
import { type Env, json, fail, nowIso, daysAgoIso, readJson, addWrites, holdReached } from "./util.ts";
import type { Me } from "./auth.ts";

export const MESSAGES_PER_DAY = 5;
export const MAX_BODY = 2000;
/** how far back a thread reads (a thread longer than this shows its newest part) */
const KEEP = 300;

type Row = Record<string, unknown>;

/** one person's thread, oldest first: their messages and the owner's, and their reports, each item tagged by kind */
export async function thread(env: Env, userId: string) {
  const [msgs, reports] = await Promise.all([
    env.DB.prepare(`SELECT id, from_owner, body, dispute_id, event, created_at, read_at FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ${KEEP}`).bind(userId).all<Row>(),
    env.DB.prepare(`SELECT id, section, level, question_id, n, message, status, created_at, resolved_at FROM disputes WHERE user_id = ? ORDER BY id DESC LIMIT ${KEEP}`).bind(userId).all<Row>(),
  ]);
  const items = [
    ...msgs.results.map((m) => ({ kind: "message" as const, id: Number(m.id), fromOwner: m.from_owner === 1, body: String(m.body), disputeId: m.dispute_id == null ? null : Number(m.dispute_id), event: (m.event as "resolved" | "reopened" | null) ?? null, at: String(m.created_at), readAt: (m.read_at as string | null) ?? null })),
    ...reports.results.map((d) => ({ kind: "report" as const, id: Number(d.id), section: String(d.section), level: String(d.level), questionId: String(d.question_id), n: Number(d.n), body: String(d.message), status: String(d.status), at: String(d.created_at), resolvedAt: (d.resolved_at as string | null) ?? null })),
  ];
  // by date; a report and a message at the same instant: the report first (it is what the message follows)
  items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === b.kind ? a.id - b.id : a.kind === "report" ? -1 : 1));
  return items;
}

/** how many messages the person may still send: MESSAGES_PER_DAY in any 24 hours; `resetAt` (when none is left) is the
 *  moment the oldest of them turns a day old and one more may go */
export async function allowance(env: Env, userId: string) {
  const { results } = await env.DB.prepare("SELECT created_at FROM messages WHERE user_id = ? AND from_owner = 0 AND created_at >= ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, daysAgoIso(1), MESSAGES_PER_DAY).all<{ created_at: string }>();
  const left = Math.max(0, MESSAGES_PER_DAY - results.length);
  const oldest = results[results.length - 1]?.created_at;
  return { perDay: MESSAGES_PER_DAY, left, resetAt: left === 0 && oldest ? new Date(Date.parse(oldest) + 86400000).toISOString() : null };
}

/** the owner's answers this person has not opened yet (the dot on « Messages », the card on the dashboard) */
export async function unreadFor(env: Env, userId: string) {
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM messages WHERE from_owner = 1 AND user_id = ? AND read_at IS NULL").bind(userId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

export async function handleMessages(req: Request, env: Env, me: Me, path: string): Promise<Response> {
  if (path === "/messages" && req.method === "GET") {
    const [items, unread, limit] = await Promise.all([thread(env, me.id), unreadFor(env, me.id), allowance(env, me.id)]);
    return json({ items, unread, limit });
  }
  if (req.method !== "POST") return fail(405, "GET or POST");
  if (path === "/messages/read") {
    const r = await env.DB.prepare("UPDATE messages SET read_at = ? WHERE from_owner = 1 AND user_id = ? AND read_at IS NULL").bind(nowIso(), me.id).run();
    if (r.meta.changes) await addWrites(env, 1);
    return json({ ok: true });
  }
  if (path !== "/messages") return fail(404, "not found");
  const b = await readJson<Row>(req);
  if (!b) return fail(400, "json");
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!body) return fail(400, "body");
  if (body.length > MAX_BODY) return fail(400, "too_long");
  // a follow-up to one of their own reports keeps its number; someone else's report is not theirs to name
  let disputeId: number | null = null;
  if (b.disputeId != null) {
    const id = Number(b.disputeId);
    const mine = Number.isInteger(id) ? await env.DB.prepare("SELECT 1 FROM disputes WHERE id = ? AND user_id = ?").bind(id, me.id).first() : null;
    if (!mine) return fail(400, "disputeId");
    disputeId = id;
  }
  const [hold, limit] = await Promise.all([holdReached(env), allowance(env, me.id)]);
  if (hold) return json({ error: "hold" }, 503);
  if (limit.left <= 0) return json({ error: "daily_cap", limit }, 429);
  const at = nowIso();
  const r = await env.DB.prepare("INSERT INTO messages (user_id, from_owner, body, dispute_id, created_at) VALUES (?, 0, ?, ?, ?)").bind(me.id, body, disputeId, at).run();
  await addWrites(env, 1);
  return json({ ok: true, id: r.meta.last_row_id, at, limit: await allowance(env, me.id) }, 201);
}

/* ---------- the owner's side (called from worker/admin.ts, behind its checks) ---------- */

const INBOX_PAGE = 50;

/** every thread with something in it, the latest first; « waiting »: those with an unread message or an open report */
export async function inbox(env: Env, url: URL) {
  const waiting = url.searchParams.get("filter") !== "all";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const rows = (await env.DB.prepare(`WITH t AS (
      SELECT user_id, created_at at, body txt, from_owner who, 'message' kind FROM messages
      UNION ALL SELECT user_id, created_at, message, 0, 'report' FROM disputes
    ), people AS (
      SELECT user_id, MAX(at) at FROM t GROUP BY user_id
    ), counted AS (
      SELECT p.user_id, p.at,
        (SELECT COUNT(*) FROM messages m WHERE m.from_owner = 0 AND m.user_id = p.user_id AND m.read_at IS NULL) unread,
        (SELECT COUNT(*) FROM disputes d WHERE d.user_id = p.user_id AND d.status = 'open') open
      FROM people p
    )
    SELECT c.user_id, c.at, c.unread, c.open, u.name, u.email, u.lang,
      (SELECT txt FROM t WHERE t.user_id = c.user_id ORDER BY t.at DESC LIMIT 1) last_text,
      (SELECT who FROM t WHERE t.user_id = c.user_id ORDER BY t.at DESC LIMIT 1) last_owner,
      (SELECT kind FROM t WHERE t.user_id = c.user_id ORDER BY t.at DESC LIMIT 1) last_kind
    FROM counted c JOIN users u ON u.id = c.user_id
    WHERE ?1 = 0 OR c.unread > 0 OR c.open > 0
    ORDER BY c.at DESC LIMIT ${INBOX_PAGE} OFFSET ${page * INBOX_PAGE}`).bind(waiting ? 1 : 0).all<Row>()).results;
  const totals = await env.DB.prepare(`SELECT
      (SELECT COUNT(DISTINCT user_id) FROM messages WHERE from_owner = 0 AND read_at IS NULL) unreadPeople,
      (SELECT COUNT(*) FROM messages WHERE from_owner = 0 AND read_at IS NULL) unread,
      (SELECT COUNT(*) FROM disputes WHERE status = 'open') open`).first<Row>();
  return {
    threads: rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, lang: r.lang, at: r.at, unread: Number(r.unread), open: Number(r.open), last: { text: String(r.last_text ?? "").slice(0, 160), fromOwner: r.last_owner === 1, kind: r.last_kind } })),
    page, pageSize: INBOX_PAGE, filter: waiting ? "waiting" : "all",
    unread: Number(totals?.unread ?? 0), open: Number(totals?.open ?? 0),
  };
}

/** the owner opens a thread: the person, the items; the person's messages count as read from then on */
export async function ownerThread(env: Env, userId: string) {
  const who = await env.DB.prepare("SELECT id, name, email, lang, created_at, last_seen_at FROM users WHERE id = ?").bind(userId).first<Row>();
  if (!who) return null;
  return { person: who, items: await thread(env, userId) };
}

export async function ownerRead(env: Env, userId: string) {
  await env.DB.prepare("UPDATE messages SET read_at = ? WHERE from_owner = 0 AND user_id = ? AND read_at IS NULL").bind(nowIso(), userId).run();
  return json({ ok: true });
}

/** the owner writes; `disputeId` ties the answer to one of the person's reports, `resolve` marks that report done:
 *  then the same row carries `event: "resolved"` and the answer becomes the report's note */
export async function ownerSend(env: Env, userId: string, b: Row | null) {
  const who = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!who) return fail(404, "no such person");
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!body) return fail(400, "body");
  if (body.length > MAX_BODY) return fail(400, "too_long");
  let disputeId: number | null = null, open = false;
  if (b?.disputeId != null) {
    const id = Number(b.disputeId);
    const theirs = Number.isInteger(id) ? await env.DB.prepare("SELECT status FROM disputes WHERE id = ? AND user_id = ?").bind(id, userId).first<{ status: string }>() : null;
    if (!theirs) return fail(400, "disputeId");
    disputeId = id; open = theirs.status === "open";
  }
  const at = nowIso();
  const closes = disputeId != null && b?.resolve === true && open;
  const writes = [
    env.DB.prepare("INSERT INTO messages (user_id, from_owner, body, dispute_id, event, created_at) VALUES (?, 1, ?, ?, ?, ?)").bind(userId, body, disputeId, closes ? "resolved" : null, at),
    // answering is reading: what the person wrote before is seen
    env.DB.prepare("UPDATE messages SET read_at = ? WHERE from_owner = 0 AND user_id = ? AND read_at IS NULL").bind(at, userId),
  ];
  if (closes) writes.push(env.DB.prepare("UPDATE disputes SET status = 'resolved', resolved_at = ?, note = ? WHERE id = ? AND status = 'open'").bind(at, body, disputeId));
  const res = await env.DB.batch(writes);
  return json({ ok: true, id: res[0].meta.last_row_id, at });
}

/** a report marked done (with the owner's optional note) or open again, from the Disputes page or the chat: the status
 *  changes and the person's thread gets a row saying so, with the note as its words (the dot on « Messages » comes on) */
export async function settleReport(env: Env, id: number, action: string, b: Row | null) {
  if (action !== "resolve" && action !== "reopen") return fail(404, "no such action");
  const d = await env.DB.prepare("SELECT user_id, status FROM disputes WHERE id = ?").bind(id).first<{ user_id: string; status: string }>();
  if (!d) return fail(404, "no such dispute");
  const note = String(b?.note ?? "").trim().slice(0, MAX_BODY);
  const at = nowIso();
  if (action === "resolve" ? d.status === "resolved" : d.status === "open") return json({ ok: true, unchanged: true });
  await env.DB.batch([
    action === "resolve"
      ? env.DB.prepare("UPDATE disputes SET status = 'resolved', resolved_at = ?, note = ? WHERE id = ?").bind(at, note || null, id)
      : env.DB.prepare("UPDATE disputes SET status = 'open', resolved_at = NULL WHERE id = ?").bind(id),
    env.DB.prepare("INSERT INTO messages (user_id, from_owner, body, dispute_id, event, created_at) VALUES (?, 1, ?, ?, ?, ?)").bind(d.user_id, note, id, action === "resolve" ? "resolved" : "reopened", at),
  ]);
  return json({ ok: true });
}
