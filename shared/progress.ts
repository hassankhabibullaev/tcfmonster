export type Section = "co" | "ce";
export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type Key = "A" | "B" | "C" | "D";
export type Colour = "green" | "red" | "amber";
export const LEVELS: readonly Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const POINTS: Record<Level, number> = { A1: 3, A2: 9, B1: 15, B2: 21, C1: 26, C2: 33 };
export const EXAM_COUNT: Record<Level, number> = { A1: 4, A2: 6, B1: 9, B2: 10, C1: 6, C2: 4 };
export function levelOfPosition(pos: number): Level {
    if (pos <= 4)
        return "A1";
    if (pos <= 10)
        return "A2";
    if (pos <= 19)
        return "B1";
    if (pos <= 29)
        return "B2";
    if (pos <= 35)
        return "C1";
    return "C2";
}
export type Entry = {
    s: Colour;
    t: number;
    a: Key | null;
};
export type State = {
    v: 1;
    q: Record<string, Entry>;
    pos: number | null;
    x?: Record<string, number>;
};
export type EventType = "answer" | "mark" | "reset" | "pos";
export type Event = {
    id: string;
    section: Section;
    level: Level;
    t: number;
    type: EventType;
    qid?: string;
    key?: Key;
    right?: boolean;
    s?: "green" | "amber";
    n?: number;
    dt?: number;
};
export const emptyState = (): State => ({ v: 1, q: {}, pos: null });
export const MERGED: Record<string, string> = {
    "07ddf1fa-7637-5c07-aae8-cf913d457ef3": "b20f517a-9a64-5a99-95df-7d219e3db596",
    "eb2b3a01-f95a-5464-a997-459ba1129e75": "5f496ab8-dd59-4fc5-8428-bdb522a0e8e2",
    "c24767f2-d89e-5a9e-aac4-19be5bceb5f8": "18a0c124-76c4-4c9a-bec4-e67d17be8066",
    "3305894f-8572-55e8-ac2c-312027279d8b": "0e7130d6-d517-4a59-bdab-ed40b012b49d",
    "af59f853-d354-5197-af75-7f1100186f3c": "6b5f9f2e-a5b1-4022-a1e3-7e4db0a055f3",
};
export function settle(state: State): State {
    let q: Record<string, Entry> | null = null, x: Record<string, number> | null = null;
    for (const [old, kept] of Object.entries(MERGED)) {
        if (state.q[old]) {
            q ??= { ...state.q };
            if (!q[kept])
                q[kept] = q[old];
            delete q[old];
        }
        if (state.x?.[old] !== undefined) {
            x ??= { ...state.x };
            if (!q?.[kept] && !state.q[kept] && (x[kept] ?? 0) < x[old])
                x[kept] = x[old];
            delete x[old];
        }
    }
    if (!q && !x)
        return state;
    const next: State = { ...state, q: q ?? state.q };
    if (x) {
        if (Object.keys(x).length)
            next.x = x;
        else
            delete next.x;
    }
    return next;
}
function withEntry(state: State, qid: string, entry: Entry | null, at = 0): State {
    const q = { ...state.q };
    const x = { ...(state.x ?? {}) };
    if (entry) {
        q[qid] = entry;
        delete x[qid];
    }
    else {
        delete q[qid];
        x[qid] = at;
    }
    const next: State = { ...state, q };
    if (Object.keys(x).length)
        next.x = x;
    else
        delete next.x;
    return next;
}
export function apply(state: State, e: Event): State {
    if (e.type === "pos") {
        const n = e.n;
        if (typeof n !== "number" || !Number.isFinite(n) || n === state.pos)
            return state;
        return { ...state, pos: n };
    }
    const qid = typeof e.qid === "string" ? MERGED[e.qid] ?? e.qid : e.qid;
    if (typeof qid !== "string" || !qid)
        return state;
    const cur = state.q[qid];
    if (cur && !(e.t > cur.t))
        return state;
    const gone = state.x?.[qid];
    if (gone !== undefined && !(e.t > gone))
        return state;
    if (e.type === "answer") {
        const key = e.key ?? null;
        if (!cur)
            return withEntry(state, qid, { s: e.right ? "green" : "red", t: e.t, a: key });
        if (cur.s === "red")
            return withEntry(state, qid, { s: e.right ? "amber" : "red", t: e.t, a: key });
        return state;
    }
    if (e.type === "mark") {
        if (!cur || cur.s === "red" || (e.s !== "green" && e.s !== "amber"))
            return state;
        return withEntry(state, qid, { s: e.s, t: e.t, a: cur.a });
    }
    if (e.type === "reset") {
        if (!cur)
            return state;
        return withEntry(state, qid, null, e.t);
    }
    return state;
}
export function counts(state: State, n: number): {
    green: number;
    red: number;
    amber: number;
    grey: number;
} {
    let green = 0, red = 0, amber = 0;
    for (const k in state.q) {
        if (MERGED[k])
            continue;
        const s = state.q[k].s;
        if (s === "green")
            green++;
        else if (s === "red")
            red++;
        else if (s === "amber")
            amber++;
    }
    return { green, red, amber, grey: Math.max(0, n - green - red - amber) };
}
