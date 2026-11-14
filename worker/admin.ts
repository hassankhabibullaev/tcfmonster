// The admin's API (/api/admin/*): the people who registered and what they do, one person's page and actions, the
// reports on questions. Owner only once sign-in exists (ADMIN_OPEN = "0"); every request that changes something must
// carry the header x-admin: 1, which a page on another site cannot send without the browser asking first.
import { passedAccess, isOwnerEmail } from "./access.ts";
import { failedMails, sentToday, dayTotal, brevoUsable, RESEND_DAY, BREVO_DAY } from "./mail.ts";
import { type Env, json, fail, nowIso, day, daysAgoIso, readJson, BUDGET_HOLD } from "./util.ts";
import { currentUser, CODES_PER_HOUR, CODES_PER_DAY } from "./auth.ts";
import { blockUser, unblockUser, parseSigns, scoreOf, SIGNS, ASK_AT, BLOCK_AT } from "./guard.ts";
import { LEVELS, MERGED } from "../shared/progress.ts";
import { inbox, ownerThread, ownerRead, ownerSend, settleReport } from "./messages.ts";

type Row = Record<string, unknown>;
const all = async (env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).all()).results as Row[];
const one = async (env: Env, sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first()) as Row | null;
const num = (r: Row | null, k = "n") => Number(r?.[k] ?? 0);

/** is this request the owner's? While ADMIN_OPEN is "1", everyone is. */
export async function isOwner(env: Env, req: Request) {
  if (env.ADMIN_OPEN === "1") return true;
  const me = await currentUser(env, req);
  return !!me && isOwnerEmail(env, me.email) && (await passedAccess(env, req));
}

/** colours of one person's practice per section: { co: { ok, bad, amber }, ce: … } */
function colours(rows: Row[]) {
  const out: Record<string, { ok: number; bad: number; amber: number }> = {};
  for (const r of rows) {
    const c = (out[String(r.section)] ??= { ok: 0, bad: 0, amber: 0 });
    let blob: { q?: Record<string, unknown[]> } = {};
    try { blob = JSON.parse(String(r.data)); } catch { /* a broken row counts as empty */ }
    for (const [k, v] of Object.entries(blob.q ?? {})) {
      if (MERGED[k]) continue; // a merged question counts once, on the kept one
      // the app's state is { s: green | red | amber, t, a } (shared/progress.ts)
      const s = v && typeof v === "object" ? (v as { s?: string }).s : null;
      if (s === "green") c.ok++;
      else if (s === "red") c.bad++;
      else if (s === "amber") c.amber++;
    }
  }
  return out;
}

