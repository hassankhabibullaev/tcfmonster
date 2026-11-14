// One person, for support: what stops them (with the button that fixes it) on top, then four tabs — Overview (the four
// tests, practice level by level), History (everything they did, each piece removable for a fresh try), Access (the
// guard, the sign-in door, devices, e-mails) and Account (profile, settings, the irreversible actions).
import { useEffect, useState, type ReactNode } from "react";
import { BackLink, Icon, Chip, Mark, Button, Sheet, Seg, Tabs, ColourBar, Empty, type IconName, type Section, type Tone } from "../../ui/ui.tsx";
import { useApi, useSummary, useLocation, setParams, api, linkProps, go, num, when, date, time, minutes, plural } from "../lib.ts";
import { ExamDate, DayStrip, Levels, Gain } from "./People.tsx";
import { useToast } from "../main.tsx";

type Attempt = { id: number; section: "co" | "ce"; exam: number; mode: string; started_at: string; deadline_at: string; finished_at: string | null; ended: string | null; score: number | null; nclc: number | null; right_count: number | null; wrong_count: number | null; blank_count: number | null; mock_id: number | null };
type Expr = { id: string; section: "ee" | "eo"; kind: string; taches: string; mode: string | null; mock_id: number | null; started_at: string; finished_at: string | null; ended: string | null; score: number | null; nclc: number | null; seconds: number | null };
type Mock = { id: number; started_at: string; finished_at: string | null; status: string; stage: string; overall: number | null; nclc: Record<Section, number | null> };
type Practice = { day: string; section: "co" | "ce"; level: string; answered: number; wrong: number; seconds: number; last_at: string };
type Level = { section: "co" | "ce"; level: string; ok: number; bad: number; amber: number; answered: number; wrong: number; seconds: number; last_at: string | null };
type Report = { id: number; section: "co" | "ce"; level: string; n: number; message: string; status: "open" | "resolved"; created_at: string };
type Detail = {
  user: { id: string; email: string; name: string | null; created_at: string; last_seen_at: string | null; target_nclc: number | null; exam_date: string | null; lang: string; settings: Record<string, unknown>; terms_version: string | null; terms_at: string | null; gemini_status: string; gemini_checked_at: string | null; gemini_error: string | null; note: string | null; has_password: boolean; blocked_at: string | null; blocked_reason: string | null; human_until: string | null; human_needed_at: string | null; human_reason: string | null; human_fails: number };
  /** the sign-in door: the pause after wrong passwords, the e-mail codes sent against their hourly and daily lines */
  signin: { lockedUntil: string | null; failedLogins: number; codes: { hour: number; day: number; hourMax: number; dayMax: number; limited: boolean } };
  devices: { id: string; device: string | null; created_at: string; last_seen_at: string }[];
  colours: Record<string, { ok: number; bad: number; amber: number }>;
  levels: Level[]; attempts: Attempt[]; expression: Expr[]; mocks: Mock[]; practice: Practice[]; answeredToday: number; disputes: Report[];
  /** question-bank files opened (worker/coce/guard.ts) */
  bank: Record<"data", { today: number; week: number }>;
  /** the e-mails sent to the address, newest first */
  mail: { at: string; kind: string; ok: number; detail: string | null }[];
  /** what the abuse guard did and what the owner did here, newest first; today's counted requests and changes; the signs
   *  of a machine seen in the last seven days with the score they make (the check at askAt, a block at blockAt) */
  guard: { events: { at: string; kind: string; detail: string | null }[]; today: { requests: number; writes: number }; score: number; askAt: number; blockAt: number; signs: { sign: string; label: string; weight: number; check: boolean; at: string }[] };
};

