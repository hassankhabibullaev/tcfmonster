// Messages: every person's one thread with the owner, as a chat. Left, the threads (the latest first; « Waiting »: an
// unread message or an open report); right, one thread: the person's messages and the owner's, and their reports on
// questions as numbered cards (#12 · CO C1 · n° 139, open or done, the question a click away). « Answer » ties the reply
// to a report (« ↳ #12 ») and, ticked, marks it done with the reply as its note. Opening a thread reads it. Phone: the
// list, then the thread on its own address (/messages/<person>).
import { useEffect, useRef, useState } from "react";
import { BackLink, Button, Chip, Empty, Icon, Mark, Seg } from "../../ui/ui.tsx";
import { useApi, useLocation, setParams, linkProps, api, when, time, date, num } from "../lib.ts";
import { useToast } from "../main.tsx";
import { QuestionText } from "./Disputes.tsx";

type Thread = { userId: string; name: string | null; email: string; lang: string; at: string; unread: number; open: number; last: { text: string; fromOwner: boolean; kind: "message" | "report" } };
type Inbox = { threads: Thread[]; page: number; pageSize: number; filter: "waiting" | "all"; unread: number; open: number };
type Msg = { kind: "message"; id: number; fromOwner: boolean; body: string; disputeId: number | null; event: "resolved" | "reopened" | null; at: string; readAt: string | null };
type Report = { kind: "report"; id: number; section: "co" | "ce"; level: string; questionId: string; n: number; body: string; status: "open" | "resolved"; at: string; resolvedAt: string | null };
type Item = Msg | Report;
type One = { person: { id: string; name: string | null; email: string; lang: string; created_at: string; last_seen_at: string | null }; items: Item[] };

const FILTERS: [string, string][] = [["waiting", "Waiting"], ["all", "All"]];
const who = (t: { name: string | null; email: string }) => t.name ?? t.email;