/** minutes the app's time zone is ahead of UTC, now */
function offsetMinutes(tz: string, at = new Date()) {
  const local = new Date(at.toLocaleString("en-US", { timeZone: tz }));
  const utc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

/**
 * The first page (« Today »): what waits for the owner, then how the app is used — this week against the one before,
 * how far people go, what they use, who sits the exam soon, and the free plan's lines. Every figure is counted from
 * real rows at the moment of asking.
 */
async function overview(env: Env) {
  const tz = env.APP_TZ, now = Date.now(), at = nowIso();
  const off = offsetMinutes(tz);
  const shift = `${off >= 0 ? "+" : ""}${off} minutes`;
  const local = (n: number) => day(tz, new Date(now + n * 86400000));
  const today = local(0);
  const todayStart = new Date(Date.parse(today + "T00:00:00Z") - off * 60000).toISOString();
  const d7 = daysAgoIso(7), d14 = daysAgoIso(14), d30 = daysAgoIso(30);
  const day7 = local(-6), day14 = local(-13);
  const [u, practice, exams, expr, mocks, studied, used, far, blocked, checks, disputesOpen, messagesUnread, mailFailed, jobs, budget, sent, cap, nets, devices, daily, joinedDaily, adoption, keys, targets, places, mailDays, writeDays, mailToday, brevoOk] = await Promise.all([
    one(env, `SELECT COUNT(*) people, SUM(created_at >= ?1) joinedToday, SUM(created_at >= ?2) joined7, SUM(created_at >= ?3 AND created_at < ?2) joinedPrev7,
      SUM(last_seen_at >= ?1) activeToday, SUM(last_seen_at >= ?2) active7, SUM(last_seen_at >= ?4) active30,
      SUM(name IS NOT NULL) named, SUM(gemini_status = 'ok') withKey, SUM(lang = 'en') english,
      SUM(exam_date >= ?5) examAhead, SUM(exam_date >= ?5 AND exam_date <= ?6) exam7, SUM(exam_date >= ?5 AND exam_date <= ?7) exam30,
      SUM(blocked_at IS NOT NULL) blocked, AVG(target_nclc) target,
      SUM(created_at >= ?8 AND created_at < ?2) cohort,
      SUM(created_at >= ?8 AND created_at < ?2 AND last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+7 days')) stayed
      FROM users`, todayStart, d7, d14, d30, today, local(7), local(30), daysAgoIso(37)),
    one(env, `SELECT COALESCE(SUM(CASE WHEN day >= ?1 THEN answered END), 0) n7, COALESCE(SUM(CASE WHEN day < ?1 THEN answered END), 0) prev,
      COALESCE(SUM(CASE WHEN day >= ?1 AND section = 'co' THEN answered END), 0) co, COALESCE(SUM(CASE WHEN day >= ?1 AND section = 'ce' THEN answered END), 0) ce,
      COALESCE(SUM(CASE WHEN day >= ?1 THEN seconds END), 0) seconds FROM practice_days WHERE day >= ?2`, day7, day14),
    one(env, `SELECT SUM(finished_at >= ?1) n7, SUM(finished_at >= ?2 AND finished_at < ?1) prev,
      SUM(finished_at >= ?1 AND section = 'co') co, SUM(finished_at >= ?1 AND section = 'ce') ce,
      AVG(CASE WHEN section = 'co' AND mode = 'exam' THEN nclc END) coNclc, AVG(CASE WHEN section = 'ce' AND mode = 'exam' THEN nclc END) ceNclc,
      SUM(CASE WHEN finished_at >= ?1 THEN (julianday(finished_at) - julianday(started_at)) * 86400 END) seconds
      FROM attempts WHERE finished_at >= ?3`, d7, d14, d30),
    one(env, `SELECT SUM(finished_at >= ?1) n7, SUM(finished_at >= ?2 AND finished_at < ?1) prev,
      SUM(finished_at >= ?1 AND section = 'ee') ee, SUM(finished_at >= ?1 AND section = 'eo') eo,
      AVG(CASE WHEN section = 'ee' THEN nclc END) eeNclc, AVG(CASE WHEN section = 'eo' THEN nclc END) eoNclc,
      SUM(CASE WHEN finished_at >= ?1 THEN seconds END) seconds
      FROM expr_sessions WHERE status = 'done' AND finished_at >= ?3`, d7, d14, d30),
    one(env, "SELECT SUM(finished_at >= ?1) n7, SUM(finished_at < ?1) prev FROM mocks WHERE status = 'done' AND finished_at >= ?2", d7, d14),
    // someone who practised, sat an exam or started a writing or speaking session: this week, the week before
    one(env, `SELECT COUNT(DISTINCT CASE WHEN d >= ?1 THEN u END) n7, COUNT(DISTINCT CASE WHEN d < ?1 THEN u END) prev FROM (
        SELECT day d, user_id u FROM practice_days WHERE day >= ?2
        UNION ALL SELECT date(started_at, ?3), user_id FROM attempts WHERE started_at >= ?4
        UNION ALL SELECT date(started_at, ?3), user_id FROM expr_sessions WHERE started_at >= ?4)
      WHERE d >= ?2`, day7, day14, shift, daysAgoIso(15)),
    // the people behind each test over seven days
    all(env, `SELECT s, COUNT(DISTINCT u) people FROM (
        SELECT section s, user_id u FROM practice_days WHERE day >= ?1
        UNION ALL SELECT section, user_id FROM attempts WHERE started_at >= ?2
        UNION ALL SELECT section, user_id FROM expr_sessions WHERE started_at >= ?2
        UNION ALL SELECT 'mock', user_id FROM mocks WHERE started_at >= ?2) GROUP BY s`, day7, d7),
    // how far people ever went
    one(env, `SELECT (SELECT COUNT(DISTINCT user_id) FROM practice_days) practised,
      (SELECT COUNT(DISTINCT user_id) FROM attempts WHERE finished_at IS NOT NULL) examined,
      (SELECT COUNT(DISTINCT user_id) FROM expr_sessions WHERE status = 'done') expressed,
      (SELECT COUNT(DISTINCT user_id) FROM mocks WHERE status = 'done') mocked,
      (SELECT COUNT(*) FROM users u WHERE ${STARTED}) started`),
    all(env, "SELECT id, name, email, blocked_at, blocked_reason FROM users WHERE blocked_at >= ? ORDER BY blocked_at DESC LIMIT 10", d7),
    // the human check asked and failed again and again: perhaps a person who cannot pass it
    all(env, "SELECT id, name, email, human_needed_at, human_reason, human_fails FROM users WHERE human_needed_at IS NOT NULL AND human_fails >= 3 AND blocked_at IS NULL ORDER BY human_needed_at DESC LIMIT 10"),
    one(env, "SELECT COUNT(*) n FROM disputes WHERE status = 'open'"),
    one(env, "SELECT COUNT(*) n FROM messages WHERE from_owner = 0 AND read_at IS NULL"),
    failedMails(env),
    all(env, "SELECT name, last_at, ok, detail FROM jobs ORDER BY name"),
    one(env, "SELECT writes n FROM budget WHERE day = ?", today),
    sentToday(env),
    dayTotal(env),
    one(env, "SELECT COALESCE(SUM(strict_until > ?1), 0) strict, COALESCE(SUM(closed_until > ?1), 0) closed FROM guard_networks", at),
    one(env, `SELECT COUNT(DISTINCT user_id) people, COUNT(DISTINCT CASE WHEN device LIKE 'iPhone%' OR device LIKE 'Android%' THEN user_id END) phone,
      COUNT(DISTINCT CASE WHEN device LIKE 'iPad%' THEN user_id END) tablet
      FROM sessions WHERE expires_at > ?`, at),
    // each of the last 30 days: the people who studied (practice, an exam, a session) and the answers they gave
    all(env, `SELECT d, COUNT(DISTINCT u) people FROM (
        SELECT day d, user_id u FROM practice_days WHERE day >= ?1
        UNION ALL SELECT date(started_at, ?2), user_id FROM attempts WHERE started_at >= ?3
        UNION ALL SELECT date(started_at, ?2), user_id FROM expr_sessions WHERE started_at >= ?3)
      WHERE d >= ?1 GROUP BY d`, local(-29), shift, daysAgoIso(31)),
    all(env, `SELECT date(created_at, ?1) d, COUNT(*) n FROM users WHERE created_at >= ?2 GROUP BY d`, shift, daysAgoIso(31)),
    // what the people who studied in 30 days used in those 30 days: each feature, and the help switches they keep on
    one(env, `WITH act AS (
        SELECT user_id u FROM practice_days WHERE day >= ?1
        UNION SELECT user_id FROM attempts WHERE started_at >= ?2
        UNION SELECT user_id FROM expr_sessions WHERE started_at >= ?2)
      SELECT (SELECT COUNT(*) FROM act) base,
        (SELECT COUNT(DISTINCT user_id) FROM practice_days WHERE day >= ?1 AND section = 'co') coPractice,
        (SELECT COUNT(DISTINCT user_id) FROM practice_days WHERE day >= ?1 AND section = 'ce') cePractice,
        (SELECT COUNT(DISTINCT user_id) FROM attempts WHERE started_at >= ?2 AND mode = 'exam') realExam,
        (SELECT COUNT(DISTINCT user_id) FROM attempts WHERE started_at >= ?2 AND mode = 'training') freeExam,
        (SELECT COUNT(DISTINCT user_id) FROM expr_sessions WHERE started_at >= ?2 AND section = 'ee') ee,
        (SELECT COUNT(DISTINCT user_id) FROM expr_sessions WHERE started_at >= ?2 AND section = 'eo') eo,
        (SELECT COUNT(DISTINCT user_id) FROM mocks WHERE started_at >= ?2) mock,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND gemini_status = 'ok') key,
        (SELECT COUNT(DISTINCT user_id) FROM messages WHERE from_owner = 0 AND created_at >= ?2) wrote,
        (SELECT COUNT(DISTINCT user_id) FROM disputes WHERE created_at >= ?2) reported,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND exam_date IS NOT NULL) examDate,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND json_extract(settings, '$.help.co.autoplay') = 1) autoplay,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND json_extract(settings, '$.help.co.transcript') = 1) transcript,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND (json_extract(settings, '$.help.co.hint') = 1 OR json_extract(settings, '$.help.ce.hint') = 1)) hint,
        (SELECT COUNT(*) FROM users WHERE id IN (SELECT u FROM act) AND (json_extract(settings, '$.help.co.english') = 1 OR json_extract(settings, '$.help.ce.english') = 1)) english`, local(-29), d30),
    // the Gemini key over everyone who finished the welcome: works, none, refused by Google, its daily limit reached
    all(env, "SELECT COALESCE(gemini_status, 'none') s, COUNT(*) n FROM users WHERE name IS NOT NULL GROUP BY s"),
    all(env, "SELECT target_nclc t, COUNT(*) n FROM users WHERE target_nclc IS NOT NULL GROUP BY t ORDER BY t"),
    // where they are: the part of the world of the time zone their browser gave
    all(env, `SELECT CASE WHEN tz IS NULL OR tz = '' THEN 'Unknown' WHEN instr(tz, '/') = 0 THEN 'Other' ELSE substr(tz, 1, instr(tz, '/') - 1) END r, COUNT(*) n
      FROM (SELECT json_extract(settings, '$.tz') tz FROM users WHERE name IS NOT NULL) GROUP BY r ORDER BY n DESC`),
    all(env, "SELECT substr(at, 1, 10) d, SUM(ok = 1 AND detail IS NULL) resend, SUM(ok = 1 AND detail = 'brevo') brevo, SUM(ok = 0) failed FROM mail WHERE at >= ? GROUP BY d", daysAgoIso(14)),
    all(env, "SELECT day d, writes n FROM budget WHERE day >= ? ORDER BY day", local(-13)),
    one(env, "SELECT COALESCE(SUM(ok = 1 AND detail IS NULL), 0) resend, COALESCE(SUM(ok = 1 AND detail = 'brevo'), 0) brevo, COALESCE(SUM(ok = 0), 0) failed FROM mail WHERE at >= ?", at.slice(0, 10)),
    brevoUsable(env),
  ]);
  const n = (k: string) => num(u, k);
  const avg = (r: Row | null, k: string) => (r?.[k] == null ? null : Math.round(Number(r[k]) * 10) / 10);
  const people = Object.fromEntries(used.map((r) => [String(r.s), num(r, "people")]));
  return {
    today,
    needs: {
      blocked, blockedTotal: n("blocked"), checks, disputesOpen: num(disputesOpen), messagesUnread: num(messagesUnread), mailFailed,
      jobsFailed: jobs.filter((j) => !Number(j.ok)),
    },
    people: {
      total: n("people"), joinedToday: n("joinedToday"), joined7: n("joined7"), joinedPrev7: n("joinedPrev7"),
      activeToday: n("activeToday"), active7: n("active7"), active30: n("active30"), studied7: num(studied, "n7"), studiedPrev7: num(studied, "prev"),
    },
    work: {
      answers7: num(practice, "n7"), answersPrev7: num(practice, "prev"), exams7: num(exams, "n7"), examsPrev7: num(exams, "prev"),
      expression7: num(expr, "n7"), expressionPrev7: num(expr, "prev"), mocks7: num(mocks, "n7"), mocksPrev7: num(mocks, "prev"),
      hours7: Math.round((num(practice, "seconds") + num(exams, "seconds") + num(expr, "seconds")) / 360) / 10,
    },
    funnel: { registered: n("people"), named: n("named"), started: num(far, "started"), practised: num(far, "practised"), examined: num(far, "examined"), withKey: n("withKey"), expressed: num(far, "expressed"), mocked: num(far, "mocked") },
    sections: {
      co: { people: people.co ?? 0, answers: num(practice, "co"), exams: num(exams, "co"), nclc: avg(exams, "coNclc") },
      ce: { people: people.ce ?? 0, answers: num(practice, "ce"), exams: num(exams, "ce"), nclc: avg(exams, "ceNclc") },
      ee: { people: people.ee ?? 0, sessions: num(expr, "ee"), nclc: avg(expr, "eeNclc") },
      eo: { people: people.eo ?? 0, sessions: num(expr, "eo"), nclc: avg(expr, "eoNclc") },
      mock: { people: people.mock ?? 0, done: num(mocks, "n7") },
    },
    target: avg(u, "target"),
    days: Array.from({ length: 30 }, (_, i) => {
      const d = local(i - 29);
      return { day: d, people: num(daily.find((r) => r.d === d) ?? null, "people"), joined: num(joinedDaily.find((r) => r.d === d) ?? null) };
    }),
    adoption: Object.fromEntries(Object.entries(adoption ?? {}).map(([k, v]) => [k, Number(v ?? 0)])),
    keys: Object.fromEntries(keys.map((r) => [String(r.s), num(r)])),
    who: {
      cohort: n("cohort"), stayed: n("stayed"), english: n("english"), named: n("named"), examAhead: n("examAhead"),
      signedIn: num(devices, "people"), phone: num(devices, "phone"), tablet: num(devices, "tablet"),
      targets: targets.map((r) => ({ nclc: Number(r.t), n: num(r) })), places: places.map((r) => ({ region: String(r.r), n: num(r) })),
    },
    health: {
      mail: {
        sent, cap, resend: num(mailToday, "resend"), brevo: num(mailToday, "brevo"), failed: num(mailToday, "failed"),
        resendCap: RESEND_DAY, brevoCap: BREVO_DAY, brevoState: env.BREVO_API_KEY ? (brevoOk ? "works" : "refused") : "unset",
        days: Array.from({ length: 14 }, (_, i) => {
          const d = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);
          const r = mailDays.find((x) => x.d === d) ?? null;
          return { day: d, resend: num(r, "resend"), brevo: num(r, "brevo"), failed: num(r, "failed") };
        }),
      },
      writes: {
        today: num(budget), hold: BUDGET_HOLD, limit: 100000,
        days: Array.from({ length: 14 }, (_, i) => { const d = local(i - 13); return { day: d, n: num(writeDays.find((r) => r.d === d) ?? null) }; }),
      },
      jobs, networks: { strict: num(nets, "strict"), closed: num(nets, "closed") },
    },
  };
}

