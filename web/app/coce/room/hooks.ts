import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { unauthorized } from "../../api.ts";
const onlineSub = (l: () => void) => { window.addEventListener("online", l); window.addEventListener("offline", l); return () => { window.removeEventListener("online", l); window.removeEventListener("offline", l); }; };
export const useOnline = () => useSyncExternalStore(onlineSub, () => navigator.onLine, () => true);
const mq = typeof matchMedia === "function" ? matchMedia("(max-width: 760px)") : null;
const mqSub = (l: () => void) => { mq?.addEventListener("change", l); return () => mq?.removeEventListener("change", l); };
export const usePhone = () => useSyncExternalStore(mqSub, () => mq?.matches ?? false, () => false);
export type KeyHandlers = {
    digit?: (n: number) => void;
    enter?: () => void;
    space?: () => void;
    esc?: () => void;
    left?: () => void;
    right?: () => void;
};
export function useKeys(enabled: boolean, handlers: KeyHandlers) {
    const ref = useRef(handlers);
    ref.current = handlers;
    useEffect(() => {
        if (!enabled)
            return;
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey || e.ctrlKey || e.altKey)
                return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
                return;
            if (document.querySelector("dialog[open]"))
                return;
            const h = ref.current;
            if (e.key >= "1" && e.key <= "4" && h.digit) {
                e.preventDefault();
                h.digit(Number(e.key));
            }
            else if (e.key === "Enter" && h.enter) {
                if (t && t.tagName === "BUTTON" && t !== document.body)
                    return;
                e.preventDefault();
                h.enter();
            }
            else if ((e.key === " " || e.code === "Space") && h.space) {
                if (t && t.tagName === "BUTTON" && t.classList.contains("cr-opt"))
                    return;
                e.preventDefault();
                h.space();
            }
            else if (e.key === "Escape" && h.esc) {
                e.preventDefault();
                h.esc();
            }
            else if (e.key === "ArrowLeft" && h.left) {
                e.preventDefault();
                h.left();
            }
            else if (e.key === "ArrowRight" && h.right) {
                e.preventDefault();
                h.right();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [enabled]);
}
let offsetMs = 0;
let offsetKnown = false;
export function noteServerDate(r: Response) {
    const d = r.headers.get("date");
    if (!d)
        return;
    const t = Date.parse(d);
    if (Number.isNaN(t))
        return;
    offsetMs = t + 500 - Date.now();
    offsetKnown = true;
}
export const serverNow = () => Date.now() + offsetMs;
export const serverClockKnown = () => offsetKnown;
export async function call<T = unknown>(path: string, init?: RequestInit & {
    json?: unknown;
}): Promise<{
    status: number;
    data: T;
}> {
    const { json, ...rest } = init ?? {};
    let r: Response;
    try {
        r = await fetch(`/api${path}`, {
            credentials: "same-origin", ...rest,
            ...(json !== undefined ? { method: rest.method ?? "POST", headers: { "content-type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) } : {}),
        });
    }
    catch {
        throw { status: 0 };
    }
    noteServerDate(r);
    if (r.status === 401)
        unauthorized();
    const data = (await r.json().catch(() => ({}))) as T;
    return { status: r.status, data };
}
export const fmtClock = (s: number) => { const v = Math.max(0, Math.round(s)); return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };
export const fmtTime = (s: number) => { if (!Number.isFinite(s))
    return "0:00"; const v = Math.max(0, Math.floor(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };
export function useFlash(trigger: boolean, ms = 1800) {
    const [on, setOn] = useState(false);
    const was = useRef(trigger);
    useEffect(() => {
        if (trigger && !was.current) {
            setOn(true);
            const id = setTimeout(() => setOn(false), ms);
            was.current = trigger;
            return () => clearTimeout(id);
        }
        was.current = trigger;
    }, [trigger, ms]);
    return on;
}