export function Messages({ id }: { id: string | null }) {
  const { params } = useLocation();
  const filter = params.get("filter") === "all" ? "all" : "waiting";
  const { data, error, reload } = useApi<Inbox>(`/threads?filter=${filter}`);
  return (
    <div className="page inbox-page" data-open={id ? "" : undefined}>
      <div className="page-head inbox-head"><h1 className="title">Messages</h1>
        {data && <span className="muted">{num(data.unread)} unread · {num(data.open)} open reports</span>}
      </div>
      <div className="inbox">
        <aside className="threads" aria-label="Threads">
          <Seg label="Show" value={filter} options={FILTERS} onChange={(v) => setParams({ filter: v === "waiting" ? null : v })} />
          {error && <Empty icon="alert" title="Could not load">{error}</Empty>}
          {data && !data.threads.length && <Empty icon="check" title={filter === "waiting" ? "Nothing waiting" : "No message yet"} />}
          {!data && !error && <div className="skeleton tall" />}
          <ul className="thread-list">
            {data?.threads.map((t) => (
              <li key={t.userId}>
                <a className="thread-row" {...linkProps(`/messages/${t.userId}${filter === "all" ? "?filter=all" : ""}`)} aria-current={t.userId === id ? "page" : undefined}>
                  <span className="avatar small" aria-hidden="true">{who(t)[0].toUpperCase()}</span>
                  <span className="thread-row-main">
                    <span className="thread-row-top"><strong className="ellipsis">{who(t)}</strong><span className="muted nowrap">{when(t.at)}</span></span>
                    <span className="thread-row-last ellipsis">{t.last.fromOwner ? "You: " : t.last.kind === "report" ? "Report: " : ""}{t.last.text}</span>
                  </span>
                  {(t.unread > 0 || t.open > 0) && (
                    <span className="thread-row-badges">
                      {t.unread > 0 && <span className="badge-count" title="unread messages">{t.unread}</span>}
                      {t.open > 0 && <span className="badge-open" title="open reports"><Icon name="flag" size={12} />{t.open}</span>}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </aside>
        <section className="thread-pane">
          {id ? <ThreadView key={id} id={id} onChange={reload} /> : <Empty icon="chat" title="Pick a thread">The person's messages and reports, with your answers.</Empty>}
        </section>
      </div>
    </div>
  );
}

function ThreadView({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, error, reload } = useApi<One>(`/threads/${id}`);
  const say = useToast();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [resolve, setResolve] = useState(true);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // opening a thread reads what the person wrote
  useEffect(() => {
    if (!data) return;
    if (data.items.some((i) => i.kind === "message" && !i.fromOwner && !i.readAt)) void api(`/threads/${id}/read`, {}).then(onChange).catch(() => { /* still unread */ });
    end.current?.scrollIntoView({ block: "end" });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Empty icon="alert" title={error === "no such person" ? "This account no longer exists" : "Could not load"}>{error !== "no such person" && error}</Empty>;
  if (!data) return <div className="skeleton tall" />;
  const reports = new Map(data.items.filter((i): i is Report => i.kind === "report").map((r) => [r.id, r]));
  const target = replyTo != null ? reports.get(replyTo) : undefined;

  const answer = (r: Report) => { setReplyTo(r.id); setResolve(r.status === "open"); box.current?.focus(); };
  const settle = async (r: Report, a: "resolve" | "reopen") => {
    try { await api(`/disputes/${r.id}/${a}`, {}); say(a === "resolve" ? `#${r.id} done` : `#${r.id} open again`); reload(); onChange(); }
    catch (e) { say((e as Error).message, "bad"); }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await api(`/threads/${id}/send`, { body, disputeId: replyTo, resolve: replyTo != null && resolve && target?.status === "open" });
      setText(""); setReplyTo(null); say("Sent"); reload(); onChange();
    } catch (e) { say((e as Error).message, "bad"); }
    finally { setBusy(false); }
  };

  const p = data.person;
  let lastDay = "";
  return (
    <div className="achat">
      <div className="achat-head">
        <span className="mob-only"><BackLink to="/messages" label="Messages" /></span>
        <a className="from" {...linkProps(`/people/${p.id}`)}>
          <span className="avatar small" aria-hidden="true">{who(p)[0].toUpperCase()}</span>
          <span className="who"><strong>{who(p)}</strong><span className="muted">{p.email} · {p.lang.toUpperCase()} · joined {date(p.created_at, true)} · seen {when(p.last_seen_at)}</span></span>
          <Icon name="arrowRight" size={16} className="muted" />
        </a>
        <span className="achat-tag">Admin view</span>
      </div>
      <div className="achat-scroll">
        {!data.items.length && <p className="muted center">Nothing yet. Write first.</p>}
        {data.items.map((i) => {
          const k = new Date(i.at).toDateString(), sep = k !== lastDay;
          lastDay = k;
          return (
            <div key={`${i.kind}${i.id}`} className="achat-item">
              {sep && <div className="achat-day"><span>{dayLabel(i.at)}</span></div>}
              {i.kind === "report"
                ? <div className="achat-row"><ReportCard r={i} onAnswer={() => answer(i)} onSettle={(a) => settle(i, a)} /></div>
                : (
                  <div className="achat-row" data-mine={i.fromOwner || undefined}>
                    <div className="achat-bubble">
                      {i.disputeId != null && <button type="button" className="achat-ref" data-event={i.event ?? undefined} onClick={() => document.getElementById(`report-${i.disputeId}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>{i.event === "resolved" ? "✓" : i.event === "reopened" ? "↺" : "↳"} Report #{i.disputeId}{i.event ? ` · ${i.event === "resolved" ? "done" : "reopened"}` : ""}</button>}
                      {i.body && <p className="achat-text">{i.body}</p>}
                      <span className="achat-time">{time(i.at)}{i.fromOwner && <span className="achat-tick" data-read={i.readAt ? "" : undefined} title={i.readAt ? "read" : "not read yet"}>{i.readAt ? "✓✓" : "✓"}</span>}</span>
                    </div>
                  </div>
                )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <div className="achat-foot">
        {target && (
          <div className="composer-ref">
            <span>Answer to <strong>report #{target.id}</strong> · {target.section.toUpperCase()} {target.level} · n° {target.n}</span>
            {target.status === "open" && <label className="check"><input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> mark it done</label>}
            <button type="button" className="icon-btn" aria-label="Not an answer to a report" onClick={() => setReplyTo(null)}><Icon name="x" size={14} /></button>
          </div>
        )}
        <div className="achat-composer">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={`Write to ${who(p)} in ${p.lang === "fr" ? "French" : "English"}… ⌘↵ sends`} aria-label="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
          <button type="button" className="achat-send" aria-label="Send" title="Send" disabled={!text.trim() || busy} onClick={() => void send()}><Icon name="send" size={20} /></button>
        </div>
      </div>
    </div>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dayLabel(iso: string) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
}

function ReportCard({ r, onAnswer, onSettle }: { r: Report; onAnswer: () => void; onSettle: (a: "resolve" | "reopen") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="report-card" id={`report-${r.id}`} data-done={r.status === "resolved" || undefined}>
      <div className="report-card-head">
        <span className="report-id"><Icon name="flag" size={14} /> Report #{r.id}</span>
        <span className="dispute-ref"><Mark s={r.section} /> <strong>{r.level} · n° {r.n}</strong></span>
        <Chip tone={r.status === "open" ? "amber" : "ok"} dot>{r.status === "open" ? "open" : "done"}</Chip>
        <span className="muted report-when">{time(r.at)}</span>
      </div>
      <p className="report-body">{r.body}</p>
      <div className="report-actions">
        <Button size="sm" kind="primary" icon="send" onClick={onAnswer}>Answer</Button>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide the question" : "The question"}</Button>
        <a className="btn quiet sm" href={`https://tcf.monster/${r.section}/practice/${r.level}?q=${r.n}`} target="_blank" rel="noopener">In the app <Icon name="external" size={14} /></a>
        <span className="spacer" />
        {r.status === "open" ? <Button size="sm" icon="check" onClick={() => onSettle("resolve")}>Done</Button> : <Button size="sm" onClick={() => onSettle("reopen")}>Reopen</Button>}
      </div>
      {open && <QuestionText d={{ section: r.section, level: r.level, question_id: r.questionId }} />}
    </article>
  );
}
