import type { Level } from "../../../shared/progress.ts";
import { isFresh } from "../../../shared/exams.ts";
export type Section = "co" | "ce";
export type Key = "A" | "B" | "C" | "D";
export type Option = {
    key: Key;
    text: string | null;
    textEn: string | null;
    reason: string | null;
};
export type Word = {
    w: string;
    s: number;
    e: number;
    p?: 1;
};
export type Segments = {
    options: [
        number,
        number
    ][] | null;
    question: [
        number,
        number
    ] | null;
};
export type Question = {
    id: string;
    section: Section;
    level: Level;
    stem: string;
    stemEn: string | null;
    options: Option[];
    answer: Key;
    hint: {
        fr: string;
        en: string;
    } | null;
    keySentence: string | null;
    keySentenceEn: string | null;
    explanation: string | null;
    audio: string | null;
    image: string | null;
    transcript: string | null;
    transcriptEn: string | null;
    words: Word[] | null;
    segments: Segments | null;
    maxPlays: number;
    passage: string | null;
    passageEn: string | null;
    passageImage: string | null;
    practiceOnly: boolean;
    added?: string | null;
    placement?: string;
    position?: number;
};
export type BankIndex = {
    builtAt: string;
    points: Record<Level, number>;
    examCount: Record<Level, number>;
    levels: Record<Section, Record<Level, number>>;
    exams: Record<Section, number> | number;
    added?: {
        day: string;
        exams: Record<Section, number[]>;
        levels: Record<Section, Partial<Record<Level, number>>>;
    }[];
};
const cache = new Map<string, Promise<unknown>>();
const get = (path: string) => fetch(path, { credentials: "same-origin" });
function load<T>(path: string): Promise<T> {
    let p = cache.get(path) as Promise<T> | undefined;
    if (!p) {
        p = get(path).then(async (r) => {
            if (r.status === 401)
                location.replace(`/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`);
            if (r.status === 403 && ((await r.clone().json().catch(() => null)) as {
                error?: string;
            } | null)?.error === "blocked")
                location.replace("/sign-in?blocked");
            if (!r.ok)
                throw new Error(`${path}: ${r.status}`);
            return r.json() as Promise<T>;
        });
        p.catch(() => cache.delete(path));
        cache.set(path, p);
    }
    return p;
}
export const loadIndex = () => load<BankIndex>("/data/bank.json");
export function freshSections(index: BankIndex | null | undefined, day: string): Set<Section> {
    const out = new Set<Section>();
    for (const b of index?.added ?? []) {
        if (!isFresh(b.day, day))
            continue;
        for (const s of ["co", "ce"] as const)
            if ((b.exams?.[s]?.length ?? 0) > 0 || Object.keys(b.levels?.[s] ?? {}).length > 0)
                out.add(s);
    }
    return out;
}
export const loadLevel = (section: Section, level: Level) => load<Question[]>(`/data/${section}-${level}.json`).then((qs) => qs.filter((q) => q.section === section && q.level === level));
export const loadExam = (section: Section, nn: number) => load<Question[]>(`/data/exam-${section}-${String(nn).padStart(2, "0")}.json`).then((qs) => qs.filter((q) => (q.position ?? 0) >= 1 && (q.position ?? 0) <= 39));
export const numberOf = (questions: Question[], id: string) => questions.findIndex((q) => q.id === id) + 1;
