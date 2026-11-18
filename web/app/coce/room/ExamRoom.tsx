import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, Sheet } from "../../../ui/ui.tsx";
import type { Lang } from "../../i18n.ts";
import type { Key, Question, Section } from "../bank.ts";
import { DURATION_MIN, EXAM_QUESTIONS, placementOf, type Attempt } from "./attempt.ts";
import { Shell, type Progress } from "./Shell.tsx";
import { Player, type PlayerHandle } from "./Player.tsx";
import { Caution, Passage } from "./Passage.tsx";
import { Options } from "./Options.tsx";
import { Feedback } from "./Feedback.tsx";
import { Picker, type PickTone } from "./Picker.tsx";
import { Rail, type RailHandle } from "./Rail.tsx";
import { call, serverNow, useKeys, useOnline, usePhone } from "./hooks.ts";
import { keep } from "../../api-cache.ts";
import { useRoomWords } from "./words.ts";
import type { MockHooks } from "../../mock/shell.tsx";
export type ExamRoomProps = {
    fresh?: boolean;
    section: Section;
    exam: number;
    attempt: Attempt;
    questions: Question[];
    lang: Lang;
    onFinished: (attempt: Attempt) => void;
    onLeave: () => void;
    mock?: MockHooks;
};
const RETRY_MS = 10000;
const SEND_AFTER_MS = 20000;
const SECONDS_A_QUESTION = (DURATION_MIN.co * 60) / EXAM_QUESTIONS;
const MIN_AFTER_RECORDING_S = 6;
type Phase = "run" | "frozen" | "finishing" | "failed";
export function ExamRoom({ section, exam, attempt, questions, lang, onFinished, onLeave, mock, fresh }: ExamRoomProps) {
    const w = useRoomWords(lang);
    const online = useOnline();
    const phone = usePhone();
    const total = questions.length;
    const mockStage = mock ? mock.stage as "co" | "ce" : null;
    const localKey = `tcfm-exam-${attempt.id}`;
    const [answers, setAnswers] = useState<Record<string, string>>(() => {
        if (mock && mockStage)
            return { ...mock.store.answers(mockStage) };
        let kept: Record<string, string> = {};
        try {
            const v = JSON.parse(localStorage.getItem(localKey) ?? "null");
            if (v && typeof v === "object" && !Array.isArray(v))
                kept = v;
        }
        catch { }
        return { ...(attempt.answers ?? {}), ...kept };
    });
    const [idx, setIdx] = useState(() => {
        const i = questions.findIndex((q) => !answers[placementOf(q)]);
        const first = i < 0 ? Math.max(0, total - 1) : i;
        const kept = mock && mockStage ? mock.store.state.cursor[mockStage] : null;
        if (kept != null && kept >= 0 && kept < total)
            return section === "co" && attempt.mode !== "training" ? Math.max(kept, first) : kept;
        return first;
    });
    const heardBefore = useRef(mock && mockStage ? mock.store.state.heard[mockStage] : null);
    const [phase, setPhase] = useState<Phase>("run");
    const [left, setLeft] = useState(() => (mock ? (mock.endsAt == null ? DURATION_MIN[section] * 60 : (mock.endsAt - serverNow()) / 1000) : (Date.parse(attempt.deadlineAt) - serverNow()) / 1000));
    const [picker, setPicker] = useState(false);
    const [sheet, setSheet] = useState<"finish" | "leave" | null>(null);
    const [grace, setGrace] = useState<number | null>(null);
    const [heardId, setHeardId] = useState<string | null>(heardBefore.current);
    const [netDown, setNetDown] = useState(false);
    const player = useRef<PlayerHandle | null>(null);
    const rail = useRef<RailHandle>(null);
    const answersRef = useRef(answers);
    answersRef.current = answers;
    const dirty = useRef(false);
    const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const phaseRef = useRef(phase);
    phaseRef.current = phase;
    const pending = !!mock && mock.endsAt == null;
    const deadline = mock ? (mock.endsAt ?? Date.now() + DURATION_MIN[section] * 60000) : Date.parse(attempt.deadlineAt);
    const q = questions[idx];
    const n = idx + 1;
    const co = section === "co";
    const training = attempt.mode === "training";
    const strictOrder = co && !training;
    const strict = co && !training;
    const heard = !strict || heardId === q?.id;
    useEffect(() => {
        if (mock || fresh)
            return;
        let alive = true;
        call<{
            attempt?: Attempt;
        }>(`/attempts/${attempt.id}`).then(({ status, data }) => {
            if (!alive || status !== 200 || !data.attempt?.answers)
                return;
            setAnswers((a) => ({ ...data.attempt!.answers, ...a }));
            if (data.attempt.ended) {
                forget();
                onFinished(data.attempt);
            }
            else if (Object.entries(answersRef.current).some(([k, v]) => data.attempt!.answers?.[k] !== v))
                schedulePatch();
        }).catch(() => { });
        return () => { alive = false; };
    }, [attempt.id]);
    useEffect(() => {
        if (mock)
            return;
        try {
            if (Object.keys(answers).length)
                localStorage.setItem(localKey, JSON.stringify(answers));
        }
        catch { }
    }, [answers, localKey, mock]);
    const forget = useCallback(() => { if (mock)
        return; try {
        localStorage.removeItem(localKey);
    }
    catch { } }, [localKey, mock]);
    useEffect(() => { if (!mock)
        return; setNetDown(mock.store.isNetDown); return mock.store.subscribe(setNetDown); }, [mock]);
    useEffect(() => { if (mock && mockStage)
        mock.store.setCursor(mockStage, idx); }, [mock, mockStage, idx]);
    useEffect(() => { if (mock && mockStage && q && heardBefore.current === q.id)
        setGrace(Date.now() + MIN_AFTER_RECORDING_S * 1000); }, [mock, mockStage, q]);
    useEffect(() => {
        if (pending) {
            setLeft(DURATION_MIN[section] * 60);
            return;
        }
        const id = setInterval(() => setLeft((deadline - serverNow()) / 1000), 250);
        return () => clearInterval(id);
    }, [deadline, pending, section]);
    useEffect(() => { mock?.onReady(); }, [mock]);
    const unsent = useRef(0);
    const sendPatch = useCallback(async (keepalive = false) => {
        if (mock) {
            await mock.store.send(keepalive);
            return;
        }
        if (patchTimer.current) {
            clearTimeout(patchTimer.current);
            patchTimer.current = null;
        }
        if (!dirty.current)
            return;
        dirty.current = false;
        unsent.current = 0;
        try {
            const { status } = await call(`/attempts/${attempt.id}`, { method: "PATCH", keepalive, json: { answers: answersRef.current, at: new Date(serverNow()).toISOString() } });
            if (status >= 500 || status === 0 || status === 401)
                throw new Error(String(status));
            setNetDown(false);
        }
        catch {
            dirty.current = true;
            setNetDown(true);
            patchTimer.current = setTimeout(() => void sendPatch(), RETRY_MS);
        }
    }, [attempt.id, mock]);
    const schedulePatch = useCallback(() => {
        if (mock)
            return;
        dirty.current = true;
        unsent.current++;
        if (patchTimer.current)
            clearTimeout(patchTimer.current);
        patchTimer.current = setTimeout(() => void sendPatch(), SEND_AFTER_MS);
    }, [sendPatch, mock]);
    useEffect(() => {
        const hide = () => { if (document.visibilityState === "hidden")
            void sendPatch(true); };
        const unload = (e: BeforeUnloadEvent) => { if (phaseRef.current === "run")
            e.preventDefault(); };
        const gone = () => void sendPatch(true);
        const back = () => void sendPatch();
        document.addEventListener("visibilitychange", hide);
        window.addEventListener("pagehide", gone);
        window.addEventListener("beforeunload", unload);
        window.addEventListener("online", back);
        return () => {
            document.removeEventListener("visibilitychange", hide);
            window.removeEventListener("pagehide", gone);
            window.removeEventListener("beforeunload", unload);
            window.removeEventListener("online", back);
            void sendPatch(true);
        };
    }, [sendPatch]);
    const setAnswer = useCallback((key: Key | "-") => {
        if (!q || phase !== "run" || pending)
            return;
        if (training && /^[ABCD]$/.test(answersRef.current[placementOf(q)] ?? ""))
            return;
        setAnswers((a) => ({ ...a, [placementOf(q)]: key }));
        if (mock && mockStage)
            mock.store.setAnswer(mockStage, placementOf(q), key);
        schedulePatch();
    }, [q, phase, schedulePatch, mock, mockStage, pending, training]);
    const go = useCallback((i: number) => { if (i >= 0 && i < total) {
        setGrace(null);
        setIdx(i);
    } }, [total]);
    const next = useCallback(() => { if (!heard)
        return; if (idx >= total - 1)
        setSheet("finish");
    else
        go(idx + 1); }, [heard, idx, total, go]);
    useEffect(() => {
        if (grace === null)
            return;
        const id = setTimeout(() => { setGrace(null); if (phaseRef.current === "run")
            next(); }, Math.max(0, grace - Date.now()));
        return () => clearTimeout(id);
    }, [grace, next]);
    const onAudioError = useCallback(() => {
        if (!q || !strict)
            return;
        setAnswer("-");
        setHeardId(q.id);
        setGrace(Date.now() + 1200);
    }, [q, setAnswer, strict]);
    const onRecordingEnded = useCallback(() => {
        if (!q)
            return;
        const d = player.current?.audio?.duration;
        const allowed = Math.max(MIN_AFTER_RECORDING_S, SECONDS_A_QUESTION - (Number.isFinite(d) ? (d as number) : 0));
        setHeardId(q.id);
        if (mock && mockStage)
            mock.store.setHeard(mockStage, q.id);
        setGrace(Date.now() + Math.round(allowed * 1000));
    }, [q, mock, mockStage]);
    const lastEnded = useRef<"done" | "abandon">("done");
    const finish = useCallback(async (ended: "done" | "abandon") => {
        lastEnded.current = ended;
        setSheet(null);
        setPhase("finishing");
        if (mock) {
            for (let i = 0; i < 5; i++) {
                await sendPatch();
                if (!mock.store.unsent)
                    break;
                await new Promise((r) => setTimeout(r, 2000));
            }
            mock.onStageEnd(ended);
            return;
        }
        if (patchTimer.current) {
            clearTimeout(patchTimer.current);
            patchTimer.current = null;
        }
        const answers = dirty.current ? answersRef.current : undefined;
        dirty.current = false;
        unsent.current = 0;
        try {
            const { status, data } = await call<{
                attempt?: Attempt;
            }>(`/attempts/${attempt.id}/finish`, { json: { ended, answers, at: new Date(serverNow()).toISOString() } });
            if (status < 300 && data.attempt) {
                forget();
                keep(`/attempts/${attempt.id}`, { attempt: data.attempt });
                onFinished(data.attempt);
                return;
            }
            if (status === 409 || status === 404) {
                const r = await call<{
                    attempt?: Attempt;
                }>(`/attempts/${attempt.id}`);
                if (r.data.attempt?.ended) {
                    forget();
                    onFinished(r.data.attempt);
                    return;
                }
            }
            if (answers)
                dirty.current = true;
            setPhase("failed");
        }
        catch {
            if (answers)
                dirty.current = true;
            setPhase("failed");
        }
    }, [attempt.id, onFinished, sendPatch, forget, mock]);
    useEffect(() => {
        if (phase !== "run" || left > 0)
            return;
        setSheet(null);
        setPhase("frozen");
        player.current?.pause();
    }, [left, phase]);
    useEffect(() => {
        if (phase !== "frozen")
            return;
        const id = setTimeout(() => void finish("done"), 1000);
        return () => clearTimeout(id);
    }, [phase, finish]);
    const leave = async () => { setSheet(null); await sendPatch(true); onLeave(); };
    const armed = useRef(false);
    useEffect(() => {
        const arm = () => { history.pushState({ examGuard: true }, "", location.href); armed.current = true; };
        arm();
        const onPop = () => {
            if (!armed.current)
                return;
            armed.current = false;
            if (phaseRef.current === "run") {
                arm();
                setSheet("leave");
            }
        };
        window.addEventListener("popstate", onPop);
        return () => { window.removeEventListener("popstate", onPop); armed.current = false; };
    }, []);
    useKeys(phase === "run" && !!q, {
        digit: (d) => { const o = q?.options[d - 1]; if (o)
            setAnswer(o.key); },
        enter: next,
        esc: () => setSheet("leave"),
        space: co ? (strict ? () => player.current?.play() : () => player.current?.toggle()) : undefined,
        left: strictOrder ? undefined : () => go(idx - 1),
        right: strictOrder ? undefined : () => go(idx + 1),
    });
    const unanswered = useMemo(() => questions.map((x, i) => (answers[placementOf(x)] ? null : i + 1)).filter((v): v is number => v !== null), [questions, answers]);
    const tone = useCallback((k: number): PickTone => {
        const x = questions[k - 1], a = answers[placementOf(x)];
        if (!a)
            return "todo";
        if (!training || a === "-")
            return "done";
        return a === x.answer ? "green" : "red";
    }, [answers, questions, training]);
    const title = useMemo(() => <span className="cr-title-text">{w[section]}{training ? ` · ${w.training}` : ""}</span>, [section, training, w]);
    const done = total - unanswered.length;
    if (!q)
        return null;
    const given = answers[placementOf(q)];
    const chosen: Key | null = given === "A" || given === "B" || given === "C" || given === "D" ? given : null;
    const band = !online || netDown ? <><Icon name="wifiOff" size={16}/><span>{w.offlineExam}</span></>
        : phase === "failed" ? <><span>{w.finishFailed}</span><Button size="sm" icon="refresh" onClick={() => void finish(lastEnded.current)}>{w.retry}</Button></> : undefined;
    const leftCol = co ? (<>
      <Player ref={player} src={q.audio ?? ""} resetKey={`${attempt.id}/${q.id}/${pending ? "wait" : "live"}`} maxPlays={strict ? (heardBefore.current === q.id ? 0 : 1) : null} scrubber={!strict} autoplay={!pending && !(strict && heardBefore.current === q.id)} locked={strict} lang={lang} onEnded={strict ? onRecordingEnded : undefined} onError={onAudioError}/>
      <Caution caution={q.caution} lang={lang}/>
      {strict && <div className="cr-grace" aria-hidden="true">{grace !== null && <i key={grace} style={{ animationDuration: `${Math.max(0, grace - Date.now())}ms` }}/>}</div>}
      <div className="cr-text">{q.image && <img className="cr-picture" src={q.image} alt=""/>}</div>
    </>) : (<div className="cr-text"><Passage text={q.passage} textEn={null} english={false}/></div>);
    const right = (<>
      <div className="cr-stem"><p lang="fr">{q.stem}</p></div>
      <Options options={q.options} chosen={chosen} answer={q.answer} reveal={training && !!chosen} disabled={phase !== "run" || (strict && given === "-") || (training && !!chosen)} english={false} lang={lang} onPick={setAnswer}/>
      {training && <Feedback q={q} chosen={chosen} shown={!!chosen} english={false} lang={lang}/>}
    </>);
    const progress: Progress = { n, total, parts: { done }, onOpen: () => (phone ? setPicker(true) : rail.current?.focus()), label: `${w.questionOf(n, total)} · ${w.done} ${done} · ${w.todo} ${total - done}`, popup: phone };
    const last = idx === total - 1;
    const foot = (<>
      <Button kind="quiet" onClick={() => setSheet("finish")} disabled={phase !== "run" || (strict && !(last && heard)) || pending} busy={phase === "finishing"} className="room-finish" aria-label={w.finish}><Icon name="stop" size={18} className="mob-only icon-fill"/><span className="desk-only">{w.finish}</span></Button>
      <span className="cr-foot-mid"/>
      {!strictOrder && <Button kind="quiet" onClick={() => go(idx - 1)} disabled={idx === 0} className="cr-prev" aria-label={w.prev}><Icon name="chevronLeft" size={20} className="mob-only"/><span className="desk-only">{w.prev}</span></Button>}
      <Button className="cr-grid mob-only num" aria-haspopup="dialog" onClick={() => setPicker(true)} aria-label={progress.label}><Icon name="grid" size={16}/>{n} / {total}</Button>
      <Button kind="primary" onClick={next} className="cr-main" disabled={phase !== "run" || !heard || last || pending}>{w.next}<Icon name="chevronRight" size={20} className="mob-only"/></Button>
    </>);
    const whole = unanswered.length === 0;
    return (<div data-frozen={phase === "frozen" || undefined} className="cr-exam-wrap">
      <Shell mode="exam" section={section} title={title} sub={mock?.sub} lang={lang} code={<b><Icon name={section} size={16}/>{section.toUpperCase()}</b>} mid={w.examNo(exam)} progress={progress} rail={<Rail ref={rail} current={n} total={total} tone={tone} onPick={strictOrder ? undefined : (k) => go(k - 1)} lang={lang}/>} clock={{ secondsLeft: left, idle: pending, label: left > 0 ? w.timeLeft : w.timeUp }} band={band} left={leftCol} right={right} foot={foot}>
        <Picker open={picker} onClose={() => setPicker(false)} current={n} total={total} tone={tone} onPick={strictOrder ? undefined : (k) => go(k - 1)} lang={lang}/>
        
        <Sheet open={sheet === "finish"} title={w.finishTitle} onClose={() => setSheet(null)} className="cr-finish" actions={<><Button onClick={() => setSheet(null)}>{w.continueExam}</Button>{whole ? <Button kind="primary" onClick={() => void finish("done")}>{w.finish}</Button> : <Button kind="danger" onClick={() => void finish("abandon")}>{w.abandonTest}</Button>}</>}>
          <ul className="cr-cells" aria-label={progress.label}>
            {questions.map((x, i) => <li key={x.id} className="cr-disc" data-tone={tone(i + 1)} aria-current={i === idx ? "true" : undefined}>{i + 1}</li>)}
          </ul>
          <p>{whole ? w.finishAll : <>{w.unanswered(unanswered.length)} {w.unansweredWrong}</>}</p>
        </Sheet>
        <Sheet open={sheet === "leave"} title={w.leaveTitle} onClose={() => setSheet(null)} actions={<><Button onClick={() => setSheet(null)}>{w.stay}</Button><Button kind="primary" onClick={() => void leave()}>{w.leave}</Button></>}>
          <p>{w.leaveBody}</p>
        </Sheet>
      </Shell>
    </div>);
}
