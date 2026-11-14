import type { Level } from "../../../../shared/progress.ts";
import type { Section } from "../bank.ts";
export type AttemptMode = "exam" | "training";
export type Attempt = {
    id: string;
    section: Section;
    exam: number;
    mode?: AttemptMode;
    startedAt: string;
    deadlineAt: string;
    finishedAt: string | null;
    ended: "done" | "time" | "abandon" | null;
    score: number | null;
    nclc: number | null;
    right: number | null;
    wrong: number | null;
    blank: number | null;
    answers?: Record<string, string>;
    byLevel?: Partial<Record<Level, {
        right: number;
        of: number;
    }>>;
};
export const DURATION_MIN: Record<Section, number> = { co: 35, ce: 60 };
export const EXAM_QUESTIONS = 39;
export const placementOf = (q: {
    placement?: string;
    id: string;
}) => q.placement ?? q.id;
