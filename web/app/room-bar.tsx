import { useEffect, useState, type ReactNode } from "react";
import { Clock } from "../ui/ui.tsx";
import type { Lang } from "./i18n.ts";
export type RoomClock = {
    secondsLeft: number;
    idle?: boolean;
    warnUnder?: number;
    blinkUnder?: number;
    label: string;
};
export function LocalTime({ lang }: {
    lang: Lang;
}) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 5000); return () => clearInterval(id); }, []);
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    void lang;
    return <span className="room-time num" role="timer" aria-label={`${hh}:${mm}`}>{hh}<span className="room-time-colon" aria-hidden="true">:</span>{mm}</span>;
}
export function RoomBar({ className, left, time, lang, centre, clock, steps, right }: {
    className?: string;
    left: ReactNode;
    time?: boolean;
    lang: Lang;
    centre?: ReactNode;
    clock?: RoomClock | null;
    steps?: ReactNode;
    right?: ReactNode;
}) {
    return (<header className={`room-bar${className ? ` ${className}` : ""}`} data-steps={steps ? "" : undefined}>
      <div className="room-bar-left">{left}</div>
      <div className="room-bar-centre">{centre ?? (time ? <LocalTime lang={lang}/> : null)}</div>
      <div className="room-bar-right">
        {right}
        {clock && <Clock secondsLeft={Math.max(0, clock.secondsLeft)} idle={!!clock.idle} warnUnder={clock.warnUnder ?? 300} blinkUnder={clock.blinkUnder ?? 60} label={clock.label}/>}
      </div>
      {steps && <div className="room-bar-steps">{steps}</div>}
    </header>);
}
