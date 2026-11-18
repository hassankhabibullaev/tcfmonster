import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Icon } from "../../ui/ui.tsx";
import { linkProps } from "../../ui/router.ts";
import { useT, type Lang } from "../i18n.ts";
import { useMe } from "../main.tsx";
import { dueReleases } from "../release-due.ts";
import "./release.css";
const SEEN_KEY = "tcfm.release";
export const CONTACT_TG = "https://t.me/tcfmonsteradmin";
type Release = {
    id: string;
    also?: string[];
    date: string;
    forNew: boolean;
    party: boolean;
    row: Record<Lang, ReactNode>;
};
const RELEASES: Release[] = [
    {
        id: "2026-11-18", date: "2026-11-18", forNew: true, party: true,
        row: {
            fr: <><a {...linkProps("/co/exam")}>Examen d'écoute n° 43</a>, l'écrit sans chrono, 25 corrections du simulateur</>,
            en: <><a {...linkProps("/co/exam")}>Listening exam no. 43</a>, writing without the timer, 25 simulator fixes</>,
        },
    },
    {
        id: "2026-11-12", date: "2026-11-12", forNew: false, party: false,
        row: { fr: "Messages, 4 bugs corrigés, 4 questions rectifiées, 5 doublons réunis", en: "Messages, 4 bugs fixed, 4 questions corrected, 5 repeats merged" },
    },
    {
        id: "2026-11-11", also: ["2026-11-11-2"], date: "2026-11-11", forNew: true, party: true,
        row: {
            fr: <>Six nouveaux examens : <a {...linkProps("/co/exam")}>écoute n° 41–42</a>, <a {...linkProps("/ce/exam")}>lecture n° 41–44</a>, et 230 questions</>,
            en: <>Six new exams: <a {...linkProps("/co/exam")}>listening no. 41–42</a>, <a {...linkProps("/ce/exam")}>reading no. 41–44</a>, and 230 questions</>,
        },
    },
];
const readSeen = () => { try {
    return localStorage.getItem(SEEN_KEY);
}
catch {
    return null;
} };
const WORDS = {
    fr: {
        tag: "Nouveautés", earlier: "Aussi depuis votre dernière visite", all: "Tout voir", ok: "C'est parti !", got: "Compris",
        report: "Une erreur dans une question ? « Signaler un problème » sous la question. Autre chose ? Écrivez-nous dans",
        reportTail: "ou sur Telegram :", messages: "Messages",
    },
    en: {
        tag: "What's new", earlier: "Also since your last visit", all: "See everything", ok: "Let's go!", got: "Got it",
        report: "A mistake in a question? « Report a problem » under the question. Anything else? Write to us in",
        reportTail: "or on Telegram:", messages: "Messages",
    },
};
const EXAMS = {
    fr: { title: "Six nouveaux examens !", co: ["nouveaux examens", "de compréhension orale", "n° 41 et 42"], ce: ["nouveaux examens", "de compréhension écrite", "n° 41 à 44"], practice: (n: number) => `${n} nouvelles questions uniques à l'entraînement, de A1 à C2` },
    en: { title: "Six new exams!", co: ["new exams", "in listening", "no. 41 and 42"], ce: ["new exams", "in reading", "no. 41 to 44"], practice: (n: number) => `${n} new unique practice questions, from A1 to C2` },
};
const CARDS = [{ n: 2, s: "co", to: "/co/exam" }, { n: 4, s: "ce", to: "/ce/exam" }] as const;
function ExamsBody({ lang, close }: {
    lang: Lang;
    close: () => void;
}) {
    const w = EXAMS[lang];
    return (<>
      <h2 id="release-title">{w.title}</h2>
      <div className="release-cards">
        {CARDS.map(({ n, s, to }) => {
            const [what, section, which] = w[s];
            const link = linkProps(to);
            return (<a key={s} className="release-card" data-s={s} href={link.href} onClick={(e) => { close(); link.onClick(e); }}>
              <span className="release-card-icon"><Icon name={s} size={20}/></span>
              <b className="release-card-n num">{n}</b>
              <span className="release-card-what">{what}<br />{section}</span>
              <span className="release-card-which num">{which}</span>
            </a>);
        })}
      </div>
      <p className="release-more"><Icon name="spark" size={16}/>{w.practice(230)}</p>
    </>);
}
const NOV12 = {
    fr: {
        title: "Une messagerie avec nous",
        points: [
            { icon: "chat", b: "Messages", t: "Écrivez-nous directement dans l'app. Vos signalements sous les questions y arrivent aussi, avec notre réponse.", to: "/messages", go: "Ouvrir" },
            { icon: "check", b: "4 bugs corrigés", t: "En mode libre, juste ou faux s'affiche dès votre réponse, sans compte à rebours au départ. « Recommencer le niveau » est maintenant dans le niveau. En Tâche 2, l'échange démarre plus sûrement après la préparation." },
            { icon: "flag", b: "4 questions corrigées et 5 doublons réunis, grâce à vous", t: "Écoute C1 : l'habillage sonore des voitures. Lecture C2 : le téléphone intelligent, l'UNESCO et la lecture publique. Cinq questions d'écoute présentes deux fois à l'entraînement n'en font plus qu'une, votre progression gardée. Chaque signalement a sa réponse dans Messages." },
        ],
    },
    en: {
        title: "Messages with us",
        points: [
            { icon: "chat", b: "Messages", t: "Write to us right in the app. Your reports under the questions come there too, with our answer.", to: "/messages", go: "Open" },
            { icon: "check", b: "4 bugs fixed", t: "In free mode, right or wrong shows as soon as you answer, with no countdown at the start. « Start level over » now sits inside the level. In Tâche 2, the exchange starts more reliably after the preparation." },
            { icon: "flag", b: "4 questions corrected and 5 repeats merged, thanks to you", t: "Listening C1: car sound design. Reading C2: the smartphone, UNESCO and public reading. Five listening questions that were twice in practice are now one each, your progress kept. Every report has its answer in Messages." },
        ],
    },
} as const;
function Nov12Body({ lang, close }: {
    lang: Lang;
    close: () => void;
}) {
    const w = NOV12[lang];
    return (<>
      <h2 id="release-title">{w.title}</h2>
      <ul className="release-points">
        {w.points.map((p) => {
            const link = "to" in p ? linkProps(p.to) : null;
            return (<li key={p.b}>
              <span className="release-point-icon"><Icon name={p.icon} size={18}/></span>
              <span><b>{p.b}</b> {p.t}{link && "go" in p && <> <a href={link.href} onClick={(e) => { close(); link.onClick(e); }}>{p.go} →</a></>}</span>
            </li>);
        })}
      </ul>
    </>);
}
const NOV18 = {
    fr: {
        title: "Un nouvel examen d'écoute !",
        points: [
            { icon: "co", b: "Examen d'écoute n° 43", t: "39 nouvelles questions, aussi à l'entraînement, de A1 à C2, avec indices, traductions et explications.", to: "/co/exam", go: "Commencer" },
            { icon: "clock", b: "Écrire sans chrono", t: "Sur la page de lancement de l'expression écrite, choisissez « Sans chrono » : pas de compte à rebours, vous rendez quand vous voulez, la correction est la même.", to: "/ee", go: "Essayer" },
            { icon: "check", b: "25 corrections du simulateur", t: "À l'oral : une seule voix d'examinatrice, chaque transcription à sa place, l'écran reste allumé, le bouton pour parler plus fiable. À l'écrit : le chrono ne s'arrête plus quand vous tapez, une note n'est jamais demandée deux fois, des messages d'erreur plus clairs." },
            { icon: "flag", b: "Vos signalements", t: "Un encadré sous le lecteur indique maintenant un enregistrement abîmé. Trois questions corrigées." },
        ],
    },
    en: {
        title: "A new listening exam!",
        points: [
            { icon: "co", b: "Listening exam no. 43", t: "39 new questions, also in practice, from A1 to C2, with hints, translations and explanations.", to: "/co/exam", go: "Start" },
            { icon: "clock", b: "Write without the timer", t: "On the writing setup page pick “No timer”: no countdown, hand in when you like, the same marking.", to: "/ee", go: "Try it" },
            { icon: "check", b: "25 simulator fixes", t: "Speaking: one examiner's voice, every transcript in its place, the screen stays on, a more reliable push-to-talk. Writing: the clock no longer stops while you type, a mark is never asked for twice, clearer error messages." },
            { icon: "flag", b: "Your reports", t: "A box under the player now says when a recording is damaged. Three questions fixed." },
        ],
    },
} as const;
function Nov18Body({ lang, close }: {
    lang: Lang;
    close: () => void;
}) {
    const w = NOV18[lang];
    return (<>
      <h2 id="release-title">{w.title}</h2>
      <ul className="release-points">
        {w.points.map((p) => {
            const link = "to" in p ? linkProps(p.to) : null;
            return (<li key={p.b}>
              <span className="release-point-icon"><Icon name={p.icon} size={18}/></span>
              <span><b>{p.b}</b> {p.t}{link && "go" in p && <> <a href={link.href} onClick={(e) => { close(); link.onClick(e); }}>{p.go} →</a></>}</span>
            </li>);
        })}
      </ul>
    </>);
}
const BODIES: Record<string, (p: {
    lang: Lang;
    close: () => void;
}) => ReactNode> = { "2026-11-11": ExamsBody, "2026-11-12": Nov12Body, "2026-11-18": Nov18Body };
function useConfetti(on: boolean, canvas: React.RefObject<HTMLCanvasElement | null>) {
    useEffect(() => {
        const c = canvas.current;
        if (!on || !c || matchMedia("(prefers-reduced-motion: reduce)").matches)
            return;
        const ctx = c.getContext("2d");
        if (!ctx)
            return;
        const dpr = Math.min(2, devicePixelRatio || 1);
        const W = innerWidth, H = innerHeight;
        c.width = W * dpr;
        c.height = H * dpr;
        ctx.scale(dpr, dpr);
        const css = getComputedStyle(document.documentElement);
        const colours = ["--accent", "--sun", "--ok", "--amber", "--bad"].map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
        const bits = Array.from({ length: Math.min(180, Math.round(W / 5)) }, (_, i) => {
            const left = i % 2 === 0;
            const angle = (left ? -1 : -1) * (Math.PI / 2) + (left ? 1 : -1) * (0.25 + Math.random() * 0.55);
            const speed = (H / 60) * (0.75 + Math.random() * 0.6);
            return {
                x: left ? W * 0.04 : W * 0.96, y: H + 8,
                vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
                w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
                c: colours[i % colours.length] || "#f07a5a", delay: Math.random() * 12, round: Math.random() < 0.3,
            };
        });
        let frame = 0, raf = 0;
        const tick = () => {
            frame++;
            ctx.clearRect(0, 0, W, H);
            let alive = 0;
            for (const b of bits) {
                if (frame < b.delay) {
                    alive++;
                    continue;
                }
                b.vy += 0.32;
                b.vx *= 0.99;
                b.vy *= 0.99;
                b.x += b.vx;
                b.y += b.vy;
                b.r += b.vr;
                if (b.y > H + 20)
                    continue;
                alive++;
                ctx.save();
                ctx.translate(b.x, b.y);
                ctx.rotate(b.r);
                ctx.fillStyle = b.c;
                ctx.globalAlpha = frame > 150 ? Math.max(0, 1 - (frame - 150) / 60) : 1;
                if (b.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, b.h / 1.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                else
                    ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
                ctx.restore();
            }
            if (alive && frame < 210)
                raf = requestAnimationFrame(tick);
            else
                ctx.clearRect(0, 0, W, H);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [on, canvas]);
}
export function ReleaseNote() {
    const { lang } = useT();
    const { me } = useMe();
    const [due] = useState(() => dueReleases(readSeen(), me?.created_at, new Date().toISOString().slice(0, 10), RELEASES));
    const [open, setOpen] = useState(true);
    const ref = useRef<HTMLDialogElement>(null);
    const confetti = useRef<HTMLCanvasElement>(null);
    const show = open && !!me && due.length > 0;
    useEffect(() => { const d = ref.current; if (show && d && !d.open)
        d.showModal(); }, [show]);
    useConfetti(show && due.some((r) => r.party), confetti);
    if (!show)
        return null;
    const w = WORDS[lang];
    const [top, ...older] = due;
    const close = () => { try {
        localStorage.setItem(SEEN_KEY, RELEASES[0].id);
    }
    catch { } ref.current?.close(); setOpen(false); };
    const Body = BODIES[top.id];
    const messages = linkProps("/messages");
    return (<dialog ref={ref} className="release" aria-labelledby="release-title" onClose={close} onClick={(e) => { if (e.target === ref.current)
        close(); }}>
      <canvas ref={confetti} className="release-confetti" aria-hidden="true"/>
      <div className="release-body">
        <span className="release-tag"><span aria-hidden="true">🎉</span>{w.tag}</span>
        <Body lang={lang} close={close}/>
        {older.length > 0 && (<div className="release-earlier">
            <p className="release-earlier-title">{w.earlier}</p>
            <ul>{older.map((r) => <li key={r.id} onClick={(e) => { if ((e.target as HTMLElement).closest("a"))
            close(); }}><span className="release-earlier-date num">{shortDate(r.date, lang)}</span><span>{r.row[lang]}</span></li>)}</ul>
          </div>)}
        <p className="release-report">{w.report} <a href={messages.href} onClick={(e) => { close(); messages.onClick(e); }}>{w.messages}</a> {w.reportTail} <a href={CONTACT_TG} target="_blank" rel="noopener">@tcfmonsteradmin</a></p>
        <div className="release-actions">
          <a className="btn" href="/changes" target="_blank" rel="noopener">{w.all}</a>
          <Button kind="primary" onClick={close}>{top.party ? w.ok : w.got}</Button>
        </div>
      </div>
    </dialog>);
}
const shortDate = (d: string, lang: Lang) => new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" }).format(new Date(d + "T12:00:00"));
