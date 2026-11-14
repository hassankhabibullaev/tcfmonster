import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Lang } from "../../i18n.ts";
import type { PickTone } from "./Picker.tsx";
import { useRoomWords } from "./words.ts";
export type RailHandle = {
    focus: () => void;
};
export type RailProps = {
    current: number;
    total: number;
    tone: (n: number) => PickTone;
    fresh?: (n: number) => boolean;
    onPick?: (n: number) => void;
    lang: Lang;
    ref?: Ref<RailHandle>;
};
const quiet = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function Rail({ current, total, tone, fresh, onPick, lang, ref }: RailProps) {
    const w = useRoomWords(lang);
    const nav = useRef<HTMLElement>(null);
    const name = (t: PickTone) => (t === "done" ? w.done : t === "todo" ? w.todo : w.legend[t]);
    const show = (block: ScrollLogicalPosition) => nav.current?.querySelector<HTMLElement>(`[aria-current="true"]`)?.scrollIntoView({ block, behavior: quiet() ? "auto" : "smooth" });
    useEffect(() => { show("nearest"); }, [current]);
    useImperativeHandle(ref, () => ({
        focus: () => {
            const el = nav.current?.querySelector<HTMLElement>(`[aria-current="true"]`);
            show("center");
            if (el && el.tagName === "BUTTON")
                el.focus({ preventScroll: true });
            else
                nav.current?.focus({ preventScroll: true });
        },
    }), []);
    return (<nav ref={nav} className="cr-rail" aria-label={w.pickerTitle} tabIndex={-1} data-no-thumb="">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const t = tone(n);
            const f = fresh?.(n) ? "" : undefined;
            const label = `${w.questionOf(n, total)} · ${name(t)}${f !== undefined ? ` · ${w.added}` : ""}`;
            const cur = n === current ? "true" : undefined;
            return onPick ? (<button key={n} type="button" className="cr-rail-item cr-disc" data-tone={t} data-fresh={f} aria-current={cur} aria-label={label} onClick={() => onPick(n)}>{n}</button>) : (<span key={n} className="cr-rail-item cr-disc" data-tone={t} data-fresh={f} aria-current={cur} aria-label={label}>{n}</span>);
        })}
    </nav>);
}
export function Strip({ current, total, tone, fresh, onPick, lang }: Omit<RailProps, "ref">) {
    const w = useRoomWords(lang);
    const nav = useRef<HTMLElement>(null);
    const name = (t: PickTone) => (t === "done" ? w.done : t === "todo" ? w.todo : w.legend[t]);
    useEffect(() => {
        const el = nav.current?.querySelector<HTMLElement>(`[aria-current="true"]`);
        el?.scrollIntoView({ inline: "center", block: "nearest", behavior: quiet() ? "auto" : "smooth" });
    }, [current, total]);
    return (<nav ref={nav} className="cr-strip" aria-label={w.pickerTitle}>
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const t = tone(n);
            const f = fresh?.(n) ? "" : undefined;
            const label = `${w.questionOf(n, total)} · ${name(t)}${f !== undefined ? ` · ${w.added}` : ""}`;
            const cur = n === current ? "true" : undefined;
            return onPick ? (<button key={n} type="button" className="cr-disc" data-tone={t} data-fresh={f} aria-current={cur} aria-label={label} onClick={() => onPick(n)}>{n}</button>) : (<span key={n} className="cr-disc" data-tone={t} data-fresh={f} aria-current={cur} aria-label={label}>{n}</span>);
        })}
    </nav>);
}
