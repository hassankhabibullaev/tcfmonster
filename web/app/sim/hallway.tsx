import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MonsterAI } from "../../ui/ui";
import { playCount } from "../coce/room/sound";
const SECOND_MS = 1000;
export const ANNOUNCE_MS = 2000;
export type HallProps = {
    title: ReactNode;
    sub?: ReactNode;
    count?: boolean;
    announceMs?: number;
    onDone?: () => void;
    clock?: ReactNode;
    rows?: ReactNode;
    actions?: ReactNode;
    ai?: boolean;
    busy?: boolean;
    lang?: "fr" | "en";
    head?: ReactNode;
};
export function Hall({ title, sub, count = false, announceMs = ANNOUNCE_MS, onDone, clock, rows, actions, ai = false, busy = false, lang = "fr", head }: HallProps) {
    const [n, setN] = useState(count ? 3 : 0);
    const done = useRef(onDone);
    done.current = onDone;
    useEffect(() => {
        if (!count)
            return;
        playCount(n);
        if (n <= 0)
            return;
        const id = setTimeout(() => setN((c) => c - 1), SECOND_MS);
        return () => clearTimeout(id);
    }, [count, n]);
    useEffect(() => {
        if (n > 0 || !onDone)
            return;
        const id = setTimeout(() => done.current?.(), announceMs);
        return () => clearTimeout(id);
    }, [n]);
    const counting = count && n > 0;
    return createPortal(<div className="sim-hall" role="dialog" aria-live="assertive" aria-busy={busy || undefined}>
      {head && <div className="sim-hall-head">{head}</div>}
      <img className="sim-hall-logo" src="/app-icon.svg" alt="" width="64" height="64"/>
      {counting ? (<div className="sim-hall-count" key={n}>{n}</div>) : (<div className="sim-hall-stack" key="announce">
          <div className="sim-hall-title">{title}</div>
          {sub && <div className="sim-hall-sub">{sub}</div>}
          {ai && <div className="sim-hall-ai"><MonsterAI powered lang={lang}/></div>}
          {clock && <div className="sim-hall-clock num">{clock}</div>}
          {busy && <div className="sim-hall-busy" aria-hidden="true"><i /><i /><i /></div>}
          {rows && <div className="sim-hall-rows">{rows}</div>}
          {actions && <div className="sim-hall-acts">{actions}</div>}
        </div>)}
    </div>, document.body);
}
export function Hallway({ title, sub, ai = false, onDone, lang }: {
    title: ReactNode;
    sub?: ReactNode;
    ai?: boolean;
    onDone: () => void;
    lang?: "fr" | "en";
}) {
    return <Hall count title={title} sub={sub} ai={ai} onDone={onDone} lang={lang}/>;
}
