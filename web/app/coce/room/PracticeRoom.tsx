import { cached } from "../../api-cache.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, Icon, Sheet } from "../../../ui/ui.tsx";
import { isFresh, localDay } from "../../../../shared/exams.ts";
import type { Lang } from "../../i18n.ts";
import type { Level } from "../../../../shared/progress.ts";
import { loadLevel, type Key, type Question, type Section } from "../bank.ts";
import { useLevel, useSection } from "../store.ts";
import { Shell, Switch, type Progress } from "./Shell.tsx";
import { Player, type PlayerHandle } from "./Player.tsx";
import { Transcript } from "./Transcript.tsx";
import { Fold, Hint, MiniSeg, Panel, PanelBar } from "./Passage.tsx";
import { Options } from "./Options.tsx";
import { Feedback } from "./Feedback.tsx";
import { Picker, type PickTone } from "./Picker.tsx";
import { Rail, Strip, type RailHandle } from "./Rail.tsx";
import { useFlash, useKeys, useOnline, usePhone } from "./hooks.ts";
import { playAnswerTone } from "./sound.ts";
import { useRoomWords } from "./words.ts";
import { api, ApiError } from "../../api.ts";
import { useToast } from "../../main.tsx";
export type Help = {
    co?: {
        transcript?: boolean;
        hint?: boolean;
        english?: boolean;
        autoplay?: boolean;
        optionsEn?: boolean;
    };
    ce?: {
        hint?: boolean;
        english?: boolean;
        optionsEn?: boolean;
    };
};
export type PracticeRoomProps = {
    section: Section;
    level: Level;
    lang: Lang;
    onExit: () => void;
    settings?: Help | null;
    onSettings?: (help: Help) => void;
    start?: number | null;
};
type Local = {
    qid: string;
    chosen: Key | null;
    retrying: boolean;
};
export function PracticeRoom({ section, level, lang, onExit, settings, onSettings, start: startAt }: PracticeRoomProps) {
    const w = useRoomWords(lang);
    const store = useLevel(section, level);
    const loaded = useSection(section).levels !== null;
    const online = useOnline();
    const phone = usePhone();
    const [questions, setQuestions] = useState<Question[] | null | "failed">(null);
    const [tries, setTries] = useState(0);
    const [idx, setIdx] = useState<number | null>(null);
    const [local, setLocal] = useState<Local | null>(null);
    const [help, setHelp] = useState<Help>(() => settings ?? {});
    const [picker, setPicker] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [restartOpen, setRestartOpen] = useState(false);
    const player = useRef<PlayerHandle | null>(null);
    const rail = useRef<RailHandle>(null);
    const openedAt = useRef(Date.now());
    const saved = useFlash(store.synced);
    const say = useToast();
    const [reported, setReported] = useState<Set<string>>(() => new Set());
    const [reportOpen, setReportOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [sending, setSending] = useState(false);
    useEffect(() => {
        let alive = true;
        setQuestions(null);
        loadLevel(section, level).then((qs) => { if (alive)
            setQuestions(qs); }).catch(() => { if (alive)
            setQuestions("failed"); });
        return () => { alive = false; };
    }, [section, level, tries]);
    useEffect(() => {
        let alive = true;
        setReported(new Set());
        cached<{
            ids: string[];
        }>(`/disputes?section=${section}&level=${level}`, 24 * 3600000).then((r) => { if (alive)
            setReported(new Set(r.ids)); }).catch(() => { });
        return () => { alive = false; };
    }, [section, level]);
    const qs = questions && questions !== "failed" ? questions : null;
    useEffect(() => {
        if (!qs || !loaded || idx !== null)
            return;
        if (startAt && startAt >= 1 && startAt <= qs.length) {
            setIdx(startAt - 1);
            return;
        }
        const from = Math.max(0, (store.state.pos ?? 1) - 1);
        const grey = (i: number) => !store.state.q[qs[i].id];
        let start = -1;
        for (let k = 0; k < qs.length; k++) {
            const i = (from + k) % qs.length;
            if (grey(i)) {
                start = i;
                break;
            }
        }
        setIdx(start >= 0 ? start : Math.min(from, qs.length - 1));
    }, [qs, loaded, idx, store.state, startAt]);
    const q = qs && idx !== null ? qs[idx] : null;
    const n = (idx ?? 0) + 1;
    const total = qs?.length ?? 0;
    useEffect(() => {
        if (!q)
            return;
        setLocal({ qid: q.id, chosen: null, retrying: false });
        openedAt.current = Date.now();
        store.setPos(n);
    }, [q?.id]);
    const entry = q ? store.state.q[q.id] : undefined;
    const colour = entry?.s ?? "grey";
    const retrying = local?.qid === q?.id && local?.retrying;
    const chosen: Key | null = local?.qid === q?.id && local?.chosen ? local.chosen : retrying ? null : (entry?.a ?? null);
    const answered = chosen !== null;
    const canRetry = colour === "red" && !retrying && answered;
    const h = section === "co" ? (help.co ?? {}) : (help.ce ?? {});
    const english = !!h.english;
    const hint = !!h.hint;
    const transcript = section === "co" && !!help.co?.transcript;
    const autoplay = section === "co" && !!help.co?.autoplay;
    const setSwitch = (key: "transcript" | "hint" | "english" | "autoplay", v: boolean) => {
        const next: Help = { ...help, [section]: { ...(section === "co" ? help.co : help.ce), [key]: v } };
        setHelp(next);
        onSettings?.(next);
    };
    const pick = useCallback((key: Key) => {
        if (!q || answered)
            return;
        store.answer(q, key, (Date.now() - openedAt.current) / 1000);
        setLocal({ qid: q.id, chosen: key, retrying: false });
        playAnswerTone(key === q.answer);
    }, [q, answered, store]);
    const go = useCallback((i: number) => { if (qs && i >= 0 && i < qs.length)
        setIdx(i); }, [qs]);
    const next = useCallback(() => { if (!qs || idx === null)
        return; if (idx >= qs.length - 1)
        onExit();
    else
        go(idx + 1); }, [qs, idx, go, onExit]);
    const retry = () => { if (q)
        setLocal({ qid: q.id, chosen: null, retrying: true }); };
    const openReport = () => { setMessage(""); setReportOpen(true); };
    const sendReport = async () => {
        if (!q || !message.trim() || sending)
            return;
        setSending(true);
        try {
            await api("/disputes", { section, level, questionId: q.id, n, message: message.trim() });
            setReported((s) => new Set(s).add(q.id));
            setReportOpen(false);
            say(w.reportSent);
        }
        catch (e) {
            say(e instanceof ApiError && e.data?.error === "daily_cap" ? w.reportCap : w.reportFailed, "bad");
        }
        finally {
            setSending(false);
        }
    };
    useKeys(!!q, {
        digit: (d) => { const o = q?.options[d - 1]; if (o && !answered)
            pick(o.key); },
        enter: () => { if (answered)
            next(); },
        space: section === "co" ? () => player.current?.toggle() : undefined,
        esc: onExit,
        left: () => go((idx ?? 0) - 1),
        right: () => { if (answered)
            next(); },
    });
    const today = localDay();
    const fresh = useCallback((k: number) => isFresh(qs?.[k - 1]?.added, today), [qs, today]);
    const tone = useCallback((k: number): PickTone => { const e = qs ? store.state.q[qs[k - 1]?.id] : undefined; return e ? e.s : "grey"; }, [qs, store.state]);
    const parts = useMemo(() => {
        const c = { green: 0, amber: 0, red: 0 };
        for (const x of qs ?? []) {
            const e = store.state.q[x.id];
            if (e)
                c[e.s]++;
        }
        return c;
    }, [qs, store.state]);
    const title = useMemo(() => <span className="cr-title-text">{w[section]} · {level}</span>, [section, level, w]);
    const progress = (nn: number, tt: number): Progress => ({
        n: nn, total: tt, parts,
        onOpen: () => (phone ? setPicker(true) : rail.current?.focus()),
        label: tt ? `${w.questionOf(nn, tt)} · ${w.legend.green} ${parts.green} · ${w.legend.amber} ${parts.amber} · ${w.legend.red} ${parts.red} · ${w.legend.grey} ${tt - parts.green - parts.amber - parts.red}` : "",
        popup: phone,
    });
    if (questions === "failed") {
        return (<Shell mode="practice" section={section} lang={lang} onBack={onExit} backLabel={w.back} title={title} progress={progress(0, 0)} left={null} right={<div className="cr-band bad"><span>{w.loadFailed}</span><Button size="sm" icon="refresh" onClick={() => setTries((t) => t + 1)}>{w.retry}</Button></div>} foot={null}/>);
    }
    if (!q) {
        return (<Shell mode="practice" section={section} lang={lang} onBack={onExit} backLabel={w.back} title={title} progress={progress(0, total)} left={<div className="skeleton tall"/>} right={<div className="skeleton tall"/>} foot={null}/>);
    }
    const langSeg = <MiniSeg value={english ? "en" : "fr"} options={[["fr", "FR"], ["en", "EN"]]} onChange={(v) => setSwitch("english", v === "en")} label={w.english}/>;
    const left = section === "co" && phone ? (<>
      <PanelBar><span className="spacer"/>{langSeg}</PanelBar>
      <Player ref={player} src={q.audio ?? ""} resetKey={q.id} maxPlays={null} scrubber autoplay={autoplay} lang={lang}/>
      {q.image && <img className="cr-picture cr-picture-top" src={q.image} alt=""/>}
      <div className="cr-text cr-folds">
        <Fold title={w.transcript} open={transcript} onToggle={(v) => setSwitch("transcript", v)} disabled={!q.transcript}>
          <Transcript text={q.transcript} textEn={q.transcriptEn} words={q.words} segments={q.segments} english={english} lang={lang} player={player} optionsEn={q.options.map((o) => o.textEn)}/>
        </Fold>
        <Fold title={w.hint} open={hint} onToggle={(v) => setSwitch("hint", v)} disabled={!q.hint}>
          <Hint hint={q.hint} english={english} lang={lang}/>
        </Fold>
      </div>
    </>) : section === "co" ? (<>
      <Player ref={player} src={q.audio ?? ""} resetKey={q.id} maxPlays={null} scrubber autoplay={autoplay} lang={lang}/>
      <PanelBar>
        <Switch label={w.autoplay} on={autoplay} onChange={(v) => setSwitch("autoplay", v)}/>
        <Switch label={w.transcript} on={transcript} onChange={(v) => setSwitch("transcript", v)}/>
        <Switch label={w.shortHint} on={hint} disabled={!q.hint} onChange={(v) => setSwitch("hint", v)}/>
        {langSeg}
      </PanelBar>
      <div className="cr-text">
        {q.image && <img className="cr-picture" src={q.image} alt=""/>}
        {transcript && <Transcript text={q.transcript} textEn={q.transcriptEn} words={q.words} segments={q.segments} english={english} lang={lang} player={player} optionsEn={q.options.map((o) => o.textEn)}/>}
        {hint && <Hint hint={q.hint} english={english} lang={lang}/>}
      </div>
    </>) : (<Panel text={q.passage} textEn={q.passageEn} hint={q.hint} showHint={hint} english={english} onShowHint={(v) => setSwitch("hint", v)} onEnglish={(v) => setSwitch("english", v)} highlight={answered ? q.keySentence : null} highlightEn={answered ? q.keySentenceEn : null} lang={lang}/>);
    const right = (<>
      <div className="cr-stem">
        {isFresh(q.added, localDay()) && <span className="cr-added"><Chip tone="fresh">{w.added}</Chip></span>}
        <p><span lang="fr">{q.stem}</span>{english && q.stemEn && <span className="cr-en" lang="en">{q.stemEn}</span>}</p>
      </div>
      <Options options={q.options} chosen={chosen} answer={q.answer} reveal={answered} disabled={answered} english={english} lang={lang} onPick={pick}/>
      <Feedback q={q} chosen={chosen} shown={answered} english={english} lang={lang}/>
    </>);
    const canMark = colour === "green" || colour === "amber";
    const mark = () => store.mark(q.id, colour === "green" ? "amber" : "green");
    const foot = (<>
      <Button kind="quiet" onClick={() => go(idx! - 1)} disabled={idx === 0} className="cr-prev" aria-label={w.prev}><Icon name="chevronLeft" size={20} className="mob-only"/><span className="desk-only">{w.prev}</span></Button>
      {colour !== "grey" && <Button size="sm" onClick={() => setResetOpen(true)} className="cr-reset desk-only">{w.reset}</Button>}
      <span className="cr-foot-mid">
        <span className="cr-saved" aria-live="polite">{saved ? <><Icon name="check" size={14} className="mob-only"/>{w.saved}</> : ""}</span>
        {canMark && (<button type="button" className="cr-mark desk-only" data-tone={colour} onClick={mark}>
            <Icon name="flag" size={14}/>{colour === "green" ? w.markAmber : w.markGreen}
          </button>)}
      </span>
      {canRetry && <Button onClick={retry} className="cr-retry desk-only">{w.retry}</Button>}
      <Button kind={answered ? "primary" : "plain"} onClick={next} className="cr-main" aria-label={idx === total - 1 && answered ? w.back : w.next}>
        <span className="desk-only">{idx === total - 1 && answered ? w.back : w.next}</span><Icon name="chevronRight" size={22} className="mob-only"/>
      </Button>
    </>);
    const touched = parts.green + parts.amber + parts.red;
    const more = (<>
    {touched > 0 && <Button size="sm" kind="quiet" icon="refresh" className="cr-restart desk-only" onClick={() => setRestartOpen(true)}>{w.restart}</Button>}
    
    <Button size="sm" kind="quiet" icon={reported.has(q.id) ? "check" : "flag"} className="cr-report desk-only" title={reported.has(q.id) ? w.reported : undefined} onClick={openReport}>{w.report}</Button>
    <button type="button" className="cr-more-btn mob-only" aria-label={w.more} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><Icon name="more" size={20}/></button>
    </>);
    const moreRows: MoreRow[] = [];
    if (section === "co")
        moreRows.push({ icon: "refresh", label: w.autoplay, on: () => setSwitch("autoplay", !autoplay), toggle: autoplay });
    if (canMark)
        moreRows.push({ icon: "flag", tone: colour === "green" ? "amber" : "ok", label: colour === "green" ? w.markAmber : w.markGreen, on: mark });
    if (canRetry)
        moreRows.push({ icon: "refresh", label: w.retry, on: retry });
    if (colour !== "grey")
        moreRows.push({ icon: "x", label: w.reset, on: () => setResetOpen(true) });
    moreRows.push({ icon: "alert", tone: "bad", label: reported.has(q.id) ? `${w.report} · ${w.reported}` : w.report, on: openReport });
    if (touched > 0)
        moreRows.push({ icon: "refresh", tone: "bad", label: w.restart, on: () => setRestartOpen(true) });
    return (<Shell mode="practice" section={section} lang={lang} onBack={onExit} backLabel={w.back} title={title} progress={progress(n, total)} english={english} code={<b><Icon name={section} size={16}/>{section.toUpperCase()}</b>} mid={level} subline={total ? `${n} / ${total}` : undefined} more={more} strip={total ? <Strip current={n} total={total} tone={tone} fresh={fresh} onPick={(k) => go(k - 1)} lang={lang}/> : undefined} rail={<Rail ref={rail} current={n} total={total} tone={tone} fresh={fresh} onPick={(k) => go(k - 1)} lang={lang}/>} band={!online ? <><Icon name="wifiOff" size={16}/><span>{w.offlinePractice}</span></> : undefined} left={left} right={right} foot={foot}>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} rows={moreRows} label={w.more}/>
      <Picker open={picker} onClose={() => setPicker(false)} current={n} total={total} tone={tone} fresh={fresh} onPick={(k) => go(k - 1)} lang={lang} legend/>
      <Sheet open={resetOpen} title={w.resetTitle} onClose={() => setResetOpen(false)} actions={<><Button onClick={() => setResetOpen(false)}>{w.cancel}</Button><Button kind="danger" onClick={() => { store.reset(q.id); setLocal({ qid: q.id, chosen: null, retrying: false }); setResetOpen(false); }}>{w.reset}</Button></>}>
        <p>{w.resetBody}</p>
      </Sheet>
      <Sheet open={restartOpen} title={w.restartTitle(level)} onClose={() => setRestartOpen(false)} actions={<><Button onClick={() => setRestartOpen(false)}>{w.cancel}</Button><Button kind="danger" onClick={() => { store.resetLevel(); setLocal(null); setRestartOpen(false); }}>{w.restart}</Button></>}>
        <p>{w.restartBody(level, touched)}</p>
      </Sheet>
      <Sheet open={reportOpen} title={w.report} onClose={() => setReportOpen(false)} actions={<><Button onClick={() => setReportOpen(false)}>{w.cancel}</Button><Button kind="primary" icon="send" busy={sending} disabled={!message.trim()} onClick={sendReport}>{w.send}</Button></>}>
        <p className="muted">{w.reportRef(w[section], level, n)}</p>
        <textarea className="note" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} maxLength={2000} aria-label={w.reportMessage}/>
      </Sheet>
    </Shell>);
}
type MoreRow = {
    icon: "flag" | "refresh" | "alert" | "x" | "chat";
    tone?: string;
    label: string;
    on: () => void;
    off?: boolean;
    toggle?: boolean;
};
function MoreSheet({ open, onClose, rows, label }: {
    open: boolean;
    onClose: () => void;
    rows: MoreRow[];
    label: string;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const d = ref.current;
        if (!d)
            return;
        if (open && !d.open)
            d.showModal();
        if (!open && d.open)
            d.close();
    }, [open]);
    return (<dialog ref={ref} className="sheet cr-more" onClose={onClose} onClick={(e) => { if (e.target === ref.current)
        onClose(); }} aria-label={label}>
      <div className="cr-more-body">
        <i className="cr-more-grip" aria-hidden="true"/>
        {rows.map((r) => (<button key={r.label} type="button" className="cr-more-row" data-tone={r.tone} disabled={r.off} role={r.toggle !== undefined ? "switch" : undefined} aria-checked={r.toggle} onClick={() => { if (r.toggle === undefined)
            onClose(); r.on(); }}>
            <span className="cr-more-icon"><Icon name={r.icon} size={18}/></span>
            <b>{r.label}</b>
            {r.toggle !== undefined
                ? <i className="cr-switch-track cr-more-track" aria-hidden="true"><i className="cr-switch-knob"/></i>
                : <Icon name="chevronRight" size={18} className="cr-more-chev"/>}
          </button>))}
      </div>
    </dialog>);
}
