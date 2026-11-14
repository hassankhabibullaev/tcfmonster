import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Button } from "../../ui/ui.tsx";
import { go, replace } from "../../ui/router.ts";
import { useT } from "../i18n.ts";
import { Frame } from "../Frame.tsx";
import { loadSession } from "../sim/work.ts";
import { loadLevel, type Question, type Section as CoceSection } from "../coce/bank.ts";
import { ExamRoom, type Attempt } from "../coce/room/index.ts";
import { EcritRunner, OralRunner, Hall } from "../sim/index.ts";
import { Trouble } from "../sim/trouble.tsx";
import { rebuildStarted, type StartedSession, type StoredSession } from "../expr.ts";
import { LEVELS } from "../../../shared/progress.ts";
import { serverNow } from "../coce/room/hooks.ts";
import { beginMock, getMock, nextMock, refreshMock, isBreak, isTest, testAfter, STAGE_SECONDS, type Mock, type Stage, type TestStage } from "./api.ts";
import { MockStore } from "./store.ts";
import type { MockHooks } from "./shell.tsx";
import { Break } from "./Break.tsx";
import { Marking } from "./Marking.tsx";
import { useMockWords } from "./words.ts";
import "../sim/sim.css";
import "../coce/room/room.css";
import "./mock.css";
const RETRY_S = [4, 8, 12];
const isOver = (m: Mock) => m.status === "done" || m.status === "abandoned" || m.stage === "over";
const minutesOf = (s: number) => `${Math.round(s / 60)} min`;
export function Sitting({ id }: {
    id: number;
}) {
    const { lang } = useT();
    const w = useMockWords(lang);
    const [mock, setMock] = useState<Mock | null | undefined>(undefined);
    const [store, setStore] = useState<MockStore | null>(null);
    const [inter, setInter] = useState<{
        title: string;
        sub: string;
        count: boolean;
    } | null>(null);
    const [ready, setReady] = useState(false);
    const begun = useRef<string | null>(null);
    const [moving, setMoving] = useState(false);
    const [trouble, setTrouble] = useState<{
        retryAt: number;
        final: boolean;
    } | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const tries = useRef(0);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastStage = useRef<Stage | null>(null);
    useEffect(() => {
        let live = true;
        getMock(id).then(async (m) => {
            if (!live)
                return;
            if (isOver(m)) {
                replace(`/mock/${id}/result`);
                return;
            }
            const st = await MockStore.open(m.id, m.answers);
            if (!live)
                return;
            setStore(st);
            setMock(m);
        }).catch(() => live && setMock(null));
        return () => { live = false; };
    }, [id]);
    useEffect(() => {
        if (!mock)
            return;
        if (lastStage.current === mock.stage)
            return;
        lastStage.current = mock.stage;
        setReady(false);
        const s = mock.stage;
        if (isTest(s))
            setInter({ title: w[s], sub: s === "eo" ? w.about(12) : minutesOf(STAGE_SECONDS[s]), count: mock.pending });
    }, [mock, w]);
    useEffect(() => {
        if (!mock || inter || !ready || !mock.pending || !isTest(mock.stage) || begun.current === mock.stage)
            return;
        begun.current = mock.stage;
        const tries = { n: 0 };
        const go = () => beginMock(id).then((m) => { refreshMock(); setMock(m); }).catch(() => { if (++tries.n < 20)
            setTimeout(go, 3000); });
        go();
    }, [mock, inter, ready, id]);
    useEffect(() => { if (!trouble)
        return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [trouble]);
    const move = useCallback(async (from: Stage, how: "done" | "abandon" = "done") => {
        setMoving(true);
        try {
            const m = await nextMock(id, from, how);
            if (retryTimer.current)
                clearTimeout(retryTimer.current);
            tries.current = 0;
            setTrouble(null);
            refreshMock();
            if (isOver(m)) {
                store?.forget();
                replace(`/mock/${id}/result`);
                return;
            }
            setMock(m);
        }
        catch (e) {
            const status = (e as {
                status?: number;
            }).status ?? 0;
            if (status === 401)
                return;
            if (status === 409) {
                getMock(id).then((m) => { if (isOver(m)) {
                    store?.forget();
                    replace(`/mock/${id}/result`);
                }
                else
                    setMock(m); }).catch(() => { });
                return;
            }
            const wait = RETRY_S[Math.min(tries.current, RETRY_S.length - 1)] ?? 12;
            const final = tries.current >= RETRY_S.length;
            tries.current++;
            setTrouble({ retryAt: Date.now() + (final ? 30 : wait) * 1000, final });
            retryTimer.current = setTimeout(() => void move(from, how), (final ? 30 : wait) * 1000);
        }
        finally {
            setMoving(false);
        }
    }, [id, store]);
    const onLeave = useCallback(() => { go("/mock"); }, []);
    const onReady = useCallback(() => setReady(true), []);
    const hooks = useMemo<MockHooks | null>(() => {
        if (!mock || !store || !isTest(mock.stage))
            return null;
        const stage = mock.stage;
        const index = stage === "co" ? 1 : stage === "ce" ? 2 : stage === "ee" ? 3 : 4;
        return { stage, sub: w.stageOf(index), endsAt: mock.stageEndsAt ? Date.parse(mock.stageEndsAt) : null, store, onStageEnd: (how) => void move(stage, how), onLeave, onReady };
    }, [mock, store, move, onLeave, onReady, w]);
    if (mock === null) {
        return <Frame mode="exam"><div className="section-page room-missing"><Empty icon="co" title={w.failed}><Button size="sm" onClick={() => go("/mock")}>{w.titles}</Button></Empty></div></Frame>;
    }
    if (mock === undefined || !store)
        return <Frame mode="exam"><div className="boot" aria-busy="true"/></Frame>;
    const stage = mock.stage;
    let screen;
    if (stage === "co" || stage === "ce")
        screen = <CoceStage key={stage} mock={mock} stage={stage} hooks={hooks!}/>;
    else if (stage === "ee" || stage === "eo")
        screen = <ExprStage key={stage} mock={mock} stage={stage} hooks={hooks!}/>;
    else if (isBreak(stage))
        screen = <Break key={stage} mock={mock} lang={lang} busy={moving} onContinue={() => void move(stage)}/>;
    else if (stage === "marking")
        screen = <Marking mock={mock} lang={lang} drafts={store.state.drafts} onDone={(m) => { store.forget(); replace(`/mock/${m.id}/result`); }}/>;
    else
        screen = <div className="boot" aria-busy="true"/>;
    return (<Frame mode="exam">
      <div className="mk-sitting" data-stage={stage}>
        {screen}
        {trouble && (<div className="mk-trouble">
            <Trouble message={w.endFailed} final={false} retryIn={Math.max(0, Math.ceil((trouble.retryAt - now) / 1000))} lang={lang}/>
          </div>)}
        {inter && <Hall count={inter.count} title={inter.title} sub={inter.sub} ai={stage === "eo"} lang={lang} onDone={() => setInter(null)}/>}
      </div>
    </Frame>);
}
export async function loadPaper(section: CoceSection, paper: {
    id: string;
}[]): Promise<Question[]> {
    const files = await Promise.all(LEVELS.map((lv) => loadLevel(section, lv)));
    const byId = new Map<string, Question>();
    for (const qs of files)
        for (const q of qs)
            byId.set(q.id, q);
    return paper.map((p) => byId.get(p.id)).filter((q): q is Question => !!q);
}
function CoceStage({ mock, stage, hooks }: {
    mock: Mock;
    stage: "co" | "ce";
    hooks: MockHooks;
}) {
    const { lang } = useT();
    const w = useMockWords(lang);
    const [questions, setQuestions] = useState<Question[] | null | undefined>(undefined);
    const [tries, setTries] = useState(0);
    useEffect(() => {
        let live = true;
        setQuestions(undefined);
        loadPaper(stage, mock.paper[stage]).then((qs) => live && setQuestions(qs.length ? qs : null)).catch(() => live && setQuestions(null));
        return () => { live = false; };
    }, [stage, mock.paper, tries]);
    if (questions === undefined)
        return <div className="boot" aria-busy="true"/>;
    if (questions === null)
        return <div className="section-page room-missing"><Empty icon={stage} title={w.failed}><Button size="sm" icon="refresh" onClick={() => setTries((n) => n + 1)}>{w.retry}</Button></Empty></div>;
    const attempt: Attempt = { id: `mock-${mock.id}-${stage}`, section: stage, exam: 0, mode: "exam", startedAt: mock.stageStartedAt ?? "", deadlineAt: hooks.endsAt ? new Date(hooks.endsAt).toISOString() : "", finishedAt: null, ended: null, score: null, nclc: null, right: null, wrong: null, blank: null, answers: hooks.store.answers(stage) };
    return <ExamRoom section={stage} exam={0} attempt={attempt} questions={questions} lang={lang} onFinished={() => { }} onLeave={hooks.onLeave} mock={hooks}/>;
}
function ExprStage({ mock, stage, hooks }: {
    mock: Mock;
    stage: "ee" | "eo";
    hooks: MockHooks;
}) {
    const { lang } = useT();
    const w = useMockWords(lang);
    const sid = stage === "ee" ? mock.eeSessionId : mock.eoSessionId;
    const [state, setState] = useState<{
        s: StartedSession;
        startedAtMs: number;
    } | null | undefined>(undefined);
    const [tries, setTries] = useState(0);
    useEffect(() => {
        let live = true;
        if (!sid) {
            setState(null);
            return;
        }
        setState(undefined);
        loadSession(sid).then((d) => live && setState({ s: rebuildStarted(d), startedAtMs: Date.parse(mock.stageStartedAt ?? d.session.startedAt) })).catch(() => live && setState(null));
        return () => { live = false; };
    }, [sid, mock.stageStartedAt, tries]);
    if (state === undefined)
        return <div className="boot" aria-busy="true"/>;
    if (state === null)
        return <div className="section-page room-missing"><Empty icon={stage} title={w.failed}><Button size="sm" icon="refresh" onClick={() => setTries((n) => n + 1)}>{w.retry}</Button></Empty></div>;
    const exit = () => hooks.onStageEnd("done");
    return stage === "ee"
        ? <EcritRunner session={state.s} startedAtMs={state.startedAtMs} kind="exam" lang={lang} onExit={exit} mock={hooks}/>
        : <OralRunner session={state.s} startedAtMs={state.startedAtMs} kind="exam" micMode={mock.micMode ?? (state.s.micMode ?? "live")} lang={lang} onExit={exit} mock={hooks}/>;
}
export { testAfter };
