import { cached } from "../api-cache.ts";
import { currentRunning } from "../coce/pages/shared.ts";
import { useCallback, useEffect, useState } from "react";
import { call, serverNow } from "../coce/room/hooks.ts";
import { advance, stageEndsAt } from "../../../worker/mock/clock.ts";
import type { Answer, Mock, MockRow, Stage, TestStage } from "../../../worker/mock/types.ts";
export type { Mock, MockRow, Stage, TestStage, Answer };
export { advance, stageEndsAt };
export { STAGE_SECONDS, BREAK_SECONDS, TESTS, isTest, isBreak } from "../../../worker/mock/types.ts";
export { testAfter, breakAfter } from "../../../worker/mock/clock.ts";
export class MockApiError extends Error {
    status: number;
    data: Record<string, unknown>;
    constructor(status: number, data: Record<string, unknown>) { super(String(data?.error ?? status)); this.status = status; this.data = data ?? {}; }
}
async function ask<T>(path: string, init?: RequestInit & {
    json?: unknown;
}): Promise<T> {
    const { status, data } = await call<T & {
        error?: string;
    }>(path, init).catch(() => ({ status: 0, data: { error: "network" } as T & {
            error?: string;
        } }));
    if (status === 0 || status >= 400)
        throw new MockApiError(status, (data ?? {}) as Record<string, unknown>);
    return data;
}
export const startMock = (micMode: "live" | "ptt") => ask<{
    mock: Mock;
}>("/mock", { json: { micMode } }).then((d) => d.mock);
export const getMock = (id: number | string) => ask<{
    mock: Mock;
}>(`/mock/${id}`).then((d) => d.mock);
export const fetchRunningMock = () => ask<{
    mock: MockRow | null;
}>("/mock/running").then((d) => d.mock);
export const listMocks = () => cached<{
    mocks: MockRow[];
}>("/mock/list").then((d) => d.mocks);
export const nextMock = (id: number, from: Stage, how: "done" | "abandon" = "done") => ask<{
    mock: Mock;
}>(`/mock/${id}/next`, { json: { from, how } }).then((d) => d.mock);
export const abandonMock = (id: number) => ask<{
    mock: Mock;
}>(`/mock/${id}/abandon`, { json: {} }).then((d) => d.mock);
export const finalizeMock = (id: number) => ask<{
    mock: Mock;
}>(`/mock/${id}/finalize`, { json: {} }).then((d) => d.mock);
export const beginMock = (id: number) => ask<{
    mock: Mock;
}>(`/mock/${id}/begin`, { json: {} }).then((d) => d.mock);
export const deleteMock = (id: number) => ask<{
    ok: true;
}>(`/mock/${id}`, { method: "DELETE" });
export const patchMock = (id: number, stage: "co" | "ce", answers: Record<string, Answer>, keepalive = false) => ask<{
    mock: Mock;
}>(`/mock/${id}`, { method: "PATCH", keepalive, json: { stage, answers, at: new Date(serverNow()).toISOString() } }).then((d) => d.mock);
export const currentStage = (m: MockRow, now = serverNow()) => (m.finishedAt ? { stage: m.stage, stageStartedAt: m.stageStartedAt, breakUntil: m.breakUntil } : advance({ stage: m.stage, stageStartedAt: m.stageStartedAt, breakUntil: m.breakUntil }, now));
export const testOfStage = (s: Stage): TestStage | null => (s === "co" || s === "break1" ? (s === "co" ? "co" : "ce") : s === "ce" || s === "break2" ? (s === "ce" ? "ce" : "ee") : s === "ee" || s === "break3" ? (s === "ee" ? "ee" : "eo") : s === "eo" ? "eo" : null);
export const stageIndex = (s: Stage): number => (s === "co" || s === "break1" ? 1 : s === "ce" || s === "break2" ? 2 : s === "ee" || s === "break3" ? 3 : 4);
const listeners = new Set<() => void>();
export const refreshMock = () => { listeners.forEach((l) => l()); try {
    window.dispatchEvent(new Event("tcfm:mock"));
}
catch { } };
export function useRunningMock(on = true, every = 120000) {
    const [state, setState] = useState<{
        mock: MockRow | null;
        loaded: boolean;
    }>({ mock: null, loaded: false });
    const fromShared = useCallback(() => { currentRunning().then((r) => setState({ mock: (r.mock as unknown as MockRow) ?? null, loaded: true })).catch(() => setState((s) => ({ ...s, loaded: true }))); }, []);
    const load = useCallback(() => { fetchRunningMock().then((mock) => setState({ mock, loaded: true })).catch(() => setState((s) => ({ ...s, loaded: true }))); }, []);
    useEffect(() => {
        if (!on)
            return;
        fromShared();
        listeners.add(load);
        const back = () => { if (!document.hidden)
            load(); };
        document.addEventListener("visibilitychange", back);
        return () => { listeners.delete(load); document.removeEventListener("visibilitychange", back); };
    }, [on, load]);
    const running = !!state.mock && !state.mock.finishedAt;
    useEffect(() => {
        if (!on || !running)
            return;
        const id = setInterval(() => { if (!document.hidden)
            load(); }, every);
        return () => clearInterval(id);
    }, [on, running, every, load]);
    const set = useCallback((mock: MockRow | null) => setState({ mock, loaded: true }), []);
    return { ...state, reload: load, set };
}
