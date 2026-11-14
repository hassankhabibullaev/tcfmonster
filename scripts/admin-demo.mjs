// The admin on this Mac with the tests' six made-up people (tests/fixtures/people.ts) and one of each thing that
// can go wrong for someone, in memory: nothing is kept, no database people use is touched. For looking at the admin's
// pages while working on them. `vite build` first (the pages come from dist/).
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnv } from "./local-env.ts";
import { demoSql } from "../tests/fixtures/people.ts";
import worker from "../worker/index.ts";

process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));
const PORT = Number(process.env.PORT ?? 3503);
const { env, raw } = makeEnv();
raw.exec(demoSql());

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const run = (sql, ...a) => raw.prepare(sql).run(...a);
// Karim: blocked by the guard after a hidden trap
run("UPDATE users SET blocked_at = ?, blocked_reason = 'touched a hidden trap (/data/bank-full.json)', guard_signs = ? WHERE id = 'demo-4'", ago(190), JSON.stringify({ trap: ago(190), webdriver: ago(200) }));
run("INSERT INTO guard_events (user_id, at, kind, detail) VALUES ('demo-4', ?, 'sign', 'webdriver'), ('demo-4', ?, 'blocked', 'touched a hidden trap (/data/bank-full.json)')", ago(200), ago(190));
// Daniyar: the human check asked, failed four times
run("UPDATE users SET human_needed_at = ?, human_reason = 'never answered Cloudflare''s invisible check', human_fails = 4, guard_signs = ? WHERE id = 'demo-2'", ago(55), JSON.stringify({ nocheck: ago(55), failing: ago(20) }));
run("INSERT INTO guard_events (user_id, at, kind, detail) VALUES ('demo-2', ?, 'challenged', 'never answered the invisible check'), ('demo-2', ?, 'failed', NULL)", ago(55), ago(20));
// Lin: wrong passwords, the limit of codes, a mail that failed
run("UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = 'demo-5'", new Date(Date.now() + 9 * 60000).toISOString());
run("INSERT INTO codes (email, purpose, code_hash, created_at, expires_at, sends, window_at, day_sends, day_at) VALUES ('lin@demo.tcf.monster', 'email', 'x', ?1, ?1, 3, ?1, 3, ?1)", ago(12));
run("INSERT INTO mail (at, email, kind, ok, detail) VALUES (?, 'lin@demo.tcf.monster', 'signin', 1, 'resend'), (?, 'lin@demo.tcf.monster', 'signin', 1, 'resend'), (?, 'lin@demo.tcf.monster', 'signin', 0, 'resend HTTP 429: daily quota')", ago(40), ago(25), ago(12));
// Amina: a mock exam left open, two reports on questions
run("INSERT INTO mocks (user_id, started_at, status, stage) VALUES ('demo-1', ?, 'running', 'ce')", ago(75));
run("INSERT INTO disputes (user_id, section, level, question_id, n, message, created_at) VALUES ('demo-1', 'co', 'B2', 'q-1', 14, 'La réponse B me semble juste aussi', ?), ('demo-3', 'ce', 'C1', 'q-2', 7, 'Faute de frappe dans le texte', ?)", ago(300), ago(90));
// the nightly jobs and the day's counters
run("INSERT INTO jobs (name, last_at, ok, detail, seconds) VALUES ('backup', ?1, 1, '14 tables', 4.1), ('cleanup', ?1, 1, 'fine', 0.8), ('mails', ?1, 1, '3 sent', 1.2), ('topics', ?1, 1, 'no change', 6.5)", ago(600));
run("INSERT INTO budget (day, writes) VALUES (date('now', '+5 hours'), 3120) ON CONFLICT(day) DO UPDATE SET writes = 3120");

const serve = (host) => async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  if (headers.origin) headers.origin = `http://${host}`;
  const r = await worker.fetch(new Request(`http://${host}${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
};
createServer(serve(`admin.localhost:${PORT}`)).listen(PORT, () => console.log(`admin (made-up people, in memory) on http://localhost:${PORT}`));
