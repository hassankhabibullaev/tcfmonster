import { useCallback, useEffect, useState } from "react";
import { Frame } from "../Frame.tsx";
import { Empty, Button } from "../../ui/ui.tsx";
import { go, replace } from "../../ui/router.ts";
import { useT } from "../i18n.ts";
import { useMe } from "../main.tsx";
import { api, ApiError } from "../api.ts";
import { loadExam, type Question, type Section } from "../coce/bank.ts";
import type { Level } from "../../../shared/progress.ts";
import { PracticeRoom, ExamRoom, useRoomWords, DURATION_MIN, type Attempt, type Help } from "../coce/room/index.ts";
import { noteRunning, currentRunning, takeStart } from "../coce/pages/index.ts";
import { Hallway } from "../sim/index.ts";
import "../sim/sim.css";
const resultPath = (a: Attempt) => `/${a.section}/exam/${a.exam}/result/${a.id}`;
const sallePath = (a: Attempt) => `/${a.section}/exam/${a.exam}/room`;
export function PracticeRoute({ section, level }: {
    section: Section;
    level: Level;
}) {
    const { lang } = useT();
    const { me, update } = useMe();
    const q = Number(new URLSearchParams(location.search).get("q"));
    return (<Frame mode="room">
      <PracticeRoom section={section} level={level} lang={lang} start={Number.isInteger(q) && q > 0 ? q : null} settings={(me?.settings?.help as Help | undefined) ?? null} onSettings={(help) => update({ settings: { help } })} onExit={() => go(`/${section}/practice`)}/>
    </Frame>);
}
type SalleState = {
    step: "looking";
} | {
    step: "hall";
} | {
    step: "starting";
    error: string | null;
} | {
    step: "room";
    attempt: Attempt;
    questions: Question[];
    fresh?: boolean;
} | {
    step: "lost";
};
export function ExamSalle({ section, exam }: {
    section: Section;
    exam: number;
}) {
    const { t, lang } = useT();
    const rw = useRoomWords(lang);
    const [st, setSt] = useState<SalleState>({ step: "looking" });
    const mode = new URLSearchParams(location.search).get("mode") === "training" ? "training" : "exam";
    const errorOf = (e: unknown) => {
        const d = e instanceof ApiError ? e.data : {};
        return d.error === "hold" ? t.hold : d.error === "mock_running" ? t.mockRunning : d.error === "network" ? t.networkError : t.serverError;
    };
    useEffect(() => {
        let gone = false;
        setSt({ step: "looking" });
        void loadExam(section, exam).catch(() => null);
        (async () => {
            try {
                const running = (await currentRunning()).attempt as unknown as Attempt | null;
                if (gone)
                    return;
                if (!running) {
                    if (!takeStart(section, exam))
                        replace(`/${section}/exam/${exam}`);
                    else if (mode === "training")
                        void start();
                    else
                        setSt({ step: "hall" });
                    return;
                }
                if (running.section !== section || running.exam !== exam) {
                    replace(sallePath(running));
                    return;
                }
                const questions = await loadExam(section, exam);
                if (!gone)
                    setSt({ step: "room", attempt: running, questions });
            }
            catch (e) {
                if (!gone)
                    setSt({ step: "starting", error: errorOf(e) });
            }
        })();
        return () => { gone = true; };
    }, [section, exam]);
    const start = useCallback(async () => {
        setSt({ step: "starting", error: null });
        try {
            const [attempt, questions] = await Promise.all([
                api<{
                    attempt: Attempt;
                }>("/attempts", { section, exam, mode }).then((r) => r.attempt),
                loadExam(section, exam),
            ]);
            noteRunning(attempt as never);
            setSt({ step: "room", attempt, questions, fresh: true });
        }
        catch (e) {
            const d = e instanceof ApiError ? e.data : {};
            if (e instanceof ApiError && e.status === 409 && d.running) {
                const other = d.running as Attempt;
                if (other.section === section && other.exam === exam) {
                    setSt({ step: "room", attempt: other, questions: await loadExam(section, exam) });
                    return;
                }
                replace(sallePath(other));
                return;
            }
            setSt({ step: "starting", error: errorOf(e) });
        }
    }, [section, exam, mode]);
    if (st.step === "lost") {
        return <Frame mode="room"><div className="section-page room-missing"><Empty icon={section} title={t.roomNotFound}><Button size="sm" onClick={() => go(`/${section}`)}>{t.sectionNames[section]}</Button></Empty></div></Frame>;
    }
    if (st.step === "hall") {
        return <Frame mode="exam"><Hallway title={rw[section]} sub={`${DURATION_MIN[section]} min`} onDone={() => void start()} lang={lang}/></Frame>;
    }
    if (st.step === "looking" || st.step === "starting") {
        return (<Frame mode="exam">
        {st.step === "starting" && st.error ? (<div className="section-page room-missing">
            <Empty icon={section} title={st.error}>
              <Button size="sm" icon="refresh" onClick={() => void start()}>{rw.retry}</Button>
              <Button size="sm" kind="quiet" onClick={() => go(`/${section}/exam/${exam}`)}>{rw.back}</Button>
            </Empty>
          </div>) : <div className="boot" aria-busy="true"/>}
      </Frame>);
    }
    return (<Frame mode="exam">
      <ExamRoom section={section} exam={exam} attempt={st.attempt} fresh={st.fresh} questions={st.questions} lang={lang} onFinished={(a) => { noteRunning(null); replace(resultPath(a)); }} onLeave={() => { noteRunning(st.step === "room" ? (st.attempt as never) : null); go(`/${section}/exam/${exam}`); }}/>
    </Frame>);
}
export function ReviewRoute({ section, exam, attemptId }: {
    section: Section;
    exam: number;
    attemptId: string;
}) {
    useEffect(() => { replace(`/${section}/exam/${exam}/result/${attemptId}`); }, [section, exam, attemptId]);
    return <div className="boot" aria-busy="true"/>;
}
