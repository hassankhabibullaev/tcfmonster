import type { Evaluation } from "./eval/evaluate.ts";
import type { Skill, TaskNo } from "./config.ts";
import { RUBRIC } from "./eval/rubric.ts";
export type Marks = {
    stage: "transcript" | "full";
    score20: number;
    taskScore: number | null;
    taskScoreMax: number | null;
    criteria: {
        name: string;
        score: number;
    }[];
    locked: string[];
};
const num = (v: unknown, lo: number, hi: number): number | null => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 100) / 100 : null;
};
export function marksOf(skill: Skill, task: TaskNo, v: unknown): Marks | null {
    if (!v || typeof v !== "object" || Array.isArray(v))
        return null;
    const e = v as Partial<Evaluation> & Record<string, unknown>;
    const names = new Set((RUBRIC[skill]?.[task] ?? []).map((c) => c.name));
    const score20 = num(e.score20, 0, 20);
    if (score20 == null)
        return null;
    const criteria = (Array.isArray(e.criteria) ? e.criteria : []).flatMap((c) => {
        const r = c as {
            name?: unknown;
            score?: unknown;
        };
        const score = num(r?.score, 0, 20);
        return typeof r?.name === "string" && names.has(r.name) && score != null ? [{ name: r.name, score }] : [];
    });
    const locked = (Array.isArray(e.locked) ? e.locked : []).filter((n): n is string => typeof n === "string" && names.has(n));
    return {
        stage: e.stage === "full" ? "full" : "transcript",
        score20,
        taskScore: num(e.taskScore, 0, 20),
        taskScoreMax: num(e.taskScoreMax, 0, 20),
        criteria: [...new Map(criteria.map((c) => [c.name, c])).values()],
        locked: [...new Set(locked)],
    };
}
