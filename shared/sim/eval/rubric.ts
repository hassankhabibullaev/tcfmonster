import { SPEAKING, WRITING, type Skill, type TaskNo } from "../config.ts";
export type Criterion = {
    name: string;
    weight: number;
    kind: "task" | "language";
    source: "transcript" | "audio";
    ceiling?: boolean;
};
export const SCORE_MAX = 20;
const T = "transcript" as const;
const WRITTEN: Criterion[] = [
    { name: "Task completion", weight: 1, kind: "task", source: T },
    { name: "Organization", weight: 0.5, kind: "task", source: T },
    { name: "Vocabulary", weight: 1, kind: "language", source: T },
    { name: "Grammar", weight: 1.5, kind: "language", source: T },
    { name: "Spelling", weight: 1, kind: "language", source: T, ceiling: false },
];
const SPOKEN: Criterion[] = [
    { name: "Task completion", weight: 1, kind: "task", source: T },
    { name: "Organization", weight: 0.5, kind: "task", source: T },
    { name: "Vocabulary", weight: 1, kind: "language", source: T },
    { name: "Grammar", weight: 1.5, kind: "language", source: T },
    { name: "Fluency", weight: 1, kind: "language", source: "audio" },
    { name: "Pronunciation", weight: 1, kind: "language", source: "audio" },
];
export const RUBRIC: Record<Skill, Record<TaskNo, Criterion[]>> = {
    writing: { 1: WRITTEN, 2: WRITTEN, 3: WRITTEN },
    speaking: { 1: SPOKEN, 2: SPOKEN, 3: SPOKEN },
};
export const TASK_MARGIN = 3;
export const OVERALL_MARGIN = 1;
export type CriterionScore = {
    name: string;
    score: number;
    reason?: string;
};
export const LEVEL_RANGE: Record<string, [
    number,
    number
]> = { A1: [1, 3], A2: [4, 5], "B1-": [6, 7], "B1+": [8, 9], "B2-": [10, 11], "B2+": [12, 13], C1: [14, 15], "C2-": [16, 17], "C2+": [18, 20] };
export function scoreInLevel(level: string | undefined, score: number): number {
    const r = level ? LEVEL_RANGE[level] : undefined;
    const n = Math.round(Number.isFinite(score) ? score : 0);
    if (n === 0 || !r)
        return Math.max(0, Math.min(SCORE_MAX, n));
    return Math.max(r[0], Math.min(r[1], n));
}
export type ScoredCriterion = CriterionScore & {
    weight: number;
    kind: Criterion["kind"];
    source: Criterion["source"];
    cappedFrom?: number;
};
export type ScoreResult = {
    criteria: ScoredCriterion[];
    locked: string[];
    languageAverage: number;
    score20: number;
    ceilingApplied: boolean;
    taskScoreMax: number;
};
export function scoreFromCriteria(skill: Skill, task: TaskNo, given: CriterionScore[]): ScoreResult {
    const crit = RUBRIC[skill][task];
    const clamp = (n: number) => Math.max(0, Math.min(SCORE_MAX, Number.isFinite(n) ? n : 0));
    const have = crit.flatMap((c) => {
        const g = given.find((x) => x.name === c.name);
        return g ? [{ ...c, score: clamp(g.score), reason: g.reason }] : [];
    });
    const lang = have.filter((c) => c.kind === "language" && c.ceiling !== false);
    const languageAverage = lang.length ? lang.reduce((s, c) => s + c.score, 0) / lang.length : SCORE_MAX;
    const criteria: ScoredCriterion[] = have.map((c) => {
        const cap = languageAverage + TASK_MARGIN;
        return c.kind === "task" && c.score > cap ? { ...c, score: Number(cap.toFixed(1)), cappedFrom: c.score } : c;
    });
    const wsum = criteria.reduce((s, c) => s + c.weight, 0);
    const mean = wsum ? criteria.reduce((s, c) => s + c.score * c.weight, 0) / wsum : 0;
    const ceiling = languageAverage + OVERALL_MARGIN;
    return {
        criteria,
        locked: crit.filter((c) => !have.some((h) => h.name === c.name)).map((c) => c.name),
        languageAverage: Number(languageAverage.toFixed(2)),
        score20: mean > ceiling ? Math.floor(ceiling + 1e-9) : Number(mean.toFixed(2)),
        ceilingApplied: mean > ceiling,
        taskScoreMax: maxPointsOf(skill, task),
    };
}
export const CAPS = {
    empty: 0,
    offTask: 6,
    missingElement: 11,
    register: 11,
    lengthMinor: 11,
    lengthMajor: 8,
    lengthMajorDeviation: 0.25,
    shortSpeech: 8,
    shortSpeechRatio: 0.4,
} as const;
export type Fulfilment = {
    textTypeOk: boolean;
    registerOk: boolean;
    requiredElementsMissing: string[];
};
export type LengthFacts = {
    wordCount: number;
    min: number;
    max: number;
};
export function maxPointsOf(skill: Skill, task: TaskNo): number {
    return skill === "writing" ? WRITING.tasks[task].maxPoints : SPEAKING.tasks[task].maxPoints;
}
export function applyCaps(score20: number, f: Fulfilment, opts: {
    empty?: boolean;
    length?: LengthFacts | null;
    speechRatio?: number | null;
}): {
    score20: number;
    caps: string[];
} {
    const caps: {
        cap: number;
        why: string;
    }[] = [];
    if (opts.empty)
        caps.push({ cap: CAPS.empty, why: "production vide ou inaudible" });
    if (!f.textTypeOk)
        caps.push({ cap: CAPS.offTask, why: "hors sujet ou mauvais type de texte / de tâche" });
    if (f.requiredElementsMissing.length)
        caps.push({ cap: CAPS.missingElement, why: `élément obligatoire absent : ${f.requiredElementsMissing.join(", ")}` });
    if (!f.registerOk)
        caps.push({ cap: CAPS.register, why: "registre inadapté" });
    if (opts.length) {
        const { wordCount, min, max } = opts.length;
        if (wordCount < min || wordCount > max) {
            const dev = wordCount < min ? (min - wordCount) / min : (wordCount - max) / max;
            const major = dev > CAPS.lengthMajorDeviation;
            caps.push({ cap: major ? CAPS.lengthMajor : CAPS.lengthMinor, why: `${wordCount} mots hors de la fourchette ${min}–${max} (écart ${Math.round(dev * 100)} %)` });
        }
    }
    if (opts.speechRatio != null && opts.speechRatio < CAPS.shortSpeechRatio)
        caps.push({ cap: CAPS.shortSpeech, why: `temps de parole ${Math.round(opts.speechRatio * 100)} % de la durée de la tâche` });
    const capped = caps.reduce((s, c) => Math.min(s, c.cap), score20);
    return { score20: Math.round(capped), caps: caps.filter((c) => c.cap < score20).map((c) => `${c.why} → plafond ${c.cap}/20`) };
}
