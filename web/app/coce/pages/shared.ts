import { useCallback, useEffect, useState } from "react";
import { api, ApiError, unauthorized } from "../../api.ts";
import type { Level } from "./deps.ts";
export type CoceSection = "co" | "ce";
export type Ended = "done" | "time" | "abandon";
export type AttemptMode = "exam" | "training";
export type AttemptRow = {
    id: string;
    section: CoceSection;
    exam: number;
    mode?: AttemptMode;
    startedAt: string | number;
    deadlineAt: string | number;
    finishedAt: string | number | null;
    ended: Ended | null;
    score: number | null;
    nclc: number | null;
    right: number | null;
    wrong: number | null;
    blank: number | null;
};
export type Attempt = AttemptRow & {
    answers?: Record<string, string>;
    byLevel?: Partial<Record<Level, {
        right: number;
        of: number;
    }>>;
};
export { EXAMS } from "../../../../shared/exams.ts";
export const EXAM_QUESTIONS = 39;
export const DURATION_MIN: Record<CoceSection, number> = { co: 35, ce: 60 };
export function toMs(v: string | number | null | undefined): number {
    if (v == null)
        return NaN;
    if (typeof v === "number")
        return v < 1e12 ? v * 1000 : v;
    if (/^\d+$/.test(v))
        return toMs(Number(v));
    const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(" ", "T") + "Z" : v;
    return Date.parse(s);
}
export const dayOf = (v: string | number) => { const d = new Date(toMs(v)); return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const isRunning = (a: AttemptRow) => a.ended == null && a.finishedAt == null;
export function countdown(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}
const NCLC_FLOOR: Record<CoceSection, [
    number,
    number
][]> = {
    co: [[549, 10], [523, 9], [503, 8], [458, 7], [398, 6], [369, 5], [331, 4]],
    ce: [[549, 10], [524, 9], [499, 8], [453, 7], [406, 6], [375, 5], [342, 4]],
};
export function nclcOf(section: CoceSection, score: number): number | null {
    for (const [floor, n] of NCLC_FLOOR[section])
        if (score >= floor)
            return n;
    return null;
}
export function cefrOf(score: number): "A1" | "A2" | "B1" | "B2" | "C1" | "C2" {
    return score >= 600 ? "C2" : score >= 500 ? "C1" : score >= 400 ? "B2" : score >= 300 ? "B1" : score >= 200 ? "A2" : "A1";
}
export function latestScore(attempts: AttemptRow[]): {
    score: number;
    nclc: number | null;
} | null {
    const done = attempts.filter((a) => !isRunning(a) && a.score != null);
    if (!done.length)
        return null;
    const last = done.reduce((x, y) => (toMs(y.startedAt) > toMs(x.startedAt) ? y : x));
    return { score: last.score!, nclc: last.nclc };
}
export const sallePath = (a: Pick<AttemptRow, "section" | "exam"> & {
    mode?: AttemptMode | null;
}) => `/${a.section}/exam/${a.exam}/room${a.mode === "training" ? "?mode=training" : ""}`;
const START_KEY = "tcfm-start";
export function armStart(section: CoceSection, exam: number) {
    try {
        sessionStorage.setItem(START_KEY, `${section}-${exam}`);
    }
    catch { }
}
export function takeStart(section: CoceSection, exam: number) {
    try {
        const ok = sessionStorage.getItem(START_KEY) === `${section}-${exam}`;
        sessionStorage.removeItem(START_KEY);
        return ok;
    }
    catch {
        return true;
    }
}
export const resultPath = (a: Pick<AttemptRow, "section" | "exam" | "id">) => `/${a.section}/exam/${a.exam}/result/${a.id}`;
let offset = 0;
export const serverNow = () => Date.now() + offset;
export type RunningMock = {
    id: number;
    stage: string;
    stageStartedAt: string | null;
    breakUntil: string | null;
    status: string;
    finishedAt: string | null;
} & Record<string, unknown>;
export async function fetchRunning(): Promise<{
    attempt: Attempt | null;
    mock: RunningMock | null;
}> {
    const r = await fetch("/api/attempts/running", { credentials: "same-origin" });
    const date = r.headers.get("date");
    if (date) {
        const t = Date.parse(date);
        if (!isNaN(t))
            offset = t - Date.now();
    }
    if (r.status === 401)
        unauthorized();
    if (!r.ok)
        throw new Error(String(r.status));
    const d = (await r.json().catch(() => ({}))) as {
        attempt?: Attempt | null;
        mock?: RunningMock | null;
    };
    return { attempt: d.attempt ?? null, mock: d.mock ?? null };
}
type RunningState = {
    attempt: Attempt | null;
    mock: RunningMock | null;
    loaded: boolean;
};
let runningState: RunningState = { attempt: null, mock: null, loaded: false };
let runningAt = 0;
let inFlight: Promise<void> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const runningListeners = new Set<(s: RunningState) => void>();
const FRESH_MS = 5 * 60000, POLL_MS = 120000;
const publish = (s: RunningState) => { runningState = s; runningListeners.forEach((l) => l(s)); schedulePoll(); };
function askRunning(force = false): Promise<void> {
    if (!force && runningState.loaded && Date.now() - runningAt < FRESH_MS)
        return Promise.resolve();
    if (inFlight)
        return inFlight;
    inFlight = fetchRunning()
        .then(({ attempt, mock }) => { runningAt = Date.now(); publish({ attempt, mock, loaded: true }); })
        .catch(() => publish({ ...runningState, loaded: true }))
        .finally(() => { inFlight = null; });
    return inFlight;
}
function schedulePoll() {
    const want = runningListeners.size > 0 && !!(runningState.attempt || runningState.mock) && typeof document !== "undefined" && !document.hidden;
    if (want && !pollTimer)
        pollTimer = setInterval(() => void askRunning(true), POLL_MS);
    if (!want && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", () => { if (!document.hidden && runningListeners.size)
        void askRunning(); schedulePoll(); });
export const refreshRunning = () => { void askRunning(true); };
export const seedRunning = (r: {
    attempt: Attempt | null;
    mock: RunningMock | null;
} | undefined) => {
    if (!r)
        return;
    runningAt = Date.now();
    publish({ attempt: r.attempt ?? null, mock: r.mock ?? null, loaded: true });
};
export const noteRunning = (attempt: Attempt | null) => { runningAt = Date.now(); publish({ ...runningState, attempt, loaded: true }); };
export const currentRunning = () => askRunning().then(() => runningState);
export function useRunning(on = true) {
    const [state, setState] = useState<RunningState>(runningState);
    useEffect(() => {
        if (!on)
            return;
        runningListeners.add(setState);
        setState(runningState);
        void askRunning();
        schedulePoll();
        return () => { runningListeners.delete(setState); schedulePoll(); };
    }, [on]);
    const reload = useCallback(() => { void askRunning(true); }, []);
    const set = useCallback((attempt: Attempt | null) => publish({ ...runningState, attempt, loaded: true }), []);
    return { ...state, reload, set };
}
export async function deleteAttempt(id: string | number): Promise<void> {
    let r: Response;
    try {
        r = await fetch(`/api/attempts/${id}`, { method: "DELETE", credentials: "same-origin" });
    }
    catch {
        throw new ApiError(0, { error: "network" });
    }
    const data = await r.json().catch(() => ({}));
    if (r.status === 401)
        unauthorized();
    if (!r.ok)
        throw new ApiError(r.status, data);
    forgetExam(id);
}
export const finishAttempt = (id: string, ended: "done" | "abandon") => api<{
    attempt: Attempt;
}>(`/attempts/${id}/finish`, { ended }).then((d) => { forgetExam(id); return d.attempt; });
export const forgetExam = (id: string | number) => { try {
    localStorage.removeItem(`tcfm-exam-${id}`);
}
catch { } };
