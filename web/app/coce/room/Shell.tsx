import type { ReactNode } from "react";
import { BackLink } from "../../../ui/ui.tsx";
import type { Section } from "../bank.ts";
import { RoomBar, type RoomClock } from "../../room-bar.tsx";
import type { Lang } from "../../i18n.ts";
export type Progress = {
    n: number;
    total: number;
    parts: {
        green?: number;
        amber?: number;
        red?: number;
        done?: number;
    };
    onOpen: () => void;
    label: string;
    popup?: boolean;
};
export type ShellProps = {
    mode: "practice" | "exam" | "review";
    section: Section;
    onBack?: () => void;
    backLabel?: string;
    title: ReactNode;
    progress: Progress;
    rail?: ReactNode;
    helps?: ReactNode;
    clock?: RoomClock | null;
    lang: Lang;
    band?: ReactNode;
    left: ReactNode;
    right: ReactNode;
    foot: ReactNode;
    children?: ReactNode;
    sub?: string;
    code?: ReactNode;
    subline?: string;
    more?: ReactNode;
    mid?: ReactNode;
    english?: boolean;
    strip?: ReactNode;
};
export function Shell({ mode, section, onBack, backLabel, title, progress, rail, helps, clock, lang, band, left, right, foot, children, sub, code, subline, more, strip, mid, english }: ShellProps) {
    const exam = mode === "exam";
    return (<div className="cr" data-mode={mode} data-section={section} data-band={band ? "" : undefined} data-mock={sub ? "" : undefined} data-strip={strip ? "" : undefined} data-english={english || undefined}>
      <RoomBar className="cr-head" lang={lang} time={exam} clock={clock} left={<>
          {onBack && <BackLink onClick={onBack} label={backLabel ?? ""} word={false}/>}
          <div className="cr-title-block">
            <h1 className="cr-title sim-caps">
              {code ? <><span className="desk-only cr-title-text">{title}</span><span className="mob-only cr-title-code num">{code}</span></> : title}
              {sub && <span className="room-sub num">{sub}</span>}
            </h1>
          </div>
          {helps && <div className="cr-helps">{helps}</div>}
          {exam && <ProgressBar p={progress}/>}
        </>} centre={<>{!exam && <ProgressBar p={progress}/>}{mid && <span className="cr-title-mid mob-only num">{mid}</span>}</>} right={<>{subline && <span className="cr-title-sub mob-only num">{subline}</span>}{more}</>}/>
      {band && <div className="cr-band" role="status">{band}</div>}
      <div className="cr-body" data-rail={rail ? "" : undefined}>
        {rail}
        <section className="cr-left">{left}</section>
        <section className="cr-right">{right}</section>
      </div>
      <footer className="cr-foot">
        {strip && <div className="cr-foot-strip">{strip}</div>}
        <div className="cr-foot-row">{foot}</div>
      </footer>
      {children}
    </div>);
}
function ProgressBar({ p }: {
    p: Progress;
}) {
    const t = Math.max(1, p.total);
    const w = (n: number | undefined) => `${((n ?? 0) / t) * 100}%`;
    const { green = 0, amber = 0, red = 0 } = p.parts;
    const coloured = p.parts.done === undefined;
    return (<button type="button" className="cr-bar" onClick={p.onOpen} aria-haspopup={p.popup ? "dialog" : undefined} aria-label={p.label} title={p.label}>
      {p.total > 0 && <span className="cr-bar-n num" aria-hidden="true">{p.n} / {p.total}</span>}
      <span className="cr-bar-track" aria-hidden="true">
        {green ? <i className="cr-bar-green" style={{ width: w(green) }}/> : null}
        {amber ? <i className="cr-bar-amber" style={{ width: w(amber) }}/> : null}
        {red ? <i className="cr-bar-red" style={{ width: w(red) }}/> : null}
        {p.parts.done ? <i className="cr-bar-done" style={{ width: w(p.parts.done) }}/> : null}
      </span>
      {coloured && p.total > 0 && (<span className="cr-bar-dots num" aria-hidden="true">
          <span><i className="cr-bar-green"/>{green}</span>
          <span><i className="cr-bar-amber"/>{amber}</span>
          <span><i className="cr-bar-red"/>{red}</span>
          <span><i className="cr-bar-grey"/>{Math.max(0, p.total - green - amber - red)}</span>
        </span>)}
    </button>);
}
export function Switch({ label, offLabel, on, onChange, disabled = false }: {
    label: string;
    offLabel?: string;
    on: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
}) {
    return (<button type="button" className="cr-switch" data-two={offLabel ? "" : undefined} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}>
      {offLabel && <span className="cr-switch-off">{offLabel}</span>}
      <i className="cr-switch-track" aria-hidden="true"><i className="cr-switch-knob"/></i>
      <span className="cr-switch-on">{label}</span>
    </button>);
}
