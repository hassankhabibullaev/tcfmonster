import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, Seg } from "../../ui/ui.tsx";
import { linkProps } from "../../ui/router.ts";
import { useT, type Lang } from "../i18n.ts";
import { useMe, useToast } from "../main.tsx";
import { api, ApiError } from "../api.ts";
import { CONTACT_TG } from "./ReleaseNote.tsx";
import "./messages.css";
type Msg = {
    kind: "message";
    id: number;
    fromOwner: boolean;
    body: string;
    disputeId: number | null;
    event: "resolved" | "reopened" | null;
    at: string;
    readAt: string | null;
};
type Report = {
    kind: "report";
    id: number;
    section: "co" | "ce";
    level: string;
    questionId: string;
    n: number;
    body: string;
    status: "open" | "resolved";
    at: string;
};
type Item = Msg | Report;
type Limit = {
    perDay: number;
    left: number;
    resetAt: string | null;
};
type View = "all" | "reports";
const WORDS = {
    fr: {
        title: "Messages", team: "L'équipe tcf.monster", sub: "Répond en général en quelques semaines", back: "Accueil",
        all: "Tout", reports: "Signalements", show: "Afficher",
        hello: (name: string) => `Bonjour ${name} 👋`,
        greeting: "Une question, un bug, une idée ? Écrivez-nous ici, nous répondons dans cette conversation. Vos signalements sous les questions arrivent ici aussi, avec notre réponse.",
        report: (n: number) => `Signalement n° ${n}`,
        where: (s: string, l: string, n: number) => `${s} · ${l} · question ${n}`,
        open: "Reçu", done: "Traité", reopened: "Rouvert",
        noReports: "Aucun signalement pour l'instant. Sous chaque question d'entraînement : « Signaler un problème ».",
        noAnswer: "Pas encore de réponse.",
        placeholder: "Votre message", send: "Envoyer",
        left: (n: number, per: number) => (n === 1 ? `1 message restant aujourd'hui (${per} par jour)` : `${n} messages restants aujourd'hui (${per} par jour)`),
        none: (per: number, at: string | null) => `Limite atteinte : ${per} messages par jour.${at ? ` Vous pourrez écrire à nouveau ${at}.` : ""}`,
        at: (h: string, tomorrow: boolean) => (tomorrow ? `demain à ${h}` : `à ${h}`),
        urgent: "Urgent ? Telegram :",
        today: "Aujourd'hui", yesterday: "Hier",
        failed: "Le message n'est pas parti. Réessayez.", hold: "Le site est très sollicité aujourd'hui : réessayez demain.",
        loadFailed: "Les messages ne se chargent pas.", retry: "Réessayer", read: "Lu", sent: "Envoyé",
    },
    en: {
        title: "Messages", team: "The tcf.monster team", sub: "Usually answers within a few weeks", back: "Home",
        all: "All", reports: "Reports", show: "Show",
        hello: (name: string) => `Hello ${name} 👋`,
        greeting: "A question, a bug, an idea? Write to us here, we answer in this conversation. Your reports under the questions come here too, with our answer.",
        report: (n: number) => `Report no. ${n}`,
        where: (s: string, l: string, n: number) => `${s} · ${l} · question ${n}`,
        open: "Received", done: "Handled", reopened: "Reopened",
        noReports: "No report yet. Under every practice question: « Report a problem ».",
        noAnswer: "No answer yet.",
        placeholder: "Your message", send: "Send",
        left: (n: number, per: number) => (n === 1 ? `1 message left today (${per} a day)` : `${n} messages left today (${per} a day)`),
        none: (per: number, at: string | null) => `Limit reached: ${per} messages a day.${at ? ` You can write again ${at}.` : ""}`,
        at: (h: string, tomorrow: boolean) => (tomorrow ? `tomorrow at ${h}` : `at ${h}`),
        urgent: "Urgent? Telegram:",
        today: "Today", yesterday: "Yesterday",
        failed: "The message did not go through. Try again.", hold: "The site is very busy today: try again tomorrow.",
        loadFailed: "The messages do not load.", retry: "Retry", read: "Read", sent: "Sent",
    },
};
type W = (typeof WORDS)["fr"];
const locale = (lang: Lang) => (lang === "fr" ? "fr-FR" : "en-GB");
const hour = (iso: string, lang: Lang) => new Intl.DateTimeFormat(locale(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
function dayLabel(iso: string, lang: Lang, w: W) {
    const d = new Date(iso), now = new Date();
    const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
    if (days === 0)
        return w.today;
    if (days === 1)
        return w.yesterday;
    return new Intl.DateTimeFormat(locale(lang), { day: "numeric", month: "long", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(d);
}
const toReport = (id: number) => document.getElementById(`report-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
function Ref({ m, w, onGo }: {
    m: Msg;
    w: W;
    onGo?: (id: number) => void;
}) {
    if (m.disputeId == null)
        return null;
    const id = m.disputeId;
    return (<button type="button" className="conv-ref" data-event={m.event ?? undefined} onClick={() => (onGo ?? toReport)(id)}>
      {m.event === "resolved" ? "✓" : m.event === "reopened" ? "↺" : "↳"} {w.report(id)}{m.event ? ` · ${m.event === "resolved" ? w.done : w.reopened}` : ""}
    </button>);
}
function Bubble({ m, w, lang }: {
    m: Msg;
    w: W;
    lang: Lang;
}) {
    return (<div className="conv-row" data-mine={!m.fromOwner || undefined}>
      <div className="conv-bubble">
        <Ref m={m} w={w}/>
        {m.body && <p className="conv-text">{m.body}</p>}
        <span className="conv-time">{hour(m.at, lang)}{!m.fromOwner && <span className="conv-tick" data-read={m.readAt ? "" : undefined} title={m.readAt ? w.read : w.sent} aria-label={m.readAt ? w.read : w.sent}>{m.readAt ? "✓✓" : "✓"}</span>}</span>
      </div>
    </div>);
}
function ReportCard({ r, w, lang, sections }: {
    r: Report;
    w: W;
    lang: Lang;
    sections: Record<string, string>;
}) {
    return (<article id={`report-${r.id}`} className="conv-report" data-done={r.status === "resolved" || undefined}>
      <div className="conv-report-head">
        <span className="conv-report-no"><Icon name="flag" size={14}/>{w.report(r.id)}</span>
        <span className="conv-chip">{r.status === "resolved" ? <><Icon name="check" size={13}/>{w.done}</> : w.open}</span>
      </div>
      <a className="conv-report-where" {...linkProps(`/${r.section}/practice/${r.level}?q=${r.n}`)}>{w.where(sections[r.section], r.level, r.n)} <Icon name="arrowRight" size={14}/></a>
      <p className="conv-text">{r.body}</p>
      <span className="conv-time">{hour(r.at, lang)}</span>
    </article>);
}
export function Messages() {
    const { lang, t } = useT();
    const { me, refresh } = useMe();
    const say = useToast();
    const w = WORDS[lang];
    const [items, setItems] = useState<Item[] | null>(null);
    const [limit, setLimit] = useState<Limit | null>(null);
    const [failed, setFailed] = useState(false);
    const [view, setView] = useState<View>("all");
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    const scroll = useRef<HTMLDivElement>(null);
    const box = useRef<HTMLTextAreaElement>(null);
    const load = async () => {
        setFailed(false);
        try {
            const r = await api<{
                items: Item[];
                unread: number;
                limit: Limit;
            }>("/messages");
            setItems(r.items);
            setLimit(r.limit);
            if (r.unread > 0)
                await api("/messages/read", {}).then(refresh).catch(() => { });
        }
        catch {
            setFailed(true);
        }
    };
    useEffect(() => { void load(); }, []);
    useLayoutEffect(() => { const s = scroll.current; if (s)
        s.scrollTop = view === "all" ? s.scrollHeight : 0; }, [items, view]);
    useLayoutEffect(() => { const b = box.current; if (b) {
        b.style.height = "auto";
        b.style.height = `${Math.min(140, b.scrollHeight)}px`;
    } }, [text]);
    const reports = useMemo(() => (items ?? []).filter((i): i is Report => i.kind === "report"), [items]);
    const out = limit?.left === 0;
    const send = async () => {
        const body = text.trim();
        if (!body || busy || out)
            return;
        setBusy(true);
        try {
            const r = await api<{
                id: number;
                at: string;
                limit: Limit;
            }>("/messages", { body });
            setItems((xs) => [...(xs ?? []), { kind: "message", id: r.id, fromOwner: false, body, disputeId: null, event: null, at: r.at, readAt: null }]);
            setLimit(r.limit);
            setText("");
        }
        catch (e) {
            const data = e instanceof ApiError ? e.data : null;
            if (data?.error === "daily_cap") {
                if (data.limit)
                    setLimit(data.limit);
            }
            else
                say(data?.error === "hold" ? w.hold : w.failed, "bad");
        }
        finally {
            setBusy(false);
            box.current?.focus();
        }
    };
    const onKey = (e: React.KeyboardEvent) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing)
            return;
        if (matchMedia("(pointer: coarse)").matches && !(e.metaKey || e.ctrlKey))
            return;
        e.preventDefault();
        void send();
    };
    const showInAll = (id: number) => { setView("all"); requestAnimationFrame(() => requestAnimationFrame(() => toReport(id))); };
    let lastDay = "";
    return (<div className="conv">
      <header className="conv-head">
        <a className="conv-back" {...linkProps("/")} aria-label={w.back}><Icon name="arrowLeft" size={20}/></a>
        <img className="conv-avatar" src="/app-icon.svg" alt="" width="40" height="40"/>
        <div className="conv-who">
          <h1>{w.team}</h1>
          <p>{w.sub}</p>
        </div>
        <Seg label={w.show} value={view} onChange={setView} options={[["all", w.all], ["reports", reports.length ? `${w.reports} · ${reports.length}` : w.reports]]}/>
      </header>

      <div className="conv-scroll" ref={scroll} aria-live="polite">
        {failed && <p className="conv-note">{w.loadFailed} <button type="button" className="btn sm" onClick={() => void load()}>{w.retry}</button></p>}
        {!failed && items === null && <div className="skeleton tall"/>}

        {items && view === "all" && (<>
            <div className="conv-row">
              <div className="conv-bubble conv-greeting">
                <p className="conv-text"><b>{w.hello(me?.name ?? "")}</b></p>
                <p className="conv-text">{w.greeting}</p>
              </div>
            </div>
            {items.map((i) => {
                const k = dayKey(i.at), sep = k !== lastDay;
                lastDay = k;
                return (<div key={`${i.kind}${i.id}`} className="conv-item">
                  {sep && <div className="conv-day"><span>{dayLabel(i.at, lang, w)}</span></div>}
                  {i.kind === "report" ? <div className="conv-row" data-mine=""><ReportCard r={i} w={w} lang={lang} sections={t.sectionNames}/></div> : <Bubble m={i} w={w} lang={lang}/>}
                </div>);
            })}
          </>)}

        {items && view === "reports" && (reports.length === 0 ? <p className="conv-note">{w.noReports}</p> : [...reports].reverse().map((r) => {
            const answers = items.filter((i): i is Msg => i.kind === "message" && i.disputeId === r.id);
            return (<section key={r.id} className="conv-thread">
                <div className="conv-day"><span>{dayLabel(r.at, lang, w)}</span></div>
                <div className="conv-row" data-mine=""><ReportCard r={r} w={w} lang={lang} sections={t.sectionNames}/></div>
                {answers.length ? answers.map((m) => (<div key={m.id} className="conv-row" data-mine={!m.fromOwner || undefined}>
                    <div className="conv-bubble">
                      <Ref m={m} w={w} onGo={showInAll}/>
                      {m.body && <p className="conv-text">{m.body}</p>}
                      <span className="conv-time">{dayLabel(m.at, lang, w)} · {hour(m.at, lang)}</span>
                    </div>
                  </div>)) : <p className="conv-note conv-note-sm">{w.noAnswer}</p>}
              </section>);
        }))}
      </div>

      {view === "all" && (<footer className="conv-foot">
          {limit && (<p className="conv-limit" data-out={out || undefined}>
              <span className="conv-pips" aria-hidden="true">{Array.from({ length: limit.perDay }, (_, i) => <i key={i} data-used={i < limit.perDay - limit.left || undefined}/>)}</span>
              <span>{out ? <>{w.none(limit.perDay, limit.resetAt ? w.at(hour(limit.resetAt, lang), dayKey(limit.resetAt) !== dayKey(new Date().toISOString())) : null)} {w.urgent} <a href={CONTACT_TG} target="_blank" rel="noopener">@tcfmonsteradmin</a></> : w.left(limit.left, limit.perDay)}</span>
            </p>)}
          <div className="conv-composer">
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={2000} placeholder={w.placeholder} aria-label={w.placeholder} disabled={out} onKeyDown={onKey}/>
            <button type="button" className="conv-send" aria-label={w.send} title={w.send} disabled={!text.trim() || busy || out} onClick={() => void send()}><Icon name="send" size={20}/></button>
          </div>
        </footer>)}
    </div>);
}
export function MessagesCard() {
    const { lang } = useT();
    const { me } = useMe();
    if (!me?.unread)
        return null;
    const fr = lang === "fr";
    return (<a className="msgs-card" {...linkProps("/messages")}>
      <img src="/app-icon.svg" alt="" width="36" height="36"/>
      <span className="msgs-card-text">
        <b>{fr ? (me.unread > 1 ? `${me.unread} nouvelles réponses de l'équipe` : "Une nouvelle réponse de l'équipe") : me.unread > 1 ? `${me.unread} new answers from the team` : "A new answer from the team"}</b>
        <span>{fr ? "À vos signalements et vos messages" : "To your reports and your messages"}</span>
      </span>
      <span className="btn primary sm">{fr ? "Lire" : "Read"}</span>
    </a>);
}
