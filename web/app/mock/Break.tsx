import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/ui.tsx";
import { playChime } from "../coce/room/sound.ts";
import { serverNow } from "../coce/room/hooks.ts";
import { Hall } from "../sim/hallway.tsx";
import { LocalTime } from "../room-bar.tsx";
import type { Lang } from "../i18n.ts";
import { testAfter, TESTS, type Mock } from "./api.ts";
import { useMockWords } from "./words.ts";
export function Break({ mock, lang, onContinue, busy }: {
    mock: Mock;
    lang: Lang;
    onContinue: () => void;
    busy: boolean;
}) {
    const w = useMockWords(lang);
    const stage = mock.stage as "break1" | "break2" | "break3";
    const next = testAfter(stage);
    const until = Date.parse(mock.breakUntil ?? "") || serverNow();
    const [left, setLeft] = useState(() => Math.max(0, (until - serverNow()) / 1000));
    const rang = useRef(false);
    const over = left <= 0;
    useEffect(() => {
        const id = setInterval(() => setLeft(Math.max(0, (until - serverNow()) / 1000)), 250);
        return () => clearInterval(id);
    }, [until]);
    useEffect(() => {
        if (!over || rang.current)
            return;
        rang.current = true;
        playChime();
        const title = document.title;
        let on = false;
        const blink = setInterval(() => { on = !on; document.title = on ? w.tabAlert : title; }, 1000);
        const stop = () => { if (document.visibilityState === "visible") {
            clearInterval(blink);
            document.title = title;
            document.removeEventListener("visibilitychange", stop);
        } };
        document.addEventListener("visibilitychange", stop);
        try {
            if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted")
                new Notification(w.breakOver, { body: w.notifBody(w[next]), tag: `tcfm-mock-${mock.id}` });
        }
        catch { }
        if (next !== "eo")
            onContinue();
        return () => { clearInterval(blink); document.title = title; document.removeEventListener("visibilitychange", stop); };
    }, [over]);
    const s = Math.ceil(left);
    const waitsForPress = over && next === "eo";
    return (<Hall head={<>
        <span className="sim-hall-stages num" aria-hidden="true">{TESTS.map((t) => <b key={t} data-state={t === next ? "next" : TESTS.indexOf(t) < TESTS.indexOf(next) ? "done" : undefined}>{t.toUpperCase()}</b>)}</span>
        <LocalTime lang={lang}/>
      </>} title={waitsForPress ? w.breakOver : w.breakTitle} sub={w.breakNext(w[next])} clock={waitsForPress ? undefined : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`} ai={next === "eo"} lang={lang} actions={<Button kind="primary" busy={busy} onClick={onContinue}>{waitsForPress ? w.startEo : w.continueNow}</Button>}/>);
}
