// The admin's first page: what waits for the owner (only when something does), then how useful the app is — the week
// against the one before, the last 30 days a day each, how far people go and how they score, which features they use
// and which they leave aside, who they are — and the free plan's lines (e-mails by provider, database writes, the
// nightly jobs, the guard). Charts where a shape says more than a sentence (charts.tsx), figures written beside them.
import type { ReactNode } from "react";
import { Icon, Chip, Mark, Empty, type IconName, type Section, type Tone } from "../../ui/ui.tsx";
import { useApi, linkProps, num, when, date, plural } from "../lib.ts";
import { Columns, Meters, Split, Gauge, Legend, SERIES } from "../charts.tsx";

type Who = { id: string; name: string | null; email: string };
type Data = {
  today: string;
  needs: {
    blocked: (Who & { blocked_at: string; blocked_reason: string | null })[]; blockedTotal: number;
    checks: (Who & { human_needed_at: string; human_reason: string | null; human_fails: number })[];
    disputesOpen: number; messagesUnread?: number;
    /** the e-mails that could not be sent in the last day (a code someone is waiting for) */
    mailFailed: { at: string; email: string; kind: string; detail: string | null }[];
    jobsFailed: { name: string; last_at: string; detail: string }[];
  };
  people: { total: number; joinedToday: number; joined7: number; joinedPrev7: number; activeToday: number; active7: number; active30: number; studied7: number; studiedPrev7: number };
  work: { answers7: number; answersPrev7: number; exams7: number; examsPrev7: number; expression7: number; expressionPrev7: number; mocks7: number; mocksPrev7: number; hours7: number };
  funnel: { registered: number; named: number; started: number; practised: number; examined: number; withKey: number; expressed: number; mocked: number };
  sections: {
    co: { people: number; answers: number; exams: number; nclc: number | null }; ce: { people: number; answers: number; exams: number; nclc: number | null };
    ee: { people: number; sessions: number; nclc: number | null }; eo: { people: number; sessions: number; nclc: number | null };
    mock: { people: number; done: number };
  };
  target: number | null;
  days: { day: string; people: number; joined: number }[];
  adoption: Record<"base" | "coPractice" | "cePractice" | "realExam" | "freeExam" | "ee" | "eo" | "mock" | "key" | "wrote" | "reported" | "examDate" | "autoplay" | "transcript" | "hint" | "english", number>;
  keys: Record<string, number>;
  who: {
    cohort: number; stayed: number; english: number; named: number; examAhead: number; signedIn: number; phone: number; tablet: number;
    targets: { nclc: number; n: number }[]; places: { region: string; n: number }[];
  };
  health: {
    mail: { sent: number; cap: number; resend: number; brevo: number; failed: number; resendCap: number; brevoCap: number; brevoState: "works" | "refused" | "unset"; days: { day: string; resend: number; brevo: number; failed: number }[] };
    writes: { today: number; hold: number; limit: number; days: { day: string; n: number }[] };
    jobs: { name: string; last_at: string; ok: number; detail: string }[];
    networks: { strict: number; closed: number };
  };
};

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/** this week against the one before, as a small coloured word */
function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return now ? <Chip tone="ok">new this week</Chip> : <span className="muted small">nothing either week</span>;
  const d = Math.round(((now - before) / before) * 100);
  if (d === 0) return <span className="muted small">same as last week</span>;
  return <><Chip tone={d > 0 ? "ok" : "amber"}><Icon name={d > 0 ? "trendUp" : "trendDown"} size={13} />{d > 0 ? "+" : "−"}{Math.abs(d)} %</Chip><span className="muted small">on last week</span></>;
}

function Kpi({ icon, label, value, now, before, sub, to }: { icon: IconName; label: string; value: string; now: number; before: number; sub: ReactNode; to?: string }) {
  const inner = <>
    <span className="kpi-top"><span className="kpi-icon"><Icon name={icon} size={16} /></span><span className="stat-label">{label}</span></span>
    <span className="stat-value">{value}</span><span className="kpi-delta"><Delta now={now} before={before} /></span><span className="stat-sub">{sub}</span>
  </>;
  return to ? <a className="card stat kpi link-card" {...linkProps(to)}>{inner}</a> : <div className="card stat kpi">{inner}</div>;
}

type Need = { icon: IconName; tone: Tone; text: ReactNode; sub?: string | null; to: string };