/** did something in the app: practised, sat an exam, or started writing or speaking (`u` is the users row) */
const STARTED = `(EXISTS (SELECT 1 FROM practice_days p WHERE p.user_id = u.id) OR EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = u.id)
  OR EXISTS (SELECT 1 FROM expr_sessions e WHERE e.user_id = u.id))`;

// ---- the People list ----
// What the list compares for each person, each as one grouped query over the rows `only` lets through: the page's
// people when it fills a page (index lookups, a few rows each), everyone when the list is sorted by that figure (one
// pass over the table, only for that sort). The dates inside come from this file, never from the request.
type Cuts = { today: string; day30: string; shift: string; iso31: string };
const answersSql = (only: string) => `SELECT user_id, SUM(answered) answered, SUM(seconds) seconds FROM practice_days WHERE ${only} GROUP BY user_id`;
/** finished CO/CE attempts: how many, the time spent, the best NCLC of each test in exam mode (below 4 counts as 3) */
const examsSql = (only: string) => `SELECT user_id, COUNT(*) exams, SUM((julianday(finished_at) - julianday(started_at)) * 86400) seconds,
  MAX(CASE WHEN section = 'co' AND mode = 'exam' THEN COALESCE(nclc, 3) END) co, MAX(CASE WHEN section = 'ce' AND mode = 'exam' THEN COALESCE(nclc, 3) END) ce
  FROM attempts WHERE ${only} AND finished_at IS NOT NULL GROUP BY user_id`;
