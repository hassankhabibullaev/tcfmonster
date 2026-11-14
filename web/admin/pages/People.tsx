// Everyone who registered, side by side: how active each one is, how much they did, where they stand in each test
// against their target, what they won since their first exam, whether their key works. The list is sorted over
// everyone on the server, then cut into pages of 10, 100, 1 000 or 10 000.
import { useEffect, useRef, useState } from "react";
import { Icon, Empty, Button, Chip, ColourBar, type Tone } from "../../ui/ui.tsx";
import { useApi, useSummary, useLocation, setParams, linkProps, go, num, when, date, daysLeft, minutes, plural } from "../lib.ts";

export type PersonRow = {
  id: string; email: string; name: string | null; created_at: string; last_seen_at: string | null; target_nclc: number | null;
  exam_date: string | null; blocked_at: string | null; human_needed_at: string | null; gemini_status: string;
  answered: number; exams: number; expression: number;
  /** practice, the exams' length and the sessions, in seconds */
  seconds: number;
  /** the best NCLC in each test (3 stands for « below 4 »); null: no result yet */
  co: number | null; ce: number | null; ee: number | null; eo: number | null;
  /** CO + CE points between the first and the latest exam; null: fewer than two exams */
  gain: number | null;
  /** days with any work in the last 30, and the last 14 as bits (bit 0 = today) */
  days30: number; mask: number;
  /** practice questions by colour */
  ok: number; amber: number; bad: number;
};

const FILTERS: [string, string][] = [
  ["all", "Everyone"], ["active", "Active in 7 days"], ["new", "New in 7 days"], ["exam", "Exam ahead"], ["idle", "Never started"],
  ["key", "With a working key"], ["nokey", "Without a working key"], ["check", "Watched by the guard"], ["blocked", "Blocked"],
];
/** each sort and whether it starts from the top (most, latest) — the same as the server's */
const SORTS: [string, string, boolean][] = [
  ["seen", "Last active", true], ["active", "Most active · 30 days", true], ["time", "Time spent", true], ["practice", "Answers", true],
  ["exams", "CO·CE exams", true], ["expression", "EE·EO sessions", true], ["level", "Level (NCLC)", true], ["gain", "Gain since first exam", true],
  ["target", "Target", true], ["exam", "Exam date", false], ["joined", "Joined", true], ["name", "Name", false],
];
const SIZES = [10, 100, 1000, 10000];
const KEY: Record<string, [Tone, string]> = { ok: ["ok", "works"], error: ["bad", "rejected"], quota: ["amber", "limit"], none: ["muted", "none"] };

export function ExamDate({ d }: { d: string | null }) {
  if (!d) return <span className="muted">—</span>;
  const left = daysLeft(d)!;
  return <span>{date(d)} <span className={left < 0 ? "muted" : left <= 14 ? "warn" : "muted"}>· {left < 0 ? "past" : `${left} d`}</span></span>;
}

/** what stops the person, beside their name */
function Flags({ p }: { p: PersonRow }) {
  if (p.blocked_at) return <> <Chip tone="bad">blocked</Chip></>;
  if (p.human_needed_at) return <> <Chip tone="amber">human check</Chip></>;
  return null;
}

/** one square a day, the oldest left and today right, filled when the person did something (one element, however long) */
export function DayStrip({ on, label }: { on: boolean[]; label: string }) {
  const w = 100 / on.length, gap = Math.min(1.4, w / 5);
  const stops = on.map((v, i) => `${v ? "var(--accent)" : "var(--new)"} ${(i * w).toFixed(2)}% ${((i + 1) * w - gap).toFixed(2)}%, transparent ${((i + 1) * w - gap).toFixed(2)}% ${((i + 1) * w).toFixed(2)}%`);
  return <span className="days" role="img" aria-label={label} title={label} style={{ width: on.length * 8, backgroundImage: `linear-gradient(90deg, ${stops.join(", ")})` }} />;
}
/** the last 14 days from the list's bits (bit 0 = today) */
const lastDays = (mask: number) => Array.from({ length: 14 }, (_, i) => Boolean(mask & (1 << (13 - i))));

/** the best NCLC in each of the four tests: green at the target or above, amber below, grey without a result */
export function Levels({ p }: { p: { co: number | null; ce: number | null; ee: number | null; eo: number | null; target_nclc: number | null } }) {
  return (
    <span className="lvs">
      {(["co", "ce", "ee", "eo"] as const).map((s) => {
        const v = p[s];
        const tone = v == null ? "none" : p.target_nclc == null ? "plain" : v >= p.target_nclc ? "ok" : "amber";
        return <span key={s} className={`lv ${tone}`} title={v == null ? `${s.toUpperCase()}: no result yet` : `${s.toUpperCase()}: best NCLC ${v < 4 ? "below 4" : v}`}><i>{s}</i>{v == null ? "–" : v < 4 ? "<4" : v}</span>;
      })}
    </span>
  );
}

