import type { StartedSession } from "./types";
export type ActiveSession = {
    session: StartedSession;
    startedAtMs: number;
    endAtMs: number;
    seenAtMs?: number;
};
const KEY = "tcfm-active-session";
export const RESUME_WINDOW_MS = 5 * 60 * 1000;
export function loadActive(): ActiveSession | null {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return null;
        const a = JSON.parse(raw) as ActiveSession;
        return a?.session?.sessionId ? a : null;
    }
    catch {
        return null;
    }
}
export function saveActive(a: ActiveSession | null) {
    try {
        if (a)
            localStorage.setItem(KEY, JSON.stringify(a));
        else
            localStorage.removeItem(KEY);
    }
    catch { }
}
export function touchActive() {
    const a = loadActive();
    if (a)
        saveActive({ ...a, seenAtMs: Date.now() });
}
export function takeResumable(): ActiveSession | null {
    const a = loadActive();
    if (!a)
        return null;
    const seen = a.seenAtMs ?? a.startedAtMs;
    if (Date.now() - seen <= RESUME_WINDOW_MS && a.endAtMs > Date.now())
        return a;
    saveActive(null);
    void fetch(`/api/expr/session/${a.session.sessionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "abandoned" }) }).catch(() => { });
    return null;
}