function needsOf(o: Data): Need[] {
  const out: Need[] = [];
  for (const b of o.needs.blocked) out.push({ icon: "lock", tone: "bad", to: `/people/${b.id}?tab=access`, text: <><strong>{b.name ?? b.email}</strong> was blocked {when(b.blocked_at)}</>, sub: b.blocked_reason });
  for (const c of o.needs.checks) out.push({ icon: "alert", tone: "amber", to: `/people/${c.id}?tab=access`, text: <><strong>{c.name ?? c.email}</strong> cannot pass the human check ({c.human_fails} failed tries)</>, sub: c.human_reason });
  if (o.needs.messagesUnread) out.push({ icon: "chat", tone: "amber", to: "/messages", text: <><strong>{plural(o.needs.messagesUnread, "message")}</strong> to answer</> });
  if (o.needs.disputesOpen) out.push({ icon: "flag", tone: "amber", to: "/reports", text: <><strong>{plural(o.needs.disputesOpen, "report")}</strong> on questions to answer</> });
  for (const m of o.needs.mailFailed.slice(0, 5)) out.push({ icon: "mail", tone: "bad", to: `/people?q=${encodeURIComponent(m.email)}`, text: <>An e-mail to <strong>{m.email}</strong> was not sent ({m.kind}, {when(m.at)})</>, sub: (m.detail ?? "").slice(0, 140) });
  if (o.needs.mailFailed.length > 5) out.push({ icon: "mail", tone: "bad", to: "/people", text: <>…and {num(o.needs.mailFailed.length - 5)} more e-mails not sent in the last 24 h</> });
  for (const j of o.needs.jobsFailed) out.push({ icon: "refresh", tone: "bad", to: "/", text: <>The nightly job <strong>{j.name}</strong> failed {when(j.last_at)}</>, sub: j.detail });
  const { mail, writes } = o.health;
  if (mail.sent >= mail.cap * 0.8) out.push({ icon: "mail", tone: "amber", to: "/", text: <><strong>{num(mail.sent)} of {num(mail.cap)}</strong> e-mails of the day are used: codes may stop</> });
  if (mail.brevoState === "refused") out.push({ icon: "mail", tone: "amber", to: "/", text: <>The backup mailer <strong>Brevo refuses its key</strong>: past Resend's 100 a day, codes stop</> });
  if (writes.today >= writes.hold * 0.8) out.push({ icon: "alert", tone: "amber", to: "/", text: <><strong>{pct(writes.today, writes.hold)} %</strong> of the day's writes are used: past the line, progress waits in the browsers</> });
  return out;
}

function Card({ title, sub, children, className }: { title: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`card pad ${className ?? ""}`}><div className="card-head"><h2>{title}</h2>{sub && <span className="muted small">{sub}</span>}</div>{children}</section>;
}
const Group = ({ title, line, children }: { title: string; line: string; children: ReactNode }) => (
  <section className="dash-group"><header><h2 className="dash-title">{title}</h2><p className="muted">{line}</p></header>{children}</section>
);

export function Today() {
  const { data: o, error } = useApi<Data>("/overview");
  if (error) return <div className="page"><Empty icon="alert" title="Could not load">{error}</Empty></div>;
  if (!o) return <div className="page"><div className="stats"><div className="skeleton stat-skel" /><div className="skeleton stat-skel" /><div className="skeleton stat-skel" /><div className="skeleton stat-skel" /></div><div className="skeleton tall" /></div>;
  const needs = needsOf(o);
  const { people: p, work: w, funnel: f, sections: s, adoption: a, keys: k, who, health: h } = o;
  const done7 = w.exams7 + w.expression7 + w.mocks7, donePrev = w.examsPrev7 + w.expressionPrev7 + w.mocksPrev7;
  const studied30 = o.days.reduce((t, d) => Math.max(t, d.people), 0);
  const jobsOk = h.jobs.filter((j) => j.ok).length;
  const sections: { s?: Section; name: string; people: number; nclc: number | null | undefined; did: string }[] = [
    { s: "co", name: "Compréhension orale", people: s.co.people, nclc: s.co.nclc, did: `${num(s.co.answers)} answers · ${plural(s.co.exams, "exam")}` },
    { s: "ce", name: "Compréhension écrite", people: s.ce.people, nclc: s.ce.nclc, did: `${num(s.ce.answers)} answers · ${plural(s.ce.exams, "exam")}` },
    { s: "ee", name: "Expression écrite", people: s.ee.people, nclc: s.ee.nclc, did: plural(s.ee.sessions, "session") },
    { s: "eo", name: "Expression orale", people: s.eo.people, nclc: s.eo.nclc, did: plural(s.eo.sessions, "session") },
    { name: "Mock exam", people: s.mock.people, nclc: undefined, did: `${num(s.mock.done)} finished` },
  ];
  const keyLeft = (k.none ?? 0) + (k.error ?? 0) + (k.quota ?? 0);
  const mailMax = h.mail.resendCap + (h.mail.brevoState === "works" ? h.mail.brevoCap : 0);

  return (
    <div className="page dash">
      <div className="page-head"><h1 className="title">Today</h1><span className="muted">{date(o.today, true)}</span></div>

      {needs.length > 0 && (
        <section className="card pad needs">
          <div className="card-head"><h2>Needs you</h2><Chip tone="amber">{needs.length}</Chip></div>
          <ul className="list">
            {needs.map((n, i) => (
              <li key={i}>
                <a className="need" {...linkProps(n.to)}>
                  <span className={`need-icon ${n.tone}`}><Icon name={n.icon} size={16} /></span>
                  <span className="need-text"><span>{n.text}</span>{n.sub && <span className="muted small ellipsis">{n.sub}</span>}</span>
                  <Icon name="chevronRight" size={16} className="muted" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="stats kpis">
        <Kpi icon="users" label="Registered" value={num(p.total)} now={p.joined7} before={p.joinedPrev7} to="/people?filter=new" sub={<>+{num(p.joined7)} this week · +{num(p.joinedToday)} today</>} />
        <Kpi icon="activity" label="Studying · 7 days" value={num(p.studied7)} now={p.studied7} before={p.studiedPrev7} to="/people?filter=active" sub={<>{pct(p.studied7, p.total)} % of everyone · {num(p.activeToday)} here today</>} />
        <Kpi icon="clock" label="Hours of work · 7 days" value={num(w.hours7)} now={w.answers7} before={w.answersPrev7} sub={<>{num(w.answers7)} answers · {p.studied7 ? `${(w.hours7 / p.studied7).toFixed(1)} h a person` : "—"}</>} />
        <Kpi icon="mock" label="Exams & sessions · 7 days" value={num(done7)} now={done7} before={donePrev} sub={<>{num(w.exams7)} CO·CE · {num(w.expression7)} EE·EO · {num(w.mocks7)} mock</>} />
      </div>

      <Group title="Usage" line="How much the app is used, day by day.">
        <div className="grid-2 wide-left">
          <Card title="People studying each day" sub="practice, an exam or a session · 30 days">
            <Columns label="People studying each day" days={o.days.map((d) => ({ day: d.day, values: [d.people] }))} parts={[{ name: "People" }]} height={170} />
            <p className="muted small foot">Busiest day: <b>{num(studied30)}</b> people · {num(p.active30)} opened the app in 30 days</p>
          </Card>
          <Card title="New accounts each day" sub="30 days">
            <Columns label="New accounts each day" days={o.days.map((d) => ({ day: d.day, values: [d.joined] }))} parts={[{ name: "New accounts", color: "var(--c2)" }]} height={170} />
            <p className="muted small foot"><b>{num(o.days.reduce((t, d) => t + d.joined, 0))}</b> in 30 days</p>
          </Card>
        </div>
      </Group>

      <Group title="Is it useful?" line="How far people get, whether they come back, and how they score.">
        <div className="grid-3">
          <Card title="How far people go" sub="of everyone registered">
            <Meters of={f.registered} rows={[
              { label: "Finished the welcome", n: f.named }, { label: "Did something", n: f.started }, { label: "Practised CO or CE", n: f.practised },
              { label: "Finished a CO or CE exam", n: f.examined }, { label: "Finished writing or speaking", n: f.expressed }, { label: "Finished a mock exam", n: f.mocked },
            ]} />
            {f.registered > f.started && <p className="muted small foot"><a className="link" {...linkProps("/people?filter=idle")}>{plural(f.registered - f.started, "person", "people")}</a> never started anything.</p>}
          </Card>
          <Card title="Coming back" sub="joined 1 to 5 weeks ago">
            <div className="hero-fig"><b>{who.cohort ? `${pct(who.stayed, who.cohort)} %` : "—"}</b><span>still here a week later</span></div>
            <Split label="Coming back" parts={[{ name: "Came back", n: who.stayed, color: "var(--c1)" }, { name: "Did not", n: who.cohort - who.stayed, color: "var(--muted-fill)" }]} />
            <p className="muted small foot">{num(p.active7)} opened the app in 7 days, {num(p.active30)} in 30.</p>
          </Card>
          <Card title="Average level · 30 days" sub={o.target != null ? `they aim for NCLC ${o.target}` : "exam mode only"}>
            <ul className="lvl-bars">
              {(["co", "ce", "ee", "eo"] as const).map((x) => {
                const v = s[x].nclc;
                return (
                  <li key={x}>
                    <span className="lvl-name"><Mark s={x} /></span>
                    <span className="lvl-track">
                      {v != null && <i style={{ width: `${((v - 3) / 9) * 100}%` }} />}
                      {o.target != null && <b className="lvl-target" style={{ left: `${((o.target - 3) / 9) * 100}%` }} title={`target NCLC ${o.target}`} />}
                    </span>
                    <span className="lvl-v num">{v != null ? v : "—"}</span>
                  </li>
                );
              })}
            </ul>
            <p className="muted small foot">NCLC 3 to 12 · the line is the average target</p>
          </Card>
        </div>
      </Group>

      <Group title="What they use" line="Among the people who studied in the last 30 days: what they reached for, and what they leave aside.">
        <div className="grid-2 wide-left">
          <Card title="Features · 30 days" sub={`of the ${num(a.base)} who studied · amber: under 20 %`}>
            <Meters of={a.base} low={20} sort rows={[
              { key: "co", label: <><Mark s="co" /> practice</>, n: a.coPractice }, { key: "ce", label: <><Mark s="ce" /> practice</>, n: a.cePractice },
              { key: "real", label: "Exams · real mode", n: a.realExam }, { key: "free", label: "Exams · free mode", n: a.freeExam },
              { key: "ee", label: <><Mark s="ee" /> writing</>, n: a.ee }, { key: "eo", label: <><Mark s="eo" /> speaking</>, n: a.eo },
              { key: "mock", label: "Mock exam", n: a.mock }, { key: "key", label: "A working Gemini key", n: a.key },
              { key: "date", label: "An exam date set", n: a.examDate },
              { key: "hint", label: "Hints on", n: a.hint }, { key: "english", label: "English on", n: a.english },
              { key: "transcript", label: "Transcript on (CO)", n: a.transcript }, { key: "autoplay", label: "Autoplay on (CO)", n: a.autoplay },
              { key: "wrote", label: "Wrote in Messages", n: a.wrote }, { key: "reported", label: "Reported a question", n: a.reported },
            ]} />
          </Card>
          <div className="stack">
            <Card title="Gemini key" sub="needed for writing, speaking and the mock exam">
              <div className="hero-fig"><b>{num(keyLeft)}</b><span>of {num(who.named)} cannot use writing or speaking</span></div>
              <Split label="Gemini key" parts={[
                { name: "Works", n: k.ok ?? 0, color: "var(--ok)" }, { name: "None", n: k.none ?? 0, color: "var(--muted-fill)" },
                { name: "Refused by Google", n: k.error ?? 0, color: "var(--bad)" }, { name: "Daily limit", n: k.quota ?? 0, color: "var(--amber)" },
              ]} />
            </Card>
            <Card title="Each test · 7 days" sub="people · what they did">
              <ul className="test-rows">
                {sections.map((t) => (
                  <li key={t.name}>
                    <span className="test-name">{t.s ? <Mark s={t.s} /> : <span className="mock-mark"><Icon name="mock" size={16} /></span>}</span>
                    <span className="test-did muted small">{t.did}</span>
                    <b className="num">{num(t.people)}</b>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </Group>

      <Group title="Who they are" line="Everyone past the welcome, and the devices signed in now.">
        <div className="grid-3">
          <Card title="Device" sub={`${num(who.signedIn)} signed in now`}>
            <Split label="Device" parts={[{ name: "Phone", n: who.phone }, { name: "Tablet", n: who.tablet }, { name: "Computer", n: Math.max(0, who.signedIn - who.phone - who.tablet) }]} />
            <p className="muted small foot">Interface language</p>
            <Split label="Interface language" parts={[{ name: "French", n: p.total - who.english }, { name: "English", n: who.english }]} />
          </Card>
          <Card title="Where they are" sub="from the browser's time zone">
            <Meters of={who.named} rows={(() => {
              const top = who.places.slice(0, 5), rest = who.places.slice(5).reduce((t, r) => t + r.n, 0);
              return [...top.map((r) => ({ key: r.region, label: r.region, n: r.n })), ...(rest ? [{ key: "other", label: "Other", n: rest }] : [])];
            })()} />
          </Card>
          <Card title="Target NCLC" sub={`${num(who.targets.reduce((t, r) => t + r.n, 0))} set one · ${num(who.examAhead)} have an exam date ahead`}>
            <TargetBars rows={who.targets} />
          </Card>
        </div>
      </Group>

      <Group title="Free plan" line="Cloudflare's and the mailers' daily limits: what is used today, and the last two weeks.">
        <div className="grid-2">
          <Card title="E-mails today" sub="sign-in codes, welcome and exam mails">
            <div className="hero-fig"><b>{num(h.mail.resend + h.mail.brevo)}</b><span>sent of {num(mailMax)} possible today{h.mail.failed ? ` · ${num(h.mail.failed)} failed` : ""}</span></div>
            <div className="mail-lines">
              <div><span>Resend <small className="muted">first, {num(h.mail.resendCap)} a day</small></span><Gauge used={h.mail.resend} max={h.mail.resendCap} hot={h.mail.resend >= h.mail.resendCap * 0.8} /><b className="num">{num(h.mail.resend)}</b></div>
              <div><span>Brevo <small className="muted">backup, {num(h.mail.brevoCap)} a day</small> <Chip tone={h.mail.brevoState === "works" ? "ok" : "bad"} dot>{h.mail.brevoState === "works" ? "ready" : h.mail.brevoState === "refused" ? "key refused" : "not set"}</Chip></span><Gauge used={h.mail.brevo} max={h.mail.brevoCap} /><b className="num">{num(h.mail.brevo)}</b></div>
            </div>
            <Columns label="E-mails a day" height={90} days={h.mail.days.map((d) => ({ day: d.day, values: [d.resend, d.brevo, d.failed] }))}
              parts={[{ name: "Resend", color: "var(--c1)" }, { name: "Brevo", color: "var(--c2)" }, { name: "Failed", color: "var(--bad)" }]} />
          </Card>
          <Card title="Database writes today" sub="Cloudflare D1: 100 000 a day on the free plan">
            <div className="hero-fig"><b>{num(h.writes.today)}</b><span>{pct(h.writes.today, h.writes.hold)} % of our own line of {num(h.writes.hold)}</span></div>
            <Gauge used={h.writes.today} max={h.writes.limit} hot={h.writes.today >= h.writes.hold * 0.8} lines={[{ at: h.writes.hold, name: "our line" }]} />
            <p className="muted small explain">Every saved answer, exam step, session, message or sign-in writes a row. Past our line (half of Cloudflare's), practice progress waits in the browsers and new starts pause until midnight, so the app never hits the hard limit.</p>
            <Columns label="Writes a day" height={90} days={h.writes.days.map((d) => ({ day: d.day, values: [d.n] }))} parts={[{ name: "Writes", color: "var(--c4)" }]} />
          </Card>
        </div>
        <div className="grid-2">
          <Card title="Nightly jobs" sub="03:00 Tashkent">
            {h.jobs.length ? (
              <ul className="job-rows">
                {h.jobs.map((j) => <li key={j.name}><Chip tone={j.ok ? "ok" : "bad"} dot>{j.ok ? "fine" : "failed"}</Chip><b>{j.name}</b><span className="muted small ellipsis">{when(j.last_at)} · {j.detail}</span></li>)}
              </ul>
            ) : <p className="muted">Never ran.</p>}
            <p className="muted small foot">{jobsOk === h.jobs.length ? "All went through." : `${h.jobs.length - jobsOk} failed.`}</p>
          </Card>
          <Card title="Abuse guard" sub="automatic signs only">
            <div className="guard-figs">
              <a className="guard-fig" {...linkProps("/people?filter=blocked")}><b>{num(o.needs.blockedTotal)}</b><span>accounts blocked</span></a>
              <div className="guard-fig"><b>{num(h.networks.strict)}</b><span>networks watched closely</span></div>
              <div className="guard-fig"><b>{num(h.networks.closed)}</b><span>networks closed to sign-ups</span></div>
            </div>
          </Card>
        </div>
      </Group>
    </div>
  );
}

/** how many aim for each NCLC, 4 to 12: one column a level, the count above it */
function TargetBars({ rows }: { rows: { nclc: number; n: number }[] }) {
  const levels = Array.from({ length: 9 }, (_, i) => i + 4);
  const top = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure className="tgt" aria-label="Target NCLC">
      <div className="tgt-bars">
        {levels.map((l) => {
          const n = rows.find((r) => r.nclc === l)?.n ?? 0;
          return <div key={l} className="tgt-col" title={`NCLC ${l}: ${n}`}><small>{n || ""}</small><i style={{ height: `${(n / top) * 100}%`, background: SERIES[0] }} /></div>;
        })}
      </div>
      <div className="tgt-axis">{levels.map((l) => <span key={l}>{l}</span>)}</div>
    </figure>
  );
}

export { Legend };