export function Gain({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  return <span className={v > 0 ? "gain up" : v < 0 ? "gain down" : "muted"}>{v > 0 ? "+" : v < 0 ? "−" : ""}{num(Math.abs(v))}</span>;
}

/** a column title that sorts the whole list; a second press turns the order round */
function Th({ sort, desc, by, label, r, title }: { sort: string; desc: boolean; by?: string; label: string; r?: boolean; title?: string }) {
  if (!by) return <th className={r ? "r" : undefined} title={title}>{label}</th>;
  const on = sort === by;
  const usual = SORTS.find(([k]) => k === by)?.[2] ?? true;
  const press = () => setParams(on ? { dir: desc === usual ? (usual ? "asc" : "desc") : null, page: null } : { sort: by === "seen" ? null : by, dir: null, page: null });
  return (
    <th className={r ? "r" : undefined} aria-sort={on ? (desc ? "descending" : "ascending") : undefined} title={title}>
      <button type="button" className={`th-sort${on ? " on" : ""}`} onClick={press}>
        {label}{on && <Icon name="chevronDown" size={14} className={desc ? undefined : "flip"} />}
      </button>
    </th>
  );
}

export function People() {
  const { params } = useLocation();
  const summary = useSummary();
  const filter = params.get("filter") ?? "all", sort = params.get("sort") ?? "seen", page = Number(params.get("page") ?? 0);
  const size = SIZES.includes(Number(params.get("size"))) ? Number(params.get("size")) : 100;
  const usual = SORTS.find(([k]) => k === sort)?.[2] ?? true;
  const desc = params.get("dir") === "asc" ? false : params.get("dir") === "desc" ? true : usual;
  const [q, setQ] = useState(params.get("q") ?? "");
  // a new search goes back to the first page; the page of a link or of Back stays (nothing typed yet)
  useEffect(() => {
    if (q.trim() === (params.get("q") ?? "")) return;
    const t = setTimeout(() => setParams({ q: q.trim() || null, page: null }), 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams({ filter, sort, dir: desc ? "desc" : "asc", size: String(size), page: String(page), q: params.get("q") ?? "" });
  const { data, error, loading } = useApi<{ rows: PersonRow[]; total: number; page: number; pageSize: number }>(`/people?${qs}`);
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const searching = !!params.get("q") || filter !== "all";
  const bank = summary ? [...Object.values(summary.bank.co), ...Object.values(summary.bank.ce)].reduce((n, l) => n + l.questions, 0) : undefined;

  // a long page is drawn 200 lines at a time, as the end comes into view
  const [drawn, setDrawn] = useState(200);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => { setDrawn(200); }, [data]);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const seen = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setDrawn((n) => n + 200); }, { rootMargin: "600px" });
    seen.observe(el);
    return () => seen.disconnect();
  }, [data, drawn]);
  const rows = data?.rows.slice(0, drawn) ?? [];
  const th = { sort, desc };

  return (
    <div className="page wide">
      <div className="page-head"><h1 className="title">People</h1>{data && <span className="muted">{num(data.total)} {data.total === 1 ? "person" : "people"}{searching ? " match" : ""}</span>}</div>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or e-mail" aria-label="Search people" />
        </label>
        <label className="select">
          <span className="muted">Show</span>
          <select value={filter} onChange={(e) => setParams({ filter: e.target.value === "all" ? null : e.target.value, page: null })}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="select">
          <span className="muted">Sort by</span>
          <select value={sort} onChange={(e) => setParams({ sort: e.target.value === "seen" ? null : e.target.value, dir: null, page: null })}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Button size="sm" kind="quiet" onClick={() => setParams({ dir: desc === usual ? (usual ? "asc" : "desc") : null, page: null })} title="Turn the order round" aria-label={desc ? "Highest first; turn the order round" : "Lowest first; turn the order round"}>
          <Icon name="chevronDown" size={16} className={desc ? undefined : "flip"} />{desc ? (sort === "name" ? "Z → A" : "Top first") : sort === "name" ? "A → Z" : "Bottom first"}
        </Button>
        <span className="spacer" />
        <label className="select">
          <select value={size} onChange={(e) => setParams({ size: e.target.value === "100" ? null : e.target.value, page: null })} aria-label="People a page">
            {SIZES.map((n) => <option key={n} value={n}>{num(n)} a page</option>)}
          </select>
        </label>
      </div>

      {error && <Empty icon="alert" title="People could not load">{error}</Empty>}
      {data && !data.rows.length && <Empty icon="users" title={searching ? "Nobody matches" : "Nobody yet"} />}
      {data && data.rows.length > 0 && (
        <>
          <div className={`card table-wrap desk-table${loading ? " stale" : ""}`}>
            <table className="table people">
              <thead>
                <tr>
                  <Th {...th} by="name" label="Person" />
                  <Th {...th} by="seen" label="Last active" />
                  <Th {...th} by="active" label="Last 14 days" title="A square a day, today on the right; beside it, the days with any work out of the last 30" />
                  <Th {...th} by="time" label="Time" r title="Practice, exams and sessions together" />
                  <Th {...th} by="practice" label="Answers" r />
                  <Th {...th} label="Practice" title="Questions practised: right, corrected, wrong — out of the whole bank" />
                  <Th {...th} by="level" label="Level → target" title="The best NCLC in each test: green at the target or above, amber below" />
                  <Th {...th} by="gain" label="Gain" r title="CO + CE points between the first and the latest exam" />
                  <Th {...th} by="exam" label="Exam" />
                  <Th {...th} label="Key" title="Their Gemini key, as their browser last reported it" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="click" onClick={() => go(`/people/${p.id}`)}>
                    <td><a className="who" href={`/people/${p.id}`} onClick={(e) => { e.stopPropagation(); linkProps(`/people/${p.id}`).onClick(e); }}><strong>{p.name ?? "—"}<Flags p={p} /></strong><span className="muted">{p.email}</span></a></td>
                    <td className="nowrap"><span className="two"><span>{when(p.last_seen_at)}</span><span className="muted small">joined {date(p.created_at)}</span></span></td>
                    <td className="nowrap"><span className="act"><DayStrip on={lastDays(p.mask)} label={`${plural(p.days30, "day")} with work in the last 30`} /><span className="num muted small">{p.days30}/30</span></span></td>
                    <td className="r num nowrap">{p.seconds ? minutes(p.seconds) : <span className="muted">—</span>}</td>
                    <td className="r num"><span className="two"><span>{num(p.answered)}</span><span className="muted small nowrap">{plural(p.exams, "exam")} · {num(p.expression)} EE·EO</span></span></td>
                    <td className="bar-col" title={`${num(p.ok)} right · ${num(p.amber)} corrected · ${num(p.bad)} wrong${bank ? ` · of ${num(bank)}` : ""}`}><ColourBar ok={p.ok} amber={p.amber} bad={p.bad} total={bank} /></td>
                    <td className="nowrap"><span className="act"><Levels p={p} /><span className="muted small num">→ {p.target_nclc ?? "?"}</span></span></td>
                    <td className="r num nowrap"><Gain v={p.gain} /></td>
                    <td className="nowrap"><ExamDate d={p.exam_date} /></td>
                    <td><Chip tone={KEY[p.gemini_status]?.[0] ?? "muted"} dot>{KEY[p.gemini_status]?.[1] ?? p.gemini_status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="cards-list mob-list">
            {rows.map((p) => (
              <li key={p.id}>
                <a className="card person-card" {...linkProps(`/people/${p.id}`)}>
                  <span className="who"><strong>{p.name ?? "—"}<Flags p={p} /></strong><span className="muted">{p.email}</span></span>
                  <span className="person-card-meta"><DayStrip on={lastDays(p.mask)} label={`${plural(p.days30, "day")} with work in the last 30`} /><span className="num">{p.days30}/30 days</span><span>{when(p.last_seen_at)}</span></span>
                  <span className="person-card-meta"><Levels p={p} /><span className="num">→ {p.target_nclc ?? "?"}</span>{p.gain != null && <Gain v={p.gain} />}</span>
                  <span className="person-card-meta num">
                    <span>{num(p.answered)} answers</span><span>{p.seconds ? minutes(p.seconds) : "0 min"}</span><span>{num(p.exams)} exams</span><span>{num(p.expression)} EE·EO</span>
                    {p.exam_date && <span>exam {date(p.exam_date)}</span>}<span>key: {KEY[p.gemini_status]?.[1] ?? p.gemini_status}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {data.rows.length > drawn && <div ref={more} className="more muted small">Drawing {num(drawn)} of {num(data.rows.length)}…</div>}
          <div className="pager">
            <span className="muted">{num(page * data.pageSize + 1)}–{num(Math.min(data.total, (page + 1) * data.pageSize))} of {num(data.total)}{pages > 1 ? ` · page ${num(page + 1)} of ${num(pages)}` : ""}</span>
            {pages > 1 && (
              <span className="pager-buttons">
                <Button size="sm" kind="quiet" disabled={page === 0} onClick={() => setParams({ page: null })}>First</Button>
                <Button size="sm" disabled={page === 0} onClick={() => setParams({ page: page - 1 ? String(page - 1) : null })}>Previous</Button>
                <Button size="sm" disabled={page + 1 >= pages} onClick={() => setParams({ page: String(page + 1) })}>Next</Button>
                <Button size="sm" kind="quiet" disabled={page + 1 >= pages} onClick={() => setParams({ page: String(pages - 1) })}>Last</Button>
              </span>
            )}
          </div>
        </>
      )}
      {!data && !error && <div className="skeleton tall" />}
    </div>
  );
}