const exprSql = (only: string) => `SELECT user_id, COUNT(*) expression, SUM(seconds) seconds,
  MAX(CASE WHEN section = 'ee' THEN COALESCE(nclc, 3) END) ee, MAX(CASE WHEN section = 'eo' THEN COALESCE(nclc, 3) END) eo
  FROM expr_sessions WHERE ${only} AND status = 'done' GROUP BY user_id`;
/** points won between the first and the latest exam of each test (two at least), CO and CE added */
const gainSql = (only: string) => `SELECT user_id, SUM(g) gain FROM (
  SELECT user_id, CAST(substr(MAX(finished_at || '|' || score), instr(MAX(finished_at || '|' || score), '|') + 1) AS INTEGER)
    - CAST(substr(MIN(finished_at || '|' || score), instr(MIN(finished_at || '|' || score), '|') + 1) AS INTEGER) g
  FROM attempts WHERE ${only} AND finished_at IS NOT NULL AND score IS NOT NULL AND mode = 'exam' GROUP BY user_id, section HAVING COUNT(*) >= 2) GROUP BY user_id`;
/** the days of the last 30 with any work (practice, an exam, a session), and the last 14 as bits (bit 0 = today) */
const daysSql = (only: string, c: Cuts) => `SELECT user_id, COUNT(*) days30, SUM(CASE WHEN k < 14 THEN 1 << k ELSE 0 END) mask FROM (
  SELECT DISTINCT user_id, CAST(julianday('${c.today}') - julianday(d) AS INTEGER) k FROM (
    SELECT user_id, day d FROM practice_days WHERE ${only} AND day >= '${c.day30}' AND answered > 0
    UNION ALL SELECT user_id, date(started_at, '${c.shift}') FROM attempts WHERE ${only} AND started_at >= '${c.iso31}'
    UNION ALL SELECT user_id, date(started_at, '${c.shift}') FROM expr_sessions WHERE ${only} AND started_at >= '${c.iso31}')
  WHERE d >= '${c.day30}' AND d <= '${c.today}') GROUP BY user_id`;
/** practice questions by colour (a broken row counts as empty) */
const coloursSql = (only: string) => `SELECT g.user_id, SUM(json_extract(j.value, '$.s') = 'green') ok, SUM(json_extract(j.value, '$.s') = 'amber') amber, SUM(json_extract(j.value, '$.s') = 'red') bad
  FROM progress g, json_each(CASE WHEN json_valid(g.data) THEN g.data ELSE '{}' END, '$.q') j WHERE ${only.replaceAll("user_id", "g.user_id")} GROUP BY g.user_id`;