const GUARD_CHIP: Record<string, [Tone, string]> = { challenged: ["amber", "human check asked"], passed: ["ok", "check passed"], failed: ["amber", "check failed"], sign: ["amber", "sign"], blocked: ["bad", "blocked"], unblocked: ["ok", "unblocked"], admin: ["new", "you"] };
const KEY_CHIP: Record<string, [Tone, string]> = { ok: ["ok", "working"], error: ["bad", "rejected"], quota: ["amber", "limit"], none: ["new", "none"] };
const ENDED: Record<string, string> = { done: "finished", time: "time ran out", abandon: "abandoned", abandoned: "abandoned", in_progress: "in progress", early: "ended early", dropped: "dropped", running: "running", marking: "marking", stale: "left behind" };
const MAIL: Record<string, string> = { signup: "sign-up code", signin: "sign-in code", reset: "password code", password: "password code", delete: "deletion code", deleted: "account deleted", welcome: "welcome", luck: "good luck", after: "how did it go", test: "test", alert: "alert" };
const STAGE: Record<string, string> = { co: "listening", break1: "first break", ce: "reading", break2: "second break", ee: "writing", break3: "third break", eo: "speaking", marking: "marking", over: "over" };
const SECTIONS: Section[] = ["co", "ce", "ee", "eo"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** a question to the owner before something changes: what happens, the button, and what runs on yes */
type Ask = { title: string; body: ReactNode; button: string; danger?: boolean; typed?: string; /** the sheet shows the choice of what to reset, read when the button is pressed */ reset?: boolean; run: () => Promise<unknown>; said: string; then?: () => void };

type Kind = "exam" | "expr" | "mock" | "practice";
type Line = { key: string; kind: Kind; at: string; s?: Section; what: string; result: string; length: string; tag: string; tone?: Tone; remove?: () => void };

function SectionCard({ s, d, total }: { s: Section; d: Detail; total?: number }) {
  if (s === "co" || s === "ce") {
    const done = d.attempts.filter((a) => a.section === s && a.finished_at);
    const best = done.reduce<Attempt | null>((b, a) => (!b || (a.score ?? 0) > (b.score ?? 0) ? a : b), null);
    const latest = done[0];
    const c = d.colours[s] ?? { ok: 0, bad: 0, amber: 0 };
    const answered = d.levels.filter((l) => l.section === s).reduce((n, l) => n + l.answered, 0);
    return (
      <section className="card pad sec-card">
        <Mark s={s} big />
        <div className="sec-score"><span className="stat-value small">{best ? best.score : "—"}</span>{best && <span className="muted">best · NCLC {best.nclc ?? "< 4"}</span>}</div>
        <span className="muted">{done.length ? `${plural(done.length, "exam")} · latest ${latest.score}` : "No exam yet"}</span>
        <ColourBar {...c} total={total} />
        <span className="muted small">{num(c.ok + c.amber + c.bad)}{total ? ` of ${num(total)}` : ""} practised · {num(answered)} answers</span>
      </section>
    );
  }
  const rows = d.expression.filter((e) => e.section === s);
  const scored = rows.filter((e) => e.score != null);
  const avg = scored.length ? scored.reduce((n, e) => n + (e.score ?? 0), 0) / scored.length : null;
  return (
    <section className="card pad sec-card">
      <Mark s={s} big />
      <div className="sec-score"><span className="stat-value small">{avg == null ? "—" : avg.toFixed(1)}</span>{avg != null && <span className="muted">average / 20</span>}</div>
      <span className="muted">{rows.length ? plural(rows.length, "session") : "No session yet"}</span>
      <span className="muted small">{plural(rows.filter((e) => e.kind === "exam").length, "full test")} · {num(rows.filter((e) => e.ended === "dropped" || e.ended === "abandoned").length)} abandoned</span>
    </section>
  );
}

/** something that stops the person, said in a sentence, with the button that ends it */
function Problem({ tone, icon, title, children, button, onClick }: { tone: "bad" | "amber" | "info"; icon: IconName; title: string; children: ReactNode; button?: string; onClick?: () => void }) {
  return (
    <div className={`problem ${tone}`} role={tone === "info" ? undefined : "alert"}>
      <span className="problem-icon"><Icon name={icon} size={18} /></span>
      <div className="problem-text"><strong>{title}</strong><span>{children}</span></div>
      {button && <Button size="sm" kind={tone === "info" ? "plain" : "primary"} onClick={onClick}>{button}</Button>}
    </div>
  );
}

/** why the guard blocked, read from the signs on record */
function blockHint(d: Detail) {
  if (d.user.blocked_reason === "by the owner") return "You blocked this account yourself.";
  const has = (...names: string[]) => d.guard.signs.some((s) => names.includes(s.sign));
  if (has("trap", "canary")) return "It touched something no person can see or reach: almost certainly a program.";
  if (has("webdriver", "headless", "rhythm")) return "The browser carried a machine's mark. A person with an automation extension can set it off: ask what they use.";
  return "No machine's mark is on record any more: read the events under Access before deciding.";
}

export function Person({ id }: { id: string }) {
  const { data: d, error, reload } = useApi<Detail>(`/people/${id}`);
  const { params } = useLocation();
  const summary = useSummary();
  const say = useToast();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetWhat, setResetWhat] = useState<"all" | Section>("all");
  const [note, setNote] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [show, setShow] = useState<"all" | Kind>("all");
  const [allLines, setAllLines] = useState(false);
  useEffect(() => { if (d) setNote(d.user.note ?? ""); }, [d]);

  if (error) return <div className="page"><BackLink to="/people" label="People" /><Empty icon="users" title={error === "no such person" ? "This person no longer exists" : "Could not load"}>{error !== "no such person" && error}</Empty></div>;
  if (!d) return <div className="page"><div className="skeleton tall" /></div>;
  const u = d.user;
  const name = u.name ?? u.email;
  const tab = (["overview", "history", "access", "account"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as "overview" | "history" | "access" | "account";
  const openTab = (t: string) => setParams({ tab: t === "overview" ? null : t });
  const totals = summary ? { co: Object.values(summary.bank.co).reduce((n, l) => n + l.questions, 0), ce: Object.values(summary.bank.ce).reduce((n, l) => n + l.questions, 0) } : undefined;
  const post = (action: string, body: Record<string, unknown> = {}) => api(`/people/${id}/${action}`, body);
  const close = () => { setAsk(null); setTyped(""); setResetWhat("all"); };

  async function run() {
    if (!ask) return;
    setBusy(true);
    try {
      await (ask.reset ? post("reset-progress", { section: resetWhat }) : ask.run());
      say(ask.said);
      const then = ask.then;
      close();
      if (then) then(); else reload();
    } catch (e) {
      say((e as Error).message, "bad");
    } finally { setBusy(false); }
  }
  async function saveNote() {
    try { await post("note", { note }); setSavedNote(true); setTimeout(() => setSavedNote(false), 2000); }
    catch (e) { say((e as Error).message, "bad"); }
  }

  // ---- the questions ----
  const reopen = " An app they already have open shows it after a reload.";
  const askUnblock = () => setAsk({ title: u.blocked_at ? `Unblock ${name}?` : `Clear ${name}'s human check?`, button: u.blocked_at ? "Unblock" : "Clear the check", said: u.blocked_at ? `${name} can sign in again` : "The check is cleared",
    body: u.blocked_at ? "They can sign in again. The pending human check, the signs counted so far and today's counts start from zero." : "The pending human check, the failed tries and the signs counted so far start from zero.", run: () => post("unblock") });
  const askBlock = () => setAsk({ title: `Block ${name}?`, button: "Block", danger: true, said: `${name} is blocked`, body: "Every device is signed out and signing in is refused until you unblock.", run: () => post("block") });
  const askUnlock = () => setAsk({ title: "Unlock the sign-in?", button: "Unlock", said: "They can sign in and ask for a code again", body: "The pause after wrong passwords ends now and the count of e-mail codes starts again. A code already sent stops working: they ask for a new one.", run: () => post("unlock") });
  const askSignout = (session?: { id: string; device: string | null }) => setAsk({ title: session ? `Sign out of ${session.device ?? "this device"}?` : `Sign ${name} out everywhere?`, button: session ? "Sign out" : "Sign out everywhere", said: session ? "That device is signed out" : `${name} is signed out everywhere`,
    body: session ? "That device asks for the password again; the others stay signed in." : `${plural(d.devices.length, "device")} will ask for the password again.`, run: () => post("signout", session ? { session: session.id } : {}) });
  const askLevel = (l: Level) => setAsk({ title: `Reset ${l.section.toUpperCase()} ${l.level}?`, button: "Reset the level", danger: true, said: `${l.section.toUpperCase()} ${l.level} starts again`,
    body: <>The {num(l.ok + l.amber + l.bad)} coloured questions of this level become new again. Their days of practice and their exams stay.{reopen} This cannot be undone.</>, run: () => post("reset-progress", { section: l.section, level: l.level }) });
  const askAttempt = (a: Attempt) => setAsk({ title: `Delete ${a.section.toUpperCase()} exam ${a.exam}?`, button: "Delete the attempt", danger: true, said: "The attempt is gone",
    body: <>{a.finished_at ? `This attempt of ${when(a.started_at)} (score ${a.score ?? "—"}) leaves their lists and their dashboard.` : "This attempt is still running: it ends now and leaves no result."} They can sit the exam again at once. This cannot be undone.</>, run: () => post("delete-attempt", { id: a.id }) });
  const askSession = (e: Expr) => setAsk({ title: `Delete this ${e.section.toUpperCase()} session?`, button: "Delete the session", danger: true, said: "The session is gone",
    body: <>The session of {when(e.started_at)}{e.score != null ? ` (${e.score} / 20)` : ""} and its marks leave their lists and their dashboard. What they wrote or said stays on their own device. This cannot be undone.</>, run: () => post("delete-session", { id: e.id }) });
  const askMock = (m: Mock) => setAsk({ title: "Delete this mock exam?", button: "Delete the mock exam", danger: true, said: "The mock exam is gone",
    body: <>{m.finished_at ? `The mock exam of ${when(m.started_at)} and its four results leave their lists.` : `This sitting is still open (${STAGE[m.stage] ?? m.stage}): it ends now and leaves no result.`} Its questions count as new for their next one. This cannot be undone.</>, run: () => post("delete-mock", { id: m.id }) });
  const askReset = () => setAsk({ title: "Reset progress?", button: "Reset", danger: true, reset: true, said: "Progress reset", body: "Practice colours, days of practice, exam attempts and results are deleted for what you choose. This cannot be undone.", run: () => Promise.resolve() });
  const askDelete = () => setAsk({ title: "Delete this account?", button: "Delete account", danger: true, typed: u.email, said: `${name}'s account was deleted`, body: "The account and everything in it go: progress, results, sessions, devices. This cannot be undone.", run: () => post("delete"), then: () => go("/people") });

  // ---- what stops them ----
  const now = Date.now();
  const running = d.attempts.find((a) => !a.finished_at && Date.parse(a.deadline_at) > now);
  const openMock = d.mocks.find((m) => !m.finished_at);
  const lastMail = d.mail[0];
  const mailFailed = lastMail && !lastMail.ok && now - Date.parse(lastMail.at) < 86_400_000;
  const checkPassed = u.human_until && Date.parse(u.human_until) > now;

  // ---- the same figures as the People list, for this person ----
  const dayOf = (iso: string) => { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const worked = new Set<string>([...d.practice.filter((p) => p.answered > 0).map((p) => p.day), ...d.attempts.map((a) => dayOf(a.started_at)), ...d.expression.map((e) => dayOf(e.started_at))]);
  const last30 = Array.from({ length: 30 }, (_, i) => worked.has(dayOf(new Date(now - (29 - i) * 86_400_000).toISOString())));
  const days30 = last30.filter(Boolean).length;
  const finished = d.attempts.filter((a) => a.finished_at);
  const seconds = d.levels.reduce((n, l) => n + l.seconds, 0) + finished.reduce((n, a) => n + (Date.parse(a.finished_at!) - Date.parse(a.started_at)) / 1000, 0) + d.expression.filter((e) => e.ended === "done").reduce((n, e) => n + (e.seconds ?? 0), 0);
  const best = (rows: { nclc: number | null }[]) => (rows.length ? Math.max(...rows.map((r) => r.nclc ?? 3)) : null);
  const level = {
    co: best(finished.filter((a) => a.section === "co" && a.mode === "exam")), ce: best(finished.filter((a) => a.section === "ce" && a.mode === "exam")),
    ee: best(d.expression.filter((e) => e.section === "ee" && e.ended === "done")), eo: best(d.expression.filter((e) => e.section === "eo" && e.ended === "done")), target_nclc: u.target_nclc,
  };
  const sat = (["co", "ce"] as const).map((s) => finished.filter((a) => a.section === s && a.mode === "exam" && a.score != null).sort((a, b) => a.finished_at!.localeCompare(b.finished_at!))).filter((l) => l.length >= 2);
  const gain = sat.length ? sat.reduce((n, l) => n + (l[l.length - 1].score! - l[0].score!), 0) : null;
  const answers = d.levels.reduce((n, l) => n + l.answered, 0);

  // ---- everything they did, newest first ----
  const lines: Line[] = [];
  for (const a of d.attempts) lines.push({
    key: `a${a.id}`, kind: "exam", at: a.started_at, s: a.section, what: `Exam ${a.exam}${a.mode === "training" ? " · training" : ""}${a.mock_id ? " · mock exam" : ""}`,
    result: a.finished_at ? `${a.score} · NCLC ${a.nclc ?? "< 4"} · ${a.right_count}/${a.wrong_count}/${a.blank_count}` : "running",
    length: a.finished_at ? minutes((Date.parse(a.finished_at) - Date.parse(a.started_at)) / 1000) : "—",
    tag: a.ended ? ENDED[a.ended] ?? a.ended : "in progress", tone: a.ended === "abandon" ? "bad" : a.ended === "time" || !a.finished_at ? "amber" : undefined, remove: () => askAttempt(a),
  });
  for (const e of d.expression) lines.push({
    key: `e${e.id}`, kind: "expr", at: e.started_at, s: e.section, what: `${e.kind === "exam" ? "Tâche 1 → 3" : `Tâche ${e.taches}`}${e.mode ? ` · ${e.mode === "live" ? "live" : "push to talk"}` : ""}${e.mock_id ? " · mock exam" : ""}`,
    result: e.score != null ? `${e.score} / 20${e.nclc != null ? ` · NCLC ${e.nclc}` : ""}` : "—", length: minutes(e.seconds), tag: e.ended ? ENDED[e.ended] ?? e.ended : "in progress",
    tone: e.ended === "dropped" || e.ended === "abandoned" ? "bad" : e.ended === "in_progress" ? "amber" : undefined, remove: e.mock_id ? undefined : () => askSession(e),
  });
  for (const m of d.mocks) lines.push({
    key: `m${m.id}`, kind: "mock", at: m.started_at, what: "Mock exam",
    result: m.finished_at ? `${m.overall != null ? `NCLC ${m.overall} overall · ` : ""}${SECTIONS.map((s) => `${s.toUpperCase()} ${m.nclc[s] ?? "—"}`).join(" · ")}` : `at ${STAGE[m.stage] ?? m.stage}`,
    length: m.finished_at ? minutes((Date.parse(m.finished_at) - Date.parse(m.started_at)) / 1000) : "—", tag: ENDED[m.status] ?? m.status, tone: !m.finished_at ? "amber" : m.status === "abandoned" ? "bad" : undefined, remove: () => askMock(m),
  });
  for (const p of d.practice) lines.push({ key: `p${p.day}${p.section}${p.level}`, kind: "practice", at: p.last_at, s: p.section, what: `Practice ${p.level}`, result: `${p.answered} answered · ${p.wrong} wrong`, length: minutes(p.seconds), tag: "practice", tone: "new" });
  lines.sort((a, b) => b.at.localeCompare(a.at));
  const shown = lines.filter((l) => show === "all" || l.kind === show);

  return (
    <div className="page">
      <BackLink to="/people" label="People" />
      <div className="person-head">
        <div className="person-id">
          <span className="avatar" aria-hidden="true">{name[0].toUpperCase()}</span>
          <div>
            <h1 className="title">{name}{u.blocked_at && <> <Chip tone="bad" dot>blocked</Chip></>}</h1>
            <p className="muted"><a className="link" href={`mailto:${u.email}`}>{u.email}</a></p>
          </div>
        </div>
      </div>

      {(u.blocked_at || u.human_needed_at || d.signin.lockedUntil || d.signin.codes.limited || mailFailed || running || openMock || u.gemini_status === "error") && (
        <div className="problems">
          {u.blocked_at && <Problem tone="bad" icon="lock" title={`Blocked ${when(u.blocked_at)}`} button="Unblock" onClick={askUnblock}>{u.blocked_reason ? `Reason: ${u.blocked_reason}. ` : ""}{blockHint(d)}</Problem>}
          {!u.blocked_at && u.human_needed_at && <Problem tone="amber" icon="alert" title="Must pass the human check before going on" button="Clear the check" onClick={askUnblock}>Asked {when(u.human_needed_at)}{u.human_reason ? `: ${u.human_reason}` : ""}. {u.human_fails ? `${plural(u.human_fails, "failed try", "failed tries")} since.` : "No try yet."}</Problem>}
          {d.signin.lockedUntil && <Problem tone="amber" icon="lock" title="Sign-in paused after wrong passwords" button="Unlock now" onClick={askUnlock}>It opens again by itself at {time(d.signin.lockedUntil)}.</Problem>}
          {d.signin.codes.limited && <Problem tone="amber" icon="mail" title="No more e-mail codes for now" button="Reset the count" onClick={askUnlock}>{d.signin.codes.hour} of {d.signin.codes.hourMax} this hour, {d.signin.codes.day} of {d.signin.codes.dayMax} today: the next code is refused until the hour or the day turns.</Problem>}
          {mailFailed && <Problem tone="bad" icon="mail" title="The last e-mail to them was not sent" button="See e-mails" onClick={() => openTab("access")}>{MAIL[lastMail.kind] ?? lastMail.kind}, {when(lastMail.at)}: {(lastMail.detail ?? "no detail").slice(0, 160)}</Problem>}
          {running && <Problem tone="info" icon="clock" title={`Sitting ${running.section.toUpperCase()} exam ${running.exam} right now`} button="See history" onClick={() => openTab("history")}>The clock ends at {time(running.deadline_at)}; nothing else can start before.</Problem>}
          {openMock && <Problem tone="info" icon="mock" title="A mock exam is open" button="See history" onClick={() => openTab("history")}>Started {when(openMock.started_at)}, now at {STAGE[openMock.stage] ?? openMock.stage}. No other exam can start while it is open; one nobody moves for 12 hours closes at night.</Problem>}
          {u.gemini_status === "error" && <Problem tone="info" icon="key" title="Their Gemini key is rejected">{u.gemini_error ?? "Google refused it"}: writing and speaking cannot be marked until they paste a working key in their profile.</Problem>}
        </div>
      )}

      <dl className="facts">
        <div><dt>Joined</dt><dd>{date(u.created_at, true)}</dd></div>
        <div><dt>Last active</dt><dd>{when(u.last_seen_at)}</dd></div>
        <div><dt>Target</dt><dd>{u.target_nclc ? `NCLC ${u.target_nclc}` : "—"}</dd></div>
        <div><dt>Exam</dt><dd>{u.exam_date ? <ExamDate d={u.exam_date} /> : "not registered yet"}</dd></div>
        <div><dt>Today</dt><dd>{plural(d.answeredToday, "answer")}</dd></div>
        <div><dt>Signed in on</dt><dd>{plural(d.devices.length, "device")}</dd></div>
      </dl>

      <Tabs label="This person" items={[
        { label: "Overview", current: tab === "overview", onClick: () => openTab("overview") },
        { label: <>History <span className="muted num">{num(lines.length)}</span></>, current: tab === "history", onClick: () => openTab("history") },
        { label: "Access", current: tab === "access", onClick: () => openTab("access") },
        { label: "Account", current: tab === "account", onClick: () => openTab("account") },
      ]} />

      {tab === "overview" && (
        <>
          <div className="stats glance">
            <div className="card stat"><span className="stat-label">Active · last 30 days</span><span className="stat-value small"><DayStrip on={last30} label={`${plural(days30, "day")} with work in the last 30`} /></span><span className="stat-sub">{plural(days30, "day")} with work · last seen {when(u.last_seen_at)}</span></div>
            <div className="card stat"><span className="stat-label">Time in all</span><span className="stat-value small">{seconds ? minutes(seconds) : "—"}</span><span className="stat-sub">{num(answers)} answers · {plural(finished.length, "exam")} · {plural(d.expression.filter((e) => e.ended === "done").length, "session")}</span></div>
            <div className="card stat"><span className="stat-label">Level → target</span><span className="stat-value small"><Levels p={level} /></span><span className="stat-sub">best NCLC in each test · aims for {u.target_nclc ? `NCLC ${u.target_nclc}` : "no target yet"}</span></div>
            <div className="card stat"><span className="stat-label">Gain since the first exam</span><span className="stat-value small"><Gain v={gain} /></span><span className="stat-sub">{gain == null ? "needs two exams of the same test" : "CO + CE points, first to latest"}</span></div>
          </div>
          <div className="sections">
            {SECTIONS.map((s) => <SectionCard key={s} s={s} d={d} total={totals?.[s as "co" | "ce"]} />)}
          </div>
          <div className="grid-person">
            <section className="card pad">
              <div className="card-head"><h2>Practice, level by level</h2><span className="muted">reset one for a fresh start</span></div>
              {d.levels.length ? (
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Level</th><th className="bar-cell">Right · corrected · wrong</th><th className="r">Answers</th><th>Last</th><th></th></tr></thead>
                    <tbody>
                      {(["co", "ce"] as const).flatMap((s) => LEVELS.map((lv) => d.levels.find((l) => l.section === s && l.level === lv)).filter((l): l is Level => !!l)).map((l) => {
                        const total = summary?.bank[l.section]?.[l.level]?.questions;
                        const done = l.ok + l.amber + l.bad;
                        return (
                          <tr key={l.section + l.level}>
                            <td className="nowrap"><Mark s={l.section} /> <strong>{l.level}</strong></td>
                            <td className="bar-cell"><div className="bar-stack"><ColourBar ok={l.ok} amber={l.amber} bad={l.bad} total={total} /><span className="muted small num">{num(done)}{total ? ` of ${num(total)}` : ""} · {num(l.ok)} right · {num(l.bad)} wrong</span></div></td>
                            <td className="r num">{num(l.answered)}</td>
                            <td className="nowrap muted">{when(l.last_at)}</td>
                            <td className="r">{done > 0 && <Button size="sm" kind="quiet" onClick={() => askLevel(l)}>Reset</Button>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted">No practice yet.</p>}
            </section>
            <div className="stack">
              <section className="card pad">
                <div className="card-head"><h2>Note</h2>{savedNote && <Chip tone="ok">saved</Chip>}</div>
                <textarea className="note" value={note ?? ""} onChange={(e) => setNote(e.target.value)} rows={3} aria-label="Note about this person" maxLength={2000} placeholder="Only you see this" />
                <div className="note-actions"><Button size="sm" onClick={saveNote} disabled={(note ?? "") === (u.note ?? "")}>Save note</Button></div>
              </section>
              <section className="card pad">
                <div className="card-head"><h2>Messages and reports</h2><a className="btn quiet sm" {...linkProps(`/messages/${u.id}`)}><Icon name="chat" size={14} /> Open the chat</a></div>
                {d.disputes.length ? (
                  <ul className="list">
                    {d.disputes.map((r) => (
                      <li key={r.id}>
                        <a className="list-row" {...linkProps(`/messages/${u.id}`)}>
                          <Mark s={r.section} />
                          <span className="ellipsis">{r.level} · n° {r.n} — {r.message}</span>
                          <Chip tone={r.status === "open" ? "amber" : "ok"} dot>{r.status === "open" ? "open" : "done"}</Chip>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">None sent.</p>}
              </section>
            </div>
          </div>
        </>
      )}

      {tab === "history" && (
        <section className="card pad">
          <div className="card-head">
            <Seg label="What to show" value={show} onChange={(v) => { setShow(v); setAllLines(false); }} options={[["all", "Everything"], ["exam", "CO·CE exams"], ["expr", "EE·EO"], ["mock", "Mock exams"], ["practice", "Practice days"]]} />
            <span className="muted">{num(shown.length)}</span>
          </div>
          <p className="muted small history-hint">Deleting an exam, a session or a mock exam removes it for good, so they can take it again as if for the first time.</p>
          {shown.length ? (
            <div className="table-wrap">
              <table className="table compact">
                <thead><tr><th>When</th><th>What</th><th>Result</th><th className="r">Time</th><th></th><th></th></tr></thead>
                <tbody>
                  {shown.slice(0, allLines ? 600 : 30).map((a) => (
                    <tr key={a.key}>
                      <td className="nowrap">{when(a.at)}</td>
                      <td className="nowrap"><span className="what">{a.s ? <Mark s={a.s} /> : <Icon name="mock" size={18} />}{a.what}</span></td>
                      <td className="num nowrap">{a.result}</td>
                      <td className="r num nowrap">{a.length}</td>
                      <td><Chip tone={a.tone ?? "muted"}>{a.tag}</Chip></td>
                      <td className="r">{a.remove && <Button size="sm" kind="quiet" onClick={a.remove}>Delete</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length > 30 && !allLines && <div className="more"><Button size="sm" kind="quiet" onClick={() => setAllLines(true)}>Show all {num(shown.length)}</Button></div>}
            </div>
          ) : <p className="muted">Nothing here yet.</p>}
        </section>
      )}

      {tab === "access" && (
        <div className="grid-person">
          <section className="card pad">
            <div className="card-head"><h2>Guard</h2>{u.blocked_at ? <Button size="sm" kind="primary" onClick={askUnblock}>Unblock</Button> : <Button size="sm" onClick={askBlock}>Block</Button>}</div>
            <p className="guard-line">
              <Chip tone={u.blocked_at ? "bad" : d.guard.score >= d.guard.askAt ? "amber" : "ok"} dot>{u.blocked_at ? "blocked" : d.guard.score >= d.guard.askAt ? "watched" : "nothing unusual"}</Chip>{" "}
              <span className="muted">score {d.guard.score} — the human check comes at {d.guard.askAt}, a block at {d.guard.blockAt}</span>
            </p>
            {checkPassed && <p className="guard-line"><Chip tone="ok" dot>check passed</Chip> <span className="muted">good until {when(u.human_until)}</span></p>}
            {d.guard.signs.length > 0 && (
              <>
                <h3 className="sub-h">Signs of a machine · last 7 days</h3>
                <ul className="list">
                  {d.guard.signs.map((s) => (
                    <li key={s.sign} className="list-row">
                      <span className="nowrap muted">{when(s.at)}</span>
                      <span className="ellipsis">{s.label}</span>
                      <Chip tone={s.weight >= 100 ? "bad" : "amber"}>+{s.weight}</Chip>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="sub-h">What happened</h3>
            {d.guard.events.length ? (
              <ul className="list">
                {d.guard.events.map((e, i) => (
                  <li key={i} className="list-row">
                    <span className="nowrap muted">{when(e.at)}</span>
                    <span className="ellipsis">{e.detail ?? ""}</span>
                    <Chip tone={GUARD_CHIP[e.kind]?.[0] ?? "muted"} dot>{GUARD_CHIP[e.kind]?.[1] ?? e.kind}</Chip>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nothing: no check, no sign, no block.</p>}
            <p className="muted small foot">Today: {num(d.guard.today.requests)} requests · {plural(d.guard.today.writes, "change")} · {plural(d.bank.data.today, "bank file")} opened ({num(d.bank.data.week)} in 7 days).</p>
          </section>

          <div className="stack">
            <section className="card pad">
              <div className="card-head"><h2>Sign-in</h2><Button size="sm" onClick={askUnlock}>Unlock</Button></div>
              <dl className="kv">
                <div><dt>Password</dt><dd>{u.has_password ? "set" : "not set yet"}</dd></div>
                <div><dt>Wrong tries</dt><dd>{d.signin.lockedUntil ? <Chip tone="amber" dot>paused until {time(d.signin.lockedUntil)}</Chip> : d.signin.failedLogins ? `${d.signin.failedLogins} in a row` : "none"}</dd></div>
                <div><dt>Codes</dt><dd>{d.signin.codes.limited && <Chip tone="amber" dot>limit reached</Chip>}<span>{d.signin.codes.hour} of {d.signin.codes.hourMax} this hour · {d.signin.codes.day} of {d.signin.codes.dayMax} today</span></dd></div>
              </dl>
            </section>
            <section className="card pad">
              <div className="card-head"><h2>Devices</h2>{d.devices.length > 1 && <Button size="sm" onClick={() => askSignout()}>Sign out everywhere</Button>}</div>
              {d.devices.length ? (
                <ul className="devices">
                  {d.devices.map((v) => (
                    <li key={v.id}><Icon name={/iphone|android/i.test(v.device ?? "") ? "phone" : "laptop"} size={18} /><span>{v.device ?? "Unknown device"}<span className="muted small"> · {when(v.last_seen_at)}</span></span><Button size="sm" kind="quiet" onClick={() => askSignout(v)}>Sign out</Button></li>
                  ))}
                </ul>
              ) : <p className="muted">Signed in nowhere.</p>}
            </section>
            <section className="card pad">
              <div className="card-head"><h2>E-mails sent</h2><span className="muted">{d.mail.length}</span></div>
              {d.mail.length ? (
                <ul className="list">
                  {d.mail.map((m, i) => (
                    <li key={i} className="list-row">
                      <span className="nowrap muted">{when(m.at)}</span>
                      <span className="ellipsis">{MAIL[m.kind] ?? m.kind}{!m.ok && m.detail ? ` — ${m.detail}` : ""}</span>
                      <Chip tone={m.ok ? "ok" : "bad"} dot>{m.ok ? "sent" : "failed"}</Chip>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">None in the last 90 days.</p>}
            </section>
          </div>
        </div>
      )}

      {tab === "account" && (
        <div className="grid-person">
          <section className="card pad">
            <h2>Account</h2>
            <dl className="kv wide">
              <div><dt>E-mail</dt><dd>{u.email}</dd></div>
              <div><dt>Joined</dt><dd>{date(u.created_at, true)}</dd></div>
              <div><dt>Language</dt><dd>{u.lang === "en" ? "English" : "Français"}</dd></div>
              <div><dt>Target</dt><dd>{u.target_nclc ? `NCLC ${u.target_nclc}` : "—"}</dd></div>
              <div><dt>Exam</dt><dd>{u.exam_date ? <ExamDate d={u.exam_date} /> : "not registered yet"}</dd></div>
              <div><dt>Gemini key</dt><dd><Chip tone={KEY_CHIP[u.gemini_status]?.[0]} dot>{KEY_CHIP[u.gemini_status]?.[1] ?? u.gemini_status}</Chip>{u.gemini_checked_at && <span className="muted"> checked {when(u.gemini_checked_at)}</span>}{u.gemini_error && <span className="kv-sub bad-text">{u.gemini_error}</span>}</dd></div>
              <div><dt>Terms</dt><dd>{u.terms_at ? `v${u.terms_version} · ${date(u.terms_at, true)}` : "—"}</dd></div>
              <div><dt>Settings</dt><dd className="settings">{Object.keys(u.settings).length ? <Settings v={u.settings} /> : <span className="muted">defaults</span>}</dd></div>
            </dl>
          </section>
          <div className="stack">
            <section className="card pad danger-zone">
              <h2>Cannot be undone</h2>
              <div className="danger-row"><div><strong>Reset progress</strong><span className="muted small">Everything, or one of the four tests. For one level or one exam, use Overview and History.</span></div><Button size="sm" onClick={askReset}>Reset…</Button></div>
              <div className="danger-row"><div><strong>Delete the account</strong><span className="muted small">The person and all their work, for good.</span></div><Button size="sm" kind="danger" onClick={askDelete}>Delete…</Button></div>
            </section>
          </div>
        </div>
      )}

      <Sheet open={!!ask} title={ask?.title ?? ""} onClose={close} actions={<>
        <Button onClick={close}>Cancel</Button>
        <Button kind={ask?.danger ? "danger" : "primary"} busy={busy} onClick={run} disabled={!!ask?.typed && typed.trim().toLowerCase() !== ask.typed}>{ask?.button}</Button>
      </>}>
        <p>{ask?.body}</p>
        {ask?.reset && <Seg label="What to reset" value={resetWhat} onChange={setResetWhat} options={[["all", "Everything"], ["co", "CO"], ["ce", "CE"], ["ee", "EE"], ["eo", "EO"]]} />}
        {ask?.typed && (
          <label className="field">
            <span>Type <strong>{ask.typed}</strong></span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
      </Sheet>
    </div>
  );
}

function Settings({ v }: { v: Record<string, unknown> }) {
  return (
    <ul className="settings-list">
      {Object.entries(v).map(([k, val]) => (
        <li key={k}><span className="muted">{k}</span> {val && typeof val === "object" ? Object.entries(val as Record<string, unknown>).filter(([, x]) => x === true).map(([x]) => x).join(", ") || "all off" : String(val)}</li>
      ))}
    </ul>
  );
}
