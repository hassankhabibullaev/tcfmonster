import type { Level, Question } from "./deps.ts";
export type Hit = {
    level: Level;
    n: number;
    snippet: string;
};
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SNIPPET_BEFORE = 32;
const SNIPPET_AFTER = 64;
export function snippetOf(text: string, at: number, length: number): string {
    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(text.length, at + length + SNIPPET_AFTER);
    const piece = text.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "…" : ""}${piece}${end < text.length ? "…" : ""}`;
}
const textsOf = (q: Question): string[] => [q.stem, ...q.options.map((o) => o.text ?? ""), q.transcript ?? "", q.passage ?? ""].filter((t) => t.length > 0);
export function searchQuestions(bank: Partial<Record<Level, Question[]>>, levels: readonly Level[], query: string, limit = 20): Hit[] {
    const needle = fold(query.trim());
    if (needle.length < 2)
        return [];
    const hits: Hit[] = [];
    for (const level of levels) {
        const qs = bank[level];
        if (!qs)
            continue;
        for (let i = 0; i < qs.length && hits.length < limit; i++) {
            for (const text of textsOf(qs[i])) {
                const at = fold(text).indexOf(needle);
                if (at < 0)
                    continue;
                hits.push({ level, n: i + 1, snippet: snippetOf(text, at, needle.length) });
                break;
            }
        }
        if (hits.length >= limit)
            break;
    }
    return hits;
}
