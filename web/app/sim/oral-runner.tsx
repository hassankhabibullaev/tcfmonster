import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Icon, TacheTag } from "../../ui/ui";
import { SPEAKING, BLINK_S, WARN_S, canAsk, introCut, questionDeservesAnswer, safeJson, timeIsUp, type Clock, type MicMode, type SessionSummary, type StartedSession, type TaskNo, type Timing, type Turn } from "./types";
import { useRecorder, type StopResult } from "./use-recorder";
import { Station, useLeaveGuard } from "./station";
import { SessionResults, type TaskView } from "./session-results";
import { Interviewer, type Mood } from "./interviewer";
import { LiveExaminer } from "./live-examiner";
import { OutputLevel } from "./output-level";
import { finishTask } from "./analysis";
import { BusyOverlay } from "./busy-overlay";
import { LISTENING_TIMEOUT_MS, explainFailure, type Failure } from "./scoring-error";
import { keepClip, newClipId } from "./clips";
import { applyLog, loadSession, type LogItem } from "./work";
import { askedHere } from "./browser-score";
import { StopDialog } from "./stop-dialog";
import { Hallway } from "./hallway";
import { Trouble } from "./trouble";
import { useSimWords } from "./words";
import type { Lang } from "../i18n";
import type { MockHooks } from "../mock/shell.tsx";
type Line = {
    text: string;
};
type Closing = {
    done: Line;
    cut: Line[];
    lateQuestion: Line | null;
    farewell: Line | null;
};
type Plan = {
    taskNo: TaskNo;
    intro: Line[];
    subject: string[];
    opening: Line;
    relance: Line;
    stop: Line;
    closing?: Closing;
    timing: Timing;
};
type Phase = "preparing" | "intro" | "prep" | "connecting" | "listening" | "examiner" | "reconnecting" | "stopping" | "done" | "idle";
const PREP_FRESH_S = 20;
type Pending = Record<number, {
    durationS: number;
    failed?: boolean;
}>;
type Progress = {
    results: Record<number, TaskView>;
    summary: SessionSummary | null;
    pending?: Pending | null;
};
const safeTurns = (json: string) => safeJson<Turn[]>(json, []).map((u) => ({ role: u.role, text: u.text, clipId: u.clipId }));
function MicGlyph({ off = false }: {
    off?: boolean;
}) {
    return (<svg viewBox="0 0 24 24" className="icon mic-glyph" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3"/>
      <path d="M5 10a7 7 0 0 0 14 0"/>
      <path d="M12 17v4M8 21h8"/>
      {off && <path d="M3 3l18 18"/>}
    </svg>);
}
export type OralRunnerProps = {
    session: StartedSession;
    startedAtMs: number;
    kind: "practice" | "exam";
    micMode: MicMode;
    lang: Lang;
    onExit: () => void;
    mock?: MockHooks;
};
export function OralRunner({ session: s, startedAtMs, kind, micMode, lang, onExit, mock }: OralRunnerProps) {
    const w = useSimWords(lang);
    const pKey = `tcfm-progress-${s.sessionId}`;
    const [hall, setHall] = useState(kind === "exam" && !mock);
    useEffect(() => { mock?.onReady(); }, [mock]);
    const [idx, setIdx] = useState(0);
    const [phase, setPhase] = useState<Phase>("preparing");
    const [left, setLeft] = useState(0);
    const [speaking, setSpeaking] = useState(false);
    const [caption, setCaption] = useState<string | null>(null);
    const [results, setResults] = useState<Record<number, TaskView>>({});
    const [summary, setSummary] = useState<SessionSummary | null>(null);
    const [notes, setNotes] = useState("");
    const [micError, setMicError] = useState<string | null>(null);
    const [started, setStarted] = useState(false);
    const [trouble, setTrouble] = useState<{
        message: string;
        final: boolean;
        retryAt: number | null;
        retry: () => void;
        quit: () => void;
        link?: {
            label: string;
            href: string;
        };
    } | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const troubleRef = useRef<{
        attempts: number;
        timer: ReturnType<typeof setTimeout> | null;
    }>({ attempts: 0, timer: null });
    const [asking, setAsking] = useState<number | null>(null);
    const [leaving, setLeaving] = useState(false);
    const [pondering, setPondering] = useState(false);
    const [mood, setMood] = useState<Mood>("neutral");
    const [pending, setPending] = useState<Pending>({});
    const [failures, setFailures] = useState<Record<number, Failure>>({});
    const [drafts, setDrafts] = useState<Record<number, TaskView>>({});
    const [pressing, setPressing] = useState(false);
    const [rtRecording, setRtRecording] = useState(false);
    const [questionOpen, setQuestionOpen] = useState(false);
    const [sitOpen, setSitOpen] = useState(false);
    const pendingRef = useRef(pending);
    pendingRef.current = pending;
    const resultsRef = useRef(results);
    resultsRef.current = results;
    const voice = useRef<OutputLevel | null>(null);
    const moodTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const setMoodFor = (m: Mood, ms?: number) => {
        if (moodTimer.current)
            clearTimeout(moodTimer.current);
        moodTimer.current = null;
        setMood(m);
        if (ms)
            moodTimer.current = setTimeout(() => setMood("neutral"), ms);
    };
    const R = useRef({
        taskIdx: 0,
        plan: null as Plan | null,
        phase: "idle" as Phase,
        clockStart: 0,
        frozenMs: 0,
        frozenStart: 0,
        prepEnd: 0,
        segStart: 0,
        segCount: 0,
        seq: 0,
        pending: [] as Promise<unknown>[],
        uploads: new Map<number, Promise<unknown>>(),
        clipIds: new Map<number, string>(),
        lastUploadP: null as Promise<unknown> | null,
        stopRequested: false,
        stopRequestedByUser: false,
        closing: false,
        introDone: false,
        asked: 0,
        questionEndAt: 0,
        turnStartAt: 0,
        lastSpeechAt: 0,
        spoke: false,
        busy: false,
        busySince: 0,
        speechEndAt: 0,
        latencyMs: null as number | null,
        lastExaminerLine: "",
        lastCandidateText: "",
        replaceNextLog: null as string | null,
        openingScript: "",
        openingSpoken: true,
        recOn: false,
        micMode,
        rt: null as LiveExaminer | null,
        rtP: null as Promise<LiveExaminer | null> | null,
        prepFresh: false,
        prepOld: null as LiveExaminer | null,
        rtFail: null as string | null,
        nextTaskIdx: -1,
        nextPlanP: null as Promise<Plan> | null,
        rtNextP: null as Promise<LiveExaminer | null> | null,
    });
    const done = s.tasks.every((t) => results[t.taskNo] || pending[t.taskNo]) && (phase === "done" || phase === "idle" || !!summary);
    useLeaveGuard(started && !done);
    const TROUBLE_WAITS = [4, 8, 12];
    function clearTrouble(reset = true) {
        const t = troubleRef.current;
        if (t.timer)
            clearTimeout(t.timer);
        t.timer = null;
        if (reset)
            t.attempts = 0;
        setTrouble(null);
    }
    function raiseTrouble(message: string, retry: () => void, quit: () => void, opts: {
        link?: {
            label: string;
            href: string;
        };
        auto?: boolean;
    } = {}) {
        const t = troubleRef.current;
        if (t.timer)
            clearTimeout(t.timer);
        t.timer = null;
        const auto = opts.auto !== false && t.attempts < TROUBLE_WAITS.length;
        if (!auto && opts.auto !== false) {
            setTrouble({ message, final: true, retryAt: null, retry, quit, link: opts.link });
            return;
        }
        const wait = auto ? TROUBLE_WAITS[t.attempts] : null;
        setTrouble({ message, final: false, retryAt: wait ? Date.now() + wait * 1000 : null, retry, quit, link: opts.link });
        if (wait)
            t.timer = setTimeout(() => { t.attempts += 1; t.timer = null; retry(); }, wait * 1000);
    }
    useEffect(() => {
        if (!trouble?.retryAt)
            return;
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [trouble?.retryAt]);
    useEffect(() => () => { if (troubleRef.current.timer)
        clearTimeout(troubleRef.current.timer); }, []);
    useEffect(() => {
        R.current.micMode = micMode;
        R.current.rt?.setMode(micMode);
    }, [micMode]);
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        try {
            const p = JSON.parse(localStorage.getItem(pKey) ?? "null") as Progress | null;
            const res: Record<number, TaskView> = { ...(p?.results ?? {}) };
            for (const task of s.tasks) {
                const st = task.stored;
                if (st && st.status === "done" && st.score20 != null && !res[task.taskNo]) {
                    const turns = safeTurns(st.turnsJson);
                    res[task.taskNo] = { taskNo: task.taskNo, sessionId: s.sessionId, prompt: task.prompt, turns, score20: st.score20, level: st.level, nclc: st.nclc, feedbackJson: st.feedbackJson, detailJson: st.detailJson, elsewhere: st.elsewhere };
                }
            }
            setResults(res);
            if (p) {
                setSummary(p.summary ?? null);
                setPending(Object.fromEntries(Object.entries(p.pending ?? {}).filter(([k]) => !res[Number(k)]).map(([k, v]) => [k, { ...v, failed: true }])));
            }
        }
        catch { }
        setHydrated(true);
    }, [pKey]);
    useEffect(() => {
        if (!hydrated)
            return;
        try {
            localStorage.setItem(pKey, JSON.stringify({ results, summary, pending } satisfies Progress));
        }
        catch { }
    }, [results, summary, pending, pKey, hydrated]);
    const elapsed = () => {
        const st = R.current;
        if (!st.clockStart)
            return 0;
        const now = Date.now();
        return (now - st.clockStart - st.frozenMs - (st.frozenStart ? now - st.frozenStart : 0)) / 1000;
    };
    const freeze = () => {
        if (!R.current.frozenStart)
            R.current.frozenStart = Date.now();
    };
    const unfreeze = () => {
        const st = R.current;
        if (st.frozenStart)
            st.frozenMs += Date.now() - st.frozenStart;
        st.frozenStart = 0;
    };
    const setPhaseBoth = (p: Phase) => {
        R.current.phase = p;
        setPhase(p);
    };
    const curTaskNo = () => s.tasks[R.current.taskIdx].taskNo;
    const phaseNow = () => R.current.phase as Phase;
    const clock = (): Clock => ({ elapsed: elapsed(), introDone: R.current.introDone, asked: R.current.asked, questionEndAt: R.current.questionEndAt, turnStartAt: R.current.turnStartAt });
    const rec = useRecorder({
        onLevel: (rms) => {
            if (rms > 0.015)
                R.current.lastSpeechAt = Date.now();
        },
    });
    const [lvlHist, setLvlHist] = useState<number[]>([0, 0, 0, 0, 0]);
    const lvlAt = useRef(0);
    useEffect(() => {
        if (phase !== "listening") {
            setLvlHist((h) => (h.some((v) => v > 0) ? [0, 0, 0, 0, 0] : h));
            return;
        }
        const now = performance.now();
        if (now - lvlAt.current < 60)
            return;
        lvlAt.current = now;
        const v = Math.min(1, Math.max(0, (rec.level - 0.006) * 7));
        setLvlHist((h) => [v, h[0], h[1], h[2], h[3]]);
    }, [rec.level, phase]);
    const post = (path: string, body: unknown) => fetch(`/api/expr${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const logQueue = useRef<LogItem[]>([]);
    const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushLog = useCallback((): Promise<void> => {
        if (logTimer.current) {
            clearTimeout(logTimer.current);
            logTimer.current = null;
        }
        const items = logQueue.current.splice(0);
        if (!items.length)
            return Promise.resolve();
        return applyLog(s.sessionId, items).catch(() => { logQueue.current.unshift(...items); });
    }, [s.sessionId]);
    const logLater = (item: LogItem) => {
        logQueue.current.push(item);
        if (!logTimer.current)
            logTimer.current = setTimeout(() => void flushLog(), 5000);
    };
    useEffect(() => {
        const away = () => { if (document.visibilityState === "hidden")
            void flushLog(); };
        const gone = () => void flushLog();
        document.addEventListener("visibilitychange", away);
        window.addEventListener("pagehide", gone);
        return () => { document.removeEventListener("visibilitychange", away); window.removeEventListener("pagehide", gone); void flushLog(); };
    }, [flushLog]);
    async function fetchPlan(taskNo: TaskNo): Promise<Plan> {
        const r = await post("/oral/prepare", { sessionId: s.sessionId, taskNo, asked: askedHere() });
        const plan = (await r.json()) as Plan & {
            error?: string;
        };
        if (!r.ok)
            throw new Error(plan.error ?? "préparation impossible");
        return plan;
    }
    async function say(line: Line | null, log = false) {
        if (!line)
            return;
        const st = R.current;
        if (log)
            logLine(line.text);
        const rt = st.rt && !st.rt.isClosed ? st.rt : st.rtP ? await Promise.race([st.rtP, new Promise<null>((r) => setTimeout(() => r(null), 3000))]) : null;
        if (rt && !rt.isClosed && !st.stopRequested) {
            st.rt = rt;
            (voice.current ??= new OutputLevel()).attachStream(rt.stream);
            await rt.say(line.text);
        }
        else {
            setCaption(line.text);
            await new Promise((r) => setTimeout(r, Math.min(6000, 1200 + line.text.length * 55)));
            setCaption(null);
        }
    }
    useEffect(() => {
        const id = setInterval(() => {
            const st = R.current;
            const p = st.phase;
            if (p === "prep") {
                const l = Math.max(0, (st.prepEnd - Date.now()) / 1000);
                setLeft(l);
                if (!st.prepFresh && st.plan && l <= Math.min(PREP_FRESH_S, st.plan.timing.prepS / 2)) {
                    st.prepFresh = true;
                    st.prepOld = st.rt;
                    st.rtP = rtConnect();
                }
                if (l <= 0)
                    void beginLive();
                return;
            }
            if (p !== "listening" && p !== "examiner" && p !== "stopping")
                return;
            if (st.frozenStart)
                return;
            const t = st.plan?.timing;
            if (!t)
                return;
            const e = elapsed();
            setLeft(t.speakS - e);
            if (st.taskIdx < s.tasks.length - 1 && st.nextTaskIdx < 0 && t.speakS - e <= 25) {
                const ni = st.taskIdx + 1;
                st.nextTaskIdx = ni;
                st.nextPlanP = fetchPlan(s.tasks[ni].taskNo);
                st.nextPlanP.catch(() => null);
                st.rtNextP = rtConnect({}, s.tasks[ni].taskNo);
            }
            if (!st.stopRequested) {
                const mid = p === "listening" && st.spoke && !st.busy;
                const idle = p === "listening" && !st.spoke && !st.busy;
                if ((mid || idle || e >= t.speakS + t.overrunS) && timeIsUp(t, { ...clock(), midAnswer: mid, idle })) {
                    st.stopRequested = true;
                    void hardStop(mid ? "cut" : "close");
                    return;
                }
            }
            if (!st.rt)
                return;
            const segS = (Date.now() - st.segStart) / 1000;
            const silenceS = (Date.now() - st.lastSpeechAt) / 1000;
            if (st.busy && !st.rt.talking && Date.now() - st.busySince > 12000) {
                if (st.rt.unanswered(12000))
                    st.rt.drop("no answer from Google");
                else
                    void rtListen();
            }
            else if (p === "listening" && !st.busy && !st.spoke && segS >= t.idleRelanceS + 2)
                void rtRelance();
            else if (st.plan!.taskNo === 1 && p === "listening" && !st.introDone && st.spoke && introCut(t, segS, silenceS))
                st.rt.setMic(false);
            else if (st.plan!.taskNo === 3 && p === "listening" && !st.introDone && st.spoke && t.firstInterjectS != null && e >= t.firstInterjectS)
                st.rt.setMic(false);
        }, 200);
        return () => clearInterval(id);
    }, []);
    useEffect(() => () => {
        const st = R.current;
        st.rt?.close();
        void st.rtP?.then((x) => x?.close());
        voice.current?.close();
    }, []);
    useEffect(() => {
        if (hall || started || !hydrated)
            return;
        setStarted(true);
        void (async () => {
            try {
                const left: Record<number, {
                    durationS: number;
                }> = { ...pendingRef.current };
                const done: Record<number, TaskView> = { ...resultsRef.current };
                try {
                    const d = await loadSession(s.sessionId);
                    for (const t of d.tasks ?? []) {
                        if (done[t.taskNo] || left[t.taskNo])
                            continue;
                        if (t.status === "done" && t.score20 != null) {
                            const task = s.tasks.find((x) => x.taskNo === t.taskNo);
                            if (task)
                                done[t.taskNo] = { taskNo: t.taskNo, sessionId: s.sessionId, prompt: task.prompt, turns: safeTurns(t.turnsJson ?? "[]"), score20: t.score20, level: t.level, nclc: t.nclc, feedbackJson: t.feedbackJson ?? null, detailJson: t.detailJson ?? null, elsewhere: t.elsewhere };
                        }
                        else if (t.status === "grading" || /"role":"candidate"/.test(t.turnsJson ?? ""))
                            left[t.taskNo] = { durationS: t.durationS ?? SPEAKING.tasks[t.taskNo as TaskNo].speakSeconds };
                    }
                }
                catch { }
                if (Object.keys(done).length !== Object.keys(resultsRef.current).length)
                    setResults(done);
                for (const [k, v] of Object.entries(left))
                    void finishAndScore(Number(k) as TaskNo, v.durationS);
                const next = s.tasks.findIndex((t) => !done[t.taskNo] && !left[t.taskNo]);
                if (next < 0) {
                    setPhaseBoth("done");
                    return;
                }
                await startFrom(next);
            }
            catch {
                setPhaseBoth("idle");
                raiseTrouble(w.troublePrep, () => void startFrom(R.current.taskIdx), () => void abandon());
            }
        })();
    }, [hall, hydrated]);
    async function startFrom(first: number) {
        R.current.taskIdx = first;
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setMicError(w.noRecorder);
            setPhaseBoth("idle");
            return;
        }
        const planP = fetchPlan(s.tasks[first].taskNo);
        void planP.catch(() => null);
        const rtP = rtConnect({}, s.tasks[first].taskNo);
        try {
            await rec.start();
            await rec.stop();
        }
        catch {
            setMicError(w.micMissing);
            setPhaseBoth("idle");
            void rtP.then((x) => x?.close());
            return;
        }
        await runTask(first, planP, rtP);
    }
    async function runTask(i: number, planP?: Promise<Plan>, rtP?: Promise<LiveExaminer | null>, openingP?: Promise<void>) {
        const t = s.tasks[i];
        const st = R.current;
        const prepared = st.nextTaskIdx === i;
        const preparedPlan = prepared ? st.nextPlanP : null;
        const preparedRt = prepared ? st.rtNextP : rtP ?? null;
        Object.assign(st, { taskIdx: i, seq: 0, segCount: 0, pending: [], stopRequested: false, stopRequestedByUser: false, introDone: false, asked: 0, questionEndAt: 0, turnStartAt: 0, closing: false, lastUploadP: null, nextTaskIdx: -1, nextPlanP: null, rtNextP: null, clockStart: 0, frozenMs: 0, frozenStart: 0, lastCandidateText: "", lastExaminerLine: "" });
        setIdx(i);
        setNotes("");
        setQuestionOpen(false);
        const interP = Promise.resolve();
        setPhaseBoth(prepared || i > 0 ? "intro" : "preparing");
        let plan: Plan;
        try {
            plan = await (preparedPlan ?? planP ?? fetchPlan(t.taskNo));
        }
        catch {
            await interP;
            setPhaseBoth("idle");
            raiseTrouble(w.troublePrep, () => void runTask(i), () => void abandon());
            return;
        }
        st.plan = plan;
        st.rt = null;
        st.rtFail = null;
        st.rtP = preparedRt ?? rtConnect({}, t.taskNo);
        if (!openingP)
            await Promise.race([st.rtP, new Promise((r) => setTimeout(r, 9000))]);
        await interP;
        if (st.stopRequested)
            return;
        setPhaseBoth("intro");
        setMoodFor("neutral");
        const script = [...plan.intro.map((l) => l.text), ...plan.subject].filter(Boolean).join(" ");
        if (openingP) {
            const rt = await st.rtP;
            if (rt && !rt.isClosed)
                st.rt = rt;
            await openingP;
            setSpeaking(false);
        }
        else if (script && !st.stopRequested) {
            st.replaceNextLog = script;
            await say({ text: script });
            st.replaceNextLog = null;
        }
        st.openingScript = script;
        st.openingSpoken = !!st.rt;
        if (plan.timing.prepS > 0) {
            st.prepFresh = false;
            st.prepOld = null;
            setPhaseBoth("prep");
            st.prepEnd = Date.now() + plan.timing.prepS * 1000;
            setLeft(plan.timing.prepS);
        }
        else
            await beginLive();
    }
    function rtConnect(opts: {
        lastModel?: string | null;
        resumeHandle?: string | null;
        avoid?: string[];
    } = {}, taskNo: TaskNo = curTaskNo()): Promise<LiveExaminer | null> {
        return LiveExaminer.connect(s.sessionId, rtHandlers, { mode: R.current.micMode, taskNo, ...opts }).catch((e) => {
            R.current.rtFail = e instanceof Error ? e.message : String(e);
            return null;
        });
    }
    const recover = useRef<{
        model: string;
        handle: string | null;
        internal: boolean;
    }>({ model: "", handle: null, internal: false });
    async function rtRecover(info: {
        model: string;
        resumeHandle: string | null;
    }, reason: string) {
        recover.current = { model: info.model, handle: info.resumeHandle, internal: /internal error|code 10(08|11)|quota|exhausted/i.test(reason) };
        await new Promise((r) => setTimeout(r, 600));
        await tryRecover();
    }
    async function tryRecover() {
        const st = R.current;
        if (st.stopRequested || st.rt)
            return;
        const { model, handle, internal } = recover.current;
        const rt = await rtConnect({ lastModel: model, resumeHandle: handle, avoid: internal ? [model] : [] });
        recover.current.handle = null;
        if (st.stopRequested) {
            rt?.close();
            return;
        }
        if (!rt) {
            raiseTrouble(w.troubleCut, () => void tryRecover(), () => (R.current.spoke || R.current.seq > 0 ? stopHere() : void abandon()));
            return;
        }
        st.rt = rt;
        rt.setMode(st.micMode);
        (voice.current ??= new OutputLevel()).attachStream(rt.stream);
        clearTrouble();
        unfreeze();
        await rtResume(rt);
    }
    async function rtResume(rt: LiveExaminer) {
        const st = R.current;
        const plan = st.plan;
        if (!plan)
            return;
        if (!st.clockStart) {
            if (st.phase === "reconnecting")
                setPhaseBoth(plan.timing.prepS > 0 && Date.now() < st.prepEnd ? "prep" : "connecting");
            if (st.phase === "connecting")
                void beginLive();
            return;
        }
        setPhaseBoth("examiner");
        st.busy = true;
        st.busySince = Date.now();
        const last = st.lastCandidateText.trim();
        const line = rt.resumed
            ? last
                ? `la connexion a été coupée un instant. Le candidat venait de dire : « ${last.slice(0, 400)} ». Réponds-lui maintenant, naturellement, sans commenter la coupure.`
                : "la connexion a été coupée un instant. Demande simplement au candidat de répéter, en quelques mots, sans commenter la coupure."
            : last
                ? `le candidat venait de dire : « ${last.slice(0, 400)} ». Réponds-lui maintenant, naturellement, dans ton rôle, sans te représenter.`
                : "demande simplement au candidat de répéter sa dernière phrase, en quelques mots, dans ton rôle, sans te représenter.";
        st.lastCandidateText = "";
        await rt.prompt(line);
        if (phaseNow() !== "listening" && !st.stopRequested && st.rt === rt)
            void rtListen();
    }
    async function beginLive() {
        const st = R.current;
        const plan = st.plan;
        if (!plan || st.phase === "listening" || st.phase === "examiner" || st.phase === "connecting")
            return;
        setPhaseBoth("connecting");
        setLeft(plan.timing.speakS);
        let rt = await (st.rtP ?? rtConnect());
        st.rtP = null;
        const old = st.prepOld;
        st.prepOld = null;
        if ((!rt || rt.isClosed) && old && !old.isClosed)
            rt = old;
        else if (old && old !== rt)
            old.close();
        if (rt?.isClosed)
            rt = await rtConnect();
        if (st.stopRequested) {
            rt?.close();
            return;
        }
        if (!rt) {
            raiseTrouble(w.troubleLive, retryLive, () => void abandon());
            return;
        }
        clearTrouble();
        st.rt = rt;
        (voice.current ??= new OutputLevel()).attachStream(rt.stream);
        setPhaseBoth("examiner");
        setLeft(plan.timing.speakS);
        if (!plan.opening.text) {
            if (!st.openingSpoken && st.openingScript && plan.timing.prepS === 0) {
                st.openingSpoken = true;
                st.replaceNextLog = st.openingScript;
                await rt.say(st.openingScript);
                if (phaseNow() !== "listening" && !st.stopRequested && st.rt)
                    void rtListen();
                return;
            }
            void rtListen();
            return;
        }
        st.replaceNextLog = plan.opening.text;
        await say(plan.opening);
        if (st.rt === rt && rt.unanswered(0) && !st.stopRequested) {
            rt.drop("no answer to the opening");
            return;
        }
        if (phaseNow() !== "listening" && !st.stopRequested && st.rt)
            void rtListen();
    }
    function retryLive() {
        const st = R.current;
        if (st.rt || st.rtP || st.phase !== "connecting")
            return;
        st.rtP = rtConnect();
        st.phase = "intro";
        void beginLive();
    }
    async function rtListen() {
        const st = R.current;
        st.busy = false;
        setSpeaking(false);
        setPondering(false);
        if (st.stopRequested || !st.rt || st.phase === "intro" || st.phase === "prep" || st.phase === "preparing")
            return;
        if (st.clockStart && st.plan?.taskNo === 2 && !canAsk(st.plan.timing, clock())) {
            st.stopRequested = true;
            void hardStop("close");
            return;
        }
        if (!st.clockStart)
            st.clockStart = Date.now();
        const taskNo = st.plan?.taskNo ?? 2;
        st.rt.setSilence(taskNo === 2 ? 800 : !st.introDone ? (taskNo === 1 ? 2000 : 5000) : 1500);
        st.rt.setMic(true);
        if (!st.rt.speaking) {
            setPressing(false);
            st.segStart = Date.now();
            st.lastSpeechAt = Date.now();
            st.spoke = false;
            st.segCount += 1;
        }
        setPhaseBoth("listening");
        if (!st.recOn) {
            st.recOn = true;
            await rec.start().catch(() => (st.recOn = false));
        }
    }
    async function rtRelance() {
        const st = R.current;
        if (!st.rt || !st.plan || st.busy)
            return;
        st.busy = true;
        st.busySince = Date.now();
        st.recOn = false;
        await rec.stop();
        setPhaseBoth("examiner");
        void st.rt.say(st.plan.relance.text);
    }
    const rtHandlers = {
        onSpeechStarted: () => {
            const st = R.current;
            if (!st.rt || st.stopRequested)
                return;
            st.spoke = true;
            st.turnStartAt = Math.max(0.01, elapsed());
            setRtRecording(true);
            setMoodFor("neutral");
            if (!st.recOn) {
                st.recOn = true;
                st.segStart = Date.now();
                void rec.start().catch(() => (st.recOn = false));
            }
        },
        onSpeechStopped: () => {
            const st = R.current;
            if (st.closing) {
                setRtRecording(false);
                setPressing(false);
                return;
            }
            if (!st.rt || !st.spoke)
                return;
            st.spoke = false;
            st.busy = true;
            st.busySince = Date.now();
            if (st.plan?.taskNo !== 2 && st.segCount === 1)
                st.introDone = true;
            st.speechEndAt = st.lastSpeechAt || Date.now();
            st.latencyMs = null;
            setRtRecording(false);
            setMoodFor("warm", 2500);
            setPondering(true);
            setPressing(false);
            st.recOn = false;
            st.lastUploadP = rec.stop().then((res) => {
                if (res.durationS >= 0.5 && res.blob.size > 1500)
                    void upload(res);
            });
            if (st.plan && st.plan.taskNo !== 2 && st.clockStart && !st.stopRequested && !canAsk(st.plan.timing, clock())) {
                st.stopRequested = true;
                void hardStop("close");
            }
        },
        onCandidateText: (text: string) => {
            const st = R.current;
            st.lastCandidateText = text;
            const seq = st.seq;
            const up = st.uploads.get(seq);
            const clipId = st.clipIds.get(seq);
            if (!seq || !up || !clipId)
                return;
            const tn = curTaskNo();
            st.pending.push(up.then(() => logLater({ taskNo: tn, clipId, candidateText: text })).catch(() => null));
        },
        onAudioStart: () => {
            const st = R.current;
            if (!st.rt)
                return;
            if (st.speechEndAt)
                st.latencyMs = Date.now() - st.speechEndAt;
            st.speechEndAt = 0;
            st.busy = true;
            st.busySince = Date.now();
            setPondering(false);
            setSpeaking(true);
            if (st.phase === "listening")
                setPhaseBoth("examiner");
        },
        onAudioStop: () => {
            const st = R.current;
            if (st.rt && st.plan?.taskNo !== 2 && /\?\s*$/.test(st.lastExaminerLine) && st.phase !== "stopping")
                st.questionEndAt = elapsed();
            if (st.rt && st.phase !== "stopping")
                void rtListen();
        },
        onExaminerText: (heard: string) => {
            const st = R.current;
            if (!st.rt)
                return;
            if (st.closing && /…$/.test(heard))
                return;
            const text = st.replaceNextLog ?? heard;
            const scripted = st.replaceNextLog != null;
            st.replaceNextLog = null;
            if (scripted && !text)
                return;
            st.lastCandidateText = "";
            logLine(text, st.latencyMs);
            st.latencyMs = null;
            st.lastExaminerLine = text;
            if (/pardon|r[ée]p[ée]t|vous parlez de|tu parles de|c'est bien (ça|de ça)|vous voulez dire|tu veux dire|pas (bien )?compris/i.test(text))
                setMoodFor("puzzled");
            else if (/arrêter là|merci/i.test(text) && st.phase === "stopping")
                setMoodFor("warm");
            else if (/\?\s*$/.test(text))
                setMoodFor("curious");
            else
                setMoodFor("neutral");
            if (st.plan?.taskNo === 1 && st.introDone && st.phase !== "stopping")
                st.asked += 1;
        },
        onClosed: (reason: string, info: {
            self: LiveExaminer;
            model: string;
            resumeHandle: string | null;
        }) => {
            const st = R.current;
            if (st.rt && st.rt !== info.self)
                return;
            const partial = info.self.heardSoFar;
            st.rt = null;
            st.busy = false;
            setSpeaking(false);
            setPondering(false);
            setPressing(false);
            if (st.stopRequested || st.phase === "stopping" || st.phase === "done")
                return;
            if (st.phase === "listening" || st.phase === "examiner") {
                if (info.self === st.prepOld) {
                    st.prepOld = null;
                    return;
                }
                freeze();
                if (st.recOn) {
                    st.recOn = false;
                    const spoke = st.spoke;
                    st.spoke = false;
                    void rec.stop().then((res) => {
                        if (spoke && res.durationS >= 0.5 && res.blob.size > 1500)
                            upload(res);
                    });
                    if (spoke && partial)
                        st.lastCandidateText = partial;
                }
                setPhaseBoth("reconnecting");
                void rtRecover(info, reason);
            }
            else if (st.phase === "prep" || st.phase === "intro" || st.phase === "preparing") {
                if (info.self === st.prepOld)
                    st.prepOld = null;
                else if (!st.prepFresh)
                    st.rtP = rtConnect({ lastModel: info.model, avoid: /internal error|code 10(08|11)/i.test(reason) ? [info.model] : [] });
            }
        },
    };
    function rtClose() {
        const st = R.current;
        st.rt?.close();
        st.rt = null;
        st.rtP = null;
    }
    function upload(res: StopResult): Promise<unknown> {
        const st = R.current;
        const taskNo = curTaskNo();
        const seq = ++st.seq;
        const clipId = newClipId();
        st.clipIds.set(seq, clipId);
        const item = { taskNo, clipId, register: true, durationS: res.durationS, elapsedS: elapsed() };
        const p = keepClip({ clipId, sessionId: s.sessionId, taskNo, blob: res.blob, durationS: res.durationS })
            .catch(() => null)
            .then(() => logLater(item));
        st.pending.push(p);
        st.uploads.set(seq, p);
        return p;
    }
    function logLine(text: string, latencyMs?: number | null) {
        logLater({ taskNo: curTaskNo(), examinerText: text, elapsedS: elapsed(), ...(latencyMs != null ? { latencyMs } : {}) });
    }
    async function hardStop(reason: "cut" | "close" | "user") {
        const st = R.current;
        const plan = st.plan;
        if (!plan)
            return;
        const closing = plan.closing;
        const user = reason === "user" || st.stopRequestedByUser;
        const cut = reason === "cut" && !user;
        const late = cut && plan.taskNo === 2 && !questionDeservesAnswer(plan.timing, clock());
        const line = late && closing?.lateQuestion ? closing.lateQuestion : cut && closing?.cut.length ? closing.cut[Math.floor(Math.random() * closing.cut.length)] : plan.stop;
        const wasRecording = st.recOn;
        const spoke = st.spoke;
        st.closing = true;
        unfreeze();
        clearTrouble();
        setPondering(false);
        setPhaseBoth("stopping");
        setMoodFor("neutral");
        const task = s.tasks[st.taskIdx];
        const hasNext = st.taskIdx < s.tasks.length - 1;
        const endedAt = elapsed();
        const nextRt = hasNext && !user && st.nextTaskIdx === st.taskIdx + 1 && st.rtNextP ? await Promise.race([st.rtNextP, new Promise<null>((r) => setTimeout(() => r(null), 2500))]) : null;
        const nextPlan = nextRt && st.nextPlanP ? await Promise.race([st.nextPlanP.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 1500))]) : null;
        const nextScript = nextPlan ? [...nextPlan.intro.map((l) => l.text), ...nextPlan.subject].filter(Boolean).join(" ") : "";
        const handoff = !!(nextRt && !nextRt.isClosed && nextPlan);
        let stopP: Promise<void>;
        if (handoff) {
            rtClose();
            st.rt = nextRt;
            (voice.current ??= new OutputLevel()).attachStream(nextRt!.stream);
            logLater({ taskNo: task.taskNo, examinerText: line.text, elapsedS: endedAt });
            st.replaceNextLog = nextScript;
            stopP = nextRt!.say(`${line.text} ${nextScript}`);
        }
        else if (st.rt) {
            const farewell = !hasNext && !user && closing?.farewell ? ` ${closing.farewell.text}` : "";
            st.replaceNextLog = line.text;
            stopP = st.rt.sayNow(`${line.text}${farewell}`, true);
        }
        else
            stopP = say(line, true);
        if (wasRecording) {
            await new Promise((r) => setTimeout(r, plan.timing.tailS * 1000));
            const res = await rec.stop();
            st.recOn = false;
            if (res.durationS >= 1 && spoke)
                void upload(res);
        }
        st.spoke = false;
        await st.lastUploadP?.catch(() => null);
        const uploads = [...st.pending];
        setPending((p) => ({ ...p, [task.taskNo]: { durationS: endedAt } }));
        void Promise.all(uploads).then(() => finishAndScore(task.taskNo, endedAt));
        if (hasNext && handoff) {
            const rt = nextRt!;
            const until = Date.now() + 5000;
            while (!rt.talking && !rt.isClosed && Date.now() < until)
                await new Promise((r) => setTimeout(r, 80));
            const lead = `${line.text} ${nextPlan!.intro.map((l) => l.text).join(" ")}`;
            await Promise.race([stopP, new Promise((r) => setTimeout(r, Math.max(1500, lead.length * 58)))]);
            st.rt = null;
            void runTask(st.taskIdx + 1, Promise.resolve(nextPlan!), Promise.resolve(rt), stopP);
            return;
        }
        await stopP;
        setSpeaking(false);
        rtClose();
        if (hasNext)
            await runTask(st.taskIdx + 1);
        else
            setPhaseBoth("done");
    }
    async function finishAndScore(taskNo: TaskNo, durationS: number): Promise<void> {
        const task = s.tasks.find((t) => t.taskNo === taskNo)!;
        setPending((p) => ({ ...p, [taskNo]: { durationS } }));
        await new Promise((r) => setTimeout(r, 800));
        await Promise.all([...R.current.pending]).catch(() => null);
        await flushLog();
        try {
            const d = await finishTask(s.sessionId, taskNo, durationS, LISTENING_TIMEOUT_MS);
            const view: TaskView = { taskNo, sessionId: s.sessionId, prompt: task.prompt, turns: d.transcript.map((u) => ({ role: u.role, text: u.text, clipId: u.clipId })), score20: d.score20, level: d.level, nclc: d.nclc, feedbackJson: d.evaluation ? JSON.stringify(d.evaluation) : null, detailJson: d.detail ? JSON.stringify(d.detail) : null };
            setResults((x) => ({ ...x, [taskNo]: view }));
            if (d.summary)
                setSummary(d.summary);
            setPending((p) => {
                const { [taskNo]: _gone, ...rest } = p;
                void _gone;
                return rest;
            });
        }
        catch (e) {
            setFailures((x) => ({ ...x, [taskNo]: explainFailure(e, lang) }));
            setPending((p) => ({ ...p, [taskNo]: { durationS, failed: true } }));
        }
    }
    function retryPending(taskNo: TaskNo) {
        const p = pendingRef.current[taskNo];
        if (p)
            void finishAndScore(taskNo, p.durationS);
    }
    function askStop() {
        if (R.current.stopRequested)
            return;
        freeze();
        setAsking(Date.now());
    }
    function resumeFromSheet() {
        const st = R.current;
        if (asking && st.phase === "prep")
            st.prepEnd += Date.now() - asking;
        setAsking(null);
        unfreeze();
    }
    function stopHere() {
        setAsking(null);
        if (R.current.stopRequested)
            return;
        R.current.stopRequestedByUser = true;
        R.current.stopRequested = true;
        void hardStop("user");
    }
    async function abandon() {
        const st = R.current;
        setAsking(null);
        setLeaving(true);
        st.stopRequested = true;
        st.stopRequestedByUser = true;
        try {
            rtClose();
            voice.current?.close();
            if (st.recOn)
                await rec.stop();
        }
        catch { }
        if (mock) {
            mock.onStageEnd("abandon");
            return;
        }
        const keep = Object.keys(resultsRef.current).length > 0 || Object.keys(pendingRef.current).length > 0;
        try {
            if (keep)
                await fetch(`/api/expr/session/${s.sessionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "abandoned" }) });
            else
                await fetch(`/api/expr/session/${s.sessionId}`, { method: "DELETE" });
        }
        catch { }
        try {
            localStorage.removeItem(pKey);
        }
        catch { }
        onExit();
    }
    function togglePress() {
        const st = R.current;
        if (!st.rt || st.phase !== "listening" || st.busy)
            return;
        if (pressing)
            st.rt.pressEnd();
        else
            st.rt.pressStart();
        setPressing(!pressing);
    }
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey)
                return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
                return;
            if (document.querySelector("dialog[open]"))
                return;
            const st = R.current;
            if (e.key === " " || e.code === "Space") {
                if (t && t.tagName === "BUTTON")
                    return;
                e.preventDefault();
                if (st.micMode === "ptt")
                    togglePress();
                else if (st.phase === "listening" && st.rt?.speaking)
                    st.rt.endTurn();
            }
            else if (e.key === "Escape") {
                e.preventDefault();
                askStop();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [pressing]);
    if (hall)
        return <Hallway title={w.eo} sub={w.about12} ai onDone={() => setHall(false)} lang={lang}/>;
    const cur = s.tasks[idx];
    const cfg = SPEAKING.tasks[cur.taskNo];
    const live = phase === "listening" || phase === "examiner" || phase === "reconnecting" || phase === "stopping" || phase === "connecting";
    if (done && mock)
        return <MockStageDone onDone={() => mock.onStageEnd("done")}/>;
    if (done) {
        const views = s.tasks.map((t) => results[t.taskNo] ?? drafts[t.taskNo]).filter(Boolean);
        return (<SessionResults skill="speaking" sessionId={s.sessionId} views={views} summary={summary} selected={s.tasks.map((t) => t.taskNo)} pending={Object.fromEntries(Object.entries(pending).map(([k, v]) => [k, v.failed ? "failed" : "running"]))} failures={failures} onRetry={retryPending} onExit={onExit} lang={lang}/>);
    }
    const showQuestion = cur.taskNo === 3 && (phase === "intro" || live);
    const side = (cur.taskNo === 2 && (phase === "intro" || phase === "prep" || live)) || showQuestion;
    const retryIn = trouble?.retryAt ? Math.max(0, Math.ceil((trouble.retryAt - now) / 1000)) : null;
    const onRetryNow = () => {
        if (!trouble)
            return;
        const t = troubleRef.current;
        if (t.timer)
            clearTimeout(t.timer);
        t.timer = null;
        if (trouble.final)
            t.attempts = 0;
        setTrouble(null);
        trouble.retry();
    };
    return (<>
      <StopDialog open={asking != null} canScore={R.current.spoke || R.current.seq > 0} onResume={resumeFromSheet} onStop={stopHere} onAbandon={() => void abandon()} lang={lang}/>
      <BusyOverlay message={leaving ? w.leaving : phase === "preparing" ? w.prepMessage : null} lang={lang}/>
      <Station skill="speaking" steps={s.tasks.map((t, i) => ({ taskNo: t.taskNo, done: !!results[t.taskNo] || !!pending[t.taskNo], active: i === idx }))} secondsLeft={phase === "prep" || live ? left : cfg.speakSeconds} running={(phase === "prep" || live) && phase !== "stopping"} warnUnder={WARN_S} blinkUnder={BLINK_S} lang={lang} sub={mock?.sub} foot={<div className="eo-controls">
            <Button kind="quiet" className="room-finish" onClick={askStop} disabled={phase === "stopping" || leaving} aria-label={w.finish}><Icon name="stop" size={18} className="mob-only icon-fill"/><span className="desk-only">{w.finish}</span></Button>
            <div className="eo-mic" style={{ "--lvl": phase === "listening" ? Math.min(1, rec.level * 6) : 0 } as CSSProperties}>
              {micMode === "ptt" ? (<button type="button" className="btn-mic" data-rec={pressing} onClick={togglePress} disabled={phase !== "listening" || pondering} aria-pressed={pressing} aria-label={pressing ? w.endAnswer : w.speak}>
                  <span className="mic-ring" aria-hidden="true"/>
                  <MicGlyph off={pressing}/>
                  <span>{pressing ? w.stopAnswer : w.speak}</span>
                </button>) : (<div className="voice-bars" data-idle={phase !== "listening"} data-heard={rtRecording} role="status" aria-label={phase === "listening" ? w.voiceHeard : undefined}>
                  {[4, 3, 2, 1, 0, 1, 2, 3, 4].map((age, i) => <span key={i} style={{ "--lvl": lvlHist[age] } as CSSProperties}/>)}
                </div>)}
            </div>
            <span />
          </div>}>
        <div className="room-body eo-room" data-side={side}>
          <aside className="eo-side" aria-hidden={!side}>
            {side && (cur.taskNo === 2 ? (<>
                  <div className="card pad eo-card" data-unfolded={sitOpen || undefined}>
                    <div className="eo-question-head"><span className="sim-caps">{w.situation}</span><TacheTag n={cur.taskNo}/><button type="button" className="ee-fold mob-only" aria-expanded={sitOpen} onClick={() => setSitOpen((x) => !x)}><Icon name="chevronDown" size={14} className={sitOpen ? "flipy" : ""}/></button></div>
                    <p className="eo-consigne">{cur.prompt.consigne}</p>
                  </div>
                  <label className="eo-notes">
                    <span className="sim-caps">{phase === "prep" || phase === "intro" ? w.notesPrep : w.notes}</span>
                    <textarea className="sim-paper" value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={phase !== "prep" && phase !== "intro"} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
                  </label>
                </>) : (<div className="card pad eo-card eo-question" data-open={questionOpen}>
                  <div className="eo-question-head">
                    <span className="sim-caps">{w.question}</span>
                    <Button kind="quiet" size="sm" aria-expanded={questionOpen} onClick={() => setQuestionOpen((x) => !x)}>{questionOpen ? w.hideText : w.showText}</Button>
                  </div>
                  <p className="eo-question-text eo-consigne" aria-hidden={!questionOpen}>{cur.prompt.consigne}</p>
                </div>))}
          </aside>
          <section className="eo-stage">
            <Interviewer speaking={speaking} listening={phase === "listening" && !pondering} pondering={!speaking && (pondering || phase === "examiner" || phase === "intro" || phase === "stopping")} thinking={phase === "prep" || phase === "connecting" || phase === "preparing"} mood={mood} level={() => voice.current?.get() ?? null} lang={lang}/>
            <span className="eo-status mob-only" data-on={phase === "listening" || speaking || undefined}><i aria-hidden="true"/>{speaking ? w.statusSpeaking : phase === "listening" ? w.statusListening : phase === "prep" ? w.statusPrep : w.statusThinking}</span>
            <p className="eo-caption">{caption ?? ""}</p>
            {micError ? (<Trouble message={micError === w.noRecorder ? micError : w.troubleMic} onQuit={() => void abandon()} onRetry={micError === w.noRecorder ? undefined : () => { setMicError(null); void startFrom(R.current.taskIdx); }} lang={lang}/>) : trouble ? (<Trouble message={trouble.message} final={trouble.final} retryIn={retryIn} onRetry={onRetryNow} onQuit={trouble.quit} link={trouble.link} lang={lang}/>) : null}
          </section>
        </div>
      </Station>
    </>);
}
function MockStageDone({ onDone }: {
    onDone: () => void;
}) {
    const once = useRef(false);
    useEffect(() => { if (!once.current) {
        once.current = true;
        onDone();
    } }, [onDone]);
    return <div className="boot" aria-busy="true"/>;
}