// each sort: what it orders by (over everyone, before the page is cut), its usual direction, and the one figure it
// needs joined for everyone (`m.v`; nothing done counts as 0). An empty date, level or gain always comes last; among
// equals, the newest sign-up first.
type Sorting = { by: string; desc: boolean; all?: (c: Cuts) => string };
const ALL = "1 = 1";
const PEOPLE_SORT: Record<string, Sorting> = {
  seen: { by: "u.last_seen_at", desc: true },
  joined: { by: "u.created_at", desc: true },
  name: { by: "coalesce(u.name, u.email) COLLATE NOCASE", desc: false },
  email: { by: "u.email", desc: false },
  exam: { by: "u.exam_date", desc: false },
  target: { by: "u.target_nclc", desc: true },
  active: { by: "COALESCE(m.v, 0)", desc: true, all: (c) => `SELECT user_id, days30 v FROM (${daysSql(ALL, c)})` },
  time: { by: "COALESCE(m.v, 0)", desc: true, all: () => `SELECT user_id, SUM(seconds) v FROM (SELECT user_id, seconds FROM (${answersSql(ALL)}) UNION ALL SELECT user_id, seconds FROM (${examsSql(ALL)}) UNION ALL SELECT user_id, seconds FROM (${exprSql(ALL)})) GROUP BY user_id` },
  practice: { by: "COALESCE(m.v, 0)", desc: true, all: () => `SELECT user_id, answered v FROM (${answersSql(ALL)})` },
  exams: { by: "COALESCE(m.v, 0)", desc: true, all: () => `SELECT user_id, exams v FROM (${examsSql(ALL)})` },
  expression: { by: "COALESCE(m.v, 0)", desc: true, all: () => `SELECT user_id, expression v FROM (${exprSql(ALL)})` },
  // the level: the best NCLC of each test the person has a result in, averaged
  level: { by: "m.v", desc: true, all: () => `SELECT user_id, AVG(b) v FROM (SELECT user_id, co b FROM (${examsSql(ALL)}) WHERE co IS NOT NULL UNION ALL SELECT user_id, ce FROM (${examsSql(ALL)}) WHERE ce IS NOT NULL
    UNION ALL SELECT user_id, ee FROM (${exprSql(ALL)}) WHERE ee IS NOT NULL UNION ALL SELECT user_id, eo FROM (${exprSql(ALL)}) WHERE eo IS NOT NULL) GROUP BY user_id` },
  gain: { by: "m.v", desc: true, all: () => `SELECT user_id, gain v FROM (${gainSql(ALL)})` },
};
export const PAGE_SIZES = [10, 100, 1000, 10000];

async function people(env: Env, url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const filter = url.searchParams.get("filter") ?? "all";
  const sort = PEOPLE_SORT[url.searchParams.get("sort") ?? "seen"] ?? PEOPLE_SORT.seen;
  const dir = url.searchParams.get("dir");
  const desc = dir === "asc" ? false : dir === "desc" ? true : sort.desc;
  const asked = Number(url.searchParams.get("size"));
  const PAGE = PAGE_SIZES.includes(asked) ? asked : 100;
  const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? 0)) || 0);
  // every numbered argument is used once whatever the filter, so the four always bind
  const where = ["(?1 = '' OR u.email LIKE ?2 OR lower(coalesce(u.name, '')) LIKE ?2)", "?3 IS NOT NULL AND ?4 IS NOT NULL"];
  if (filter === "active") where.push("u.last_seen_at >= ?3");
  if (filter === "new") where.push("u.created_at >= ?3");
  if (filter === "exam") where.push("u.exam_date >= ?4");
  if (filter === "blocked") where.push("u.blocked_at IS NOT NULL");
  // the guard is watching: a human check pending, or signs of a machine in the last days
  if (filter === "check") where.push("u.blocked_at IS NULL AND (u.human_needed_at IS NOT NULL OR u.guard_signs IS NOT NULL)");
  // registered and never did anything
  if (filter === "idle") where.push(`NOT ${STARTED}`);
  // a working Gemini key (writing and speaking can be marked), or none that works
  if (filter === "key") where.push("u.gemini_status = 'ok'");
  if (filter === "nokey") where.push("u.gemini_status <> 'ok'");
  const w = where.join(" AND ");
  const tz = env.APP_TZ, off = offsetMinutes(tz);
  const cuts: Cuts = { today: day(tz), day30: day(tz, new Date(Date.now() - 29 * 86400000)), shift: `${off >= 0 ? "+" : ""}${off} minutes`, iso31: daysAgoIso(31) };
  const args = [q, `%${q}%`, daysAgoIso(7), cuts.today];
  const order = `(${sort.by}) IS NULL, ${sort.by} ${desc ? "DESC" : "ASC"}, u.created_at DESC, u.id`;
  const mine = "user_id IN (SELECT id FROM page)";
  // the order is made over everyone who matches, then the page is cut from it; the figures are then counted for the
  // page's people only
  const rows = await all(env, `
    WITH page AS MATERIALIZED (
      SELECT u.id, u.email, u.name, u.created_at, u.last_seen_at, u.target_nclc, u.exam_date, u.blocked_at, u.human_needed_at, u.gemini_status,
        ROW_NUMBER() OVER (ORDER BY ${order}) rn
      FROM users u ${sort.all ? `LEFT JOIN (${sort.all(cuts)}) m ON m.user_id = u.id` : ""}
      WHERE ${w} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${page * PAGE})
    SELECT p.id, p.email, p.name, p.created_at, p.last_seen_at, p.target_nclc, p.exam_date, p.blocked_at, p.human_needed_at, p.gemini_status,
      COALESCE(pr.answered, 0) answered, COALESCE(at.exams, 0) exams, COALESCE(ex.expression, 0) expression,
      CAST(COALESCE(pr.seconds, 0) + COALESCE(at.seconds, 0) + COALESCE(ex.seconds, 0) AS INTEGER) seconds,
      at.co, at.ce, ex.ee, ex.eo, gn.gain, COALESCE(dy.days30, 0) days30, COALESCE(dy.mask, 0) mask,
      COALESCE(cl.ok, 0) ok, COALESCE(cl.amber, 0) amber, COALESCE(cl.bad, 0) bad
    FROM page p
      LEFT JOIN (${answersSql(mine)}) pr ON pr.user_id = p.id
      LEFT JOIN (${examsSql(mine)}) at ON at.user_id = p.id
      LEFT JOIN (${exprSql(mine)}) ex ON ex.user_id = p.id
      LEFT JOIN (${gainSql(mine)}) gn ON gn.user_id = p.id
      LEFT JOIN (${daysSql(mine, cuts)}) dy ON dy.user_id = p.id
      LEFT JOIN (${coloursSql(mine)}) cl ON cl.user_id = p.id
    ORDER BY p.rn`, ...args);
  const total = await one(env, `SELECT COUNT(*) n FROM users u WHERE ${w}`, ...args);
  return { rows, total: num(total), page, pageSize: PAGE };
}

