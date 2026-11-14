import { useEffect, useState } from "react";
import { Empty, Button } from "../../ui/ui.tsx";
import { replace } from "../../ui/router.ts";
import { useT } from "../i18n.ts";
import { useMe } from "../main.tsx";
import { loadSession } from "../sim/work.ts";
import { loadStarted, rebuildStarted, type Section, type StartedSession } from "../expr.ts";
import { OralRunner, EcritRunner } from "../sim/index.ts";
import { Frame } from "../Frame.tsx";
import "../sim/sim.css";
export function Room({ s, id }: {
    s: Section;
    id: string;
}) {
    const { t, lang } = useT();
    const { me } = useMe();
    const [state, setState] = useState<{
        s: StartedSession;
        startedAtMs: number;
    } | null | undefined>(() => loadStarted(id) ?? undefined);
    const fresh = !!state;
    useEffect(() => {
        loadSession(id).then((d) => {
            if (d.session.status === "done" || d.session.status === "abandoned") {
                replace(`/${s}/result/${id}`);
                return;
            }
            if (!fresh)
                setState({ s: rebuildStarted(d), startedAtMs: Date.parse(d.session.startedAt) });
        }).catch(() => { if (!fresh)
            setState(null); });
    }, [id]);
    const exit = () => replace(`/${s}`);
    if (state === undefined)
        return <Frame mode="room"><div className="boot" aria-busy="true"/></Frame>;
    if (state === null)
        return <Frame mode="room"><div className="section-page room-missing"><Empty icon={s} title={t.roomNotFound}><Button size="sm" onClick={exit}>{t.sectionNames[s]}</Button></Empty></div></Frame>;
    const micMode = state.s.micMode ?? (me?.settings?.eo?.mode === "ptt" ? "ptt" : "live");
    return (<Frame mode={state.s.kind === "exam" ? "exam" : "room"}>
      {state.s.skill === "speaking"
            ? <OralRunner session={state.s} startedAtMs={state.startedAtMs} kind={state.s.kind} micMode={micMode} lang={lang} onExit={exit}/>
            : <EcritRunner session={state.s} startedAtMs={state.startedAtMs} kind={state.s.kind} lang={lang} onExit={exit}/>}
    </Frame>);
}
