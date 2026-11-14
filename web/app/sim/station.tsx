import { useEffect, type ReactNode } from "react";
import { Icon, MonsterAI } from "../../ui/ui";
import { RoomBar } from "../room-bar.tsx";
import { touchActive } from "./active-session";
import { useSimWords } from "./words";
import type { Lang } from "../i18n";
export function useLeaveGuard(active: boolean) {
    useEffect(() => {
        if (!active)
            return;
        touchActive();
        const id = setInterval(touchActive, 10000);
        const onHide = () => touchActive();
        document.addEventListener("visibilitychange", onHide);
        window.addEventListener("pagehide", onHide);
        const onUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener("beforeunload", onUnload);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onHide);
            window.removeEventListener("pagehide", onHide);
            window.removeEventListener("beforeunload", onUnload);
            touchActive();
        };
    }, [active]);
}
export type Step = {
    taskNo: number;
    done: boolean;
    active: boolean;
    words?: number;
};
export function Station({ skill, steps, onSelect, secondsLeft, running = true, warnUnder = 20, blinkUnder = 10, children, foot, lang, sub }: {
    skill: "writing" | "speaking";
    steps: Step[];
    onSelect?: (index: number) => void;
    secondsLeft: number | null;
    running?: boolean;
    warnUnder?: number;
    blinkUnder?: number;
    children: ReactNode;
    foot?: ReactNode;
    lang: Lang;
    sub?: string;
}) {
    const w = useSimWords(lang);
    const shown = secondsLeft ?? 0;
    const live = secondsLeft != null && running;
    const stepsList = (<ol className="room-steps" aria-label={w.steps}>
            {steps.map((s, i) => {
            const inner = (<>
                  {s.done && <Icon name="check" size={14}/>}
                  <span className="room-step-word">{w.taskN(s.taskNo)}</span>
                  <span className="room-step-no num">{s.taskNo}</span>
                </>);
            const state = s.done ? "done" : s.active ? "current" : (s.words ?? 0) > 0 ? "started" : "next";
            return (<li key={s.taskNo}>
                  {onSelect ? (<button type="button" className="room-step" data-state={state} aria-current={s.active ? "step" : undefined} aria-label={w.taskN(s.taskNo)} onClick={() => onSelect(i)}>{inner}</button>) : (<span className="room-step" data-state={state} aria-current={s.active ? "step" : undefined}>{inner}</span>)}
                </li>);
        })}
          </ol>);
    return (<div className="room" data-skill={skill} data-foot={foot ? "" : undefined} data-mock={sub ? "" : undefined}>
      <RoomBar lang={lang} time steps={stepsList} left={<><span className="room-name sim-caps">{skill === "writing" ? w.ee : w.eo}{sub && <span className="room-sub num">{sub}</span>}</span><span className="room-code mob-only num">{skill === "writing" ? "EE" : "EO"}{sub && <span className="room-sub num">{sub}</span>}</span></>} clock={{ secondsLeft: Math.round(shown), idle: !live, warnUnder, blinkUnder, label: live && shown <= 0 ? w.timeUp : w.timeLeft }}/>
      {children}
      {foot && <div className="room-foot">{foot}</div>}
      <span className="room-powered"><MonsterAI powered lang={lang}/></span>
    </div>);
}