const parse = <T>(text: unknown, fallback: T): T => { try { return text ? (JSON.parse(String(text)) as T) : fallback; } catch { return fallback; } };

/**
 * One person, for support: who they are, what stops them (a block, a pending check, a paused sign-in, the limit of
 * e-mail codes), and everything they did, each piece with its own id so it can be removed for a fresh try.
 */
async function person(env: Env, id: string) {
  const u = await one(env, `SELECT id, email, name, created_at, last_seen_at, target_nclc, exam_date, lang, settings, terms_version, terms_at,
    gemini_status, gemini_checked_at, gemini_error, note, password IS NOT NULL has_password, failed_logins, locked_until,
    blocked_at, blocked_reason, human_until, human_needed_at, human_reason, human_fails, guard_signs FROM users WHERE id = ?`, id);
  if (!u) return null;
  const today = day(env.APP_TZ);
  const [devices, prog, att, expr, mockRows, practice, perLevel, answeredToday, reports, reads, events, use, mail, codes] = await Promise.all([
    all(env, "SELECT id, device, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC", id, nowIso()),
    all(env, "SELECT section, level, data, updated_at FROM progress WHERE user_id = ?", id),
    all(env, "SELECT id, section, exam, mode, mock_id, started_at, deadline_at, finished_at, ended, score, nclc, right_count, wrong_count, blank_count FROM attempts WHERE user_id = ? ORDER BY started_at DESC LIMIT 200", id),
    all(env, "SELECT id, section, kind, replace(replace(taches, '[', ''), ']', '') taches, mode, mock_id, started_at, finished_at, status ended, score, nclc, seconds FROM expr_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 200", id),
    all(env, "SELECT id, started_at, finished_at, status, stage, result_json FROM mocks WHERE user_id = ? ORDER BY started_at DESC LIMIT 50", id),
    all(env, "SELECT day, section, level, answered, wrong, seconds, last_at FROM practice_days WHERE user_id = ? ORDER BY last_at DESC LIMIT 200", id),
    all(env, "SELECT section, level, SUM(answered) answered, SUM(wrong) wrong, SUM(seconds) seconds, MAX(last_at) last_at FROM practice_days WHERE user_id = ? GROUP BY section, level", id),
    one(env, "SELECT SUM(answered) n FROM practice_days WHERE user_id = ? AND day = ?", id, today),
    all(env, "SELECT id, section, level, n, message, status, created_at FROM disputes WHERE user_id = ? ORDER BY id DESC LIMIT 100", id),
    // question-bank files opened, today and over seven days (the guard's counts)
    all(env, "SELECT kind, SUM(day = ?2) today, COUNT(DISTINCT key) week FROM bank_reads WHERE user_id = ?1 AND day >= ?3 GROUP BY kind",
      id, today, day(env.APP_TZ, new Date(Date.now() - 6 * 86_400_000))),
    // what the abuse guard did (worker/guard.ts) and what the owner did here (kind « admin ») — 90 days
    all(env, "SELECT at, kind, detail FROM guard_events WHERE user_id = ? ORDER BY at DESC LIMIT 100", id),
    // requests and changes counted today (written in groups of 25: a light day shows nothing)
    one(env, "SELECT requests, writes FROM usage WHERE user_id = ? AND day = ?", id, today),
    // the e-mails sent to this address (kept 90 days): a code that never arrived shows here
    all(env, "SELECT at, kind, ok, detail FROM mail WHERE email = ? ORDER BY id DESC LIMIT 30", u.email),
    all(env, "SELECT purpose, created_at, sends, window_at, day_sends, day_at FROM codes WHERE email = ?", u.email),
  ]);
  const bank = { data: { today: 0, week: 0 } } as Record<string, { today: number; week: number }>;
  for (const r of reads) if (bank[String(r.kind)]) bank[String(r.kind)] = { today: num(r, "today"), week: num(r, "week") };
  // practice level by level: the colours of the progress row beside what the days add up to
  const levels: Row[] = [];
  for (const section of ["co", "ce"]) for (const level of LEVELS) {
    const row = prog.find((r) => r.section === section && r.level === level);
    const days = perLevel.find((r) => r.section === section && r.level === level);
    if (!row && !days) continue;
    const c = row ? colours([row])[section] : undefined;
    levels.push({ section, level, ok: c?.ok ?? 0, bad: c?.bad ?? 0, amber: c?.amber ?? 0, answered: num(days ?? null, "answered"), wrong: num(days ?? null, "wrong"), seconds: num(days ?? null, "seconds"), last_at: days?.last_at ?? row?.updated_at ?? null });
  }
  const mocks = mockRows.map(({ result_json, ...m }) => {
    const r = parse<{ overall?: number | null; co?: { nclc?: number | null } | null; ce?: { nclc?: number | null } | null; ee?: { nclc?: number | null } | null; eo?: { nclc?: number | null } | null } | null>(result_json, null);
    return { ...m, overall: r?.overall ?? null, nclc: { co: r?.co?.nclc ?? null, ce: r?.ce?.nclc ?? null, ee: r?.ee?.nclc ?? null, eo: r?.eo?.nclc ?? null } };
  });
  // the e-mail codes sent to the address in the running hour and day, against the lines of worker/auth.ts
  const now = Date.now();
  let hour = 0, daySends = 0;
  for (const c of codes) {
    if (c.window_at && now - Date.parse(String(c.window_at)) < 3_600_000) hour = Math.max(hour, num(c, "sends"));
    if (c.day_at && now - Date.parse(String(c.day_at)) < 86_400_000) daySends = Math.max(daySends, num(c, "day_sends"));
  }
  const locked = u.locked_until && Date.parse(String(u.locked_until)) > now ? u.locked_until : null;
  // the signs of a machine seen in the last seven days and the score they make (worker/guard.ts)
  const seen = parseSigns(u.guard_signs as string | null);
  const signs = (Object.keys(seen) as (keyof typeof SIGNS)[]).map((k) => ({ sign: k, label: SIGNS[k].label, weight: SIGNS[k].weight, check: "check" in SIGNS[k], at: seen[k] }));
  const { guard_signs: _signs, failed_logins, locked_until: _locked, ...user } = u;
  return {
    user: { ...user, settings: parse(u.settings, {}), has_password: Boolean(u.has_password) },
    signin: { lockedUntil: locked, failedLogins: num(u, "failed_logins"), codes: { hour, day: daySends, hourMax: CODES_PER_HOUR, dayMax: CODES_PER_DAY, limited: hour >= CODES_PER_HOUR || daySends >= CODES_PER_DAY } },
    devices, colours: colours(prog), levels, attempts: att, expression: expr, mocks, practice, answeredToday: num(answeredToday), disputes: reports, bank, mail,
    guard: { events, today: { requests: num(use, "requests"), writes: num(use, "writes") }, score: scoreOf(seen), askAt: ASK_AT, blockAt: BLOCK_AT, signs },
  };
}

