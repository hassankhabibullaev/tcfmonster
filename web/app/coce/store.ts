import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, unauthorized } from "../api.ts";
import { cached } from "../api-cache.ts";
import { apply, emptyState, settle, LEVELS, type Event, type Level, type State } from "../../../shared/progress.ts";
import type { Key, Question, Section } from "./bank.ts";
export type { Event, Level, State };
const LEGACY_KEY = "tcfm-queue";
const OWNER_KEY = "tcfm-owner";
const SOON_MS = 60000;
const MAX_MS = 180000;
const HOLD_MS = 15 * 60000;
const RETRY_MS = 60000;
type Levels = Record<Level, State>;
type Load = "idle" | "loading" | "ready" | "failed";
let base: Partial<Record<Section, Levels>> = {};
const load: Record<Section, Load> = { co: "idle", ce: "idle" };
let owner: string | null = null;
let queue: Event[] = [];
const acked = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const l of listeners)
    l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const queueKey = () => (owner ? `tcfm-queue:${owner}` : null);
function readKey(key: string | null): Event[] {
    if (!key)
        return [];
    try {
        const v = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string" && typeof e.t === "number") : [];
    }
    catch {
        return [];
    }
}
const readQueue = () => readKey(queueKey());
function writeQueue() {
    const key = queueKey();
    if (!key)
        return;
    try {
        if (queue.length)
            localStorage.setItem(key, JSON.stringify(queue));
        else
            localStorage.removeItem(key);
    }
    catch { }
}
function mergeStored() {
    const mine = new Set(queue.map((e) => e.id));
    const extra = readQueue().filter((e) => !mine.has(e.id) && !acked.has(e.id));
    if (extra.length)
        queue = [...queue, ...extra].sort((a, b) => a.t - b.t);
}
export function setOwner(id: string | null) {
    if (id === owner)
        return;
    clearTimers();
    base = {};
    load.co = load.ce = "idle";
    viewCache.clear();
    sectionCache.clear();
    acked.clear();
    owner = id;
    queue = [];
    if (id) {
        try {
            const last = localStorage.getItem(OWNER_KEY);
            const legacy = readKey(LEGACY_KEY);
            if (legacy.length && (!last || last === id)) {
                queue = legacy;
                writeQueue();
            }
            localStorage.removeItem(LEGACY_KEY);
            localStorage.setItem(OWNER_KEY, id);
        }
        catch { }
        mergeStored();
        if (queue.length)
            schedule();
    }
    emit();
}
export const ownerId = () => owner;
export function forgetDevice() {
    try {
        const keysOf = (st: Storage) => Array.from({ length: st.length }, (_, i) => st.key(i)).filter((k): k is string => !!k);
        for (const k of keysOf(localStorage))
            if (/^tcfm-(draft|progress|exam|active-session|cache)/.test(k))
                localStorage.removeItem(k);
        for (const k of keysOf(sessionStorage))
            if (k.startsWith("expr-session-"))
                sessionStorage.removeItem(k);
    }
    catch { }
    try {
        indexedDB.deleteDatabase("tcfm-clips");
    }
    catch { }
}
const viewCache = new Map<string, {
    version: number;
    state: State;
}>();
function levelState(section: Section, level: Level): State {
    const k = `${section}/${level}`;
    const hit = viewCache.get(k);
    if (hit && hit.version === version)
        return hit.state;
    let s = settle(base[section]?.[level] ?? emptyState());
    for (const e of queue)
        if (e.section === section && e.level === level)
            s = apply(s, e);
    viewCache.set(k, { version, state: s });
    return s;
}
const sectionCache = new Map<Section, {
    version: number;
    levels: Levels;
}>();
function sectionLevels(section: Section): Levels | null {
    if (load[section] !== "ready" && load[section] !== "failed")
        return null;
    const hit = sectionCache.get(section);
    if (hit && hit.version === version)
        return hit.levels;
    const levels = Object.fromEntries(LEVELS.map((l) => [l, levelState(section, l)])) as Levels;
    sectionCache.set(section, { version, levels });
    return levels;
}
async function ensureLoaded(section: Section, force = false) {
    if (!force && load[section] !== "idle" && load[section] !== "failed")
        return;
    load[section] = "loading";
    emit();
    try {
        const d = force ? await api<{
            levels: Partial<Record<Level, State>>;
        }>(`/progress?section=${section}`) : await cached<{
            levels: Partial<Record<Level, State>>;
        }>(`/progress?section=${section}`);
        base[section] = Object.fromEntries(LEVELS.map((l) => [l, d.levels?.[l] ?? emptyState()])) as Levels;
        load[section] = "ready";
    }
    catch {
        base[section] ??= Object.fromEntries(LEVELS.map((l) => [l, emptyState()])) as Levels;
        load[section] = "failed";
        setTimeout(() => { if (load[section] === "failed")
            void ensureLoaded(section, true); }, RETRY_MS);
    }
    emit();
}
let soonTimer: ReturnType<typeof setTimeout> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let holdUntil = 0;
let sending: Promise<void> | null = null;
function schedule() {
    if (soonTimer)
        clearTimeout(soonTimer);
    soonTimer = setTimeout(() => void flush(), SOON_MS);
    if (!maxTimer)
        maxTimer = setTimeout(() => void flush(), MAX_MS);
}
function clearTimers() {
    if (soonTimer)
        clearTimeout(soonTimer);
    if (maxTimer)
        clearTimeout(maxTimer);
    soonTimer = maxTimer = null;
}
export function flush(leaving = false): Promise<void> {
    if (sending)
        return sending;
    clearTimers();
    mergeStored();
    if (!owner || !queue.length || Date.now() < holdUntil)
        return Promise.resolve();
    const who = owner;
    const sent = queue.slice(0, 300);
    sending = (async () => {
        try {
            const r = await fetch("/api/sync", {
                method: "POST", credentials: "same-origin", keepalive: leaving,
                headers: { "content-type": "application/json" }, body: JSON.stringify({ events: sent }),
            });
            if (owner !== who)
                return;
            if (r.status === 401) {
                unauthorized();
                return;
            }
            if (!r.ok) {
                schedule();
                return;
            }
            const d = (await r.json().catch(() => ({}))) as {
                ok?: boolean;
                hold?: boolean;
            };
            if (d.hold) {
                holdUntil = Date.now() + HOLD_MS;
                setTimeout(() => void flush(), HOLD_MS);
                return;
            }
            if (!d.ok) {
                schedule();
                return;
            }
            const ids = new Set(sent.map((e) => e.id));
            for (const e of sent) {
                const b = base[e.section];
                if (b)
                    b[e.level] = apply(b[e.level], e);
                acked.add(e.id);
            }
            queue = queue.filter((e) => !ids.has(e.id));
            writeQueue();
            emit();
            if (queue.length)
                schedule();
        }
        catch {
            if (owner === who)
                schedule();
        }
        finally {
            sending = null;
        }
    })();
    return sending;
}
export const pendingCount = () => queue.length;
function push(ev: Event) {
    if (!owner)
        return;
    queue = [...queue, ev];
    writeQueue();
    emit();
    schedule();
}
let lastT = 0;
function stamp() {
    const t = Math.max(Date.now() / 1000, lastT + 0.001);
    lastT = t;
    return Math.round(t * 1000) / 1000;
}
const uuid = () => (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && queue.length)
        void flush(true); });
    window.addEventListener("pagehide", () => { if (queue.length)
        void flush(true); });
    window.addEventListener("online", () => { if (queue.length)
        void flush(); });
}
export type LevelStore = {
    state: State;
    answer: (q: Question, key: Key, dt?: number) => boolean;
    mark: (qid: string, s: "green" | "amber") => void;
    reset: (qid: string) => void;
    resetLevel: () => void;
    setPos: (n: number) => void;
    synced: boolean;
};
export const record = {
    answer(section: Section, level: Level, q: Question, key: Key, dt?: number) {
        const right = key === q.answer;
        push({ id: uuid(), section, level, t: stamp(), type: "answer", qid: q.id, key, right, ...(dt !== undefined ? { dt: Math.max(0, Math.min(600, Math.round(dt))) } : {}) });
        return right;
    },
    mark(section: Section, level: Level, qid: string, s: "green" | "amber") { push({ id: uuid(), section, level, t: stamp(), type: "mark", qid, s }); },
    reset(section: Section, level: Level, qid: string) { push({ id: uuid(), section, level, t: stamp(), type: "reset", qid }); },
    resetLevel(section: Section, level: Level) {
        for (const qid of Object.keys(levelState(section, level).q))
            push({ id: uuid(), section, level, t: stamp(), type: "reset", qid });
    },
    pos(section: Section, level: Level, n: number) { if (levelState(section, level).pos !== n)
        push({ id: uuid(), section, level, t: stamp(), type: "pos", n }); },
};
export const stateOf = (section: Section, level: Level) => levelState(section, level);
export const load_ = (section: Section, force = false) => ensureLoaded(section, force);
export function useLevel(section: Section, level: Level): LevelStore {
    useEffect(() => { void ensureLoaded(section); }, [section]);
    const state = useSyncExternalStore(subscribe, () => levelState(section, level));
    const synced = useSyncExternalStore(subscribe, () => !queue.some((e) => e.section === section && e.level === level));
    const answer = useCallback((q: Question, key: Key, dt?: number) => record.answer(section, level, q, key, dt), [section, level]);
    const mark = useCallback((qid: string, s: "green" | "amber") => record.mark(section, level, qid, s), [section, level]);
    const reset = useCallback((qid: string) => record.reset(section, level, qid), [section, level]);
    const setPos = useCallback((n: number) => record.pos(section, level, n), [section, level]);
    const resetLevel = useCallback(() => record.resetLevel(section, level), [section, level]);
    return { state, answer, mark, reset, resetLevel, setPos, synced };
}
export function useSection(section: Section): {
    levels: Levels | null;
    refresh: () => Promise<void>;
} {
    useEffect(() => { void ensureLoaded(section); }, [section]);
    const levels = useSyncExternalStore(subscribe, () => sectionLevels(section));
    const refresh = useCallback(() => ensureLoaded(section, true), [section]);
    return { levels, refresh };
}
