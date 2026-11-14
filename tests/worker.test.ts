// The real Worker on a real SQLite: the admin API (people, disputes), the topics sync (against a pretend source site), backups, cleanup.
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../worker/index.ts";
import { makeEnv } from "../scripts/local-env.ts";
import { demoSql } from "./fixtures/people.ts";
import { syncTopics, monthOf, parseEO, parseEE } from "../worker/topics.ts";
import { runJob } from "../worker/jobs.ts";
import type { Env } from "../worker/util.ts";

type Row = Record<string, any>;
let env: Env, raw: ReturnType<typeof makeEnv>["raw"], r2: ReturnType<typeof makeEnv>["r2"];

beforeEach(() => {
  const e = makeEnv();
  env = e.env as unknown as Env; raw = e.raw; r2 = e.r2;
});

const call = async (path: string, o: { method?: string; body?: unknown; headers?: Record<string, string>; host?: string } = {}) => {
  const method = o.method ?? (o.body !== undefined ? "POST" : "GET");
  const r = await worker.fetch(new Request(`https://${o.host ?? "admin.tcf.monster"}${path}`, {
    method,
    headers: { ...(method === "POST" ? { "x-admin": "1", "content-type": "application/json" } : {}), ...o.headers },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  }), env);
  const data: any = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
};
const count = (sql: string, ...a: unknown[]) => Number((raw.prepare(sql).get(...(a as never[])) as Row).n);