/**
 * What the owner can do to one person; each one confirmed in the page first. What changes the person's work or access
 * leaves a line in their guard events (kind « admin »), so the page shows what was done and when.
 */
async function act(env: Env, id: string, action: string, body: Row | null) {
  const who = await one(env, "SELECT id, email FROM users WHERE id = ?", id);
  if (!who) return fail(404, "no such person");
  const d = env.DB;
  // the events' key is (person, moment, kind): two actions in the same millisecond each keep their line
  const done = async (what: string, extra: Row = {}) => {
    for (let i = 0, t = Date.now(); i < 5; i++, t++) {
      const r = await d.prepare("INSERT OR IGNORE INTO guard_events (user_id, at, kind, detail) VALUES (?, ?, 'admin', ?)").bind(id, new Date(t).toISOString(), what).run();
      if (r.meta.changes) break;
    }
    return json({ ok: true, ...extra });
  };
  if (action === "signout") {
    // one device (its row's id) or all of them
    const session = typeof body?.session === "string" ? body.session : null;
    const r = session
      ? await d.prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?").bind(id, session).run()
      : await d.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
    return done(session ? "signed out of one device" : "signed out everywhere", { removed: r.meta.changes ?? 0 });
  }
  if (action === "reset-progress") {
    const section = String(body?.section ?? "all");
    if (!["all", "co", "ce", "ee", "eo"].includes(section)) return fail(400, "bad section");
    // one practice level: its colours go, the days it was practised on stay (they are the person's history)
    if (body?.level != null) {
      const level = String(body.level);
      if ((section !== "co" && section !== "ce") || !(LEVELS as readonly string[]).includes(level)) return fail(400, "bad level");
      await d.prepare("DELETE FROM progress WHERE user_id = ? AND section = ? AND level = ?").bind(id, section, level).run();
      return done(`reset practice ${section.toUpperCase()} ${level}`);
    }
    const s = section === "all" ? "" : " AND section = ?2";
    const bind = (sql: string) => (section === "all" ? d.prepare(sql).bind(id) : d.prepare(sql).bind(id, section));
    const stmts = [];
    if (section === "all" || section === "co" || section === "ce") {
      stmts.push(bind(`DELETE FROM progress WHERE user_id = ?1${s}`), bind(`DELETE FROM practice_days WHERE user_id = ?1${s}`), bind(`DELETE FROM attempts WHERE user_id = ?1${s}`));
    }
    if (section === "all" || section === "ee" || section === "eo") {
      stmts.push(bind(`DELETE FROM expr_tasks WHERE session_id IN (SELECT id FROM expr_sessions WHERE user_id = ?1${s})`), bind(`DELETE FROM expr_sessions WHERE user_id = ?1${s}`));
    }
    if (section === "all") stmts.push(d.prepare("DELETE FROM mocks WHERE user_id = ?").bind(id));
    await d.batch(stmts);
    return done(`reset ${section === "all" ? "everything" : section.toUpperCase()}`);
  }
  // one exam attempt, running or finished: gone, so the person can sit that exam as if for the first time
  if (action === "delete-attempt") {
    const row = await one(env, "SELECT section, exam FROM attempts WHERE id = ? AND user_id = ?", Number(body?.id), id);
    if (!row) return fail(404, "no such attempt");
    await d.prepare("DELETE FROM attempts WHERE id = ? AND user_id = ?").bind(Number(body?.id), id).run();
    return done(`deleted ${String(row.section).toUpperCase()} exam ${row.exam}`);
  }
  // one writing or speaking session (a mock exam's sessions go with the mock)
  if (action === "delete-session") {
    const sid = String(body?.id ?? "");
    const row = await one(env, "SELECT section, mock_id FROM expr_sessions WHERE id = ? AND user_id = ?", sid, id);
    if (!row) return fail(404, "no such session");
    if (row.mock_id != null) return fail(400, "part of a mock exam: delete the mock exam");
    await d.batch([d.prepare("DELETE FROM expr_tasks WHERE session_id = ?").bind(sid), d.prepare("DELETE FROM expr_sessions WHERE id = ? AND user_id = ?").bind(sid, id)]);
    return done(`deleted ${String(row.section).toUpperCase()} session`);
  }
  // one mock exam with its writing and speaking sessions: a stuck sitting is freed, its questions count as new again
  if (action === "delete-mock") {
    const mid = Number(body?.id);
    const row = await one(env, "SELECT id FROM mocks WHERE id = ? AND user_id = ?", mid, id);
    if (!row) return fail(404, "no such mock exam");
    await d.batch([
      d.prepare("DELETE FROM expr_tasks WHERE session_id IN (SELECT id FROM expr_sessions WHERE user_id = ?1 AND mock_id = ?2)").bind(id, mid),
      d.prepare("DELETE FROM expr_sessions WHERE user_id = ?1 AND mock_id = ?2").bind(id, mid),
      d.prepare("DELETE FROM attempts WHERE user_id = ?1 AND mock_id = ?2").bind(id, mid),
      d.prepare("DELETE FROM mocks WHERE id = ?2 AND user_id = ?1").bind(id, mid),
    ]);
    return done(`deleted mock exam ${mid}`);
  }
  // the sign-in door: the pause after wrong passwords ends, the count of e-mail codes starts again
  if (action === "unlock") {
    await d.batch([
      d.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").bind(id),
      d.prepare("DELETE FROM codes WHERE email = ?").bind(who.email),
    ]);
    return done("sign-in unlocked");
  }
  if (action === "delete") {
    // everything that belongs to the person, then the person (no reliance on cascades)
    await d.batch([d.prepare("DELETE FROM expr_tasks WHERE session_id IN (SELECT id FROM expr_sessions WHERE user_id = ?)").bind(id)]
      .concat(["sessions", "progress", "practice_days", "attempts", "expr_sessions", "user_kv", "mocks", "disputes", "messages", "starts", "bank_reads", "usage", "guard_events"].map((t) => d.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)))
      .concat(d.prepare("DELETE FROM codes WHERE email = (SELECT email FROM users WHERE id = ?)").bind(id), d.prepare("DELETE FROM mail WHERE email = (SELECT email FROM users WHERE id = ?)").bind(id), d.prepare("DELETE FROM users WHERE id = ?").bind(id)));
    return json({ ok: true });
  }
  if (action === "block") {
    // the owner's own account never: with ADMIN_OPEN "0" nobody could unblock it
    const self = await one(env, "SELECT 1 n FROM users WHERE id = ? AND lower(email) = lower(?)", id, env.OWNER_EMAIL ?? "");
    if (self) return fail(400, "the owner cannot be blocked");
    await blockUser(env, id, "by the owner");
    return json({ ok: true });
  }
  // a block ends, and with it any pending human check and the signs counted so far (also used alone, to clear a check)
  if (action === "unblock") {
    await unblockUser(env, id);
    return json({ ok: true });
  }
  if (action === "note") {
    const text = String(body?.note ?? "").slice(0, 2000);
    await d.prepare("UPDATE users SET note = ? WHERE id = ?").bind(text || null, id).run();
    return json({ ok: true });
  }
  return fail(404, "no such action");
}

/** the reports people sent on practice questions, newest first (status: open · resolved · all) */
async function disputes(env: Env, url: URL) {
  const status = url.searchParams.get("status") ?? "open";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const PAGE = 50;
  const w = status === "open" || status === "resolved" ? "d.status = ?1" : "?1 = ?1";
  const rows = await all(env, `SELECT d.id, d.user_id, u.email, u.name, d.section, d.level, d.question_id, d.n, d.message, d.status, d.created_at, d.resolved_at, d.note
    FROM disputes d LEFT JOIN users u ON u.id = d.user_id WHERE ${w} ORDER BY d.id DESC LIMIT ${PAGE} OFFSET ${page * PAGE}`, status);
  const counts = await all(env, "SELECT status s, COUNT(*) n FROM disputes GROUP BY status");
  const c = Object.fromEntries(counts.map((r) => [r.s, Number(r.n)]));
  return { rows, page, pageSize: PAGE, open: c.open ?? 0, resolved: c.resolved ?? 0 };
}

/** one report with the person who sent it and how many reports they sent in all */
async function dispute(env: Env, id: number) {
  return one(env, `SELECT d.id, d.user_id, u.email, u.name, u.created_at user_created_at, u.last_seen_at, d.section, d.level, d.question_id, d.n,
      d.message, d.status, d.created_at, d.resolved_at, d.note, (SELECT COUNT(*) FROM disputes x WHERE x.user_id = d.user_id) reports
    FROM disputes d LEFT JOIN users u ON u.id = d.user_id WHERE d.id = ?`, id);
}

export async function handleAdmin(req: Request, env: Env, url: URL): Promise<Response> {
  if (!(await isOwner(env, req))) return fail(403, "owner only");
  const p = url.pathname.slice("/api/admin".length);
  const write = req.method === "POST";
  if (write && req.headers.get("x-admin") !== "1") return fail(403, "missing x-admin header");
  if (!write && req.method !== "GET") return fail(405, "GET or POST");

  if (!write && p === "/overview") return json(await overview(env));
  if (!write && p === "/people") return json(await people(env, url));
  let m = p.match(/^\/people\/([\w-]+)$/);
  if (!write && m) { const r = await person(env, m[1]); return r ? json(r) : fail(404, "no such person"); }
  m = p.match(/^\/people\/([\w-]+)\/([\w-]+)$/);
  if (write && m) return act(env, m[1], m[2], await readJson<Row>(req));
  if (!write && p === "/disputes") return json(await disputes(env, url));
  m = p.match(/^\/disputes\/(\d+)$/);
  if (!write && m) { const r = await dispute(env, Number(m[1])); return r ? json(r) : fail(404, "no such dispute"); }
  m = p.match(/^\/disputes\/(\d+)\/(\w+)$/);
  if (write && m) return settleReport(env, Number(m[1]), m[2], await readJson<Row>(req));
  // Messages: the threads (each person's messages and reports), one thread, read, answer
  if (!write && p === "/threads") return json(await inbox(env, url));
  m = p.match(/^\/threads\/([\w-]+)$/);
  if (!write && m) { const r = await ownerThread(env, m[1]); return r ? json(r) : fail(404, "no such person"); }
  m = p.match(/^\/threads\/([\w-]+)\/(read|send)$/);
  if (write && m) return m[2] === "read" ? ownerRead(env, m[1]) : ownerSend(env, m[1], await readJson<Row>(req));
  return fail(404, "not found");
}