describe("admin API", () => {
  beforeEach(() => raw.exec(demoSql()));

  it("today: sign-ups and activity against the week before, how far people went, what they use, the free plan's lines", async () => {
    const { status, data } = await call("/api/admin/overview");
    expect(status).toBe(200);
    const week = new Date(Date.now() - 7 * 86400000).toISOString();
    expect(data.people).toMatchObject({ total: 6, joined7: 2, joinedPrev7: 1 });
    expect(data.people.active7).toBe(count("SELECT COUNT(*) n FROM users WHERE last_seen_at >= ?", week));
    expect(data.people.studied7).toBeGreaterThan(0);
    expect(data.work.exams7).toBe(count("SELECT COUNT(*) n FROM attempts WHERE finished_at >= ?", week));
    expect(data.work.expression7).toBe(count("SELECT COUNT(*) n FROM expr_sessions WHERE status = 'done' AND finished_at >= ?", week));
    expect(data.work.hours7).toBeGreaterThan(0);
    // how far: each step counts people, never more than are registered
    expect(data.funnel).toMatchObject({ registered: 6, named: 6, withKey: 3 });
    expect(data.funnel.practised).toBe(count("SELECT COUNT(DISTINCT user_id) n FROM practice_days"));
    expect(data.funnel.started).toBeGreaterThanOrEqual(data.funnel.practised);
    for (const k of ["named", "started", "practised", "examined", "expressed", "mocked"]) expect(data.funnel[k], k).toBeLessThanOrEqual(6);
    expect(data.sections.co.people).toBeGreaterThan(0);
    expect(data.sections.co.answers + data.sections.ce.answers).toBe(data.work.answers7);
    // 30 days a day each, today last; the people of a day never more than registered
    expect(data.days).toHaveLength(30);
    expect(data.days.at(-1).day).toBe(data.today);
    for (const d of data.days) expect(d.people).toBeLessThanOrEqual(6);
    expect(data.days.reduce((t: number, d: Row) => t + d.joined, 0)).toBe(count("SELECT COUNT(*) n FROM users WHERE created_at >= ?", new Date(Date.now() - 31 * 86400000).toISOString()));
    // what the people who studied in 30 days used: each figure among them
    expect(data.adoption.base).toBeGreaterThan(0);
    for (const k of ["coPractice", "cePractice", "realExam", "freeExam", "ee", "eo", "mock", "key", "examDate", "autoplay", "transcript", "hint", "english"]) expect(data.adoption[k], k).toBeLessThanOrEqual(data.adoption.base);
    // the key's states add up to everyone past the welcome
    expect(Object.values(data.keys as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(6);
    expect(data.keys.ok).toBe(3);
    expect(data.who.targets.reduce((t: number, r: Row) => t + r.n, 0)).toBe(count("SELECT COUNT(*) n FROM users WHERE target_nclc IS NOT NULL"));
    expect(data.who.places.reduce((t: number, r: Row) => t + r.n, 0)).toBe(6);
    expect(data.health.mail).toMatchObject({ resend: 0, brevo: 0, failed: 0, resendCap: 100, brevoCap: 300, brevoState: "unset" });
    expect(data.health.mail.days).toHaveLength(14);
    expect(data.health.writes).toMatchObject({ hold: 50000, limit: 100000 });
    expect(data.health.writes.days).toHaveLength(14);
    expect(data.exams).toBeUndefined();
    expect(data.who.signedIn).toBe(count("SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE expires_at > ?", new Date().toISOString()));
    expect(data.health).toMatchObject({ writes: { hold: 50000 }, mail: { sent: 0, cap: 100 }, networks: { strict: 0, closed: 0 } });
    // nothing waits for the owner in a quiet database
    expect(data.needs).toMatchObject({ blocked: [], blockedTotal: 0, checks: [], disputesOpen: 0, mailFailed: [], jobsFailed: [] });
  });

  it("today lists what waits: a fresh block, a check failed again and again, a failed job, a failed mail", async () => {
    await call("/api/admin/people/demo-2/block", { body: {} });
    raw.prepare("UPDATE users SET human_needed_at = ?, human_reason = 'pace', human_fails = 4 WHERE id = 'demo-3'").run(new Date().toISOString());
    raw.prepare("UPDATE users SET human_needed_at = ?, human_fails = 1 WHERE id = 'demo-4'").run(new Date().toISOString());
    raw.prepare("INSERT INTO jobs (name, last_at, ok, detail, seconds) VALUES ('backup', ?, 0, 'R2 refused', 1.2), ('topics', ?, 1, 'fine', 3)").run(new Date().toISOString(), new Date().toISOString());
    raw.prepare("INSERT INTO mail (at, email, kind, ok, detail) VALUES (?, 'amina@demo.tcf.monster', 'signin', 0, 'resend HTTP 429')").run(new Date().toISOString());
    const { needs, health } = (await call("/api/admin/overview")).data;
    expect(needs.blocked.map((r: Row) => r.id)).toEqual(["demo-2"]);
    expect(needs.blocked[0].blocked_reason).toBe("by the owner");
    expect(needs.blockedTotal).toBe(1);
    expect(needs.checks.map((r: Row) => r.id)).toEqual(["demo-3"]);
    expect(needs.jobsFailed.map((j: Row) => j.name)).toEqual(["backup"]);
    expect(needs.mailFailed.length).toBe(1);
    expect(health.jobs.length).toBe(2);
    expect(health.mail.sent).toBe(1);
  });

  it("people: search, filters, sort and pages", async () => {
    expect((await call("/api/admin/people")).data.total).toBe(6);
    expect((await call("/api/admin/people?q=SOF")).data.rows.map((r: Row) => r.name)).toEqual(["Sofia"]);
    expect((await call("/api/admin/people?filter=new")).data.rows.map((r: Row) => r.name).sort()).toEqual(["Lin", "Olena"]);
    const byEmail = (await call("/api/admin/people?sort=email")).data.rows.map((r: Row) => r.email);
    expect(byEmail).toEqual([...byEmail].sort());
    const byName = (await call("/api/admin/people?sort=name")).data.rows.map((r: Row) => r.name);
    expect(byName).toEqual([...byName].sort());
    const byPractice = (await call("/api/admin/people?sort=practice")).data.rows.map((r: Row) => r.answered);
    expect(byPractice).toEqual([...byPractice].sort((a, b) => b - a));
    const a = (await call("/api/admin/people?q=amina")).data.rows[0];
    expect(a.exams).toBe(count("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1' AND finished_at IS NOT NULL"));
    expect(a.answered).toBe(count("SELECT SUM(answered) n FROM practice_days WHERE user_id = 'demo-1'"));
    expect(a.expression).toBe(count("SELECT COUNT(*) n FROM expr_sessions WHERE user_id = 'demo-1' AND status = 'done'"));
    // the guard's list (a check pending or signs seen, not yet blocked) and the people who never started
    raw.prepare("UPDATE users SET guard_signs = '{\"webdriver\":\"2026-11-10T10:00:00.000Z\"}' WHERE id = 'demo-2'").run();
    raw.prepare("UPDATE users SET human_needed_at = 'x' WHERE id = 'demo-3'").run();
    raw.prepare("UPDATE users SET human_needed_at = 'x', blocked_at = 'x' WHERE id = 'demo-4'").run();
    expect((await call("/api/admin/people?filter=check")).data.rows.map((r: Row) => r.name).sort()).toEqual(["Daniyar", "Sofia"]);
    expect((await call("/api/admin/people?filter=blocked")).data.rows.map((r: Row) => r.name)).toEqual(["Karim"]);
    expect((await call("/api/admin/people?filter=idle")).data.total).toBe(0);
    raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('fresh', 'fresh@example.com', '2026-11-01T10:00:00.000Z')").run();
    expect((await call("/api/admin/people?filter=idle")).data.rows.map((r: Row) => r.id)).toEqual(["fresh"]);
    raw.prepare("DELETE FROM users WHERE id = 'fresh'").run();
    // a search for a quote or a percent sign is just text
    expect((await call("/api/admin/people?q=%27%25")).data.total).toBe(0);
  });

  it("the list compares people: activity, time, level, gain and practice colours, counted for each one", async () => {
    const rows = (await call("/api/admin/people")).data.rows as Row[];
    const a = rows.find((r) => r.id === "demo-1")!;
    // the days of the last 30 with any work, and the last 14 as bits (bit 0 = today)
    const off = 300, local = (iso: string) => new Date(Date.parse(iso) + off * 60000).toISOString().slice(0, 10);
    const today = local(new Date().toISOString()), first = local(new Date(Date.now() - 29 * 86400000).toISOString());
    const days = new Set<string>();
    for (const r of raw.prepare("SELECT day FROM practice_days WHERE user_id = 'demo-1' AND answered > 0").all() as Row[]) days.add(r.day);
    for (const t of ["attempts", "expr_sessions"]) for (const r of raw.prepare(`SELECT started_at FROM ${t} WHERE user_id = 'demo-1'`).all() as Row[]) days.add(local(r.started_at));
    const in30 = [...days].filter((d) => d >= first && d <= today);
    expect(a.days30).toBe(in30.length);
    let mask = 0;
    for (const d of in30) { const k = Math.round((Date.parse(today) - Date.parse(d)) / 86400000); if (k < 14) mask |= 1 << k; }
    expect(a.mask).toBe(mask);
    // time: practice, the exams' length, the sessions
    const secs = count("SELECT SUM(seconds) n FROM practice_days WHERE user_id = 'demo-1'") + count("SELECT COALESCE(SUM(seconds), 0) n FROM expr_sessions WHERE user_id = 'demo-1' AND status = 'done'")
      + count("SELECT SUM((julianday(finished_at) - julianday(started_at)) * 86400) n FROM attempts WHERE user_id = 'demo-1' AND finished_at IS NOT NULL");
    expect(Math.abs(a.seconds - secs)).toBeLessThan(2);
    // the best NCLC of each test, and the points between the first and the latest exam
    expect(a.co).toBe(count("SELECT MAX(COALESCE(nclc, 3)) n FROM attempts WHERE user_id = 'demo-1' AND section = 'co' AND finished_at IS NOT NULL"));
    expect(a.ee).toBe(count("SELECT MAX(COALESCE(nclc, 3)) n FROM expr_sessions WHERE user_id = 'demo-1' AND section = 'ee' AND status = 'done'"));
    let gain = 0;
    for (const sec of ["co", "ce"]) {
      const list = raw.prepare("SELECT score FROM attempts WHERE user_id = 'demo-1' AND section = ? AND finished_at IS NOT NULL ORDER BY finished_at").all(sec) as Row[];
      if (list.length >= 2) gain += list[list.length - 1].score - list[0].score;
    }
    expect(a.gain).toBe(gain);
    const blobs = raw.prepare("SELECT data FROM progress WHERE user_id = 'demo-1'").all() as Row[];
    const states = blobs.flatMap((b) => Object.values(JSON.parse(b.data).q) as Row[]).map((v) => v.s);
    expect([a.ok, a.amber, a.bad]).toEqual(["green", "amber", "red"].map((c) => states.filter((x) => x === c).length));
    expect(a.gemini_status).toBe("ok");
    // a broken progress row counts as empty, a person with nothing shows zeros and no level
    raw.prepare("UPDATE progress SET data = 'not json' WHERE user_id = 'demo-2'").run();
    raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('fresh', 'fresh@example.com', '2026-11-01T10:00:00.000Z')").run();
    const again = (await call("/api/admin/people")).data.rows as Row[];
    expect(again.find((r) => r.id === "demo-2")).toMatchObject({ ok: 0, amber: 0, bad: 0 });
    expect(again.find((r) => r.id === "fresh")).toMatchObject({ answered: 0, exams: 0, expression: 0, seconds: 0, days30: 0, mask: 0, co: null, ce: null, ee: null, eo: null, gain: null });
  });

  it("the list sorts everyone before it cuts pages: every sort, both directions, 10 · 100 · 1 000 · 10 000 a page", async () => {
    const everyone = (await call("/api/admin/people")).data;
    expect(everyone.pageSize).toBe(100);
    for (const size of [10, 1000, 10000]) expect((await call(`/api/admin/people?size=${size}`)).data.pageSize).toBe(size);
    for (const size of ["50", "0", "-1", "abc", "100000"]) expect((await call(`/api/admin/people?size=${size}`)).data.pageSize, size).toBe(100);
    // 26 people: three pages of 10, in the order of the whole list
    const add = raw.prepare("INSERT INTO users (id, email, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)");
    for (let i = 0; i < 20; i++) add.run(`x-${i}`, `x${String(i).padStart(2, "0")}@example.com`, `X${String(i).padStart(2, "0")}`, `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, null);
    const whole = (await call("/api/admin/people?size=100&sort=practice")).data;
    expect(whole.total).toBe(26);
    const paged: string[] = [];
    for (let p = 0; p < 3; p++) {
      const r = (await call(`/api/admin/people?size=10&sort=practice&page=${p}`)).data;
      expect(r.rows.length).toBe(p < 2 ? 10 : 6);
      paged.push(...r.rows.map((x: Row) => x.id));
    }
    expect(paged).toEqual(whole.rows.map((x: Row) => x.id));
    // the six with answers lead, most first; the twenty without any follow
    expect(whole.rows.slice(0, 6).map((x: Row) => x.id).sort()).toEqual(["demo-1", "demo-2", "demo-3", "demo-4", "demo-5", "demo-6"]);
    const sorted = (xs: number[], desc = true) => [...xs].sort((a, b) => (desc ? b - a : a - b));
    const col = async (qs: string, k: string) => ((await call(`/api/admin/people?${qs}`)).data.rows as Row[]).map((r) => r[k]);
    for (const [sort, k] of [["practice", "answered"], ["active", "days30"], ["time", "seconds"], ["exams", "exams"], ["expression", "expression"], ["gain", "gain"]] as const) {
      // nothing done counts as 0 (first when ascending); a gain that does not exist comes last either way
      const down = await col(`sort=${sort}`, k), up = await col(`sort=${sort}&dir=asc`, k);
      for (const [list, desc] of [[down, true], [up, false]] as const) {
        const have = list.filter((v) => v != null) as number[];
        expect(have, `${sort} ${desc ? "desc" : "asc"}`).toEqual(sorted(have, desc));
        expect(list.slice(have.length).every((v) => v == null)).toBe(true);
      }
    }
    // the level: the best NCLC of each test averaged, highest first; people with no result come last in both directions
    const level = (r: Row) => { const v = [r.co, r.ce, r.ee, r.eo].filter((x) => x != null) as number[]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const byLevel = ((await call("/api/admin/people?sort=level")).data.rows as Row[]).map(level);
    expect(byLevel.slice(0, 6)).toEqual(sorted(byLevel.slice(0, 6) as number[]));
    expect(byLevel.slice(6).every((v) => v === null)).toBe(true);
    const lastSeen = await col("sort=seen&dir=asc", "last_seen_at");
    expect(lastSeen.slice(0, 6)).toEqual([...lastSeen.slice(0, 6)].sort());
    expect(lastSeen.slice(6).every((v) => v === null)).toBe(true);
    // with a working key, without
    expect((await call("/api/admin/people?filter=key")).data.total).toBe(3);
    expect((await call("/api/admin/people?filter=nokey")).data.total).toBe(23);
  });

  it("a person: profile without secrets, colours from the progress rows, attempts and devices", async () => {
    raw.prepare("UPDATE users SET password = 'pbkdf2-sha256$1$salt$secret-hash' WHERE id = 'demo-1'").run();
    const { data } = await call("/api/admin/people/demo-1");
    expect(data.user.email).toBe("amina@demo.tcf.monster");
    expect(JSON.stringify(data)).not.toContain("secret-hash");
    expect(data.user.password).toBeUndefined();
    expect(data.user.has_password).toBe(true);
    const blobs = raw.prepare("SELECT data FROM progress WHERE user_id = 'demo-1' AND section = 'co'").all() as Row[];
    const ok = blobs.flatMap((b) => Object.values(JSON.parse(b.data).q)).filter((v: any) => v.s === "green").length;
    expect(data.colours.co.ok).toBe(ok);
    expect(data.devices.length).toBe(2);
    expect(data.attempts.length).toBe(count("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1'"));
    expect(data.disputes).toEqual([]);
    expect((await call("/api/admin/people/nobody")).status).toBe(404);
    // practice level by level: the colours of each progress row and the answers of its days
    const b2 = raw.prepare("SELECT data FROM progress WHERE user_id = 'demo-1' AND section = 'co' ORDER BY level").all() as Row[];
    expect(data.levels.filter((l: Row) => l.section === "co").length).toBe(b2.length);
    expect(data.levels.filter((l: Row) => l.section === "co").reduce((n: number, l: Row) => n + l.ok, 0)).toBe(ok);
    expect(data.levels.reduce((n: number, l: Row) => n + l.answered, 0)).toBe(count("SELECT SUM(answered) n FROM practice_days WHERE user_id = 'demo-1'"));
    expect(data.signin).toEqual({ lockedUntil: null, failedLogins: 0, codes: { hour: 0, day: 0, hourMax: 3, dayMax: 10, limited: false } });
    expect(data.mail).toEqual([]);
    expect(data.mocks).toEqual([]);
  });

  it("a person who cannot get in: the pause after wrong passwords, the limit of codes, the mails sent — and « unlock »", async () => {
    const soon = new Date(Date.now() + 600_000).toISOString(), now = new Date().toISOString();
    raw.prepare("UPDATE users SET failed_logins = 3, locked_until = ? WHERE id = 'demo-1'").run(soon);
    raw.prepare("INSERT INTO codes (email, purpose, code_hash, created_at, expires_at, sends, window_at, day_sends, day_at) VALUES ('amina@demo.tcf.monster', 'email', 'h', ?1, ?1, 3, ?1, 4, ?1)").run(now);
    raw.prepare("INSERT INTO mail (at, email, kind, ok, detail) VALUES (?, 'amina@demo.tcf.monster', 'signin', 1, 'resend'), (?, 'amina@demo.tcf.monster', 'signin', 0, 'resend HTTP 429'), (?, 'sofia@demo.tcf.monster', 'signin', 1, 'resend')").run(now, now, now);
    const before = (await call("/api/admin/people/demo-1")).data;
    expect(before.signin).toMatchObject({ lockedUntil: soon, failedLogins: 3, codes: { hour: 3, day: 4, limited: true } });
    expect(before.mail.map((m: Row) => m.ok)).toEqual([0, 1]);
    expect(JSON.stringify(before)).not.toContain("code_hash");

    expect((await call("/api/admin/people/demo-1/unlock", { body: {} })).status).toBe(200);
    const after = (await call("/api/admin/people/demo-1")).data;
    expect(after.signin).toMatchObject({ lockedUntil: null, failedLogins: 0, codes: { hour: 0, day: 0, limited: false } });
    expect(after.guard.events[0]).toMatchObject({ kind: "admin", detail: "sign-in unlocked" });
    // a pause that already ended is not one
    raw.prepare("UPDATE users SET locked_until = '2020-01-01T00:00:00.000Z' WHERE id = 'demo-1'").run();
    expect((await call("/api/admin/people/demo-1")).data.signin.lockedUntil).toBeNull();
  });

  it("a fresh try: one practice level, one exam attempt, one session, one mock exam — nothing else moves", async () => {
    const n = (sql: string) => count(sql);
    const days = n("SELECT COUNT(*) n FROM practice_days WHERE user_id = 'demo-1'");
    const level = (raw.prepare("SELECT level FROM progress WHERE user_id = 'demo-1' AND section = 'co' LIMIT 1").get() as Row).level;
    const rows = n("SELECT COUNT(*) n FROM progress WHERE user_id = 'demo-1'");
    expect((await call("/api/admin/people/demo-1/reset-progress", { body: { section: "co", level } })).status).toBe(200);
    expect(n("SELECT COUNT(*) n FROM progress WHERE user_id = 'demo-1'")).toBe(rows - 1);
    expect(n("SELECT COUNT(*) n FROM practice_days WHERE user_id = 'demo-1'")).toBe(days);
    expect((await call("/api/admin/people/demo-1/reset-progress", { body: { section: "co", level: "Z9" } })).status).toBe(400);
    expect((await call("/api/admin/people/demo-1/reset-progress", { body: { section: "ee", level: "B2" } })).status).toBe(400);
    expect(n("SELECT COUNT(*) n FROM progress WHERE user_id = 'demo-1'")).toBe(rows - 1);

    const attempts = n("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1'");
    const a = raw.prepare("SELECT id FROM attempts WHERE user_id = 'demo-1' LIMIT 1").get() as Row;
    // someone else's attempt is not this person's to lose
    expect((await call("/api/admin/people/demo-2/delete-attempt", { body: { id: a.id } })).status).toBe(404);
    expect((await call("/api/admin/people/demo-1/delete-attempt", { body: { id: a.id } })).status).toBe(200);
    expect(n("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1'")).toBe(attempts - 1);
    expect((await call("/api/admin/people/demo-1/delete-attempt", { body: { id: a.id } })).status).toBe(404);

    raw.prepare("INSERT INTO mocks (id, user_id, started_at, status, stage) VALUES (77, 'demo-1', '2026-11-01T10:00:00.000Z', 'running', 'ee')").run();
    const add = raw.prepare("INSERT INTO expr_sessions (id, user_id, section, kind, taches, mock_id, started_at) VALUES (?, 'demo-1', ?, 'exam', '[1,2,3]', ?, '2026-11-01T10:00:00.000Z')");
    add.run("s-mock", "ee", 77); add.run("s-free", "eo", null);
    raw.prepare("INSERT INTO expr_tasks (id, session_id, task_no, prompt_json) VALUES ('t-mock', 's-mock', 1, '{}'), ('t-free', 's-free', 1, '{}')").run();
    expect((await call("/api/admin/people/demo-1")).data.mocks[0]).toMatchObject({ id: 77, status: "running", stage: "ee", overall: null });
    expect((await call("/api/admin/people/demo-1/delete-session", { body: { id: "s-mock" } })).status).toBe(400);
    expect((await call("/api/admin/people/demo-2/delete-session", { body: { id: "s-free" } })).status).toBe(404);
    expect((await call("/api/admin/people/demo-1/delete-session", { body: { id: "s-free" } })).status).toBe(200);
    expect(n("SELECT COUNT(*) n FROM expr_tasks WHERE id = 't-free'")).toBe(0);
    expect(n("SELECT COUNT(*) n FROM expr_tasks WHERE id = 't-mock'")).toBe(1);
    expect((await call("/api/admin/people/demo-2/delete-mock", { body: { id: 77 } })).status).toBe(404);
    expect((await call("/api/admin/people/demo-1/delete-mock", { body: { id: 77 } })).status).toBe(200);
    expect(n("SELECT COUNT(*) n FROM mocks WHERE id = 77") + n("SELECT COUNT(*) n FROM expr_sessions WHERE id = 's-mock'") + n("SELECT COUNT(*) n FROM expr_tasks WHERE id = 't-mock'")).toBe(0);
    // every one of them left a line the person's page shows
    const said = (await call("/api/admin/people/demo-1")).data.guard.events.filter((e: Row) => e.kind === "admin").map((e: Row) => e.detail).sort();
    expect(said.length).toBe(4);
    expect(said[0]).toMatch(/^deleted C[OE] exam \d+$/);
    expect(said.slice(1)).toEqual(["deleted EO session", "deleted mock exam 77", `reset practice CO ${level}`]);
  });

  it("one device signed out, the others stay; unblock clears a pending check too", async () => {
    const [first] = (await call("/api/admin/people/demo-1")).data.devices;
    expect((await call("/api/admin/people/demo-1/signout", { body: { session: first.id } })).data.removed).toBe(1);
    expect(count("SELECT COUNT(*) n FROM sessions WHERE user_id = 'demo-1'")).toBe(1);
    raw.prepare("UPDATE users SET human_needed_at = 'x', human_fails = 4, guard_signs = '{\"quiet\":\"2026-11-10T10:00:00.000Z\"}' WHERE id = 'demo-1'").run();
    await call("/api/admin/people/demo-1/unblock", { body: {} });
    const u = raw.prepare("SELECT human_needed_at, human_fails, guard_signs, blocked_at FROM users WHERE id = 'demo-1'").get() as Row;
    expect(u).toMatchObject({ human_needed_at: null, human_fails: 0, guard_signs: null, blocked_at: null });
  });

  it("disputes as tickets: the list, one report with its sender, done with a note, reopened", async () => {
    const add = raw.prepare("INSERT INTO disputes (user_id, section, level, question_id, n, message, created_at) VALUES (?, 'co', 'B2', 'q-1', ?, ?, ?)");
    add.run("demo-1", 4, "La réponse B est juste", "2026-10-20T10:00:00Z");
    add.run("demo-1", 9, "Audio coupé", "2026-10-21T10:00:00Z");
    add.run("demo-2", 2, "Faute de frappe", "2026-10-22T10:00:00Z");
    const list = (await call("/api/admin/disputes")).data;
    expect(list.rows.map((r: Row) => r.message)).toEqual(["Faute de frappe", "Audio coupé", "La réponse B est juste"]);
    expect([list.open, list.resolved]).toEqual([3, 0]);
    expect((await call("/api/admin/overview")).data.needs.disputesOpen).toBe(3);

    const one = (await call("/api/admin/disputes/2")).data;
    expect(one).toMatchObject({ id: 2, n: 9, email: "amina@demo.tcf.monster", name: "Amina", reports: 2, status: "open", note: null });
    expect((await call("/api/admin/people/demo-1")).data.disputes.map((r: Row) => r.id)).toEqual([2, 1]);

    expect((await call("/api/admin/disputes/2/resolve", { body: { note: "  audio replaced  " } })).status).toBe(200);
    expect((await call("/api/admin/disputes/2")).data).toMatchObject({ status: "resolved", note: "audio replaced" });
    expect((await call("/api/admin/disputes?status=resolved")).data.rows.map((r: Row) => r.id)).toEqual([2]);
    expect((await call("/api/admin/disputes?status=open")).data.rows.map((r: Row) => r.id)).toEqual([3, 1]);
    expect((await call("/api/admin/disputes?status=all")).data.rows.length).toBe(3);

    await call("/api/admin/disputes/2/reopen", { body: {} });
    expect((await call("/api/admin/disputes/2")).data).toMatchObject({ status: "open", resolved_at: null });
    expect((await call("/api/admin/disputes/99")).status).toBe(404);
    expect((await call("/api/admin/disputes/99/resolve", { body: {} })).status).toBe(404);
    expect((await call("/api/admin/disputes/2/delete", { body: {} })).status).toBe(404);
  });

  it("the old Content and Jobs routes are gone", async () => {
    for (const p of ["/api/admin/content", "/api/admin/topics", "/api/admin/jobs"]) expect((await call(p)).status, p).toBe(404);
    for (const p of ["/api/admin/hide", "/api/admin/jobs/backup/run", "/api/admin/mail/test"]) expect((await call(p, { body: {} })).status, p).toBe(404);
  });

  it("actions: sign out everywhere, reset one section, note, delete (a key lives in the person's browser: none to remove)", async () => {
    expect((await call("/api/admin/people/demo-1/signout", { body: {} })).data.removed).toBe(2);
    expect(count("SELECT COUNT(*) n FROM sessions WHERE user_id = 'demo-1'")).toBe(0);

    expect((await call("/api/admin/people/demo-1/remove-key", { body: {} })).status).not.toBe(200);

    const ceBefore = count("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1' AND section = 'ce'");
    await call("/api/admin/people/demo-1/reset-progress", { body: { section: "co" } });
    expect(count("SELECT COUNT(*) n FROM progress WHERE user_id = 'demo-1' AND section = 'co'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1' AND section = 'co'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM attempts WHERE user_id = 'demo-1' AND section = 'ce'")).toBe(ceBefore);
    expect((await call("/api/admin/people/demo-1/reset-progress", { body: { section: "xx" } })).status).toBe(400);

    await call("/api/admin/people/demo-1/note", { body: { note: "asked about C1" } });
    expect((await call("/api/admin/people/demo-1")).data.user.note).toBe("asked about C1");

    await call("/api/admin/people/demo-1/delete", { body: {} });
    for (const t of ["users", "sessions", "progress", "practice_days", "attempts", "expr_sessions", "mocks"])
      expect(count(`SELECT COUNT(*) n FROM ${t} WHERE ${t === "users" ? "id" : "user_id"} = 'demo-1'`)).toBe(0);
    expect(count("SELECT COUNT(*) n FROM users")).toBe(5);
  });

  it("changes need the x-admin header; other methods are refused", async () => {
    const r = await worker.fetch(new Request("https://admin.tcf.monster/api/admin/people/demo-1/delete", { method: "POST" }), env);
    expect(r.status).toBe(403);
    expect(count("SELECT COUNT(*) n FROM users WHERE id = 'demo-1'")).toBe(1);
    expect((await call("/api/admin/overview", { method: "DELETE" })).status).toBe(405);
  });

  it("once ADMIN_OPEN is 0, only the owner's live session gets in", async () => {
    (env as Row).ADMIN_OPEN = "0";
    expect((await call("/api/admin/overview")).status).toBe(403);
    const hash = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('owner', 'owner@example.com', 'x')").run();
    raw.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, 'owner', 'x', 'x', '2999-01-01')").run(await hash("tok-owner"));
    raw.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, 'demo-1', 'x', 'x', '2999-01-01')").run(await hash("tok-amina"));
    raw.prepare("INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, 'owner', 'x', 'x', '2000-01-01')").run(await hash("tok-old"));
    expect((await call("/api/admin/overview", { headers: { cookie: "tcfm_session=tok-owner" } })).status).toBe(200);
    expect((await call("/api/admin/overview", { headers: { cookie: "tcfm_session=tok-amina" } })).status).toBe(403);
    expect((await call("/api/admin/overview", { headers: { cookie: "tcfm_session=tok-old" } })).status).toBe(403);
  });

  it("pages: any admin address gets the admin page, any app address the app page, with strict headers", async () => {
    (env as Row).ASSETS = { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`) };
    const page = await call("/people/demo-1");
    expect(page.data).toBe("asset /admin/");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect((await call("/assets/admin-1.js")).data).toBe("asset /assets/admin-1.js");
    expect((await call("/profile", { host: "tcf.monster" })).data).toBe("asset /app/");
    expect((await call("/api/admin/overview", { host: "tcf.monster" })).status).toBe(404);
  });
});

// a pretend formation-tcfcanada.com: index pages listing month addresses, month pages with the data in script strings
function site(pages: Record<string, string>) {
  const hits: string[] = [];
  const fetcher = (async (url: string) => {
    hits.push(url);
    const body = pages[url];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(body);
  }) as unknown as typeof fetch;
  return { fetcher, hits };
}
const B = "https://www.formation-tcfcanada.com/epreuve";
const esc = (o: unknown) => JSON.stringify(o).replaceAll('"', '\\"');
const index = (slugs: string[]) => slugs.map((s) => `<a href="/epreuve/x/sujets-actualites/${s}">`).join("") + `<a href="/epreuve/x/sujets-actualites/favoris">`;
const eoPage = (title: string, parties: unknown[]) => `<title>Sujets Expression Orale TCF Canada - ${title}</title><script>self.__next_f.push([1,"${esc({ parties })}"])</script>`;
const eePage = (title: string, combinaisons: unknown[]) => `<title>Sujets Expression Écrite TCF Canada - ${title}</title><script>self.__next_f.push([1,"${esc({ combinaisons })}"])</script>`;
const partie = (id: number, jour: number, topics: [number, number, string][]) => ({ id, jour, date: "x", sujets: topics.map(([tid, tache, title]) => ({ id: tid, tache, title, description: "$undefined", correction: "MODEL ANSWER" })) });
const combi = (id: number, n: number) => ({ id, titre: `Combinaison ${n}`, tache1: { sujet: "Écrivez à Alex.", correction: "MODEL" }, tache2: { sujet: "Racontez." }, tache3: { titre: "Pour ou contre ?", document1: { contenu: "Doc 1" }, document2: "Doc 2" } });

describe("topics sync", () => {
  it("parses months, Parties and Combinaisons, and never keeps the model answers", () => {
    expect(monthOf("<title>Sujets - Août 2026</title>")).toBe("2026-08");
    const eo = parseEO(eoPage("Octobre 2026", [partie(1, 3, [[11, 2, "Posez-moi des questions."], [12, 3, "Qu’en pensez-vous ?"]])]), "2026-10")!;
    expect(eo).toEqual([
      { id: 11, month: "2026-10", part: 3, part_id: 1, tache: 2, position: 0, title: "Posez-moi des questions.", body: {} },
      { id: 12, month: "2026-10", part: 3, part_id: 1, tache: 3, position: 1, title: "Qu’en pensez-vous ?", body: {} },
    ]);
    const ee = parseEE(eePage("Octobre 2026", [combi(7, 4)]), "2026-10")!;
    expect(ee[0]).toMatchObject({ id: 7, part: 4, tache: null, title: "Combinaison 4", body: { tache1: "Écrivez à Alex.", tache3: { title: "Pour ou contre ?", document1: "Doc 1", document2: "Doc 2" } } });
    expect(JSON.stringify([eo, ee])).not.toContain("MODEL");
  });

  it("first run reads every month; later runs read new addresses and the three newest months only; a vanished topic is kept as gone", async () => {
    const months = ["mai-2026", "juin-2026", "juillet-2026", "aot-2026"];
    const titles = ["Mai 2026", "Juin 2026", "Juillet 2026", "Août 2026"];
    const pages: Record<string, string> = {
      [`${B}/expression-orale/sujets-actualites`]: index(months),
      [`${B}/expression-ecrite/sujets-actualites`]: index(["aot-2026"]),
      [`${B}/expression-ecrite/sujets-actualites/aot-2026`]: eePage("Août 2026", [combi(70, 1), combi(71, 2)]),
    };
    months.forEach((m, i) => { pages[`${B}/expression-orale/sujets-actualites/${m}`] = eoPage(titles[i], [partie(100 + i, 1, [[1000 + i * 10, 2, `T2 ${m}`], [1001 + i * 10, 3, `T3 ${m}`]])]); });
    let s = site(pages);
    const first = await syncTopics(env, s.fetcher);
    expect(first.ok).toBe(true);
    expect(count("SELECT COUNT(*) n FROM topics WHERE section = 'eo'")).toBe(8);
    expect(count("SELECT COUNT(*) n FROM topics WHERE section = 'ee'")).toBe(2);
    expect(s.hits.length).toBe(2 + 4 + 1);

    // nothing changed: the oldest month is not read again, and no topic row is written
    const writes = count("SELECT COALESCE(SUM(writes), 0) n FROM budget");
    s = site(pages);
    const second = await syncTopics(env, s.fetcher);
    expect(second.detail).toContain("no change");
    expect(s.hits).not.toContain(`${B}/expression-orale/sujets-actualites/mai-2026`);
    expect(count("SELECT COALESCE(SUM(writes), 0) n FROM budget")).toBe(writes);

    // a new month appears and one August topic disappears from the source
    pages[`${B}/expression-orale/sujets-actualites`] = index([...months, "septembre-2026"]);
    pages[`${B}/expression-orale/sujets-actualites/septembre-2026`] = eoPage("Septembre 2026", [partie(200, 1, [[2000, 2, "Nouveau"]])]);
    pages[`${B}/expression-orale/sujets-actualites/aot-2026`] = eoPage("Août 2026", [partie(103, 1, [[1030, 2, "T2 aot-2026"]])]);
    s = site(pages);
    await syncTopics(env, s.fetcher);
    expect(count("SELECT COUNT(*) n FROM topics WHERE id = 2000")).toBe(1);
    expect(raw.prepare("SELECT gone_at FROM topics WHERE id = 1031").get()).not.toEqual({ gone_at: null });
    expect(raw.prepare("SELECT gone_at FROM topics WHERE id = 1030").get()).toEqual({ gone_at: null });
  });

  it("a broken source is a failed run, recorded, with nothing lost", async () => {
    raw.prepare("INSERT INTO topics (section, id, month, part, part_id, tache, position, title, first_seen, last_seen) VALUES ('eo', 5, '2026-10', 1, 9, 2, 0, 'Gardé', 'x', 'x')").run();
    const s = site({ [`${B}/expression-orale/sujets-actualites`]: "<html>new layout</html>" });
    const r = await syncTopics(env, s.fetcher);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("eo: no month links");
    expect(r.detail).toContain("ee: index unreadable");
    expect(count("SELECT COUNT(*) n FROM topics")).toBe(1);
  });
});

describe("jobs", () => {
  it("backup copies every table people produce, in pages, and keeps 3 nights (Time Travel covers 7 days)", async () => {
    raw.exec(demoSql());
    for (let d = 1; d <= 31; d++) await r2.put(`backups/2026-01-${String(d).padStart(2, "0")}/users-0000.json`, "[]");
    const r = await runJob(env, "backup");
    expect(r.ok).toBe(true);
    const keys = [...r2.mem.keys()];
    const today = keys.find((k) => k.includes("/users-0000.json") && !k.startsWith("backups/2026-01"))!;
    expect(JSON.parse(r2.mem.get(today)!).length).toBe(6);
    expect(keys.some((k) => k.includes("/progress-0000.json"))).toBe(true);
    expect(keys.some((k) => k.includes("/sessions-"))).toBe(false); // sign-in cookies are never backed up
    expect(keys.some((k) => k.includes("/expr_sessions-"))).toBe(true);
    const days = new Set(keys.map((k) => k.split("/")[1]));
    expect(days.size).toBe(3);
    expect(days.has("2026-01-29")).toBe(false); // tonight's copy and the two before it
    expect(days.has("2026-01-30") && days.has("2026-01-31")).toBe(true);
    expect(keys.some((k) => k.includes("/topics-"))).toBe(false); // fetched again by the weekly sync
    expect(raw.prepare("SELECT name, ok FROM jobs").get()).toEqual({ name: "backup", ok: 1 });
    expect(count("SELECT COUNT(*) n FROM job_log")).toBe(2); // « started », then the run
  });

  it("cleanup removes expired sign-ins and codes only", async () => {
    raw.exec(demoSql());
    raw.prepare("INSERT INTO codes (email, purpose, code_hash, created_at, expires_at) VALUES ('a@b.c', 'signup', 'h', 'x', '2000-01-01'), ('d@e.f', 'signup', 'h', 'x', '2999-01-01')").run();
    raw.prepare("UPDATE sessions SET expires_at = '2000-01-01' WHERE id = 'demo-s-0-1'").run();
    const before = count("SELECT COUNT(*) n FROM sessions");
    const r = await runJob(env, "cleanup");
    expect(r.detail).toMatch(/^1 sign-ins and 1 codes expired/);
    expect(count("SELECT COUNT(*) n FROM sessions")).toBe(before - 1);
    expect(count("SELECT COUNT(*) n FROM codes")).toBe(1);
  });

  it("a job that throws is a recorded failure, not a crash", async () => {
    (env as Row).FILES = { put: async () => { throw new Error("bucket unavailable"); }, list: async () => ({ delimitedPrefixes: [] }) };
    const r = await runJob(env, "backup");
    expect(r).toEqual({ ok: false, detail: "bucket unavailable" });
    expect(raw.prepare("SELECT ok, detail FROM jobs WHERE name = 'backup'").get()).toEqual({ ok: 0, detail: "bucket unavailable" });
  });

});
